/**
 * The tarot API: /api/tarot/*
 *
 * These are the only public routes in the app (see the note on the admin gate in
 * src/worker/index.ts) — a visitor cannot be asked for a password before asking
 * a question. Everything that costs an agent turn therefore passes the rate
 * limiter first, and everything that touches a reading proves ownership through
 * the session cookie.
 *
 * Route map:
 *   GET  /api/tarot/reader                       who is reading (live agent or demo)
 *   POST /api/tarot/readings                     start a round from a question
 *   GET  /api/tarot/readings/:id                 resume a round
 *   POST /api/tarot/readings/:id/greeting        SSE  the reader catches the question
 *   POST /api/tarot/readings/:id/draw            stop the shuffle, commit three cards
 *   POST /api/tarot/readings/:id/reveal          SSE  turn one card over, in order
 *   POST /api/tarot/readings/:id/interpretation  SSE  the full reading
 *   POST /api/tarot/readings/:id/follow-ups      SSE  keep reading the same three cards
 *   POST /api/tarot/readings/:id/share           freeze a public snapshot
 *   GET  /api/tarot/share/:token                 read one (public, no session)
 *
 * The streaming routes follow the starter's chat pattern: the response stream is
 * returned immediately and the pump runs under waitUntil, so a visitor who
 * closes the tab mid-reading still gets a persisted result when they come back.
 */

import { Hono } from 'hono';
import { normalizeLocale } from '../../shared/tarot/i18n';
import {
  QUESTION_MAX_CHARS,
  type DivinerEvent,
  type DrawnCardView,
} from '../../shared/tarot/types';
import { A2AError, safeErrorText } from '../a2a';
import { consentRequiredFor, measurementIdFor } from '../analytics';
import { HttpError, type Env } from '../types';
import { demoHint } from './demo';
import { resolveDiviner } from './diviner';
import { drawReading } from './draw';
import {
  assertFollowable,
  assertInterpretable,
  assertRevealable,
  assertShareable,
  drawDecision,
  isNewReveal,
  type ReadingRecord,
} from './flow';
import {
  interpretationIsUsable,
  parseFollowUp,
  parseInterpretation,
  sanitizeFollowUp,
  sanitizeQuestion,
} from './prompt';
import { FOLLOW_UPS_PER_READING, RULES, enforce, shouldSweep, sweep } from './ratelimit';
import {
  addFollowUp,
  commitDraw,
  countUserFollowUps,
  createReading,
  createShare,
  listFollowUps,
  loadShare,
  readingViewFor,
  recordReveal,
  requireOwnedReading,
  saveGreeting,
  saveInterpretation,
} from './store';
import {
  isSecureRequest,
  newSessionId,
  readSessionCookie,
  sessionCookieHeader,
} from './session';

type TarotEnv = {
  Bindings: Env;
  Variables: { sessionId: string; clientIp: string | null };
};

export const tarot = new Hono<TarotEnv>();

/* ───────── session ───────── */

tarot.use('*', async (c, next) => {
  const existing = readSessionCookie(c.req.header('cookie'));
  const sessionId = existing ?? newSessionId();
  c.set('sessionId', sessionId);
  c.set('clientIp', c.req.header('cf-connecting-ip') ?? null);
  await next();
  if (!existing) {
    c.header('set-cookie', sessionCookieHeader(sessionId, isSecureRequest(c.req.url)), {
      append: true,
    });
  }
  if (shouldSweep()) c.executionCtx.waitUntil(sweep(c.env).catch(() => undefined));
});

/* ───────── streaming helper ───────── */

/**
 * Hands streamTurn a way to keep working after the response is returned.
 *
 * Structural rather than Hono's `Context`: Hono and workerd each ship their own
 * ExecutionContext type and they are not assignable to one another, so the
 * narrow thing we actually use is the only thing named here.
 */
type Deferrable = { executionCtx: { waitUntil: (promise: Promise<unknown>) => void } };

const defer =
  (c: Deferrable) =>
  (promise: Promise<unknown>): void =>
    c.executionCtx.waitUntil(promise);

/**
 * Runs one diviner turn as SSE.
 *
 * Mirrors src/worker/chat.ts: writes to a vanished client fail silently while
 * the pump keeps consuming and persisting, because the reading the visitor
 * comes back to matters more than the socket they left.
 */
function streamTurn(
  waitUntil: (promise: Promise<unknown>) => void,
  pump: (send: (event: DivinerEvent) => Promise<void>) => Promise<void>,
): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let clientGone = false;

  const send = async (event: DivinerEvent) => {
    if (clientGone) return;
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    } catch {
      clientGone = true;
    }
  };

  const run = async () => {
    try {
      await pump(send);
    } catch (error) {
      const message =
        error instanceof HttpError
          ? error.message
          : safeErrorText(error instanceof Error ? error.message : error);
      await send({ type: 'error', message });
    } finally {
      try {
        await writer.close();
      } catch {
        /* already closed */
      }
    }
  };

  waitUntil(run());
  return new Response(readable, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  });
}

/** Throttles `delta` events; the reader's voice does not need 60fps. */
const DELTA_INTERVAL_MS = 120;

function throttledDelta(send: (event: DivinerEvent) => Promise<void>) {
  let last = 0;
  return async (text: string) => {
    const stamp = Date.now();
    if (stamp - last < DELTA_INTERVAL_MS) return;
    last = stamp;
    await send({ type: 'delta', text });
  };
}

/* ───────── who is reading ───────── */

tarot.get('/reader', async (c) => {
  const diviner = await resolveDiviner(c.env);
  // `consentRequired` rides along because the page already asks this question on
  // load and a second request to answer it would be a request for nothing. It
  // decides whether a banner is drawn, not whether anything is stored — the tag
  // in the page head has already denied itself in these regions before this
  // answer arrives (src/worker/analytics.ts).
  return c.json({
    demo: diviner.demo,
    consentRequired:
      measurementIdFor(c.env) !== null && consentRequiredFor(c.req.header('cf-ipcountry')),
  });
});

/* ───────── state 1 → 2: the question ───────── */

tarot.post('/readings', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const question = sanitizeQuestion(body?.question);
  if (!question) {
    throw new HttpError(400, 'question_required', 'Write down what you want to ask first.');
  }
  if (String(body?.question ?? '').length > QUESTION_MAX_CHARS * 2) {
    throw new HttpError(400, 'question_too_long', `Questions are limited to ${QUESTION_MAX_CHARS} characters.`);
  }

  const sessionId = c.get('sessionId');
  await enforce(c.env, {
    sessionId,
    ip: c.get('clientIp'),
    scope: 'readings',
    rule: RULES.readings,
    ipRule: RULES.readingsPerIp,
  });

  // A new round is a new row and a new A2A context. The previous id is kept only
  // as a link between rounds — never as a way to mix two spreads.
  const previous = typeof body?.previousReadingId === 'string' ? body.previousReadingId : null;
  const reading = await createReading(c.env, {
    sessionId,
    question,
    locale: normalizeLocale(body?.locale),
    previousReadingId: previous,
  });
  return c.json({ reading: await readingViewFor(c.env, reading) }, 201);
});

tarot.get('/readings/:id', async (c) => {
  const reading = await requireOwnedReading(c.env, c.req.param('id'), c.get('sessionId'));
  return c.json({ reading: await readingViewFor(c.env, reading) });
});

/* ───────── state 2: the reader catches it ───────── */

tarot.post('/readings/:id/greeting', async (c) => {
  const reading = await requireOwnedReading(c.env, c.req.param('id'), c.get('sessionId'));

  // Already spoken: replay it rather than paying for the same sentence twice.
  if (reading.greeting) {
    return streamTurn(defer(c), async (send) => {
      await send({ type: 'greeting', text: reading.greeting });
    });
  }

  await enforce(c.env, {
    sessionId: c.get('sessionId'),
    ip: c.get('clientIp'),
    scope: 'turns',
    rule: RULES.turns,
    ipRule: RULES.turnsPerIp,
  });
  const diviner = await resolveDiviner(c.env);

  return streamTurn(defer(c), async (send) => {
    const result = await diviner.speak(
      { kind: 'greeting', locale: reading.locale, question: reading.question },
      {
        idempotencyKey: `${reading.id}-greeting`,
        contextId: reading.contextId,
        taskId: reading.activeTaskId,
        onDelta: throttledDelta(send),
      },
    );
    await saveGreeting(c.env, reading.id, {
      greeting: result.text,
      contextId: result.contextId,
      taskId: result.taskId,
      demo: diviner.demo,
      agentId: diviner.agentId,
    });
    await send({ type: 'greeting', text: result.text });
  });
});

/* ───────── state 3: stop the shuffle ───────── */

tarot.post('/readings/:id/draw', async (c) => {
  const reading = await requireOwnedReading(c.env, c.req.param('id'), c.get('sessionId'));
  const { draw } = drawDecision(reading);

  // The one place in the app where cards are chosen. Not the browser, not the
  // agent — here, from the CSPRNG, after the user asked the deck to stop.
  const committed = draw ? await commitDraw(c.env, reading.id, drawReading()) : reading;
  return c.json({ reading: await readingViewFor(c.env, committed) });
});

/* ───────── state 4: turn them over, one at a time ───────── */

tarot.post('/readings/:id/reveal', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { index?: unknown } | null;
  const index = Number(body?.index);
  const reading = await requireOwnedReading(c.env, c.req.param('id'), c.get('sessionId'));
  assertRevealable(reading, index);

  const card = reading.cards![index];
  const view: DrawnCardView = {
    slot: card.slot,
    index,
    cardId: card.cardId,
    reversed: card.reversed,
    hint: reading.hints[index] ?? '',
  };

  // Turning an already-open card back over is a read, not a turn: no agent call.
  if (!isNewReveal(reading, index)) {
    return streamTurn(defer(c), async (send) => {
      await send({ type: 'card', card: view });
      await send({ type: 'hint', index, text: view.hint });
    });
  }

  await enforce(c.env, {
    sessionId: c.get('sessionId'),
    ip: c.get('clientIp'),
    scope: 'turns',
    rule: RULES.turns,
    ipRule: RULES.turnsPerIp,
  });
  const diviner = await resolveDiviner(c.env);

  return streamTurn(defer(c), async (send) => {
    // The card first: it flips the moment the user asked, and the line arrives
    // underneath it. A 30-second wait staring at a card back is not the ritual.
    await send({ type: 'card', card: view });
    let hint: string;
    try {
      const result = await diviner.speak(
        { kind: 'hint', locale: reading.locale, question: reading.question, card, index },
        {
          idempotencyKey: `${reading.id}-hint-${index}`,
          contextId: reading.contextId,
          taskId: reading.activeTaskId,
          onDelta: throttledDelta(send),
        },
      );
      hint = result.text;
    } catch (error) {
      // Unlike the greeting and the reading itself, a hint falls back rather
      // than failing: it is one beat in the flip, and the full interpretation
      // still comes from the reader. The fallback is the deck's own line.
      console.warn('tarot hint fell back', safeErrorText(error instanceof Error ? error.message : error));
      hint = demoHint(card, reading.locale);
    }
    await recordReveal(c.env, reading.id, index, hint, reading.hints);
    await send({ type: 'hint', index, text: hint });
  });
});

/* ───────── state 5: the reading ───────── */

tarot.post('/readings/:id/interpretation', async (c) => {
  const reading = await requireOwnedReading(c.env, c.req.param('id'), c.get('sessionId'));
  assertInterpretable(reading);

  if (reading.interpretation) {
    const existing = reading.interpretation;
    return streamTurn(defer(c), async (send) => {
      await send({ type: 'interpretation', interpretation: existing });
    });
  }

  await enforce(c.env, {
    sessionId: c.get('sessionId'),
    ip: c.get('clientIp'),
    scope: 'turns',
    rule: RULES.turns,
    ipRule: RULES.turnsPerIp,
  });
  const diviner = await resolveDiviner(c.env);

  return streamTurn(defer(c), async (send) => {
    const result = await diviner.speak(
      {
        kind: 'interpretation',
        locale: reading.locale,
        question: reading.question,
        cards: reading.cards!,
      },
      {
        idempotencyKey: `${reading.id}-reading`,
        contextId: reading.contextId,
        taskId: reading.activeTaskId,
        onDelta: throttledDelta(send),
      },
    );

    const interpretation = parseInterpretation(result.text);
    if (!interpretationIsUsable(interpretation)) {
      throw new A2AError('The reading came back empty.', true);
    }
    await saveInterpretation(c.env, reading.id, {
      interpretation,
      contextId: result.contextId,
      taskId: result.taskId,
      demo: diviner.demo,
      agentId: diviner.agentId,
    });
    await send({ type: 'interpretation', interpretation });
  });
});

/* ───────── state 6a: keep reading the same three cards ───────── */

tarot.post('/readings/:id/follow-ups', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { message?: unknown } | null;
  const message = sanitizeFollowUp(body?.message);
  if (!message) throw new HttpError(400, 'message_required', 'Write your question first.');

  const reading = await requireOwnedReading(c.env, c.req.param('id'), c.get('sessionId'));
  assertFollowable(reading);

  const asked = await countUserFollowUps(c.env, reading.id);
  if (asked >= FOLLOW_UPS_PER_READING) {
    throw new HttpError(
      429,
      'follow_up_limit',
      'This reading has been taken as far as it goes. Start a new round for anything more.',
    );
  }

  await enforce(c.env, {
    sessionId: c.get('sessionId'),
    ip: c.get('clientIp'),
    scope: 'turns',
    rule: RULES.turns,
    ipRule: RULES.turnsPerIp,
  });
  const diviner = await resolveDiviner(c.env);
  const history = await listFollowUps(c.env, reading.id);
  // Stored before the turn so the row id can key it: same message, same id, so
  // a retry is the same turn to the agent rather than a second billed one.
  const userMessageId = await addFollowUp(c.env, reading.id, 'user', message);

  return streamTurn(defer(c), async (send) => {
    const result = await diviner.speak(
      {
        kind: 'followup',
        locale: reading.locale,
        question: reading.question,
        cards: reading.cards!,
        conclusion: reading.interpretation?.conclusion ?? '',
        followUp: message,
        history: history.map((entry) => ({ role: entry.role, content: entry.content })),
      },
      {
        idempotencyKey: `${reading.id}-follow-${userMessageId}`,
        contextId: reading.contextId,
        taskId: reading.activeTaskId,
        onDelta: throttledDelta(send),
      },
    );

    const parsed = parseFollowUp(result.text);
    await addFollowUp(c.env, reading.id, 'diviner', parsed.text);
    await send({
      type: 'followup',
      text: parsed.text,
      suggestsNewReading: parsed.suggestsNewReading,
    });
  });
});

/* ───────── state 6b: share ───────── */

tarot.post('/readings/:id/share', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { includeQuestion?: unknown } | null;
  const reading: ReadingRecord = await requireOwnedReading(
    c.env,
    c.req.param('id'),
    c.get('sessionId'),
  );
  assertShareable(reading);

  await enforce(c.env, {
    sessionId: c.get('sessionId'),
    ip: c.get('clientIp'),
    scope: 'shares',
    rule: RULES.shares,
  });

  const snapshot = await createShare(c.env, reading, body?.includeQuestion === true);
  const url = new URL(c.req.url);
  return c.json({ share: snapshot, url: `${url.origin}/s/${snapshot.token}` }, 201);
});

/** Public: no session, no ownership. A share link is meant to be opened by anyone. */
tarot.get('/share/:token', async (c) => {
  const snapshot = await loadShare(c.env, c.req.param('token'));
  if (!snapshot) throw new HttpError(404, 'share_not_found', 'That share does not exist.');
  return c.json({ share: snapshot });
});

/* ───────── guardrail ───────── */

tarot.all('*', () => {
  throw new HttpError(404, 'not_found', 'No such tarot route.');
});
