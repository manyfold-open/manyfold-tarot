/**
 * The whole product, driven the way a browser drives it.
 *
 * Every request below goes through the real Worker — the same Hono app that is
 * deployed, with its CSRF check, its session cookie, its rate limiter and its
 * SQL — against a real SQLite database standing in for D1. Nothing here mocks a
 * route or a query, so this is the test that would notice if the flow itself
 * broke: a card revealed out of order, a stranger reading someone's reading, a
 * share link that quietly follows the reading it came from.
 *
 * The diviner is the built-in demo reader (TAROT_DEMO=1), which is exactly the
 * configuration this site runs in until Agent 2 is connected.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/worker/index';
import type { Env } from '../src/worker/types';
import { parseDraw } from '../src/worker/tarot/draw';
import type { DivinerEvent, ReadingView, ShareSnapshot } from '../src/shared/tarot/types';
import { createD1, type FakeD1 } from './support/d1';

const ORIGIN = 'https://taro.test';

let d1: FakeD1;
let env: Env;

beforeAll(() => {
  d1 = createD1();
  env = {
    DB: d1.db,
    ASSETS: { fetch: async () => new Response('asset', { status: 200 }) } as unknown as Fetcher,
    ENVIRONMENT: 'test',
    // The reader Agent 2 will replace. Until then the site has to work alone.
    TAROT_DEMO: '1',
  } as Env;
});

afterAll(() => d1.close());

/** waitUntil work is collected so a test can wait for the SSE pump to finish. */
function context() {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil: (promise: Promise<unknown>) => void pending.push(promise),
      passThroughOnException: () => undefined,
    } as unknown as ExecutionContext,
    settled: () => Promise.all(pending),
  };
}

interface Call {
  status: number;
  json: <T>() => Promise<T>;
  events: () => Promise<DivinerEvent[]>;
  cookie: string | null;
}

async function call(
  path: string,
  options: { method?: string; body?: unknown; cookie?: string | null } = {},
): Promise<Call> {
  const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
  const headers: Record<string, string> = { origin: ORIGIN };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.cookie) headers.cookie = options.cookie;

  const { ctx, settled } = context();
  const response = await app.fetch(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    env,
    ctx,
  );

  const setCookie = response.headers.get('set-cookie');
  const text = await response.text();
  await settled();

  return {
    status: response.status,
    cookie: setCookie ? (setCookie.split(';')[0] ?? null) : null,
    json: async <T>() => JSON.parse(text) as T,
    events: async () =>
      text
        .split('\n\n')
        .map((frame) => frame.replace(/^data: /, '').trim())
        .filter(Boolean)
        .map((payload) => JSON.parse(payload) as DivinerEvent),
  };
}

const first = <T extends DivinerEvent['type']>(
  events: DivinerEvent[],
  type: T,
): Extract<DivinerEvent, { type: T }> | undefined =>
  events.find((event) => event.type === type) as Extract<DivinerEvent, { type: T }> | undefined;

/** Runs a whole round and hands back the ids, so later tests can start anywhere. */
async function completeReading(cookie?: string | null) {
  const started = await call('/api/tarot/readings', {
    body: { question: '我要不要换一份工作？', locale: 'zh' },
    cookie,
  });
  const session = cookie ?? started.cookie;
  const { reading } = await started.json<{ reading: ReadingView }>();

  await call(`/api/tarot/readings/${reading.readingId}/greeting`, { body: {}, cookie: session });
  await call(`/api/tarot/readings/${reading.readingId}/draw`, { body: {}, cookie: session });
  for (const index of [0, 1, 2]) {
    await call(`/api/tarot/readings/${reading.readingId}/reveal`, { body: { index }, cookie: session });
  }
  const done = await call(`/api/tarot/readings/${reading.readingId}/interpretation`, {
    body: {},
    cookie: session,
  });
  return { readingId: reading.readingId, session, interpretation: await done.events() };
}

describe('the app still boots', () => {
  it('answers /api/health and creates its schema on the way', async () => {
    const response = await call('/api/health');
    expect(response.status).toBe(200);
    expect(await response.json<{ status: string }>()).toMatchObject({ status: 'ok' });
    expect(d1.query("SELECT name FROM sqlite_master WHERE name = 'tarot_readings'")).toHaveLength(1);
  });

  it('keeps the tarot routes public and the operator routes not', async () => {
    expect((await call('/api/tarot/reader')).status).toBe(200);
    expect((await call('/api/tarot/nope')).status).toBe(404);
  });

  it('owes nobody a consent banner on a deployment that measures nothing', async () => {
    // No GA_MEASUREMENT_ID in this env — which is every fork and every clone.
    // Nothing from Google is served, so there is nothing to ask about, and the
    // answer has to be no regardless of where the request came from.
    const reader = await (await call('/api/tarot/reader')).json<{
      demo: boolean;
      consentRequired: boolean;
    }>();
    expect(reader).toEqual({ demo: true, consentRequired: false });
  });

  it('refuses a cross-origin mutation', async () => {
    const { ctx } = context();
    const response = await app.fetch(
      new Request(`${ORIGIN}/api/tarot/readings`, {
        method: 'POST',
        headers: { origin: 'https://evil.test', 'content-type': 'application/json' },
        body: JSON.stringify({ question: 'x' }),
      }),
      env,
      ctx,
    );
    expect(response.status).toBe(403);
  });
});

describe('one full round', () => {
  let session: string;
  let readingId: string;

  it('state 1 → 2: takes the question and hands back a session cookie', async () => {
    const response = await call('/api/tarot/readings', {
      body: { question: '  我要不要换一份工作？  ', locale: 'zh' },
    });
    expect(response.status).toBe(201);
    expect(response.cookie).toMatch(/^taro_sid=/);
    session = response.cookie!;

    const { reading } = await response.json<{ reading: ReadingView }>();
    readingId = reading.readingId;
    expect(reading.status).toBe('greeting');
    expect(reading.question).toBe('我要不要换一份工作？');
    expect(reading.cards).toEqual([]);
    expect(reading.pending).toBe(0);
    expect(reading.demo).toBe(false); // not known until the reader speaks
  });

  it('refuses an empty question', async () => {
    const response = await call('/api/tarot/readings', { body: { question: '   ' }, cookie: session });
    expect(response.status).toBe(400);
    expect(await response.json<{ error: { code: string } }>()).toMatchObject({
      error: { code: 'question_required' },
    });
  });

  it('state 2: the reader catches the question without naming a card', async () => {
    const events = await (
      await call(`/api/tarot/readings/${readingId}/greeting`, { body: {}, cookie: session })
    ).events();
    const greeting = first(events, 'greeting');
    expect(greeting?.text.trim()).not.toBe('');
    // Nothing is drawn yet, so nothing may be named.
    expect(greeting?.text).not.toMatch(/正位|逆位/);
    expect(first(events, 'error')).toBeUndefined();
  });

  it('will not turn a card over before the shuffle is stopped', async () => {
    const response = await call(`/api/tarot/readings/${readingId}/reveal`, {
      body: { index: 0 },
      cookie: session,
    });
    expect(response.status).toBe(409);
    expect(await response.json<{ error: { code: string } }>()).toMatchObject({
      error: { code: 'not_drawn_yet' },
    });
  });

  it('state 3: stopping the shuffle commits three cards the browser cannot see', async () => {
    const response = await call(`/api/tarot/readings/${readingId}/draw`, { body: {}, cookie: session });
    const { reading } = await response.json<{ reading: ReadingView }>();

    expect(reading.status).toBe('drawn');
    expect(reading.pending).toBe(3);
    expect(reading.cards).toEqual([]); // face down means face down, over the wire too

    const [row] = d1.query('SELECT cards FROM tarot_readings WHERE id = ?', readingId);
    const drawn = parseDraw(String(row.cards));
    expect(drawn).not.toBeNull();
    expect(new Set(drawn!.map((card) => card.cardId)).size).toBe(3);
    expect(drawn!.map((card) => card.slot)).toEqual(['situation', 'hidden', 'guidance']);
  });

  it('draws exactly once, however many times the button is pressed', async () => {
    const before = d1.query('SELECT cards FROM tarot_readings WHERE id = ?', readingId)[0].cards;
    await call(`/api/tarot/readings/${readingId}/draw`, { body: {}, cookie: session });
    await call(`/api/tarot/readings/${readingId}/draw`, { body: {}, cookie: session });
    expect(d1.query('SELECT cards FROM tarot_readings WHERE id = ?', readingId)[0].cards).toBe(before);
  });

  it('state 4: turns them over strictly in order', async () => {
    const skipped = await call(`/api/tarot/readings/${readingId}/reveal`, {
      body: { index: 2 },
      cookie: session,
    });
    expect(skipped.status).toBe(409);
    expect(await skipped.json<{ error: { code: string } }>()).toMatchObject({
      error: { code: 'reveal_out_of_order' },
    });

    const slots = ['situation', 'hidden', 'guidance'];
    for (const index of [0, 1, 2]) {
      const events = await (
        await call(`/api/tarot/readings/${readingId}/reveal`, { body: { index }, cookie: session })
      ).events();
      const card = first(events, 'card');
      expect(card?.card.index, `card ${index}`).toBe(index);
      expect(card?.card.slot, `card ${index}`).toBe(slots[index]);
      expect(typeof card?.card.reversed).toBe('boolean');
      expect(first(events, 'hint')?.text.trim(), `hint ${index}`).not.toBe('');
    }

    const { reading } = await (
      await call(`/api/tarot/readings/${readingId}`, { cookie: session })
    ).json<{ reading: ReadingView }>();
    expect(reading.status).toBe('revealed');
    expect(reading.cards).toHaveLength(3);
    expect(reading.pending).toBe(0);
  });

  it('state 5: reads all three as one spread, in the eight fixed sections', async () => {
    const events = await (
      await call(`/api/tarot/readings/${readingId}/interpretation`, { body: {}, cookie: session })
    ).events();
    const interpretation = first(events, 'interpretation')?.interpretation;
    expect(interpretation).toBeDefined();

    expect(interpretation!.conclusion.trim()).not.toBe('');
    expect(interpretation!.overview.trim()).not.toBe('');
    expect(interpretation!.perCard.map((entry) => entry.slot)).toEqual([
      'situation',
      'hidden',
      'guidance',
    ]);
    for (const entry of interpretation!.perCard) expect(entry.text.trim()).not.toBe('');
    expect(interpretation!.connections.trim()).not.toBe('');
    expect(interpretation!.response.trim()).not.toBe('');
    expect(interpretation!.actions.length).toBeGreaterThanOrEqual(2);
    expect(interpretation!.reflection.trim()).not.toBe('');
    expect(interpretation!.closing.trim()).not.toBe('');

    // The protocol the reader answers in never reaches the reader of the page.
    const rendered = JSON.stringify(interpretation);
    for (const tag of ['[CONCLUSION]', '[ACTIONS]', '[CLOSING]', 'NEW_READING', '<think>']) {
      expect(rendered).not.toContain(tag);
    }
  });

  it('replays a finished reading instead of paying for it twice', async () => {
    const again = await (
      await call(`/api/tarot/readings/${readingId}/interpretation`, { body: {}, cookie: session })
    ).events();
    expect(first(again, 'interpretation')).toBeDefined();
    expect(d1.query('SELECT COUNT(*) AS n FROM tarot_readings WHERE id = ?', readingId)[0].n).toBe(1);
  });

  it('state 6a: keeps a follow-up on the same three cards, with no new draw', async () => {
    const before = d1.query('SELECT cards FROM tarot_readings WHERE id = ?', readingId)[0].cards;
    const events = await (
      await call(`/api/tarot/readings/${readingId}/follow-ups`, {
        body: { message: '第二张牌为什么会落在隐藏的影响？' },
        cookie: session,
      })
    ).events();

    const followUp = first(events, 'followup');
    expect(followUp?.text.trim()).not.toBe('');
    expect(followUp?.suggestsNewReading).toBe(false);
    expect(d1.query('SELECT cards FROM tarot_readings WHERE id = ?', readingId)[0].cards).toBe(before);

    const { reading } = await (
      await call(`/api/tarot/readings/${readingId}`, { cookie: session })
    ).json<{ reading: ReadingView }>();
    expect(reading.followUps.map((entry) => entry.role)).toEqual(['user', 'diviner']);
  });

  it('flags a genuinely new question as a new round rather than answering it here', async () => {
    const events = await (
      await call(`/api/tarot/readings/${readingId}/follow-ups`, {
        body: { message: '那我妈的病呢？' },
        cookie: session,
      })
    ).events();
    expect(first(events, 'followup')?.suggestsNewReading).toBe(true);
  });

  it('state 6b: a new round is a new record, and never touches the old one', async () => {
    const response = await call('/api/tarot/readings', {
      body: { question: '那我妈的病呢？', locale: 'zh', previousReadingId: readingId },
      cookie: session,
    });
    const { reading } = await response.json<{ reading: ReadingView }>();
    expect(reading.readingId).not.toBe(readingId);
    expect(reading.status).toBe('greeting');
    expect(reading.cards).toEqual([]);

    const old = await (
      await call(`/api/tarot/readings/${readingId}`, { cookie: session })
    ).json<{ reading: ReadingView }>();
    expect(old.reading.status).toBe('interpreted');
    expect(old.reading.cards).toHaveLength(3);
  });
});

describe('a reading belongs to the browser that asked', () => {
  it('answers 404, not 403, to a stranger — an id is not a hint', async () => {
    const mine = await completeReading();
    const stranger = await call(`/api/tarot/readings/${mine.readingId}`, { cookie: 'taro_sid=someoneelseentirely' });
    expect(stranger.status).toBe(404);

    const anonymous = await call(`/api/tarot/readings/${mine.readingId}`);
    expect(anonymous.status).toBe(404);
  });

  it('refuses a stranger the interpretation and the share button too', async () => {
    const mine = await completeReading();
    const other = 'taro_sid=anotherbrowsersessionid';
    expect((await call(`/api/tarot/readings/${mine.readingId}/interpretation`, { body: {}, cookie: other })).status).toBe(404);
    expect((await call(`/api/tarot/readings/${mine.readingId}/share`, { body: {}, cookie: other })).status).toBe(404);
  });
});

describe('sharing', () => {
  it('is public, frozen, and shows only what was agreed', async () => {
    const mine = await completeReading();
    const created = await call(`/api/tarot/readings/${mine.readingId}/share`, {
      body: { includeQuestion: false },
      cookie: mine.session,
    });
    expect(created.status).toBe(201);
    const { share, url } = await created.json<{ share: ShareSnapshot; url: string }>();
    expect(url).toBe(`${ORIGIN}/s/${share.token}`);
    expect(share.question).toBeNull();
    expect(share.cards).toHaveLength(3);
    expect(share.conclusion.trim()).not.toBe('');
    expect(share.signature.trim()).not.toBe('');

    // Opened by a stranger with no cookie at all — that is the point of a link.
    const opened = await call(`/api/tarot/share/${share.token}`);
    expect(opened.status).toBe(200);
    expect(await opened.json<{ share: ShareSnapshot }>()).toEqual({ share });

    // The reading moves on underneath it; the link does not.
    await call(`/api/tarot/readings/${mine.readingId}/follow-ups`, {
      body: { message: '再多说一点。' },
      cookie: mine.session,
    });
    const later = await call(`/api/tarot/share/${share.token}`);
    expect(await later.json<{ share: ShareSnapshot }>()).toEqual({ share });
  });

  it('keeps every share separate, so a second one never overwrites the first', async () => {
    const mine = await completeReading();
    const a = await (
      await call(`/api/tarot/readings/${mine.readingId}/share`, {
        body: { includeQuestion: false },
        cookie: mine.session,
      })
    ).json<{ share: ShareSnapshot }>();
    const b = await (
      await call(`/api/tarot/readings/${mine.readingId}/share`, {
        body: { includeQuestion: true },
        cookie: mine.session,
      })
    ).json<{ share: ShareSnapshot }>();

    expect(b.share.token).not.toBe(a.share.token);
    expect(a.share.question).toBeNull();
    expect(b.share.question).toBe('我要不要换一份工作？');
    expect((await (await call(`/api/tarot/share/${a.share.token}`)).json<{ share: ShareSnapshot }>()).share.question).toBeNull();
  });

  it('will not share a reading that has not been read yet', async () => {
    const started = await call('/api/tarot/readings', { body: { question: '还没开始的一轮' } });
    const { reading } = await started.json<{ reading: ReadingView }>();
    const response = await call(`/api/tarot/readings/${reading.readingId}/share`, {
      body: {},
      cookie: started.cookie,
    });
    expect(response.status).toBe(409);
  });

  it('404s an invented token', async () => {
    expect((await call('/api/tarot/share/not-a-real-token')).status).toBe(404);
  });
});

describe('the meter', () => {
  it('cuts a session off once it has started too many rounds', async () => {
    const cookie = 'taro_sid=heavyhandedvisitorsession';
    let blocked: Awaited<ReturnType<typeof call>> | null = null;
    for (let i = 0; i < 20 && !blocked; i += 1) {
      const response = await call('/api/tarot/readings', {
        body: { question: `第 ${i} 个问题` },
        cookie,
      });
      if (response.status === 429) blocked = response;
    }
    expect(blocked, 'a session should eventually be refused').not.toBeNull();
    expect(await blocked!.json<{ error: { code: string } }>()).toMatchObject({
      error: { code: 'rate_limited' },
    });
  });
});
