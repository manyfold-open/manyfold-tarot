/**
 * When the agent behind the reader cannot answer.
 *
 * The site does not fall back to sample text once a real reader exists, so a
 * failure is something the visitor sees. What they see must be the site's own
 * words — the platform's message (an exhausted quota, a plan name) is for the
 * logs — and the round they already started must still be theirs to retry.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { A2AError } from '../src/worker/a2a';
import { demoDiviner, type Diviner } from '../src/worker/tarot/diviner';
import type { Env } from '../src/worker/types';
import {
  READER_UNAVAILABLE,
  type DivinerEvent,
  type ReadingView,
} from '../src/shared/tarot/types';
import { createD1, type FakeD1 } from './support/d1';

const PLATFORM_MESSAGE = 'active hours quota reached (200h included for Pro plan this billing period)';

/** What resolveDiviner hands out; each test decides whether the agent is up. */
let reader: Diviner;

vi.mock('../src/worker/tarot/diviner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/worker/tarot/diviner')>()),
  resolveDiviner: async () => reader,
}));

const brokenReader: Diviner = {
  demo: false,
  agentId: 'agent-test',
  speak: async () => {
    throw new A2AError(PLATFORM_MESSAGE, true);
  },
};

const ORIGIN = 'https://taro.test';
let d1: FakeD1;
let env: Env;
let app: { fetch: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response> };

beforeAll(async () => {
  d1 = createD1();
  env = {
    DB: d1.db,
    ASSETS: { fetch: async () => new Response('asset', { status: 200 }) } as unknown as Fetcher,
    ENVIRONMENT: 'test',
  } as Env;
  app = (await import('../src/worker/index')).default as typeof app;
});

afterAll(() => d1.close());
afterEach(() => vi.restoreAllMocks());

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
    text,
    cookie: setCookie ? (setCookie.split(';')[0] ?? null) : null,
    json: <T>() => JSON.parse(text) as T,
    events: () =>
      text
        .split('\n\n')
        .map((frame) => frame.replace(/^data: /, '').trim())
        .filter(Boolean)
        .map((payload) => JSON.parse(payload) as DivinerEvent),
  };
}

describe('the reader fails on the greeting', () => {
  it('tells the browser a code, not what the agent platform said, and logs the detail', async () => {
    reader = brokenReader;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const started = await call('/api/tarot/readings', {
      body: { question: '我最近的工作状况要往哪里走？', locale: 'zh', spreadId: 'current' },
    });
    const { reading } = started.json<{ reading: ReadingView }>();
    const greeting = await call(`/api/tarot/readings/${reading.readingId}/greeting`, {
      body: {},
      cookie: started.cookie,
    });

    const failure = greeting.events().find((event) => event.type === 'error');
    expect(failure).toMatchObject({ type: 'error', code: READER_UNAVAILABLE });
    expect(greeting.text).not.toMatch(/quota|Pro plan|billing/i);
    expect(warn).toHaveBeenCalledWith('tarot turn failed', expect.stringContaining('quota reached'));
  });

  it('hands the day back when the reader never spoke, and charges it again on a retry that works', async () => {
    reader = brokenReader;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const started = await call('/api/tarot/readings', {
      body: { question: '我该不该接受新公司的 offer？', locale: 'zh', spreadId: 'decision' },
    });
    const cookie = started.cookie;
    const { reading } = started.json<{ reading: ReadingView }>();
    const path = `/api/tarot/readings/${reading.readingId}/greeting`;

    await call(path, { body: {}, cookie });
    // Someone who gives up here has not had a reading, so they have not spent one.
    expect((await access(cookie)).freeUsed).toBe(false);
    expect((await access(cookie)).canRead).toBe(true);

    // A second failure on the same round gives back nothing more than it took.
    await call(path, { body: {}, cookie });
    expect((await access(cookie)).freeUsed).toBe(false);

    // The agent comes back. The retry is a turn on the same reading, not a new one,
    // and now that the reader has spoken the day's reading is spent.
    reader = demoDiviner();
    const retried = await call(path, { body: {}, cookie });
    expect(retried.status).toBe(200);
    expect(retried.events().some((event) => event.type === 'greeting')).toBe(true);
    expect(await access(cookie)).toMatchObject({ freeUsed: true, canRead: false });

    const resumed = await call(`/api/tarot/readings/${reading.readingId}`, { cookie });
    expect(resumed.json<{ reading: ReadingView }>().reading.greeting).toBeTruthy();

    // Replaying a greeting that exists costs nothing and refunds nothing.
    const replayed = await call(path, { body: {}, cookie });
    expect(replayed.events().some((event) => event.type === 'greeting')).toBe(true);
    expect((await access(cookie)).freeUsed).toBe(true);
  });

  it('does not let fail, refund, retry become a free reading once the day is spent elsewhere', async () => {
    reader = brokenReader;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const first = await call('/api/tarot/readings', {
      body: { question: '这段关系接下来会怎样？', locale: 'zh', spreadId: 'current' },
    });
    const cookie = first.cookie;
    const failed = first.json<{ reading: ReadingView }>().reading;
    await call(`/api/tarot/readings/${failed.readingId}/greeting`, { body: {}, cookie });

    // The refunded reading is spent on a new round instead.
    reader = demoDiviner();
    const second = await call('/api/tarot/readings', {
      body: { question: '换个问题：下周的重点是什么？', locale: 'zh', spreadId: 'next-step' },
      cookie,
    });
    expect(second.status).toBe(201);

    // Going back to the first round now has nothing left to pay with, and the
    // reader is not asked at all.
    const speak = vi.fn(demoDiviner().speak);
    reader = { ...demoDiviner(), speak };
    const retried = await call(`/api/tarot/readings/${failed.readingId}/greeting`, { body: {}, cookie });
    expect(retried.status).toBe(429);
    expect(retried.json<{ error: { code: string } }>().error.code).toBe('reading_limit');
    expect(speak).not.toHaveBeenCalled();
    const resumed = await call(`/api/tarot/readings/${failed.readingId}`, { cookie });
    expect(resumed.json<{ reading: ReadingView }>().reading.greeting).toBe('');
  });

  it('gives an invite reward back to the same browser when that is what paid', async () => {
    reader = brokenReader;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // Today's free reading is already gone; one invite reward is waiting.
    const cookie = (await call('/api/tarot/access')).cookie as string;
    const sessionId = cookie.split('=')[1];
    const day = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
    const stamp = new Date().toISOString();
    await d1.db
      .prepare('INSERT INTO tarot_daily_free (session_id, day, created_at) VALUES (?, ?, ?)')
      .bind(sessionId, day, stamp)
      .run();
    await d1.db
      .prepare('INSERT INTO tarot_rewards (referral_token, session_id, redeemed_at, created_at) VALUES (?, ?, NULL, ?)')
      .bind('invite-token-1', sessionId, stamp)
      .run();

    const started = await call('/api/tarot/readings', {
      body: { question: '我要怎么准备面试？', locale: 'zh', spreadId: 'next-step' },
      cookie,
    });
    expect(started.json<{ accessSource: string }>().accessSource).toBe('referral');
    expect(await access(cookie)).toMatchObject({ credits: 0, dailyExtraUsed: true, canRead: false });

    const { reading } = started.json<{ reading: ReadingView }>();
    await call(`/api/tarot/readings/${reading.readingId}/greeting`, { body: {}, cookie });
    expect(await access(cookie)).toMatchObject({ credits: 1, dailyExtraUsed: false, canRead: true });
  });
});

async function access(cookie: string | null) {
  return (await call('/api/tarot/access', { cookie })).json<{
    freeUsed: boolean;
    canRead: boolean;
    credits: number;
    dailyExtraUsed: boolean;
  }>();
}
