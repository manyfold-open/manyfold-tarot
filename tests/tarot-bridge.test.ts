/**
 * The Fortune Stick bridge, end to end through the Worker: a signed claim from
 * the Stick adds at most one extra reading per session per Taipei day, and the
 * mounted /tarot path serves the same app.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import app from '../src/worker/index';
import type { Env } from '../src/worker/types';
import { freeDay } from '../src/worker/tarot/referrals';
import { createD1, type FakeD1 } from './support/d1';

const ORIGIN = 'https://app.manyfold.ai';
const SECRET = 'bridge-contract-secret-0123456789abcdef';

/**
 * Minted by the Fortune Stick repo's tests/tarot-bridge.test.ts for
 * 2026-09-24 (Taipei) with SECRET. Both repos pin the same string, so a change
 * to the claim format on either side fails a test instead of production.
 */
const CONTRACT_TOKEN =
  'eyJ2IjoxLCJpc3MiOiJmb3J0dW5lLXN0aWNrIiwiYXVkIjoidGFyb3QiLCJpZCI6InpZMFp1V1oyNVo4d1hkTk5vMjMzZzJvUnZCbXhyQU04VzFfM2VKTHQ2VGMiLCJkYXkiOiIyMDI2LTA5LTI0IiwiZXhwIjoxNzkwMjY1NjAwfQ.sD3YaTJncLffPl1rX-s3cymv5ynVwkm3Uhmk1BG7sc0';
const CONTRACT_NOON = Date.parse('2026-09-24T04:00:00Z');

let d1: FakeD1;
let env: Env;
const assetPaths: string[] = [];

beforeAll(() => {
  d1 = createD1();
  env = {
    DB: d1.db,
    ASSETS: {
      fetch: async (request: Request) => {
        assetPaths.push(new URL(request.url).pathname);
        return new Response('asset', { status: 200 });
      },
    } as unknown as Fetcher,
    ENVIRONMENT: 'test',
    TAROT_DEMO: '1',
    TAROT_BRIDGE_SECRET: SECRET,
    BASE_PATH: '/tarot',
  } as Env;
});

afterAll(() => d1.close());
afterEach(() => vi.useRealTimers());

async function call(path: string, options: { body?: unknown; cookie?: string | null } = {}) {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.cookie) headers.cookie = options.cookie;
  const pending: Promise<unknown>[] = [];
  const response = await app.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: options.body === undefined ? 'GET' : 'POST',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: 'manual',
    }),
    env,
    {
      waitUntil: (promise: Promise<unknown>) => void pending.push(promise),
      passThroughOnException: () => undefined,
    } as unknown as ExecutionContext,
  );
  const text = await response.text();
  await Promise.all(pending);
  const setCookie = response.headers.get('set-cookie');
  return {
    status: response.status,
    headers: response.headers,
    cookie: setCookie ? (setCookie.split(';')[0] ?? null) : null,
    json: <T>() => JSON.parse(text) as T,
  };
}

const encoder = new TextEncoder();
const b64url = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Signs a claim the way the Stick does, so tests can vary one field at a time. */
async function sign(overrides: Record<string, unknown> = {}, secret = SECRET): Promise<string> {
  const day = freeDay();
  const claim = {
    v: 1,
    iss: 'fortune-stick',
    aud: 'tarot',
    id: b64url(crypto.getRandomValues(new Uint8Array(32))),
    day,
    exp: Math.floor(Date.parse(`${day}T16:00:00Z`) / 1000),
    ...overrides,
  };
  const payload = b64url(encoder.encode(JSON.stringify(claim)));
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${payload}.${b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))))}`;
}

async function newSession(): Promise<string> {
  return (await call('/tarot/api/tarot/access')).cookie!;
}
const redeem = async (cookie: string, token: string) =>
  (await call('/tarot/api/tarot/bridge/redeem', { body: { token }, cookie })).json<{ status: string }>();
const read = (cookie: string) =>
  call('/tarot/api/tarot/readings', { body: { question: 'What should I notice today?', locale: 'en' }, cookie });

describe('the Stick claim contract', () => {
  it('accepts the token the Fortune Stick repo mints', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(CONTRACT_NOON);
    expect(await redeem(await newSession(), CONTRACT_TOKEN)).toEqual({ status: 'granted' });
  });

  it('refuses a claim signed with another secret, tampered with, or for another audience', async () => {
    const cookie = await newSession();
    expect(await redeem(cookie, await sign({}, 'some-other-secret-0123456789abcdefgh'))).toEqual({ status: 'invalid' });
    const good = await sign();
    expect(await redeem(cookie, `${good.split('.')[0]}.${b64url(new Uint8Array(32))}`)).toEqual({ status: 'invalid' });
    expect(await redeem(cookie, await sign({ aud: 'stick' }))).toEqual({ status: 'invalid' });
    expect(await redeem(cookie, 'not-a-token')).toEqual({ status: 'invalid' });
  });

  it('refuses a claim that carries a raw Stick reading id', async () => {
    const claim = await sign({ id: '6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b' });
    expect(await redeem(await newSession(), claim)).toEqual({ status: 'invalid' });
  });

  it("refuses yesterday's claim", async () => {
    const yesterday = freeDay(Date.now() - 24 * 60 * 60 * 1000);
    const claim = await sign({ day: yesterday, exp: Math.floor(Date.parse(`${yesterday}T16:00:00Z`) / 1000) });
    expect(await redeem(await newSession(), claim)).toEqual({ status: 'expired' });
  });

  it('says so when the Worker has no bridge secret', async () => {
    const saved = env.TAROT_BRIDGE_SECRET;
    env.TAROT_BRIDGE_SECRET = undefined;
    try {
      const response = await call('/tarot/api/tarot/bridge/redeem', { body: { token: await sign() }, cookie: await newSession() });
      expect(response.status).toBe(503);
    } finally {
      env.TAROT_BRIDGE_SECRET = saved;
    }
  });
});

describe('one extra reading a day', () => {
  it('a Stick visitor gets the free reading and one extra, then no more', async () => {
    const cookie = await newSession();
    expect(await redeem(cookie, await sign())).toEqual({ status: 'granted' });
    const first = await read(cookie);
    const second = await read(cookie);
    const third = await read(cookie);
    expect([first.status, second.status, third.status]).toEqual([201, 201, 429]);
    expect(first.json<{ accessSource: string }>().accessSource).toBe('free');
    expect(second.json<{ accessSource: string }>().accessSource).toBe('stick');
    expect(third.json<{ error: { code: string } }>().error.code).toBe('reading_limit');
  });

  it('a claim adds one reward, however many times or sticks it is redeemed with', async () => {
    const cookie = await newSession();
    const claim = await sign();
    expect(await redeem(cookie, claim)).toEqual({ status: 'granted' });
    expect(await redeem(cookie, claim)).toEqual({ status: 'already_available' });
    expect(await redeem(cookie, await sign())).toEqual({ status: 'already_available' });
    expect(d1.query('SELECT COUNT(*) AS n FROM tarot_stick_rewards WHERE session_id = ?', cookie.split('=')[1])).toEqual([{ n: 1 }]);
  });

  it('a claim spent in one browser cannot be spent in another', async () => {
    const claim = await sign();
    expect(await redeem(await newSession(), claim)).toEqual({ status: 'granted' });
    expect(await redeem(await newSession(), claim)).toEqual({ status: 'unavailable' });
  });

  it('spends the Stick reward before an invite reward, and keeps the invite for another day', async () => {
    const cookie = await newSession();
    const session = cookie.split('=')[1]!;
    await d1.db
      .prepare('INSERT INTO tarot_rewards (referral_token, session_id, redeemed_at, created_at) VALUES (?, ?, NULL, ?)')
      .bind(`invite-${session}`, session, new Date().toISOString())
      .run();
    expect(await redeem(cookie, await sign())).toEqual({ status: 'granted' });
    await read(cookie);
    const extra = await read(cookie);
    expect(extra.json<{ accessSource: string }>().accessSource).toBe('stick');
    expect((await read(cookie)).status).toBe(429);
    expect(
      d1.query('SELECT redeemed_at FROM tarot_rewards WHERE session_id = ?', session),
    ).toEqual([{ redeemed_at: null }]);
  });

  it('a Stick claim after the day’s extra was spent on an invite is refused', async () => {
    const cookie = await newSession();
    const session = cookie.split('=')[1]!;
    await d1.db
      .prepare('INSERT INTO tarot_rewards (referral_token, session_id, redeemed_at, created_at) VALUES (?, ?, NULL, ?)')
      .bind(`invite2-${session}`, session, new Date().toISOString())
      .run();
    await read(cookie);
    expect((await read(cookie)).json<{ accessSource: string }>().accessSource).toBe('referral');
    expect(await redeem(cookie, await sign())).toEqual({ status: 'daily_limit' });
  });

  it('with only the free reading spent, access says the extra is still to unlock', async () => {
    const cookie = await newSession();
    await read(cookie);
    const access = (await call('/tarot/api/tarot/access', { cookie })).json<Record<string, unknown>>();
    expect(access).toMatchObject({ freeUsed: true, canRead: false, dailyExtraUsed: false, stickBonusAvailable: false });
    const refused = await read(cookie);
    expect(refused.json<{ error: { message: string } }>().error.message).not.toMatch(/extra/i);
  });
});

describe('mounted at /tarot on the shared host', () => {
  it('strips the prefix for the API and for static files', async () => {
    expect((await call('/tarot/api/health')).status).toBe(200);
    await call('/tarot/cards/back.webp');
    expect(assetPaths.at(-1)).toBe('/cards/back.webp');
  });

  it('sends the bare mount path to its trailing slash', async () => {
    const response = await call('/tarot');
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/tarot/`);
  });

  it('still serves the unprefixed paths the legacy host uses', async () => {
    expect((await call('/api/health')).status).toBe(200);
    await call('/s/some-share');
    expect(assetPaths.at(-1)).toBe('/s/some-share');
  });
});
