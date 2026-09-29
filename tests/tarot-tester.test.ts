/**
 * The test browser: a visitor the daily reading limit does not apply to.
 *
 * Driven through the real Worker and SQLite, like tarot-e2e. What matters is
 * both halves — the pass opens the daily limit, and nothing else about it is
 * open: a wrong token, no configured hash, an expired pass and the hourly
 * meters must all still behave like an ordinary visitor.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/worker/index';
import type { Env } from '../src/worker/types';
import { RULES } from '../src/worker/tarot/ratelimit';
import { sha256Hex } from '../src/worker/tarot/tester';
import { createD1, type FakeD1 } from './support/d1';

const ORIGIN = 'https://taro.test';
const TOKEN = 'a-long-random-test-token';

let d1: FakeD1;
let env: Env;

beforeAll(async () => {
  d1 = createD1();
  env = {
    DB: d1.db,
    ASSETS: { fetch: async () => new Response('asset', { status: 200 }) } as unknown as Fetcher,
    ENVIRONMENT: 'test',
    TAROT_DEMO: '1',
    TAROT_TEST_TOKEN_SHA256: await sha256Hex(TOKEN),
  } as Env;
});

afterAll(() => d1.close());

async function call(path: string, options: { body?: unknown; cookie?: string | null } = {}) {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => void pending.push(promise),
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext;
  const headers: Record<string, string> = { origin: ORIGIN };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.cookie) headers.cookie = options.cookie;
  const response = await app.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: options.body === undefined ? 'GET' : 'POST',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    env,
    ctx,
  );
  const text = await response.text();
  await Promise.all(pending);
  const setCookie = response.headers.get('set-cookie');
  return {
    status: response.status,
    cookie: setCookie ? (setCookie.split(';')[0] ?? null) : null,
    json: <T>() => JSON.parse(text) as T,
  };
}

/** A fresh browser: it asks for something first, so it has a session to be a tester as. */
async function newBrowser(): Promise<string> {
  const first = await call('/api/tarot/access');
  return first.cookie as string;
}

const ask = (cookie: string) =>
  call('/api/tarot/readings', { body: { question: '测试', locale: 'zh', spreadId: 'current' }, cookie });

const access = async (cookie: string) =>
  (await call('/api/tarot/access', { cookie })).json<{ canRead: boolean; tester: boolean }>();

describe('sha256Hex', () => {
  it('matches the published vector for "abc"', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('presenting the token', () => {
  it('refuses a wrong token, and says the same as when none is configured', async () => {
    const cookie = await newBrowser();
    const wrong = await call('/api/tarot/tester', { body: { token: 'nope' }, cookie });
    expect(wrong.status).toBe(403);
    expect(await access(cookie)).toMatchObject({ tester: false });

    const saved = env.TAROT_TEST_TOKEN_SHA256;
    env.TAROT_TEST_TOKEN_SHA256 = '';
    const unconfigured = await call('/api/tarot/tester', { body: { token: TOKEN }, cookie });
    env.TAROT_TEST_TOKEN_SHA256 = saved;
    expect(unconfigured.status).toBe(403);
    expect(unconfigured.json()).toEqual(wrong.json());
  });

  it('rejects a body with no token', async () => {
    const cookie = await newBrowser();
    expect((await call('/api/tarot/tester', { body: {}, cookie })).status).toBe(400);
  });

  it('lets a browser with the token read past the daily limit, and nobody else', async () => {
    const tester = await newBrowser();
    const visitor = await newBrowser();

    const granted = await call('/api/tarot/tester', { body: { token: TOKEN }, cookie: tester });
    expect(granted.status).toBe(200);

    for (let round = 0; round < 3; round += 1) {
      const started = await ask(tester);
      expect(started.status).toBe(201);
      expect(started.json<{ accessSource: string }>().accessSource).toBe('test');
    }
    expect(await access(tester)).toMatchObject({ canRead: true, tester: true });

    // An ordinary browser still gets one.
    expect((await ask(visitor)).status).toBe(201);
    expect((await ask(visitor)).status).toBe(429);
    expect(await access(visitor)).toMatchObject({ canRead: false, tester: false });
  });
});

describe('what the pass does not open', () => {
  it('still stops at the hourly meter', async () => {
    const cookie = await newBrowser();
    await call('/api/tarot/tester', { body: { token: TOKEN }, cookie });
    let blocked = 0;
    for (let round = 0; round < RULES.readings.limit + 2; round += 1) {
      if ((await ask(cookie)).status === 429) blocked += 1;
    }
    expect(blocked).toBe(2);
  });

  it('ends when the pass expires', async () => {
    const cookie = await newBrowser();
    await call('/api/tarot/tester', { body: { token: TOKEN }, cookie });
    expect(await access(cookie)).toMatchObject({ tester: true });

    await env.DB.prepare('UPDATE tarot_testers SET expires_at = ?')
      .bind(new Date(Date.now() - 1000).toISOString())
      .run();
    expect((await access(cookie)).tester).toBe(false);
  });

  it('ends for everyone when the hash is emptied', async () => {
    const cookie = await newBrowser();
    await call('/api/tarot/tester', { body: { token: TOKEN }, cookie });
    expect((await access(cookie)).tester).toBe(true);

    const saved = env.TAROT_TEST_TOKEN_SHA256;
    env.TAROT_TEST_TOKEN_SHA256 = '';
    const revoked = await access(cookie);
    env.TAROT_TEST_TOKEN_SHA256 = saved;
    expect(revoked.tester).toBe(false);
  });
});
