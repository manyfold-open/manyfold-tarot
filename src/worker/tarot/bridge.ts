/**
 * Verify a one-day Fortune Stick claim and attach it to Tarot's anonymous
 * browser session. The claim is a bearer token, but the HMAC is shared only by
 * the two Workers; the browser never gets the secret.
 */

import { now } from '../db';
import { HttpError, type Env } from '../types';
import { freeDay } from './referrals';

const encoder = new TextEncoder();
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const READING_ID = /^[0-9a-f-]{36}$/i;

interface StickClaim {
  v: 1;
  iss: 'fortune-stick';
  aud: 'tarot';
  id: string;
  day: string;
  exp: number;
}

export type StickRedeemStatus =
  | 'granted'
  | 'already_available'
  | 'daily_limit'
  | 'expired'
  | 'invalid'
  | 'unavailable';

const fromBase64Url = (value: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
    const binary = atob(base64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
};

async function verifyClaim(env: Env, token: string): Promise<StickClaim | null> {
  const secret = env.TAROT_BRIDGE_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new HttpError(503, 'bridge_unavailable', 'The Fortune Stick reward is not configured.');
  }
  if (token.length > 2048) return null;
  const [payloadPart, signaturePart, extra] = token.split('.');
  if (!payloadPart || !signaturePart || extra !== undefined) return null;
  const signature = fromBase64Url(signaturePart);
  const payloadBytes = fromBase64Url(payloadPart);
  if (!signature || !payloadBytes) return null;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(payloadPart));
  if (!valid) return null;

  let claim: unknown;
  try {
    claim = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  if (!claim || typeof claim !== 'object') return null;
  const value = claim as Partial<StickClaim>;
  if (
    value.v !== 1 ||
    value.iss !== 'fortune-stick' ||
    value.aud !== 'tarot' ||
    typeof value.id !== 'string' ||
    !READING_ID.test(value.id) ||
    typeof value.day !== 'string' ||
    !DAY.test(value.day) ||
    typeof value.exp !== 'number' ||
    !Number.isInteger(value.exp)
  ) {
    return null;
  }
  return value as StickClaim;
}

/** Verify and store a claim once per Tarot session and Taiwan day. */
export async function redeemStickBonus(
  env: Env,
  sessionId: string,
  token: string,
): Promise<{ status: StickRedeemStatus }> {
  const claim = await verifyClaim(env, token);
  if (!claim) return { status: 'invalid' };
  if (claim.day !== freeDay() || claim.exp <= Math.floor(Date.now() / 1000)) {
    return { status: 'expired' };
  }

  const used = await env.DB.prepare(
    'SELECT 1 AS used FROM tarot_daily_extra WHERE session_id = ? AND day = ?',
  )
    .bind(sessionId, claim.day)
    .first<{ used: number }>();
  if (used) return { status: 'daily_limit' };

  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO tarot_stick_rewards
       (token_id, session_id, day, redeemed_at, created_at)
     SELECT ?, ?, ?, NULL, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM tarot_daily_extra WHERE session_id = ? AND day = ?
     )
     RETURNING token_id`,
  )
    .bind(claim.id, sessionId, claim.day, now(), sessionId, claim.day)
    .first<{ token_id: string }>();
  if (inserted) return { status: 'granted' };

  const existing = await env.DB.prepare(
    `SELECT redeemed_at FROM tarot_stick_rewards WHERE session_id = ? AND day = ?`,
  )
    .bind(sessionId, claim.day)
    .first<{ redeemed_at: string | null }>();
  if (existing) {
    return { status: existing.redeemed_at ? 'daily_limit' : 'already_available' };
  }
  return { status: 'unavailable' };
}
