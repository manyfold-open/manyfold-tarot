/**
 * The gateway in front of the public tarot routes.
 *
 * The starter's admin password protects everything under /api/ precisely so a
 * public URL cannot be used to spend the owner's agent budget. The tarot flow
 * has to be open — it *is* the product, and a visitor cannot be asked for a
 * password before asking a question — so the protection it loses at the door is
 * paid back here: every route that can cause a billable turn passes through a
 * counter, keyed both by session and by client IP, so neither a single browser
 * nor a single host can run up a bill.
 *
 * Fixed windows rather than a token bucket: one row, one upsert, no clock
 * skew to reason about, and the failure mode (a burst at a window boundary) is
 * harmless at these limits.
 */

import { HttpError, type Env } from '../types';

export interface RateRule {
  /** Requests allowed inside one window. */
  limit: number;
  windowMs: number;
}

export const HOUR = 60 * 60 * 1000;

/**
 * The budgets. A full reading costs 1 greeting + 3 hints + 1 interpretation =
 * 5 turns, so `turns` at 120/hour leaves room for ~15 complete readings an hour
 * from one browser plus follow-ups — generous for a person, useless for a bot.
 */
export const RULES = {
  readings: { limit: 15, windowMs: HOUR } satisfies RateRule,
  turns: { limit: 120, windowMs: HOUR } satisfies RateRule,
  shares: { limit: 40, windowMs: HOUR } satisfies RateRule,
  /** Guesses at the test token, per session and per IP. */
  tester: { limit: 10, windowMs: HOUR } satisfies RateRule,
  testerPerIp: { limit: 30, windowMs: HOUR } satisfies RateRule,
  /** Per-IP ceiling, applied on top of the per-session one. */
  readingsPerIp: { limit: 60, windowMs: HOUR } satisfies RateRule,
  turnsPerIp: { limit: 400, windowMs: HOUR } satisfies RateRule,
} as const;

/** Follow-ups inside a single reading; keeps one reading from becoming a free chatbot. */
export const FOLLOW_UPS_PER_READING = 20;

export interface RateOutcome {
  allowed: boolean;
  /** Seconds until the current window rolls over. */
  retryAfterSeconds: number;
}

export const windowIndex = (nowMs: number, windowMs: number): number =>
  Math.floor(nowMs / windowMs);

export const bucketKey = (scope: string, subject: string, nowMs: number, windowMs: number): string =>
  `${scope}:${subject}:${windowIndex(nowMs, windowMs)}`;

export const secondsUntilWindowEnd = (nowMs: number, windowMs: number): number =>
  Math.max(1, Math.ceil(((windowIndex(nowMs, windowMs) + 1) * windowMs - nowMs) / 1000));

/**
 * Counts one hit against `scope:subject` and reports whether it fits.
 *
 * The upsert returns the post-increment count, so this is a single round trip
 * and two concurrent requests cannot both read "limit - 1".
 */
export async function consume(
  env: Env,
  scope: string,
  subject: string,
  rule: RateRule,
  nowMs: number = Date.now(),
): Promise<RateOutcome> {
  const bucket = bucketKey(scope, subject, nowMs, rule.windowMs);
  const row = await env.DB.prepare(
    `INSERT INTO tarot_rate (bucket, count, window_start) VALUES (?, 1, ?)
     ON CONFLICT (bucket) DO UPDATE SET count = count + 1
     RETURNING count`,
  )
    .bind(bucket, windowIndex(nowMs, rule.windowMs) * rule.windowMs)
    .first<{ count: number }>();

  const count = Number(row?.count ?? 1);
  return {
    allowed: count <= rule.limit,
    retryAfterSeconds: secondsUntilWindowEnd(nowMs, rule.windowMs),
  };
}

/** Consumes against session and IP together, and throws 429 if either is full. */
export async function enforce(
  env: Env,
  options: {
    sessionId: string;
    ip: string | null;
    scope: string;
    rule: RateRule;
    ipRule?: RateRule;
  },
): Promise<void> {
  const checks = [consume(env, options.scope, options.sessionId, options.rule)];
  if (options.ip && options.ipRule) {
    checks.push(consume(env, `${options.scope}-ip`, options.ip, options.ipRule));
  }
  const outcomes = await Promise.all(checks);
  const blocked = outcomes.find((outcome) => !outcome.allowed);
  if (blocked) {
    throw new HttpError(
      429,
      'rate_limited',
      `Too many requests. Try again in ${blocked.retryAfterSeconds} seconds.`,
    );
  }
}

/**
 * Drops windows nobody will read again.
 *
 * Called opportunistically from waitUntil rather than on a schedule: the table
 * is write-heavy and tiny, and a sweep on roughly one request in twenty keeps
 * it bounded without adding a delete to the hot path.
 */
export async function sweep(env: Env, nowMs: number = Date.now()): Promise<void> {
  await env.DB.prepare('DELETE FROM tarot_rate WHERE window_start < ?')
    .bind(nowMs - 2 * HOUR)
    .run();
}

export const shouldSweep = (): boolean => crypto.getRandomValues(new Uint8Array(1))[0] < 13;
