/**
 * The Fortune Stick bridge, end to end through the Worker: a reward code the
 * Stick issued adds at most one extra reading per session per Taipei day, and
 * the mounted /tarot path serves the same app.
 *
 * The Stick is stood in for by a fake STICK service binding that answers the
 * way the real one does (`GET /api/tarot-claims/:id` → 200 `{ claim: { day } }`,
 * or 404). The Fortune Stick repo's tests/tarot-bridge.test.ts pins that same
 * shape on its side; keep the two in step.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/worker/index';
import type { Env } from '../src/worker/types';
import { freeDay } from '../src/worker/tarot/referrals';
import { createD1, type FakeD1 } from './support/d1';

const ORIGIN = 'https://app.manyfold.ai';

let d1: FakeD1;
let env: Env;
const assetPaths: string[] = [];

/** Codes the fake Stick has issued, and the day each is good for. */
const issued = new Map<string, string>();
/** What the fake Stick does instead of answering, when a test wants it down. */
let stickDown: 'throw' | 500 | null = null;
const stickRequests: string[] = [];

const fakeStick = {
  fetch: async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    stickRequests.push(url.pathname);
    if (stickDown === 'throw') throw new Error('connection refused');
    if (stickDown === 500) return new Response('boom', { status: 500 });
    const code = url.pathname.replace(/^\/api\/tarot-claims\//, '');
    const day = issued.get(code);
    return day
      ? Response.json({ claim: { day } })
      : Response.json({ error: { code: 'claim_not_found' } }, { status: 404 });
  },
} as unknown as Fetcher;

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
    STICK: fakeStick,
    BASE_PATH: '/tarot',
  } as Env;
});

afterAll(() => d1.close());

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

const b64url = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A code the Stick issued for `day` (today by default), as the Stick makes them. */
function issue(day = freeDay()): string {
  const code = b64url(crypto.getRandomValues(new Uint8Array(32)));
  issued.set(code, day);
  return code;
}

async function newSession(): Promise<string> {
  return (await call('/tarot/api/tarot/access')).cookie!;
}
const redeemCall = (cookie: string, token: string) =>
  call('/tarot/api/tarot/bridge/redeem', { body: { token }, cookie });
const redeem = async (cookie: string, token: string) => (await redeemCall(cookie, token)).json<{ status: string }>();
const read = (cookie: string) =>
  call('/tarot/api/tarot/readings', { body: { question: 'What should I notice today?', locale: 'en' }, cookie });

describe('checking a code with the Stick', () => {
  it('grants a code the Stick issued for today, after asking the Stick about it', async () => {
    const code = issue();
    const cookie = await newSession();
    stickRequests.length = 0;
    expect(await redeem(cookie, code)).toEqual({ status: 'granted' });
    expect(stickRequests).toEqual([`/api/tarot-claims/${code}`]);
  });

  it('refuses a code the Stick never issued, without granting anything', async () => {
    const forged = b64url(crypto.getRandomValues(new Uint8Array(32)));
    expect(await redeem(await newSession(), forged)).toEqual({ status: 'invalid' });
  });

  it('does not even ask the Stick about something that is not a code', async () => {
    const cookie = await newSession();
    stickRequests.length = 0;
    for (const token of ['not-a-token', '6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b', '../../api/readings/x']) {
      expect(await redeem(cookie, token)).toEqual({ status: 'invalid' });
    }
    expect(stickRequests).toEqual([]);
  });

  it('refuses a code for another day', async () => {
    const yesterday = issue(freeDay(Date.now() - 24 * 60 * 60 * 1000));
    expect(await redeem(await newSession(), yesterday)).toEqual({ status: 'expired' });
  });

  it('says the Stick is unavailable (so the page offers a retry) when it cannot be reached', async () => {
    const cookie = await newSession();
    const code = issue();
    for (const down of ['throw', 500] as const) {
      stickDown = down;
      try {
        const response = await redeemCall(cookie, code);
        expect(response.status).toBe(503);
        expect(response.json<{ error: { code: string } }>().error.code).toBe('bridge_unavailable');
      } finally {
        stickDown = null;
      }
    }
    // Nothing was spent: once the Stick is back, the same code works.
    expect(await redeem(cookie, code)).toEqual({ status: 'granted' });
  });

  it('says so when there is no Stick binding at all', async () => {
    const saved = env.STICK;
    env.STICK = undefined;
    try {
      expect((await redeemCall(await newSession(), issue())).status).toBe(503);
    } finally {
      env.STICK = saved;
    }
  });
});

describe('one extra reading a day', () => {
  it('a Stick visitor gets the free reading and one extra, then no more', async () => {
    const cookie = await newSession();
    expect(await redeem(cookie, issue())).toEqual({ status: 'granted' });
    const first = await read(cookie);
    const second = await read(cookie);
    const third = await read(cookie);
    expect([first.status, second.status, third.status]).toEqual([201, 201, 429]);
    expect(first.json<{ accessSource: string }>().accessSource).toBe('free');
    expect(second.json<{ accessSource: string }>().accessSource).toBe('stick');
    expect(third.json<{ error: { code: string } }>().error.code).toBe('reading_limit');
  });

  it('a code adds one reward, however many times or sticks it is redeemed with', async () => {
    const cookie = await newSession();
    const code = issue();
    expect(await redeem(cookie, code)).toEqual({ status: 'granted' });
    expect(await redeem(cookie, code)).toEqual({ status: 'already_available' });
    expect(await redeem(cookie, issue())).toEqual({ status: 'already_available' });
    expect(
      d1.query('SELECT COUNT(*) AS n FROM tarot_stick_rewards WHERE session_id = ?', cookie.split('=')[1]),
    ).toEqual([{ n: 1 }]);
  });

  it('a code spent in one browser cannot be spent in another', async () => {
    const code = issue();
    expect(await redeem(await newSession(), code)).toEqual({ status: 'granted' });
    expect(await redeem(await newSession(), code)).toEqual({ status: 'unavailable' });
  });

  it('spends the Stick reward before an invite reward, and keeps the invite for another day', async () => {
    const cookie = await newSession();
    const session = cookie.split('=')[1]!;
    await d1.db
      .prepare('INSERT INTO tarot_rewards (referral_token, session_id, redeemed_at, created_at) VALUES (?, ?, NULL, ?)')
      .bind(`invite-${session}`, session, new Date().toISOString())
      .run();
    expect(await redeem(cookie, issue())).toEqual({ status: 'granted' });
    await read(cookie);
    const extra = await read(cookie);
    expect(extra.json<{ accessSource: string }>().accessSource).toBe('stick');
    expect((await read(cookie)).status).toBe(429);
    expect(d1.query('SELECT redeemed_at FROM tarot_rewards WHERE session_id = ?', session)).toEqual([
      { redeemed_at: null },
    ]);
  });

  it('a Stick code after the day’s extra was spent on an invite is refused', async () => {
    const cookie = await newSession();
    const session = cookie.split('=')[1]!;
    await d1.db
      .prepare('INSERT INTO tarot_rewards (referral_token, session_id, redeemed_at, created_at) VALUES (?, ?, NULL, ?)')
      .bind(`invite2-${session}`, session, new Date().toISOString())
      .run();
    await read(cookie);
    expect((await read(cookie)).json<{ accessSource: string }>().accessSource).toBe('referral');
    expect(await redeem(cookie, issue())).toEqual({ status: 'daily_limit' });
  });

  it('with only the free reading spent, access says the extra is still to unlock', async () => {
    const cookie = await newSession();
    await read(cookie);
    const access = (await call('/tarot/api/tarot/access', { cookie })).json<Record<string, unknown>>();
    expect(access).toMatchObject({
      freeUsed: true,
      canRead: false,
      dailyExtraUsed: false,
      stickBonusAvailable: false,
    });
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
