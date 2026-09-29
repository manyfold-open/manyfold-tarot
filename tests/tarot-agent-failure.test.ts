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

  it('leaves the round retryable: same reading, no second reading spent', async () => {
    reader = brokenReader;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const started = await call('/api/tarot/readings', {
      body: { question: '我该不该接受新公司的 offer？', locale: 'zh', spreadId: 'decision' },
    });
    const cookie = started.cookie;
    const { reading } = started.json<{ reading: ReadingView }>();
    const path = `/api/tarot/readings/${reading.readingId}/greeting`;

    await call(path, { body: {}, cookie });
    const spent = await call('/api/tarot/access', { cookie });
    expect(spent.json<{ freeUsed: boolean; canRead: boolean }>()).toMatchObject({
      freeUsed: true,
      canRead: false,
    });

    // The agent comes back. The retry is a turn on the same reading, not a new one.
    reader = demoDiviner();
    const retried = await call(path, { body: {}, cookie });
    expect(retried.status).toBe(200);
    expect(retried.events().some((event) => event.type === 'greeting')).toBe(true);

    const resumed = await call(`/api/tarot/readings/${reading.readingId}`, { cookie });
    expect(resumed.json<{ reading: ReadingView }>().reading.greeting).toBeTruthy();
  });
});
