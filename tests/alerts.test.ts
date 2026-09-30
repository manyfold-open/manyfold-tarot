/**
 * Agent failure alerts: the one place a failed reading leaves a trace.
 *
 * Driven against a real SQLite database with `fetch` stubbed, so what is
 * asserted is what would reach Discord — how many messages, saying what — and
 * that the webhook URL, which is enough on its own to post into the channel,
 * never comes back out of the Worker.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/worker/index';
import {
  ALERT_WINDOW_MS,
  FAILURES_KEPT,
  alertsView,
  reportAgentFailure,
  reportAgentSuccess,
  saveDiscordWebhook,
  validateDiscordWebhook,
} from '../src/worker/alerts';
import { seal } from '../src/worker/crypto';
import { ensureSchema } from '../src/worker/db';
import { resolveDiviner } from '../src/worker/tarot/diviner';
import type { Env } from '../src/worker/types';
import { createD1, type FakeD1 } from './support/d1';

const WEBHOOK = 'https://discord.com/api/webhooks/123456/abc-DEF_789';
const ORIGIN = 'https://taro.test';

let d1: FakeD1;
let env: Env;
let posts: { url: string; content: string }[];
let discordStatus: number;
let agentResponse: () => Response;

// One database for the file: ensureSchema runs once per isolate, as in production.
beforeAll(() => {
  d1 = createD1();
});
afterAll(() => d1.close());

beforeEach(async () => {
  env = {
    DB: d1.db,
    ASSETS: { fetch: async () => new Response('asset') } as unknown as Fetcher,
    ENVIRONMENT: 'test',
    ADMIN_PASSWORD: 'pw',
  } as Env;
  await ensureSchema(env.DB);
  for (const table of ['agent_failures', 'agents']) d1.query(`DELETE FROM ${table}`);
  d1.query("DELETE FROM settings WHERE key LIKE 'alerts:%'");
  posts = [];
  discordStatus = 204;
  agentResponse = () => new Response('down', { status: 503 });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://discord.com/')) {
      posts.push({ url, content: JSON.parse(String(init?.body)).content });
      return new Response(null, { status: discordStatus });
    }
    return agentResponse();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const T0 = Date.UTC(2026, 8, 30, 12, 0, 0);
const MIN = 60_000;

describe('validateDiscordWebhook', () => {
  it('accepts Discord webhook URLs and drops the query string', () => {
    expect(validateDiscordWebhook(`${WEBHOOK}?wait=true`)).toBe(WEBHOOK);
    expect(validateDiscordWebhook('https://discordapp.com/api/webhooks/1/x')).toBe(
      'https://discordapp.com/api/webhooks/1/x',
    );
  });

  it.each([
    'not a url',
    'http://discord.com/api/webhooks/1/x',
    'https://evil.test/api/webhooks/1/x',
    'https://discord.com.evil.test/api/webhooks/1/x',
    'https://discord.com:8443/api/webhooks/1/x',
    'https://user:pw@discord.com/api/webhooks/1/x',
    'https://discord.com/api/users/@me',
  ])('rejects %s', (value) => {
    expect(() => validateDiscordWebhook(value)).toThrow(/Discord webhook|not a URL/);
  });
});

describe('failure alerts', () => {
  beforeEach(async () => {
    await saveDiscordWebhook(env, WEBHOOK);
    posts = []; // drop the confirmation ping
  });

  it('posts the first failure with where and why', async () => {
    await reportAgentFailure(env, 'interpretation', new Error('Reader stream timed out.'), T0);
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe(WEBHOOK);
    expect(posts[0].content).toContain('interpretation');
    expect(posts[0].content).toContain('Reader stream timed out.');
  });

  it('counts repeat failures inside the window instead of posting each one', async () => {
    await reportAgentFailure(env, 'greeting', new Error('a'), T0);
    await reportAgentFailure(env, 'greeting', new Error('b'), T0 + 1 * MIN);
    await reportAgentFailure(env, 'greeting', new Error('c'), T0 + 2 * MIN);
    expect(posts).toHaveLength(1);

    await reportAgentFailure(env, 'greeting', new Error('d'), T0 + ALERT_WINDOW_MS + MIN);
    expect(posts).toHaveLength(2);
    expect(posts[1].content).toContain('又失敗了 2 次');
    expect(posts[1].content).toContain('已持續 16 分鐘');
  });

  it('posts one recovery after a run of failures, and nothing for ordinary successes', async () => {
    await reportAgentSuccess(env, T0);
    expect(posts).toHaveLength(0);

    await reportAgentFailure(env, 'hint', new Error('x'), T0);
    await reportAgentSuccess(env, T0 + 7 * MIN);
    await reportAgentSuccess(env, T0 + 8 * MIN);
    expect(posts).toHaveLength(2);
    expect(posts[1].content).toContain('已恢復');
    expect(posts[1].content).toContain('7 分鐘');

    // A fresh failure after recovery alerts straight away.
    await reportAgentFailure(env, 'hint', new Error('y'), T0 + 9 * MIN);
    expect(posts).toHaveLength(3);
  });

  it('keeps the newest failures for the console', async () => {
    for (let i = 0; i < FAILURES_KEPT + 5; i++) {
      await reportAgentFailure(env, 'greeting', new Error(`e${i}`), T0 + i);
    }
    const view = await alertsView(env);
    expect(view.failures).toHaveLength(FAILURES_KEPT);
    expect(view.failures[0].reason).toBe(`e${FAILURES_KEPT + 4}`);
    expect(view.failing).toBe(true);
  });

  it('never throws, even when Discord refuses', async () => {
    discordStatus = 404;
    await expect(reportAgentFailure(env, 'greeting', new Error('x'), T0)).resolves.toBeUndefined();
  });
});

describe('without a webhook', () => {
  it('still records the failure and posts nothing', async () => {
    await reportAgentFailure(env, 'greeting', new Error('x'), T0);
    expect(posts).toHaveLength(0);
    expect((await alertsView(env)).failures).toHaveLength(1);
  });
});

describe('the live reader reports its own turns', () => {
  const connectAgent = async () => {
    const sealed = await seal(env, 'agent-token');
    await env.DB.prepare(
      `INSERT INTO agents (agent_id, name, rpc_url, token_ct, token_iv, verified, connected_at)
       VALUES ('a1', 'Reader', 'https://agent.test/rpc', ?, ?, 1, ?)`,
    )
      .bind(sealed.ciphertext, sealed.iv, new Date().toISOString())
      .run();
  };

  it('a failed turn is recorded and posted, then rethrown to the visitor', async () => {
    await saveDiscordWebhook(env, WEBHOOK);
    posts = [];
    await connectAgent();
    const diviner = await resolveDiviner(env);
    expect(diviner.demo).toBe(false);

    await expect(
      diviner.speak(
        { kind: 'greeting', locale: 'en', question: 'Will it rain?' },
        { idempotencyKey: 'r1-greeting', contextId: null, taskId: null },
      ),
    ).rejects.toThrow();

    const view = await alertsView(env);
    expect(view.failures).toHaveLength(1);
    expect(view.failures[0].kind).toBe('greeting');
    expect(posts).toHaveLength(1);
    // The visitor's question stays out of both.
    expect(posts[0].content).not.toContain('Will it rain');
    expect(JSON.stringify(view)).not.toContain('Will it rain');
  });
});

describe('the console routes', () => {
  const call = (method: string, path: string, body?: unknown, password = 'pw') =>
    app.fetch(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers: {
          origin: ORIGIN,
          'x-admin-password': password,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
      { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext,
    );

  it('are behind the admin password', async () => {
    expect((await call('GET', '/api/alerts', undefined, 'wrong')).status).toBe(401);
    expect((await call('PUT', '/api/alerts/discord', { url: WEBHOOK }, 'wrong')).status).toBe(401);
    expect(posts).toHaveLength(0);
  });

  it('save pings the channel, and the URL never comes back out', async () => {
    const saved = await call('PUT', '/api/alerts/discord', { url: WEBHOOK });
    expect(saved.status).toBe(200);
    const text = await saved.text();
    expect(JSON.parse(text).delivered).toBe(true);
    expect(posts).toHaveLength(1);

    const view = await (await call('GET', '/api/alerts')).text();
    expect(JSON.parse(view).discord.configured).toBe(true);
    for (const body of [text, view]) {
      expect(body).not.toContain('abc-DEF_789');
      expect(body).not.toContain('webhooks/123456');
    }
    // Sealed at rest, like agent tokens.
    const stored = d1.query("SELECT value FROM settings WHERE key = 'alerts:discord'");
    expect(String(stored[0].value)).not.toContain('abc-DEF_789');
  });

  it('rejects a non-Discord URL without calling it', async () => {
    const response = await call('PUT', '/api/alerts/discord', { url: 'https://evil.test/api/webhooks/1/x' });
    expect(response.status).toBe(400);
    expect(posts).toHaveLength(0);
  });

  it('remove forgets the webhook', async () => {
    await call('PUT', '/api/alerts/discord', { url: WEBHOOK });
    const removed = await call('DELETE', '/api/alerts/discord');
    expect(((await removed.json()) as { alerts: { discord: { configured: boolean } } }).alerts.discord.configured).toBe(false);
    posts = [];
    await reportAgentFailure(env, 'greeting', new Error('x'), T0);
    expect(posts).toHaveLength(0);
  });
});
