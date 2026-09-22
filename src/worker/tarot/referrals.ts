import type { ReadingRecord } from './flow';
import { HttpError, type Env } from '../types';
import { now } from '../db';

const REFERRAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 18;

export interface ReferralView {
  token: string;
  status: 'pending' | 'completed' | 'expired';
  expiresAt: string;
}

export interface AccessView {
  freeUsed: boolean;
  credits: number;
  canRead: boolean;
}

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export function newReferralToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

const ensureAccessRow = async (env: Env, sessionId: string): Promise<void> => {
  const timestamp = now();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tarot_access (session_id, free_used, created_at, updated_at)
     SELECT ?, CASE WHEN EXISTS (
       SELECT 1 FROM tarot_readings WHERE session_id = ?
     ) THEN 1 ELSE 0 END, ?, ?`,
  )
    .bind(sessionId, sessionId, timestamp, timestamp)
    .run();
};

/** Uses the one free reading, or exactly one completed referral reward. */
export async function consumeReadingAccess(env: Env, sessionId: string): Promise<void> {
  await ensureAccessRow(env, sessionId);
  const timestamp = now();

  const free = await env.DB.prepare(
    `UPDATE tarot_access SET free_used = 1, updated_at = ?
     WHERE session_id = ? AND free_used = 0
     RETURNING session_id`,
  )
    .bind(timestamp, sessionId)
    .first<{ session_id: string }>();
  if (free) return;

  const reward = await env.DB.prepare(
    `UPDATE tarot_rewards SET redeemed_at = ?
     WHERE session_id = ? AND redeemed_at IS NULL
       AND referral_token = (
         SELECT referral_token FROM tarot_rewards
         WHERE session_id = ? AND redeemed_at IS NULL
         ORDER BY created_at, referral_token LIMIT 1
       )
     RETURNING referral_token`,
  )
    .bind(timestamp, sessionId, sessionId)
    .first<{ referral_token: string }>();
  if (reward) return;

  throw new HttpError(
    429,
    'reading_limit',
    'You have used your free reading. Invite a friend to unlock another one.',
  );
}

export async function accessFor(env: Env, sessionId: string): Promise<AccessView> {
  await ensureAccessRow(env, sessionId);
  const access = await env.DB.prepare('SELECT free_used FROM tarot_access WHERE session_id = ?')
    .bind(sessionId)
    .first<{ free_used: number }>();
  const reward = await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM tarot_rewards WHERE session_id = ? AND redeemed_at IS NULL',
  )
    .bind(sessionId)
    .first<{ count: number }>();
  const freeUsed = Number(access?.free_used ?? 0) === 1;
  const credits = Number(reward?.count ?? 0);
  return { freeUsed, credits, canRead: !freeUsed || credits > 0 };
}

const referralStatus = (status: string, expiresAt: string): ReferralView['status'] =>
  status === 'completed'
    ? 'completed'
    : Date.parse(expiresAt) <= Date.now()
      ? 'expired'
      : 'pending';

const viewFor = (row: { token: string; status: string; expires_at: string }): ReferralView => ({
  token: row.token,
  status: referralStatus(row.status, row.expires_at),
  expiresAt: row.expires_at,
});

export async function validateReferral(
  env: Env,
  token: string,
  inviteeSessionId: string,
): Promise<void> {
  const row = await env.DB.prepare(
    'SELECT token, inviter_session_id, status, expires_at FROM tarot_referrals WHERE token = ?',
  )
    .bind(token)
    .first<{ token: string; inviter_session_id: string; status: string; expires_at: string }>();
  if (!row) throw new HttpError(404, 'referral_not_found', 'That invitation does not exist.');
  if (row.inviter_session_id === inviteeSessionId) {
    throw new HttpError(400, 'referral_self', 'Invite a friend from another browser.');
  }
  if (referralStatus(row.status, row.expires_at) !== 'pending') {
    throw new HttpError(410, 'referral_expired', 'That invitation has already been used or expired.');
  }
}

export async function createReferral(
  env: Env,
  sessionId: string,
  reading: ReadingRecord,
): Promise<ReferralView> {
  if (reading.status !== 'interpreted' || !reading.interpretation) {
    throw new HttpError(409, 'not_interpreted_yet', 'Finish the reading before inviting a friend.');
  }

  const existing = await env.DB.prepare(
    `SELECT token, status, expires_at FROM tarot_referrals
     WHERE source_reading_id = ? AND inviter_session_id = ?`,
  )
    .bind(reading.id, sessionId)
    .first<{ token: string; status: string; expires_at: string }>();
  if (existing && referralStatus(existing.status, existing.expires_at) !== 'expired') {
    return viewFor(existing);
  }

  const token = newReferralToken();
  const timestamp = now();
  const expiresAt = new Date(Date.now() + REFERRAL_TTL_MS).toISOString();
  if (existing) {
    await env.DB.prepare(
      `UPDATE tarot_referrals SET token = ?, status = 'pending', invitee_session_id = NULL,
       invitee_reading_id = NULL, created_at = ?, expires_at = ?, completed_at = NULL
       WHERE source_reading_id = ? AND inviter_session_id = ?`,
    )
      .bind(token, timestamp, expiresAt, reading.id, sessionId)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO tarot_referrals
       (token, inviter_session_id, source_reading_id, status, created_at, expires_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
    )
      .bind(token, sessionId, reading.id, timestamp, expiresAt)
      .run();
  }
  return { token, status: 'pending', expiresAt };
}

export async function bindReferralToReading(
  env: Env,
  readingId: string,
  token: string,
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO tarot_referral_readings (reading_id, referral_token, created_at) VALUES (?, ?, ?)',
  )
    .bind(readingId, token, now())
    .run();
}

/**
 * Turns a completed invitee reading into one inviter reward. The insert is the
 * idempotency key; replaying the same completion cannot create another reward.
 */
export async function completeReferral(
  env: Env,
  readingId: string,
  inviteeSessionId: string,
): Promise<boolean> {
  const mapping = await env.DB.prepare(
    'SELECT referral_token FROM tarot_referral_readings WHERE reading_id = ?',
  )
    .bind(readingId)
    .first<{ referral_token: string }>();
  if (!mapping) return false;

  const timestamp = now();
  const results = await env.DB.batch([
    env.DB
      .prepare(
        `INSERT OR IGNORE INTO tarot_rewards (referral_token, session_id, redeemed_at, created_at)
         SELECT token, inviter_session_id, NULL, ? FROM tarot_referrals
         WHERE token = ? AND status = 'pending' AND expires_at > ?
           AND inviter_session_id <> ?`,
      )
      .bind(timestamp, mapping.referral_token, timestamp, inviteeSessionId),
    env.DB
      .prepare(
        `UPDATE tarot_referrals SET status = 'completed', invitee_session_id = ?,
         invitee_reading_id = ?, completed_at = ?
         WHERE token = ? AND status = 'pending'
           AND EXISTS (SELECT 1 FROM tarot_rewards WHERE referral_token = ?)
           AND invitee_reading_id IS NULL`,
      )
      .bind(inviteeSessionId, readingId, timestamp, mapping.referral_token, mapping.referral_token),
  ]);
  return Number(results[0]?.meta?.changes ?? 0) > 0;
}
