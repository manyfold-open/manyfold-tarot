/**
 * The line between the reading and the console, driven through the real Worker.
 *
 * Two failures live here and they fail in opposite directions, which is why both
 * halves are asserted every time. Lock too much and the tarot site — the product,
 * the thing the URL is for — asks a stranger for a password before it will deal
 * three cards. Lock too little and anyone who guesses `/settings` can read the
 * operator's agent list, disconnect an agent, or spend the owner's budget in the
 * verification chat.
 *
 * The password this deployment ships with is not written down here, and that is
 * the point rather than an omission: it is committed one directory over as a
 * digest precisely so that reading this public repository does not hand it to
 * anyone. So the digest branch is exercised against a lock built here, from a
 * password these tests are allowed to know, and the shipped one is proved the
 * only way it can honestly be proved — by an operator typing it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/worker/index';
import { DEFAULT_LOCK, adminPasswordOk, matchesLock, type Lock } from '../src/worker/admin';
import type { Env } from '../src/worker/types';
import type { AppState } from '../src/shared/types';
import { createD1, type FakeD1 } from './support/d1';

const ORIGIN = 'https://taro.test';

let d1: FakeD1;
let base: Env;

beforeAll(() => {
  d1 = createD1();
  base = {
    DB: d1.db,
    ASSETS: { fetch: async () => new Response('asset', { status: 200 }) } as unknown as Fetcher,
    ENVIRONMENT: 'test',
    TAROT_DEMO: '1',
  } as Env;
});

afterAll(() => d1.close());

const ctx = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

const call = (path: string, options: { password?: string; env?: Env } = {}) => {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (options.password !== undefined) headers['x-admin-password'] = options.password;
  return app.fetch(new Request(`${ORIGIN}${path}`, { headers }), options.env ?? base, ctx);
};

/**
 * A lock this file owns, so the digest branch can be tested from both sides.
 *
 * The digest is written out rather than computed here, and the difference
 * matters: hashing the password with the same call the implementation uses would
 * only prove that a function agrees with itself. This constant came from
 * `sha256(salt + password)` computed elsewhere, so it also pins *which* hash of
 * *what* — change the algorithm, the concatenation order, or the encoding, and
 * this stops matching.
 */
const TEST_PASSWORD = 'a-password-a-test-may-know';
const testLock: Lock = {
  salt: 'dGVzdC1zYWx0LW5vdC1hLXNlY3JldA==',
  digest: 'f65e8da7949fcd3f1e3ba2074fae256fe382a7e057b5557bd42d6b35b6bf5d67',
};

describe('the reading stays open', () => {
  it('lets a stranger reach the tarot API with no password at all', async () => {
    const response = await call('/api/tarot/reader');
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty('demo');
  });

  it('keeps the deploy-verification contract open', async () => {
    expect((await call('/api/health')).status).toBe(200);
  });

  it('serves the front page without asking for anything', async () => {
    expect((await call('/')).status).toBe(200);
  });
});

describe('the console is locked', () => {
  it('turns a stranger away from every operator route', async () => {
    for (const path of ['/api/agents', '/api/agents/whatever/messages']) {
      const response = await call(path);
      expect(response.status, path).toBe(401);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        'admin_password_invalid',
      );
    }
  });

  it('rejects the passwords a stranger would actually try', async () => {
    for (const guess of ['', 'admin', 'password', 'tarot', '123456', 'manyfold']) {
      expect((await call('/api/agents', { password: guess })).status, guess).toBe(401);
    }
  });
});

describe('/api/state', () => {
  it('tells a stranger that a password is wanted, and nothing else', async () => {
    const state = (await (await call('/api/state')).json()) as AppState;
    expect(state.adminRequired).toBe(true);
    expect(state.adminOk).toBe(false);
    // The two things worth withholding: which agents exist, and any handshake in
    // flight. Both used to be served to anyone who asked.
    expect(state.agents).toEqual([]);
    expect(state.connect.session).toBeNull();
  });

  it('answers properly once the password is given', async () => {
    const env = { ...base, ADMIN_PASSWORD: 'let me in' } as Env;
    const state = (await (await call('/api/state', { env, password: 'let me in' })).json()) as AppState;
    expect(state.adminOk).toBe(true);
    expect(Array.isArray(state.agents)).toBe(true);
  });
});

describe('the ADMIN_PASSWORD secret', () => {
  // Built inside each test, never at describe time: `base` does not exist until
  // beforeAll runs, and spreading it early yields an env with no database and a
  // 500 that looks nothing like the thing under test.
  const withSecret = (secret: string): Env => ({ ...base, ADMIN_PASSWORD: secret }) as Env;

  it('opens the console when it is the one set', async () => {
    const env = withSecret('a simple one');
    expect((await call('/api/agents', { env, password: 'a simple one' })).status).toBe(200);
    expect((await call('/api/agents', { env, password: 'a simple two' })).status).toBe(401);
  });

  it('replaces the shipped default rather than joining it', async () => {
    // Otherwise setting a secret would widen the lock instead of narrowing it,
    // and the published digest would stay live on a deployment that believed it
    // had moved past it.
    expect(await adminPasswordOk(withSecret('a simple one'), TEST_PASSWORD, testLock)).toBe(false);
  });

  it('is ignored when blank, so an empty secret cannot mean "no lock"', async () => {
    const blank = withSecret('   ');
    expect(await adminPasswordOk(blank, '', testLock)).toBe(false);
    expect(await adminPasswordOk(blank, '   ', testLock)).toBe(false);
    expect(await adminPasswordOk(blank, TEST_PASSWORD, testLock)).toBe(true);
  });
});

describe('the shipped lock', () => {
  it('opens for its own password and shuts for anything else', async () => {
    expect(await matchesLock(testLock, TEST_PASSWORD)).toBe(true);
    expect(await matchesLock(testLock, `${TEST_PASSWORD} `)).toBe(false);
    expect(await matchesLock(testLock, '')).toBe(false);
  });

  it('is a whole SHA-256 and a salt, not a truncated paste', async () => {
    expect(DEFAULT_LOCK.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(DEFAULT_LOCK.salt.length).toBeGreaterThanOrEqual(16);
  });

  it('is not one of the passwords it exists to keep out', async () => {
    for (const guess of ['admin', 'password', 'tarot', 'taro', 'manyfold', '123456', 'letmein']) {
      expect(await matchesLock(DEFAULT_LOCK, guess), guess).toBe(false);
    }
  });
});
