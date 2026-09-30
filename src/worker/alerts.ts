/**
 * Tells the operator when the reader is failing visitors.
 *
 * A failed turn reaches the visitor as an SSE `error` event on a response that
 * already went out as HTTP 200, so nothing in the request logs looks wrong.
 * This module is what makes it look wrong: every agent failure is logged, kept
 * in `agent_failures` for the console, and — once the operator has pasted a
 * Discord webhook into /settings — posted to Discord.
 *
 * The webhook is stored the way agent tokens are, AES-GCM sealed in `settings`,
 * because anyone holding the URL can post into that channel. It is set from the
 * console rather than as a Worker secret so that the password is all it takes.
 *
 * Posting is throttled through `settings`: an agent that is down all night
 * produces one message per window with a count, not one per visitor, and one
 * more message when the next turn succeeds.
 *
 * The question, the cards and the reading never go into an alert or a failure
 * row, for the same reason they never go into analytics. Only where and why.
 */

import type { AlertsView } from '../shared/types';
import { safeErrorText } from './a2a';
import { seal, unseal, type Sealed } from './crypto';
import { getSetting, now, setSetting } from './db';
import { HttpError, type Env } from './types';

/** At most one failure message per window; the rest are counted into the next. */
export const ALERT_WINDOW_MS = 15 * 60_000;
/** How many failure rows the console keeps. */
export const FAILURES_KEPT = 50;
const WEBHOOK_TIMEOUT_MS = 5_000;
const STATE_KEY = 'alerts:agent';
const WEBHOOK_KEY = 'alerts:discord';

/* ───────── the webhook ───────── */

const DISCORD_HOSTS = new Set(['discord.com', 'discordapp.com', 'canary.discord.com', 'ptb.discord.com']);

/**
 * Only a Discord webhook, and nothing that merely looks like one: the Worker
 * POSTs to whatever is stored here, so it must not become a way to make it
 * call anywhere else.
 */
export function validateDiscordWebhook(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new HttpError(400, 'bad_webhook', 'That is not a URL.');
  }
  if (
    url.protocol !== 'https:' ||
    !DISCORD_HOSTS.has(url.hostname) ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    !/^\/api\/webhooks\/\d+\/[\w-]+\/?$/.test(url.pathname)
  ) {
    throw new HttpError(
      400,
      'bad_webhook',
      'Paste a Discord webhook URL: https://discord.com/api/webhooks/…',
    );
  }
  return `${url.origin}${url.pathname}`;
}

async function webhookUrl(env: Env): Promise<string | null> {
  const raw = await getSetting(env, WEBHOOK_KEY);
  if (!raw) return null;
  const sealed = JSON.parse(raw) as Sealed & { savedAt?: string };
  return unseal(env, sealed.ciphertext, sealed.iv);
}

async function post(url: string, content: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // No pings: an error string is agent-controlled text.
      body: JSON.stringify({ content: content.slice(0, 1900), allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (!response.ok) console.error('alert webhook rejected', response.status);
    return response.ok;
  } catch (error) {
    // The URL is a secret; log only what went wrong, never where it was going.
    console.error('alert webhook failed', safeErrorText(error instanceof Error ? error.name : error));
    return false;
  }
}

async function notify(env: Env, content: string): Promise<void> {
  const url = await webhookUrl(env);
  if (url) await post(url, content);
}

/** Stores the webhook and posts a confirmation to it. Returns whether Discord accepted it. */
export async function saveDiscordWebhook(env: Env, value: string): Promise<boolean> {
  const url = validateDiscordWebhook(value);
  const sealed = await seal(env, url);
  await setSetting(env, WEBHOOK_KEY, JSON.stringify({ ...sealed, savedAt: now() }));
  return post(url, '🔔 Tarot 的 agent 失敗通知已連上這個頻道。');
}

export async function clearDiscordWebhook(env: Env): Promise<void> {
  await env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(WEBHOOK_KEY).run();
}

/* ───────── failure state ───────── */

interface AlertState {
  /** True from the first failure until a turn succeeds again. */
  failing: boolean;
  /** When the last failure message was posted, ms since epoch. */
  lastSentAt: number;
  /** Failures since then that were counted rather than posted. */
  suppressed: number;
  /** When this run of failures began, ms since epoch. */
  since: number;
}

const idle = (): AlertState => ({ failing: false, lastSentAt: 0, suppressed: 0, since: 0 });

async function readState(env: Env): Promise<AlertState> {
  const raw = await getSetting(env, STATE_KEY);
  if (!raw) return idle();
  try {
    return { ...idle(), ...(JSON.parse(raw) as Partial<AlertState>) };
  } catch {
    return idle();
  }
}

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));
const reasonOf = (error: unknown) => safeErrorText(error instanceof Error ? error.message : error);

async function recordFailure(env: Env, kind: string, reason: string, at: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('INSERT INTO agent_failures (at, kind, reason) VALUES (?, ?, ?)').bind(
      new Date(at).toISOString(),
      kind,
      reason.slice(0, 500),
    ),
    env.DB.prepare(
      'DELETE FROM agent_failures WHERE id NOT IN (SELECT id FROM agent_failures ORDER BY id DESC LIMIT ?)',
    ).bind(FAILURES_KEPT),
  ]);
}

/**
 * Records one failed agent turn. Never throws: an alert that breaks the error
 * path would turn a failed reading into a hung one.
 */
export async function reportAgentFailure(
  env: Env,
  kind: string,
  error: unknown,
  at: number = Date.now(),
): Promise<void> {
  const reason = reasonOf(error);
  console.error('tarot agent failed', kind, reason);
  try {
    await recordFailure(env, kind, reason, at);
    const state = await readState(env);

    if (state.failing && at - state.lastSentAt < ALERT_WINDOW_MS) {
      await setSetting(env, STATE_KEY, JSON.stringify({ ...state, suppressed: state.suppressed + 1 }));
      return;
    }

    const since = state.failing ? state.since : at;
    await setSetting(
      env,
      STATE_KEY,
      JSON.stringify({ failing: true, lastSentAt: at, suppressed: 0, since } satisfies AlertState),
    );
    const ongoing = state.failing ? `（已持續 ${minutes(at - since)} 分鐘）` : '';
    const extra =
      state.suppressed > 0
        ? `\n上一則通知之後又失敗了 ${state.suppressed} 次`
        : '';
    await notify(env, `🔴 **Tarot agent 失敗**${ongoing}\n環節：\`${kind}\`\n原因：${reason}${extra}`);
  } catch (alertError) {
    console.error('alert bookkeeping failed', reasonOf(alertError));
  }
}

/** Records one successful agent turn; posts a recovery message if it ends a run of failures. */
export async function reportAgentSuccess(env: Env, at: number = Date.now()): Promise<void> {
  try {
    const state = await readState(env);
    if (!state.failing) return;
    await setSetting(env, STATE_KEY, JSON.stringify(idle()));
    const extra = state.suppressed > 0 ? `，最後一則通知之後又失敗 ${state.suppressed} 次` : '';
    await notify(env, `✅ **Tarot agent 已恢復**（故障約 ${minutes(at - state.since)} 分鐘${extra}）`);
  } catch (alertError) {
    console.error('alert bookkeeping failed', reasonOf(alertError));
  }
}

/* ───────── the console's view ───────── */

export async function alertsView(env: Env): Promise<AlertsView> {
  const [webhookRaw, state, failures] = await Promise.all([
    getSetting(env, WEBHOOK_KEY),
    readState(env),
    env.DB.prepare('SELECT at, kind, reason FROM agent_failures ORDER BY id DESC LIMIT ?')
      .bind(FAILURES_KEPT)
      .all<{ at: string; kind: string; reason: string }>(),
  ]);
  let savedAt: string | null = null;
  if (webhookRaw) {
    try {
      savedAt = (JSON.parse(webhookRaw) as { savedAt?: string }).savedAt ?? null;
    } catch {
      /* unreadable row: still counts as configured */
    }
  }
  return {
    // Never the URL itself: holding it is enough to post into the channel.
    discord: { configured: webhookRaw !== null, savedAt },
    failing: state.failing,
    failingSince: state.failing ? new Date(state.since).toISOString() : null,
    failures: failures.results ?? [],
  };
}
