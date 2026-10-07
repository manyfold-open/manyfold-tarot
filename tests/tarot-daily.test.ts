/**
 * Today's card, carried into a reading.
 *
 * The daily page can start a reading, and the reader is then told which card
 * the visitor walked in from. What has to hold is narrow and worth pinning:
 * the browser names a day, never a card; the Worker recomputes the card from
 * that day with the rule GET /daily has always used; only today or yesterday
 * counts, and anything else is dropped without refusing the reading; and the
 * card is context for the reader — it never touches the draw.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Diviner, DivinerRequest } from '../src/worker/tarot/diviner';
import { acceptedDailyDay, dailyCardFor, utcDay } from '../src/shared/tarot/daily';
import type { Env } from '../src/worker/types';
import type { ReadingView } from '../src/shared/tarot/types';
import { createD1, type FakeD1 } from './support/d1';

/** Every request the routes hand the reader, so a test can see what it was told. */
const asked: DivinerRequest[] = [];

vi.mock('../src/worker/tarot/diviner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/worker/tarot/diviner')>();
  const demo = actual.demoDiviner();
  const recording: Diviner = {
    demo: true,
    agentId: null,
    speak: (request, options) => {
      asked.push(request);
      return demo.speak(request, options);
    },
  };
  return { ...actual, resolveDiviner: async () => recording };
});

const ORIGIN = 'https://taro.test';
const DAY_MS = 86_400_000;
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

async function call(
  path: string,
  options: { method?: string; body?: unknown; cookie?: string | null } = {},
) {
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
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
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
  };
}

/** A fresh browser asking a fresh question; each one has its own free reading. */
async function start(body: Record<string, unknown>) {
  const response = await call('/api/tarot/readings', {
    body: { question: '今天该把精力放在哪里？', locale: 'zh', spreadId: 'next-step', ...body },
  });
  expect(response.status).toBe(201);
  const { reading } = response.json<{ reading: ReadingView }>();
  return { reading, cookie: response.cookie };
}

const storedDay = (readingId: string) =>
  d1.query('SELECT day FROM tarot_reading_daily WHERE reading_id = ?', readingId)[0]?.day ?? null;

const recomputed = (day: string) => {
  const { cardId, reversed } = dailyCardFor(day);
  return { cardId, reversed };
};

/** A card that is not the given day's, to pose as what a browser claims. */
const notTheCardOf = (day: string) => (dailyCardFor(day).cardId === 'major-13' ? 'major-12' : 'major-13');

describe('GET /daily is unchanged', () => {
  // Captured from the route as it was before the rule moved to
  // src/shared/tarot/daily.ts. Byte-for-byte: a published day keeps its card,
  // its orientation and its words — including the odd ones (a day before 1970
  // reads upright, and 02-30 rolls over to March the way Date does).
  const before: Record<string, string> = {
    '?date=2026-10-07':
      '{"date":"2026-10-07","cardId":"swords-14","reversed":true,"reflection":"今天，哪一件小事值得你多留意一点？","keywords":"思绪与真相上，强势或缺席，掌控变成压制"}',
    '?date=2026-10-08&locale=en':
      '{"date":"2026-10-08","cardId":"pentacles-01","reversed":false,"reflection":"What small thing deserves a little more of your attention today?","keywords":"In material life and resources, a fresh opening is presenting itself"}',
    '?date=1969-12-31':
      '{"date":"1969-12-31","cardId":"pentacles-14","reversed":false,"reflection":"今天，哪一件小事值得你多留意一点？","keywords":"现实与资源上，成熟地掌控全局，为结果负责"}',
    '?date=2026-02-30':
      '{"date":"2026-03-02","cardId":"major-00","reversed":false,"reflection":"今天，哪一件小事值得你多留意一点？","keywords":"起步、天真、纵身一跃"}',
    '?date=2000-01-01&locale=zh':
      '{"date":"2000-01-01","cardId":"cups-02","reversed":true,"reflection":"今天，哪一件小事值得你多留意一点？","keywords":"情感与关系上，取舍被拖延，平衡还没找到"}',
  };

  for (const [query, body] of Object.entries(before)) {
    it(`answers ${query} exactly as before`, async () => {
      const response = await call(`/api/tarot/daily${query}`);
      expect(response.status).toBe(200);
      expect(response.text).toBe(body);
    });
  }

  it('reads a missing or unreadable date as today', async () => {
    const today = (await call(`/api/tarot/daily?date=${utcDay()}&locale=en`)).text;
    expect((await call('/api/tarot/daily?locale=en')).text).toBe(today);
    expect((await call('/api/tarot/daily?date=garbage&locale=en')).text).toBe(today);
    expect((await call('/api/tarot/daily?date=2026-13-45&locale=en')).text).toBe(today);
    expect(Object.keys(JSON.parse(today))).toEqual(['date', 'cardId', 'reversed', 'reflection', 'keywords']);
  });
});

describe('which day a reading may say it came from', () => {
  const now = new Date('2026-10-07T00:00:30.000Z');

  it('takes today and yesterday, by the UTC calendar', () => {
    expect(acceptedDailyDay('2026-10-07', now)).toBe('2026-10-07');
    // Opened at 23:59 yesterday, tapped thirty seconds into today.
    expect(acceptedDailyDay('2026-10-06', now)).toBe('2026-10-06');
  });

  it('drops anything else', () => {
    for (const value of [
      '2026-10-05',
      '2026-10-04',
      '2026-10-08',
      '2026-10-7',
      '2026-10-07T00:00:00Z',
      ' 2026-10-07',
      '',
      'today',
      20261007,
      null,
      undefined,
      { day: '2026-10-07' },
      ['2026-10-07'],
    ]) {
      expect(acceptedDailyDay(value, now), JSON.stringify(value)).toBeNull();
    }
  });
});

describe('POST /readings with a daily date', () => {
  it('stores today’s day and shows the card worked out from it', async () => {
    const today = utcDay();
    const { reading, cookie } = await start({ dailyDate: today });
    expect(storedDay(reading.readingId)).toBe(today);
    expect(reading.dailyCard).toEqual(recomputed(today));

    // The same on the way back, not just in the response that created it.
    const again = await call(`/api/tarot/readings/${reading.readingId}`, { cookie });
    expect(again.json<{ reading: ReadingView }>().reading.dailyCard).toEqual(recomputed(today));
  });

  it('still takes yesterday’s, for a page opened just before midnight', async () => {
    const yesterday = utcDay(new Date(Date.now() - DAY_MS));
    const { reading } = await start({ dailyDate: yesterday });
    expect(storedDay(reading.readingId)).toBe(yesterday);
    expect(reading.dailyCard).toEqual(recomputed(yesterday));
  });

  it('never uses a card the browser names', async () => {
    const today = utcDay();
    const claimed = notTheCardOf(today);
    const { reading } = await start({
      dailyDate: today,
      dailyCardId: claimed,
      dailyCard: { cardId: claimed, reversed: !dailyCardFor(today).reversed },
    });
    expect(reading.dailyCard).toEqual(recomputed(today));
    expect(reading.dailyCard?.cardId).not.toBe(claimed);

    // And with no day at all, a named card is no daily card.
    const bare = await start({ dailyCardId: claimed });
    expect(bare.reading.dailyCard).toBeUndefined();
    expect(storedDay(bare.reading.readingId)).toBeNull();
  });

  const ignored: [string, () => unknown][] = [
    ['a day three days old', () => utcDay(new Date(Date.now() - 3 * DAY_MS))],
    ['a future day', () => utcDay(new Date(Date.now() + DAY_MS))],
    ['garbage', () => 'not-a-date'],
    ['a timestamp rather than a day', () => new Date().toISOString()],
    ['a number', () => 20261007],
    ['an object', () => ({ date: utcDay() })],
  ];

  for (const [label, value] of ignored) {
    it(`ignores ${label} and reads without a daily card`, async () => {
      const { reading } = await start({ dailyDate: value() });
      expect(reading.status).toBe('greeting');
      expect('dailyCard' in reading).toBe(false);
      expect(storedDay(reading.readingId)).toBeNull();
    });
  }

  it('leaves a reading with no daily date exactly as it was', async () => {
    const { reading } = await start({});
    expect('dailyCard' in reading).toBe(false);
    expect(storedDay(reading.readingId)).toBeNull();
  });
});

describe('the reader is told, the draw is not touched', () => {
  it('hands the card to the reading and follow-ups only, and still draws three', async () => {
    const today = utcDay();
    const { reading, cookie } = await start({ dailyDate: today });
    const id = reading.readingId;
    asked.length = 0;

    await call(`/api/tarot/readings/${id}/greeting`, { body: {}, cookie });
    const drawn = (await call(`/api/tarot/readings/${id}/draw`, { body: {}, cookie })).json<{
      reading: ReadingView;
    }>().reading;
    expect(drawn.pending).toBe(3);
    expect(drawn.cards).toHaveLength(0);
    for (const index of [0, 1, 2]) {
      await call(`/api/tarot/readings/${id}/reveal`, { body: { index }, cookie });
    }
    await call(`/api/tarot/readings/${id}/interpretation`, { body: {}, cookie });
    await call(`/api/tarot/readings/${id}/follow-ups`, { body: { message: '那下周呢？' }, cookie });

    // Three positions, three slots, and nothing extra hiding among them.
    const stored = d1.query('SELECT cards FROM tarot_readings WHERE id = ?', id)[0];
    const cards = JSON.parse(String(stored.cards)) as { slot: string }[];
    expect(cards.map((card) => card.slot)).toEqual(['situation', 'hidden', 'guidance']);

    const finished = (await call(`/api/tarot/readings/${id}`, { cookie })).json<{ reading: ReadingView }>().reading;
    expect(finished.status).toBe('interpreted');
    expect(finished.cards).toHaveLength(3);
    expect(finished.dailyCard).toEqual(recomputed(today));

    const byKind = (kind: DivinerRequest['kind']) => asked.filter((request) => request.kind === kind);
    expect(byKind('interpretation')).toHaveLength(1);
    expect(byKind('followup')).toHaveLength(1);
    for (const request of [...byKind('interpretation'), ...byKind('followup')]) {
      expect((request as { dailyCard?: unknown }).dailyCard).toEqual(recomputed(today));
    }
    // The greeting forbids naming a card, and a hint is one card's beat.
    for (const request of [...byKind('greeting'), ...byKind('hint')]) {
      expect('dailyCard' in request).toBe(false);
    }
  });

  it('tells the reader nothing about a reading that did not come from it', async () => {
    const { reading, cookie } = await start({});
    const id = reading.readingId;
    asked.length = 0;
    await call(`/api/tarot/readings/${id}/greeting`, { body: {}, cookie });
    await call(`/api/tarot/readings/${id}/draw`, { body: {}, cookie });
    for (const index of [0, 1, 2]) {
      await call(`/api/tarot/readings/${id}/reveal`, { body: { index }, cookie });
    }
    await call(`/api/tarot/readings/${id}/interpretation`, { body: {}, cookie });
    const interpretation = asked.find((request) => request.kind === 'interpretation');
    expect(interpretation).toBeDefined();
    expect((interpretation as { dailyCard?: unknown }).dailyCard).toBeUndefined();
  });
});

describe('forgetting a reading forgets where it came from', () => {
  async function finish(cookie: string | null, id: string) {
    await call(`/api/tarot/readings/${id}/greeting`, { body: {}, cookie });
    await call(`/api/tarot/readings/${id}/draw`, { body: {}, cookie });
    for (const index of [0, 1, 2]) {
      await call(`/api/tarot/readings/${id}/reveal`, { body: { index }, cookie });
    }
    await call(`/api/tarot/readings/${id}/interpretation`, { body: {}, cookie });
  }

  it('deletes the day with the reading', async () => {
    const { reading, cookie } = await start({ dailyDate: utcDay() });
    await finish(cookie, reading.readingId);
    const removed = await call(`/api/tarot/readings/${reading.readingId}/journal`, { method: 'DELETE', cookie });
    expect(removed.status).toBe(200);
    expect(storedDay(reading.readingId)).toBeNull();
  });

  it('deletes it when the whole journal is cleared', async () => {
    const { reading, cookie } = await start({ dailyDate: utcDay() });
    expect(storedDay(reading.readingId)).not.toBeNull();
    const cleared = await call('/api/tarot/journal', { method: 'DELETE', cookie });
    expect(cleared.status).toBe(200);
    expect(storedDay(reading.readingId)).toBeNull();
  });
});
