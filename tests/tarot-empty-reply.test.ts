/**
 * A reader that finished without words reaching us.
 *
 * Seen in production: a greeting came back "completed" with no text, and every
 * retry — same messageId, so the agent answers with the task it already
 * finished — came back completed and empty in 0.1s. The reading could never
 * get its greeting. The words are on the task, so they are read back with
 * tasks/get; a reply that cleaning would empty is cleaned gently instead; and
 * when there is truly nothing, the failure line says whether there were words.
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
     VALUES ('agent-1', 'tarot-master', 'https://agent.test/rpc', ?, ?, 1, ?)`,
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

/** What a replayed turn looks like: the finished task, no words. */
const bareCompleted = () =>
  sse({
    jsonrpc: '2.0',
    id: 1,
    result: { kind: 'status-update', taskId: 't-1', contextId: 'c-1', status: { state: 'completed' }, final: true },
  });

const completed = (text: string) =>
  sse({
    jsonrpc: '2.0',
    id: 1,
    result: {
      kind: 'status-update',
      taskId: 't-1',
      contextId: 'c-1',
      status: { state: 'completed', message: { role: 'agent', parts: [{ kind: 'text', text }] } },
      final: true,
    },
  });

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

const task = (extra: Record<string, unknown>) =>
  json({ jsonrpc: '2.0', id: 1, result: { kind: 'task', id: 't-1', contextId: 'c-1', status: { state: 'completed' }, ...extra } });

/** Every RPC method called, in order. */
let calls: string[];

function agentAnswers(...responses: Array<() => Response>) {
  vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push((JSON.parse(String(init?.body)) as { method: string }).method);
    const next = responses.shift();
    if (!next) throw new Error('agent called more times than scripted');
    return next();
  });
}

const GREETING: DivinerRequest = { kind: 'greeting', locale: 'zh', question: '会下雨吗？', spreadId: 'current' };

const turn = (): TurnOptions => ({
  idempotencyKey: 'r1-greeting',
  contextId: null,
  taskId: null,
  threadAgentId: 'agent-1',
});

beforeEach(() => {
  calls = [];
});
afterEach(() => vi.unstubAllGlobals());

describe('a reply that reached us empty', () => {
  it("is read back from the task's artifacts", async () => {
    agentAnswers(bareCompleted, () =>
      task({ artifacts: [{ artifactId: 'a', parts: [{ kind: 'text', text: '先静一静，再看牌。' }] }] }),
    );
    const diviner = await resolveDiviner(env);
    const result = await diviner.speak(GREETING, turn());
    expect(result.text).toBe('先静一静，再看牌。');
    expect(calls).toEqual(['message/stream', 'tasks/get']);
  });

  it("is read back from the agent's last message in the task history", async () => {
    agentAnswers(bareCompleted, () =>
      task({
        history: [
          { role: 'user', parts: [{ kind: 'text', text: 'prompt' }] },
          { role: 'agent', parts: [{ kind: 'text', text: '先静一静。' }] },
        ],
      }),
    );
    const diviner = await resolveDiviner(env);
    expect((await diviner.speak(GREETING, turn())).text).toBe('先静一静。');
  });

  it('is not read back when the stream already had words', async () => {
    agentAnswers(() => completed('你好。'));
    const diviner = await resolveDiviner(env);
    await diviner.speak(GREETING, turn());
    expect(calls).toEqual(['message/stream']);
  });

  it('still fails, saying the read-back was tried, when the task is empty too', async () => {
    agentAnswers(bareCompleted, () => task({}));
    const diviner = await resolveDiviner(env);
    await expect(diviner.speak(GREETING, turn())).rejects.toThrow(/answered with nothing \(raw 0 chars\).*tasks\/get:empty/);
  });

  it('still fails when the read-back itself fails', async () => {
    agentAnswers(bareCompleted, () => new Response('nope', { status: 500 }));
    const diviner = await resolveDiviner(env);
    await expect(diviner.speak(GREETING, turn())).rejects.toThrow(/answered with nothing.*tasks\/get:failed/);
  });
});

describe('a reply that cleaning would empty', () => {
  it('keeps a lone line that only looks like reasoning', async () => {
    agentAnswers(() => completed('思考：你心里已经有答案了，我们一起看看。'));
    const diviner = await resolveDiviner(env);
    expect((await diviner.speak(GREETING, turn())).text).toBe('思考：你心里已经有答案了，我们一起看看。');
  });

  it('keeps a lone line with a channel marker, minus the marker', async () => {
    agentAnswers(() => completed('assistantfinal欢迎坐下。'));
    const diviner = await resolveDiviner(env);
    expect((await diviner.speak(GREETING, turn())).text).toBe('欢迎坐下。');
  });

  it('never shows a reasoning block, even when it is all there is — and says what was dropped', async () => {
    agentAnswers(() => completed('<think>plan the greeting</think>'));
    const diviner = await resolveDiviner(env);
    await expect(diviner.speak(GREETING, turn())).rejects.toThrow(
      /raw 32 chars → 0 after cleaning: "<think>plan the greeting<\/think>"/,
    );
  });
});
