/**
 * The test browser: one visitor the reading limit does not apply to.
 *
 * Verifying the reader means running all four spreads against the real agent,
 * and the free reading is one a day. Rather than make that a permanent hole,
 * a browser presents a token once and is remembered for a while.
 *
 * The Worker holds only the token's SHA-256 (`TAROT_TEST_TOKEN_SHA256`), which
 * is safe to keep in a public repository — the token is 32 random bytes, so the
 * hash cannot be walked back to it — and is the reason no secret has to be
 * provisioned on Cloudflare. Unset, nothing matches and no browser can become a
 * tester. Revoking is emptying the var and deploying.
 *
 * What a tester skips is the count of readings a day, and nothing else: the
 * per-hour meters in ratelimit.ts still apply, so a leaked token can spend a
 * few readings an hour, not an unbounded amount of the agent's budget. Their
 * readings stay identifiable — the session is in tarot_testers.
 */

import { now } from '../db';
import type { Env } from '../types';

export const TESTER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const HEX_SHA256 = /^[0-9a-f]{64}$/;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Same time whatever the input, so a wrong guess learns nothing from how long it took. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

/** True only when a hash is configured and `token` hashes to it. */
export async function verifyTesterToken(env: Env, token: string): Promise<boolean> {
  const expected = (env.TAROT_TEST_TOKEN_SHA256 ?? '').trim().toLowerCase();
  if (!HEX_SHA256.test(expected)) return false;
  return constantTimeEqual(await sha256Hex(token.trim()), expected);
}

/** Remembers this session as a tester until the pass runs out. */
export async function grantTester(env: Env, sessionId: string): Promise<string> {
  const expiresAt = new Date(Date.now() + TESTER_TTL_MS).toISOString();
  await env.DB.prepare(
    `INSERT INTO tarot_testers (session_id, created_at, expires_at) VALUES (?, ?, ?)
     ON CONFLICT (session_id) DO UPDATE SET expires_at = excluded.expires_at`,
  )
    .bind(sessionId, now(), expiresAt)
    .run();
  return expiresAt;
}

/** A pass that has run out, or a hash that has since been removed, is no pass. */
export async function isTester(env: Env, sessionId: string): Promise<boolean> {
  if (!HEX_SHA256.test((env.TAROT_TEST_TOKEN_SHA256 ?? '').trim().toLowerCase())) return false;
  const row = await env.DB.prepare(
    'SELECT 1 AS ok FROM tarot_testers WHERE session_id = ? AND expires_at > ?',
  )
    .bind(sessionId, now())
    .first<{ ok: number }>();
  return row !== null;
}
