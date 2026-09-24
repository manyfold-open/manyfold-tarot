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
  /** Whether today's free reading (see freeDay) has been spent. */
  freeUsed: boolean;
  credits: number;
  canRead: boolean;
  /** The one daily extra slot has already been used, from any source. */
  dailyExtraUsed: boolean;
  /** A Stick reward is available for today's extra slot. */
  stickBonusAvailable: boolean;
  /**
   * The finished reading an invite can hang off, so the home page can offer a
   * link without the visitor having to find their old reading. A reading whose
   * invite is still out wins over a newer one, so the link a friend may already
   * hold stays the one being watched. Null when nothing has been finished yet.
   */
  inviteReadingId: string | null;
}

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export function newReferralToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

/**
 * The day a free reading belongs to, as YYYY-MM-DD in UTC+8. The free reading
 * comes back at midnight Taipei time, the same moment for every visitor, and
 * UTC+8 has no daylight saving to make a day 23 or 25 hours long.
 */
export const freeDay = (nowMs: number = Date.now()): string =>
  new Date(nowMs + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

/** Uses today's free reading, or one daily extra reward (Stick first, then invite). */
export async function consumeReadingAccess(
  env: Env,
  sessionId: string,
): Promise<'free' | 'stick' | 'referral'> {
  const timestamp = now();

  const free = await env.DB.prepare(
    `INSERT INTO tarot_daily_free (session_id, day, created_at) VALUES (?, ?, ?)
     ON CONFLICT DO NOTHING
     RETURNING session_id`,
  )
    .bind(sessionId, freeDay(), timestamp)
    .first<{ session_id: string }>();
  if (free) return 'free';

  const day = freeDay();
  const batch = await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO tarot_daily_extra
         (session_id, day, source, source_id, created_at)
       SELECT ?, ?, source, source_id, ?
       FROM (
         SELECT 'stick' AS source, token_id AS source_id, 0 AS priority
         FROM tarot_stick_rewards
         WHERE session_id = ? AND day = ? AND redeemed_at IS NULL
         UNION ALL
         SELECT 'referral' AS source, referral_token AS source_id, 1 AS priority
         FROM tarot_rewards
         WHERE session_id = ? AND redeemed_at IS NULL
       )
       ORDER BY priority
       LIMIT 1
       RETURNING source, source_id`,
    ).bind(sessionId, day, timestamp, sessionId, day, sessionId),
    env.DB.prepare(
      `UPDATE tarot_stick_rewards SET redeemed_at = ?
       WHERE token_id = (
         SELECT source_id FROM tarot_daily_extra
         WHERE session_id = ? AND day = ? AND source = 'stick'
       ) AND session_id = ? AND day = ? AND redeemed_at IS NULL`,
    ).bind(timestamp, sessionId, day, sessionId, day),
    env.DB.prepare(
      `UPDATE tarot_rewards SET redeemed_at = ?
       WHERE referral_token = (
         SELECT source_id FROM tarot_daily_extra
         WHERE session_id = ? AND day = ? AND source = 'referral'
       ) AND session_id = ? AND redeemed_at IS NULL`,
    ).bind(timestamp, sessionId, day, sessionId),
  ]);
  const slot = (batch[0]?.results?.[0] ?? null) as
    | { source: 'stick' | 'referral'; source_id: string }
    | null;
  if (slot) return slot.source;

  throw new HttpError(
    429,
    'reading_limit',
    'No reading is left for this browser today.',
  );
}

export async function accessFor(env: Env, sessionId: string): Promise<AccessView> {
  const day = freeDay();
  const [spent, reward, extra, stick, source] = await Promise.all([
    env.DB.prepare(
      'SELECT 1 AS spent FROM tarot_daily_free WHERE session_id = ? AND day = ?',
    )
      .bind(sessionId, day)
      .first<{ spent: number }>(),
    env.DB.prepare(
      'SELECT COUNT(*) AS count FROM tarot_rewards WHERE session_id = ? AND redeemed_at IS NULL',
    )
      .bind(sessionId)
      .first<{ count: number }>(),
    env.DB.prepare(
      'SELECT 1 AS used FROM tarot_daily_extra WHERE session_id = ? AND day = ?',
    )
      .bind(sessionId, day)
      .first<{ used: number }>(),
    env.DB.prepare(
      `SELECT 1 AS available FROM tarot_stick_rewards
       WHERE session_id = ? AND day = ? AND redeemed_at IS NULL`,
    )
      .bind(sessionId, day)
      .first<{ available: number }>(),
    env.DB.prepare(
    `SELECT r.id FROM tarot_readings r
     LEFT JOIN tarot_referrals f
       ON f.source_reading_id = r.id AND f.inviter_session_id = r.session_id
     WHERE r.session_id = ? AND r.status = 'interpreted'
       AND (f.status IS NULL OR f.status <> 'completed')
     ORDER BY CASE WHEN f.status = 'pending' AND f.expires_at > ? THEN 0 ELSE 1 END,
       r.created_at DESC
     LIMIT 1`,
    )
      .bind(sessionId, now())
      .first<{ id: string }>(),
  ]);
  const freeUsed = spent !== null;
  const credits = Number(reward?.count ?? 0);
  const dailyExtraUsed = extra !== null;
  const stickBonusAvailable = stick !== null && !dailyExtraUsed;
  return {
    freeUsed,
    credits,
    canRead: !freeUsed || (!dailyExtraUsed && (stickBonusAvailable || credits > 0)),
    dailyExtraUsed,
    stickBonusAvailable,
    inviteReadingId: source?.id ?? null,
  };
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

/**
 * Reads the invite belonging to one of the visitor's own readings without
 * creating or renewing anything. This is intentionally separate from
 * createReferral: reopening a finished page must be safe, and an expired
 * invitation should not silently become a new invitation just because the
 * browser asked what happened to it.
 */
export async function findReferral(
  env: Env,
  sessionId: string,
  readingId: string,
): Promise<ReferralView | null> {
  const row = await env.DB.prepare(
    `SELECT token, status, expires_at FROM tarot_referrals
     WHERE source_reading_id = ? AND inviter_session_id = ?`,
  )
    .bind(readingId, sessionId)
    .first<{ token: string; status: string; expires_at: string }>();
  return row ? viewFor(row) : null;
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
