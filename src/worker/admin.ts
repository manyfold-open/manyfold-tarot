/**
 * Who gets into the operator console.
 *
 * This file draws the line the whole deployment rests on. The reading is public:
 * a visitor opens `/`, asks a question, and turns three cards without ever
 * meeting a password. That side is protected by a meter rather than a lock
 * (src/worker/tarot/ratelimit.ts) — a stranger may spend a little of the
 * owner's agent budget, and that is the price of a public tarot site. The
 * console is the other side: connecting agents, disconnecting them, reading the
 * agent list, chatting with one. None of that is a visitor's business, and all
 * of it is behind the check below.
 *
 * Two sources for the password, in this order:
 *
 *   1. the ADMIN_PASSWORD secret, compared as plaintext. This is the real lock.
 *      The value exists only in Cloudflare's secret store, so it can be anything
 *      the operator likes — short, memorable, whatever they will actually type.
 *   2. failing that, the digest below. This is what makes the deployment arrive
 *      locked rather than waiting for someone to remember to lock it.
 *
 * The second source is the one that needs explaining, because this repository is
 * public: anybody can read the salt and the digest. That is survivable only
 * because of how the password behind them was chosen — sixteen characters drawn
 * uniformly from a thirty-one character alphabet, a shade under 80 bits. Salted
 * SHA-256 is cheap to compute, so assume the attacker manages a trillion guesses
 * a second; at that rate this one outlasts the sun.
 *
 * Which means the rule for anyone editing this file: the default password may be
 * rotated, but it may never be replaced with one a human invented. A memorable
 * password with a published digest is not a lock, it is a formality. If you want
 * a memorable password, set the secret — nobody can read that.
 */

import { safeEqual } from './crypto';
import type { Env } from './types';

/** A salt and the SHA-256 of salt + password. Neither half means anything alone. */
export interface Lock {
  salt: string;
  digest: string;
}

/**
 * The lock this deployment ships with. Rotate both fields together — a salt
 * changed without its digest locks the console against everyone, including the
 * owner:
 *
 *   node -e 'const c=require("node:crypto");const A="abcdefghjkmnpqrstuvwxyz23456789";
 *   const p=[...Array(4)].map(()=>[...Array(4)].map(()=>A[c.randomInt(A.length)]).join("")).join("-");
 *   const s=c.randomBytes(16).toString("base64");
 *   console.log(p,s,c.createHash("sha256").update(s+p).digest("hex"))'
 */
export const DEFAULT_LOCK: Lock = {
  salt: 'xqo3RjG+ywIQJS/b/jVfoQ==',
  digest: 'b6b1008e23cdc5f127d349dfeb0c4bc53e6be6f10019b7eaaa271aeacf8cc083',
};

const enc = new TextEncoder();

const hex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

/** The secret, or null when the deployment never set one. */
const configuredPassword = (env: Env): string | null => {
  const value = (env.ADMIN_PASSWORD ?? '').trim();
  return value.length > 0 ? value : null;
};

export async function matchesLock(lock: Lock, supplied: string): Promise<boolean> {
  if (supplied.length === 0) return false;
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(lock.salt + supplied));
  return safeEqual(hex(digest), lock.digest);
}

/**
 * True when this request may act as the operator.
 *
 * Both branches compare in constant time, so the response cannot be timed to
 * learn how much of a guess was right. The empty string is rejected before the
 * digest is computed — that is the overwhelmingly common case (every request
 * from a browser that has not been unlocked), and it is no secret that no
 * password was sent.
 *
 * `lock` is a parameter and not a closed-over constant for one reason: the tests
 * need to exercise this branch with a password they are allowed to write down.
 * The shipped one is not — that is the entire point of committing a digest — so
 * a test that pinned it would undo the file it is testing.
 */
export async function adminPasswordOk(
  env: Env,
  supplied: string,
  lock: Lock = DEFAULT_LOCK,
): Promise<boolean> {
  const configured = configuredPassword(env);
  if (configured !== null) return safeEqual(supplied, configured);
  return matchesLock(lock, supplied);
}

/**
 * Whether the console asks for a password at all — always, now that a default
 * ships with the code. Kept as a named export rather than a literal `true` at
 * the call site so that the day someone wants an open deployment again, there is
 * one obvious place to say so.
 */
export const adminRequired = (): boolean => true;
