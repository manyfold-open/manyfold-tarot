/**
 * The site under a prefix: app.manyfold.ai/tarot as well as the root.
 *
 * Driven through the real Worker entry, the same as tarot-e2e.test.ts, with
 * BASE_PATH set the way wrangler.jsonc sets it. What matters here is that the
 * prefix comes off on the way in, goes back on wherever a root path would reach
 * the browser, and that the root is untouched — including by a client that
 * claims a prefix it did not come in under.
 *
 * The HTML rewrite itself needs HTMLRewriter, which only exists in workerd; its
 * decisions are tested here as plain functions, and the rewrite is checked
 * against a real build in `vite preview`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import worker from '../src/worker/index';
import { isUnder, mountPath, prefixed, shouldRewrite } from '../src/worker/mount';
import type { Env } from '../src/worker/types';
import type { ReadingView } from '../src/shared/tarot/types';
import { createD1, type FakeD1 } from './support/d1';

const ORIGIN = 'https://taro.test';

let d1: FakeD1;
let env: Env;
/** Every path the assets binding was asked for, and what it answers next. */
const assetPaths: string[] = [];
let assetResponse: () => Response = () => new Response('asset', { status: 200 });

beforeAll(() => {
  d1 = createD1();
  env = {
    DB: d1.db,
    ASSETS: {
      fetch: async (request: Request) => {
        assetPaths.push(new URL(request.url).pathname);
        return assetResponse();
      },
    } as unknown as Fetcher,
    ENVIRONMENT: 'test',
    TAROT_DEMO: '1',
    BASE_PATH: '/tarot',
  } as Env;
});

afterAll(() => d1.close());

const ctx = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

async function call(
  path: string,
  options: { body?: unknown; cookie?: string | null; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { origin: ORIGIN, ...options.headers };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.cookie) headers.cookie = options.cookie;
  const response = await worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: options.body === undefined ? 'GET' : 'POST',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    env,
    ctx,
  );
  const setCookie = response.headers.get('set-cookie');
  return {
    response,
    setCookie,
    cookie: setCookie ? (setCookie.split(';')[0] ?? null) : null,
    json: async <T>() => (await response.json()) as T,
  };
}

/** One whole round under `prefix`, ending with a share link and an invitation. */
async function roundUnder(prefix: string, headers: Record<string, string> = {}) {
  const api = (path: string) => `${prefix}/api/tarot${path}`;
  const started = await call(api('/readings'), {
    body: { question: '我要不要换一份工作？', locale: 'zh' },
    headers,
  });
  expect(started.response.status).toBe(201);
  const cookie = started.cookie;
  const { reading } = await started.json<{ reading: ReadingView }>();
  const id = reading.readingId;

  const step = (path: string, body: unknown = {}) =>
    call(api(`/readings/${id}${path}`), { body, cookie, headers }).then((r) => r.response.text());
  await step('/greeting');
  await step('/draw');
  for (const index of [0, 1, 2]) await step('/reveal', { index });
  await step('/interpretation');

  const shared = await call(api(`/readings/${id}/share`), {
    body: { includeQuestion: false },
    cookie,
    headers,
  });
  const invited = await call(api(`/readings/${id}/referral`), { body: {}, cookie, headers });
  return {
    setCookie: started.setCookie ?? '',
    share: await shared.json<{ share: { token: string }; url: string }>(),
    referral: await invited.json<{ referral: { token: string }; url: string }>(),
  };
}

describe('BASE_PATH, as configured', () => {
  it('is normalised to a bare path, and anything unsafe for an attribute is dropped', () => {
    expect(mountPath({ BASE_PATH: '/tarot' })).toBe('/tarot');
    expect(mountPath({ BASE_PATH: ' /tarot/ ' })).toBe('/tarot');
    expect(mountPath({ BASE_PATH: '/apps/tarot' })).toBe('/apps/tarot');
    expect(mountPath({})).toBe('');
    expect(mountPath({ BASE_PATH: '' })).toBe('');
    expect(mountPath({ BASE_PATH: '/' })).toBe('');
    expect(mountPath({ BASE_PATH: 'tarot' })).toBe('');
    expect(mountPath({ BASE_PATH: '/ta"rot' })).toBe('');
  });

  it('claims the mount and what is under it, never a longer name', () => {
    expect(isUnder('/tarot', '/tarot')).toBe(true);
    expect(isUnder('/tarot/', '/tarot')).toBe(true);
    expect(isUnder('/tarot/s/abc', '/tarot')).toBe(true);
    expect(isUnder('/tarotology', '/tarot')).toBe(false);
    expect(isUnder('/', '/tarot')).toBe(false);
    expect(isUnder('/tarot', '')).toBe(false);
  });

  it('prefixes root paths only', () => {
    expect(prefixed('/assets/index.js', '/tarot')).toBe('/tarot/assets/index.js');
    expect(prefixed('/', '/tarot')).toBe('/tarot/');
    expect(prefixed('//cdn.test/x.js', '/tarot')).toBe('//cdn.test/x.js');
    expect(prefixed('https://www.googletagmanager.com/gtag/js', '/tarot')).toBe(
      'https://www.googletagmanager.com/gtag/js',
    );
    expect(prefixed('#chat', '/tarot')).toBe('#chat');
    expect(prefixed('cards/back.webp', '/tarot')).toBe('cards/back.webp');
  });

  it('rewrites 200 HTML documents and nothing else', () => {
    const with_ = (type: string, status = 200) =>
      new Response(null, { status, headers: { 'content-type': type } });
    expect(shouldRewrite(with_('text/html; charset=utf-8'))).toBe(true);
    expect(shouldRewrite(with_('image/webp'))).toBe(false);
    expect(shouldRewrite(with_('text/javascript'))).toBe(false);
    expect(shouldRewrite(with_('text/html', 304))).toBe(false);
  });
});

describe('requests under the mount', () => {
  it('sends the bare mount to its slash, keeping the query', async () => {
    const { response } = await call('/tarot?ref=abc');
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/tarot/?ref=abc`);
  });

  it('answers the API under the prefix and at the root alike', async () => {
    for (const path of ['/tarot/api/health', '/api/health']) {
      const { response } = await call(path);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: 'ok' });
    }
  });

  it('hands the assets binding root paths', async () => {
    assetPaths.length = 0;
    await call('/tarot/');
    await call('/tarot/cards/back.webp');
    await call('/tarot/s/sometoken');
    await call('/tarotology');
    expect(assetPaths).toEqual(['/', '/cards/back.webp', '/s/sometoken', '/tarotology']);
  });

  it('puts the prefix back on a root-relative redirect, and only under the mount', async () => {
    assetResponse = () => new Response(null, { status: 307, headers: { location: '/privacy' } });
    try {
      expect((await call('/tarot/privacy/')).response.headers.get('location')).toBe('/tarot/privacy');
      expect((await call('/privacy/')).response.headers.get('location')).toBe('/privacy');
    } finally {
      assetResponse = () => new Response('asset', { status: 200 });
    }
  });
});

describe('links and cookies follow the address the visitor used', () => {
  it('under the mount: share and invite links carry it, and the cookie stays inside it', async () => {
    const { setCookie, share, referral } = await roundUnder('/tarot');
    expect(setCookie).toContain('Path=/tarot;');
    expect(share.url).toBe(`${ORIGIN}/tarot/s/${share.share.token}`);
    expect(referral.url).toBe(`${ORIGIN}/tarot/?ref=${referral.referral.token}`);
  });

  it('at the root: unchanged, even when the client claims a prefix of its own', async () => {
    const { setCookie, share, referral } = await roundUnder('', { 'x-forwarded-prefix': '/evil' });
    expect(setCookie).toContain('Path=/;');
    expect(share.url).toBe(`${ORIGIN}/s/${share.share.token}`);
    expect(referral.url).toBe(`${ORIGIN}/?ref=${referral.referral.token}`);
  });
});
