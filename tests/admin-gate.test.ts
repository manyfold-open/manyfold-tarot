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
 * There is one password now, the ADMIN_PASSWORD secret, and the case worth the
 * most attention is its absence. A deployment that has not set it is closed, not
 * open and not default-locked: no string opens the console, and `adminConfigured`
 * carries that fact to the browser so the page can say which secret to set. The
 * default lock this file used to test was a digest committed to a public
 * repository, which meant every fork inherited a lock only its author could open.
 * `nothing opens an unconfigured console` below is the test that keeps it gone.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/worker/index';
import { adminConfigured, adminPasswordOk } from '../src/worker/admin';
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
 * Built inside each test, never at describe time: `base` does not exist until
 * beforeAll runs, and spreading it early yields an env with no database and a 500
 * that looks nothing like the thing under test.
 */
const withSecret = (secret: string): Env => ({ ...base, ADMIN_PASSWORD: secret }) as Env;

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

  it('stays open even on a deployment that has no admin password', async () => {
    // The closed console must not close the product with it. This is the half a
    // "lock everything by default" change breaks first.
    const response = await call('/api/tarot/reader', { env: base });
    expect(response.status).toBe(200);
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

describe('a deployment with no ADMIN_PASSWORD', () => {
  it('nothing opens an unconfigured console', async () => {
    // Not "the right password opens it" — there is no right password. A default
    // lock committed to a public repo is a key its author keeps and its forkers
    // do not, so there is no default any more, and this is the assertion that
    // says so out loud.
    for (const guess of ['', ' ', 'admin', 'letmein', 'abcd-efgh-ijkl-mnop', 'x'.repeat(64)]) {
      expect(adminPasswordOk(base, guess), guess).toBe(false);
    }
    expect(adminConfigured(base)).toBe(false);
  });

  it('treats a blank secret as no secret, so an empty value cannot mean "no lock"', async () => {
    for (const blank of ['', '   ', '\n\t']) {
      const env = withSecret(blank);
      expect(adminConfigured(env), JSON.stringify(blank)).toBe(false);
      expect(adminPasswordOk(env, blank)).toBe(false);
      expect((await call('/api/agents', { env, password: blank })).status).toBe(401);
    }
  });

  it('tells the browser it is unconfigured, so the page can say what to set', async () => {
    const state = (await (await call('/api/state')).json()) as AppState;
    expect(state.adminConfigured).toBe(false);
    expect(state.adminRequired).toBe(true);
    expect(state.adminOk).toBe(false);
  });
});

describe('the ADMIN_PASSWORD secret', () => {
  it('opens the console when it is the one set', async () => {
    const env = withSecret('a simple one');
    expect((await call('/api/agents', { env, password: 'a simple one' })).status).toBe(200);
    expect((await call('/api/agents', { env, password: 'a simple two' })).status).toBe(401);
  });

  it('is the only thing that opens it — no second password survives alongside', async () => {
    const env = withSecret('a simple one');
    for (const other of ['', 'admin', 'a simple one ', 'A SIMPLE ONE']) {
      expect(adminPasswordOk(env, other), JSON.stringify(other)).toBe(false);
    }
  });

  it('may be short and memorable, which is the entire reason it exists', async () => {
    // A secret is not readable by anyone, so it does not need the entropy a
    // committed digest would have needed. If this ever stops being true, someone
    // has added a length rule that pushes operators back towards a shared default.
    const env = withSecret('cat');
    expect((await call('/api/agents', { env, password: 'cat' })).status).toBe(200);
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
    const env = withSecret('let me in');
    const state = (await (await call('/api/state', { env, password: 'let me in' })).json()) as AppState;
    expect(state.adminOk).toBe(true);
    expect(state.adminConfigured).toBe(true);
    expect(Array.isArray(state.agents)).toBe(true);
  });
});
