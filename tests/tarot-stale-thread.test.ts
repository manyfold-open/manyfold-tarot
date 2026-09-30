/**
 * A reading's stored conversation belongs to the agent that started it.
 *
 * A reading keeps the contextId and taskId its reader handed back, so later
 * turns continue the same conversation. When the operator swaps the reader —
 * or the agent loses its conversations — those ids point at nothing, and the
 * agent answers -32001 "task or context not found". Every prompt already
 * carries the question, the cards and the history, so the right answer is to
 * start a fresh conversation instead of failing the reading for good.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seal } from '../src/worker/crypto';
import { ensureSchema } from '../src/worker/db';
import { resolveDiviner, type DivinerRequest, type TurnOptions } from '../src/worker/tarot/diviner';
import type { Env } from '../src/worker/types';
import { createD1, type FakeD1 } from './support/d1';

let d1: FakeD1;
let env: Env;

beforeAll(async () => {
  d1 = createD1();
  env = { DB: d1.db, ENVIRONMENT: 'test' } as Env;
  await ensureSchema(env.DB);
  const sealed = await seal(env, 'agent-token');
  await env.DB.prepare(
    `INSERT INTO agents (agent_id, name, rpc_url, token_ct, token_iv, verified, connected_at)
     VALUES ('agent-new', 'tarot-master', 'https://agent.test/rpc', ?, ?, 1, ?)`,
  )
    .bind(sealed.ciphertext, sealed.iv, new Date().toISOString())
    .run();
});
afterAll(() => d1.close());

const encoder = new TextEncoder();
const sse = (...envelopes: unknown[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const envelope of envelopes) controller.enqueue(encoder.encode(`data: ${JSON.stringify(envelope)}\n\n`));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );

const completed = (text: string) =>
  sse({
    jsonrpc: '2.0',
    id: 1,
    result: {
      kind: 'status-update',
      taskId: 't-new',
      contextId: 'c-new',
      status: { state: 'completed', message: { role: 'agent', parts: [{ kind: 'text', text }] } },
      final: true,
    },
  });

const notFound = () =>
  sse({ jsonrpc: '2.0', id: 1, error: { code: -32001, message: 'task or context not found' } });

/** Every message the agent was sent, in order. */
let sent: Array<{ contextId?: string; taskId?: string; messageId: string }>;

/** The agent answers each call with the next response in line. */
function agentAnswers(...responses: Array<() => Response>) {
  vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { params: { message: (typeof sent)[number] } };
    sent.push(body.params.message);
    const next = responses.shift();
    if (!next) throw new Error('agent called more times than scripted');
    return next();
  });
}

const HINT: DivinerRequest = {
  kind: 'hint',
  locale: 'en',
  question: 'Will it rain?',
  card: { slot: 'situation', cardId: 'major-00', reversed: false },
  index: 0,
  spreadId: 'current',
} as DivinerRequest;

const turn = (overrides: Partial<TurnOptions>): TurnOptions => ({
  idempotencyKey: 'r1-hint-0',
  contextId: 'c-old',
  taskId: 't-old',
  threadAgentId: 'agent-new',
  ...overrides,
});

const failureRows = async () =>
  (await env.DB.prepare('SELECT kind, reason FROM agent_failures').all<{ kind: string; reason: string }>()).results ?? [];

beforeEach(async () => {
  sent = [];
  await env.DB.prepare('DELETE FROM agent_failures').run();
});
afterEach(() => vi.unstubAllGlobals());

describe("a reading's stored conversation", () => {
  it('is continued when the same reader is still answering', async () => {
    agentAnswers(() => completed('The Fool steps out.'));
    const diviner = await resolveDiviner(env);
    await diviner.speak(HINT, turn({}));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ contextId: 'c-old', taskId: 't-old' });
  });

  it('is not handed to a different reader', async () => {
    agentAnswers(() => completed('The Fool steps out.'));
    const diviner = await resolveDiviner(env);
    const result = await diviner.speak(HINT, turn({ threadAgentId: 'agent-old' }));
    expect(result.text).toBe('The Fool steps out.');
    expect(sent).toHaveLength(1);
    expect(sent[0].contextId).toBeUndefined();
    expect(sent[0].taskId).toBeUndefined();
  });

  it('is not handed to a live reader when a demo reading started it', async () => {
    agentAnswers(() => completed('The Fool steps out.'));
    const diviner = await resolveDiviner(env);
    await diviner.speak(HINT, turn({ threadAgentId: null }));
    expect(sent[0].contextId).toBeUndefined();
  });

  it('is started over, once, when the reader has lost it — and that is not a failure', async () => {
    agentAnswers(notFound, () => completed('The Fool steps out.'));
    const diviner = await resolveDiviner(env);
    const result = await diviner.speak(HINT, turn({}));
    expect(result).toMatchObject({ text: 'The Fool steps out.', contextId: 'c-new' });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ contextId: 'c-old', taskId: 't-old' });
    expect(sent[1].contextId).toBeUndefined();
    expect(sent[1].taskId).toBeUndefined();
    // Same turn, same idempotency key: the fresh attempt is not a second billed turn.
    expect(sent[1].messageId).toBe(sent[0].messageId);
    expect(await failureRows()).toHaveLength(0);
  });

  it('still fails, and is reported, when a fresh conversation is refused too', async () => {
    agentAnswers(notFound, notFound);
    const diviner = await resolveDiviner(env);
    await expect(diviner.speak(HINT, turn({}))).rejects.toThrow(/task or context not found/);
    expect(sent).toHaveLength(2);
    expect(await failureRows()).toHaveLength(1);
  });

  it('is not retried when there was no conversation to lose', async () => {
    agentAnswers(notFound);
    const diviner = await resolveDiviner(env);
    await expect(diviner.speak(HINT, turn({ contextId: null, taskId: null }))).rejects.toThrow(/-32001/);
    expect(sent).toHaveLength(1);
  });
});
