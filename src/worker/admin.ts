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
 * There is exactly one password: the ADMIN_PASSWORD secret. It exists only in
 * Cloudflare's secret store, so it can be anything the operator likes — short,
 * memorable, whatever they will actually type. Set it and it opens the console.
 * Leave it unset and nothing opens the console.
 *
 * That second sentence used to read differently. A default lock shipped here as a
 * salted digest, so that a deployment arrived locked instead of waiting for
 * someone to remember to lock it. The idea was right and the shape was wrong, in a
 * way that only showed up once this repository was public: the plaintext behind
 * that digest was never committed — that was the entire point — so anyone who
 * forked the repo inherited a lock they had no key to, while whoever minted it
 * kept one. A default that locks the owner out and the author in is not a default,
 * it is a back door with good intentions.
 *
 * So an unconfigured deployment is closed rather than default-locked. No password
 * opens it, `adminConfigured` tells the browser to say which secret to set instead
 * of showing an input that cannot succeed, and the property worth keeping is kept:
 * the console is never open on arrival. It is now shut against everyone equally,
 * including us.
 */

import { safeEqual } from './crypto';
import type { Env } from './types';

/** The secret, trimmed, or null when the deployment never set one. */
const configuredPassword = (env: Env): string | null => {
  const value = (env.ADMIN_PASSWORD ?? '').trim();
  return value.length > 0 ? value : null;
};

/**
 * Whether this deployment has an admin password at all.
 *
 * The browser is told, so the gate can name the secret to set rather than ask for
 * a password that does not exist. This gives a stranger nothing they could not
 * learn by typing one guess and being refused, and it gives an operator who has
 * just deployed the one sentence they need — the alternative is a locked door with
 * no instructions on it, which is how a fork ends up abandoned.
 */
export const adminConfigured = (env: Env): boolean => configuredPassword(env) !== null;

/**
 * True when this request may act as the operator.
 *
 * The compare is constant-time, so the response cannot be timed to learn how much
 * of a guess was right. Two cases answer false before comparing anything: no
 * secret set (there is nothing to be right about), and an empty supplied password
 * (every request from a browser that has not been unlocked, and no secret that
 * it was empty).
 */
export function adminPasswordOk(env: Env, supplied: string): boolean {
  const configured = configuredPassword(env);
  if (configured === null || supplied.length === 0) return false;
  return safeEqual(supplied, configured);
}

/**
 * Whether the console asks for a password at all — always. Kept as a named export
 * rather than a literal `true` at the call site so that the day someone wants an
 * open deployment again, there is one obvious place to say so.
 */
export const adminRequired = (): boolean => true;
