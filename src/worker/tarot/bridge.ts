/**
 * Redeem a Fortune Stick reward and attach it to Tarot's anonymous browser
 * session.
 *
 * The browser only carries a code. Tarot trusts none of it: it asks the Stick's
 * own Worker whether it issued that code and for which day, over a service
 * binding (env.STICK, `GET /api/tarot-claims/:id`). The code is 32 random bytes
 * the Stick stored when it made the claim, so it cannot be guessed or forged,
 * and there is no shared secret to configure or leak.
 */

import { now } from '../db';
import { HttpError, type Env } from '../types';
import { freeDay } from './referrals';

/** 32 random bytes as base64url, exactly as the Stick issues them. */
const CLAIM_ID = /^[A-Za-z0-9_-]{43}$/;

export type StickRedeemStatus =
  | 'granted'
  | 'already_available'
  | 'daily_limit'
  | 'expired'
  | 'invalid'
  | 'unavailable';

/**
 * Ask the Stick about a code: the day it is good for, or null if it never
 * issued it. Any other failure (the Stick down, mid-deploy, not bound) is a 503,
 * which the page answers with a retry; the code is not spent by it.
 *
 * STICK_CLAIMS_URL is for local development only, where the two apps run as
 * separate dev servers: when set, the Stick is reached over plain HTTP instead.
 */
async function lookupClaim(env: Env, code: string): Promise<{ day: string } | null> {
  if (!CLAIM_ID.test(code)) return null;
  const path = `/api/tarot-claims/${code}`;
  let response: Response;
  try {
    const devBase = env.STICK_CLAIMS_URL?.trim();
    if (devBase) {
      response = await fetch(new URL(path, devBase));
    } else if (env.STICK) {
      response = await env.STICK.fetch(new Request(`https://fortune-stick${path}`));
    } else {
      throw new Error('no Stick binding');
    }
  } catch {
    throw new HttpError(503, 'bridge_unavailable', 'The Fortune Stick could not be reached.');
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new HttpError(503, 'bridge_unavailable', 'The Fortune Stick could not be reached.');
  }
  const body = (await response.json().catch(() => null)) as { claim?: { day?: unknown } } | null;
  const day = body?.claim?.day;
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new HttpError(503, 'bridge_unavailable', 'The Fortune Stick answered in a way Tarot does not understand.');
  }
  return { day };
}

/** Verify and store a claim once per Tarot session and Taiwan day. */
export async function redeemStickBonus(
  env: Env,
  sessionId: string,
  token: string,
): Promise<{ status: StickRedeemStatus }> {
  const found = await lookupClaim(env, token);
  if (!found) return { status: 'invalid' };
  if (found.day !== freeDay()) return { status: 'expired' };
  const claim = { id: token, day: found.day };

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
