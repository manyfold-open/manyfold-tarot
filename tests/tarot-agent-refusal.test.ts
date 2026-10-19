/**
 * An agent that ends a turn `failed` has not answered, whatever its status says.
 *
 * Seen in production [2026-09-05 → 2026-10-18]: Manyfold reports a turn it could
 * not run as `status-update {state: failed}` carrying the reason as the status
 * message ("This agent's sandbox is not accepting commands right now…"). The
 * reader took that message for the reply: it streamed to the visitor, was saved
 * as the greeting, the hints and the reading of 1,803 readings, and every one
 * counted as a success — so failover never left the broken agent. These tests
 * speak the platform's wire shapes, not a mock reader that throws.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { A2AError, foldA2AResults } from '../src/worker/a2a';
import { readDownAgents } from '../src/worker/agent-health';
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
});
afterAll(() => d1.close());

async function connect(agentId: string, host: string) {
  const sealed = await seal(env, `token-${agentId}`);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO agents (agent_id, name, rpc_url, token_ct, token_iv, verified, connected_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
  )
    .bind(agentId, agentId, `https://${host}/rpc`, sealed.ciphertext, sealed.iv, new Date().toISOString())
    .run();
}

const SANDBOX_DOWN =
  "This agent's sandbox is not accepting commands right now, so this message was not sent. Try again in about 60 s.";

const encoder = new TextEncoder();
const sse = (...results: unknown[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const result of results)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result })}\n\n`));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

const ids = { taskId: 't-1', contextId: 'c-1' };
const working = { kind: 'status-update', ...ids, status: { state: 'working' }, final: false };
const agentSays = (text: string) => ({ kind: 'message', role: 'agent', parts: [{ kind: 'text', text }] });

/** Manyfold's finishTurn for a turn the platform could not run. */
const failedWith = (reason: string) => () =>
  sse(working, { kind: 'status-update', ...ids, status: { state: 'failed', message: agentSays(reason) }, final: true });
/** A turn refused before it started (the session already had one running): no reason on the stream. */
const failedBare = () => sse(working, { kind: 'status-update', ...ids, status: { state: 'failed' }, final: true });
/** What the platform answers for a messageId it already failed: the stored task, terminal from its first event. */
const replayedFailure = (reason: string) => () =>
  sse({ kind: 'status-update', ...ids, status: { state: 'failed', message: agentSays(reason) }, final: true });
const rejected = () =>
  sse(working, { kind: 'status-update', ...ids, status: { state: 'rejected', message: agentSays('no') }, final: true });
const answers = (text: string) => () =>
  sse(
    working,
    { kind: 'artifact-update', ...ids, artifact: { artifactId: 'artifact-1', parts: [{ kind: 'text', text }] }, append: true },
    { kind: 'artifact-update', ...ids, artifact: { artifactId: 'artifact-1', parts: [{ kind: 'text', text }] }, append: false, lastChunk: true },
    { kind: 'status-update', ...ids, status: { state: 'completed' }, final: true },
  );
const storedTask = (state: string, reason: string) => () =>
  json({ jsonrpc: '2.0', id: 1, result: { kind: 'task', id: 't-1', contextId: 'c-1', status: { state, message: agentSays(reason) }, artifacts: [] } });

interface Call {
  host: string;
  method: string;
  messageId?: string;
  contextId?: string;
}
let calls: Call[];

/** Each host answers its calls in order; the last response repeats. */
function agentsAnswer(script: Record<string, Array<() => Response>>) {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const host = new URL(String(input)).host;
    const body = JSON.parse(String(init?.body)) as { method: string; params: { message?: { messageId: string; contextId?: string } } };
    calls.push({ host, method: body.method, messageId: body.params.message?.messageId, contextId: body.params.message?.contextId });
    const queue = script[host];
    if (!queue?.length) throw new Error(`no script for ${host}`);
    return (queue.length > 1 ? queue.shift()! : queue[0])();
  });
}

const GREETING: DivinerRequest = { kind: 'greeting', locale: 'en', question: 'Will it rain?', spreadId: 'current' };
const turn = (overrides: Partial<TurnOptions> = {}): TurnOptions => ({
  idempotencyKey: 'r1-greeting',
  contextId: null,
  taskId: null,
  threadAgentId: null,
  ...overrides,
});

beforeEach(async () => {
  calls = [];
  await env.DB.prepare('DELETE FROM agents').run();
  await env.DB.prepare('DELETE FROM settings').run();
  await env.DB.prepare('DELETE FROM agent_failures').run();
  await env.DB.prepare('DELETE FROM tarot_turn_attempts').run();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the stream of a failed turn', () => {
  it('carries no reply text; the status message is the reason', () => {
    const snapshot = foldA2AResults([
      working,
      { kind: 'status-update', ...ids, status: { state: 'failed', message: agentSays(SANDBOX_DOWN) }, final: true },
    ]);
    expect(snapshot).toMatchObject({ state: 'failed', terminal: true, text: '', progressText: SANDBOX_DOWN });
  });

  it('still takes a completed status message as the reply', () => {
    const snapshot = foldA2AResults([{ kind: 'status-update', ...ids, status: { state: 'completed', message: agentSays('Rain.') } }]);
    expect(snapshot.text).toBe('Rain.');
  });
});

describe('an agent that fails the turn', () => {
  it('is an error with its reason, and nothing of it reaches the visitor', async () => {
    await connect('agent-a', 'a.test');
    agentsAnswer({ 'a.test': [failedWith(SANDBOX_DOWN)] });
    const deltas: string[] = [];
    const diviner = await resolveDiviner(env);

    const failure = await diviner.speak(GREETING, turn({ onDelta: (text) => void deltas.push(text) })).catch((error) => error);

    expect(failure).toBeInstanceOf(A2AError);
    expect(failure.message).toMatch(/agent-a ended the turn failed: This agent's sandbox is not accepting commands/);
    expect(failure.retryable).toBe(true);
    expect(deltas).toEqual([]);
    expect([...(await readDownAgents(env)).keys()]).toEqual(['agent-a']);
  });

  it('hands the turn to the next agent, which answers it', async () => {
    await connect('agent-a', 'a.test');
    await connect('agent-b', 'b.test');
    agentsAnswer({ 'a.test': [failedWith(SANDBOX_DOWN)], 'b.test': [answers('Sit with the question.')] });
    const deltas: string[] = [];
    const diviner = await resolveDiviner(env);

    // agent-a first: the turn continues its conversation.
    const result = await diviner.speak(GREETING, turn({ threadAgentId: 'agent-a', onDelta: (text) => void deltas.push(text) }));

    expect(result.text).toBe('Sit with the question.');
    expect(calls.map((call) => call.host)).toEqual(['a.test', 'b.test']);
    expect(deltas.every((text) => !text.includes('sandbox'))).toBe(true);
    expect([...(await readDownAgents(env)).keys()]).toEqual(['agent-a']);
  });

  it('reads the reason back from the task when the stream ended without one', async () => {
    await connect('agent-a', 'a.test');
    agentsAnswer({ 'a.test': [failedBare, storedTask('failed', 'server is restarting; retry the turn')] });
    const diviner = await resolveDiviner(env);

    await expect(diviner.speak(GREETING, turn())).rejects.toThrow(
      /ended the turn failed: server is restarting; retry the turn.*tasks\/get:reason/,
    );
    expect(calls.map((call) => call.method)).toEqual(['message/stream', 'tasks/get']);
  });

  it('is not asked again under the same agent when the refusal is fresh', async () => {
    await connect('agent-a', 'a.test');
    agentsAnswer({ 'a.test': [failedWith(SANDBOX_DOWN)] });
    const diviner = await resolveDiviner(env);

    await expect(diviner.speak(GREETING, turn())).rejects.toThrow(/ended the turn failed/);
    expect(calls.filter((call) => call.method === 'message/stream')).toHaveLength(1);
  });

  it('that rejects the turn is not worth retrying', async () => {
    await connect('agent-a', 'a.test');
    agentsAnswer({ 'a.test': [rejected] });
    const diviner = await resolveDiviner(env);

    const failure = await diviner.speak(GREETING, turn()).catch((error) => error);
    expect(failure.message).toMatch(/ended the turn rejected: no/);
    expect(failure.retryable).toBe(false);
  });
});

describe('an agent that replays a refusal it already gave', () => {
  it('is asked again under a new messageId, and answers', async () => {
    await connect('agent-a', 'a.test');
    agentsAnswer({ 'a.test': [replayedFailure(SANDBOX_DOWN), answers('The cards are quiet today.')] });
    const diviner = await resolveDiviner(env);

    const result = await diviner.speak(GREETING, turn());

    expect(result.text).toBe('The cards are quiet today.');
    expect(calls.map((call) => call.messageId)).toEqual(['taro-r1-greeting', 'taro-r1-greeting-1']);
    // Not a failure of the agent: the turn it refused was an old one.
    expect((await readDownAgents(env)).size).toBe(0);
  });

  it('keeps counting, so no messageId is used twice', async () => {
    await connect('agent-a', 'a.test');
    agentsAnswer({ 'a.test': [replayedFailure(SANDBOX_DOWN), failedWith(SANDBOX_DOWN), replayedFailure(SANDBOX_DOWN), answers('Now.')] });
    const diviner = await resolveDiviner(env);

    await expect(diviner.speak(GREETING, turn())).rejects.toThrow(/ended the turn failed/);
    expect((await diviner.speak(GREETING, turn())).text).toBe('Now.');
    expect(calls.map((call) => call.messageId)).toEqual([
      'taro-r1-greeting',
      'taro-r1-greeting-1',
      'taro-r1-greeting',
      'taro-r1-greeting-2',
    ]);
  });
});

describe('a conversation still busy with another turn', () => {
  const BUSY = 'session has an active assistant turn';
  const HINT: DivinerRequest = {
    kind: 'hint',
    locale: 'en',
    question: 'Will it rain?',
    card: { slot: 'situation', cardId: 'major-00', reversed: false },
    index: 1,
    spreadId: 'current',
  } as DivinerRequest;
  const continuing = () => turn({ idempotencyKey: 'r1-hint-1', contextId: 'c-old', threadAgentId: 'agent-a' });

  it('moves the turn to a fresh conversation under a new messageId', async () => {
    await connect('agent-a', 'a.test');
    agentsAnswer({ 'a.test': [failedBare, storedTask('failed', BUSY), answers('A door opens.')] });
    const diviner = await resolveDiviner(env);

    const result = await diviner.speak(HINT, continuing());

    expect(result.text).toBe('A door opens.');
    const sends = calls.filter((call) => call.method === 'message/stream');
    expect(sends.map((call) => [call.messageId, call.contextId])).toEqual([
      ['taro-r1-hint-1', 'c-old'],
      ['taro-r1-hint-1-1', undefined],
    ]);
    expect((await readDownAgents(env)).size).toBe(0);
  });

  it('is asked afresh only once', async () => {
    await connect('agent-a', 'a.test');
    agentsAnswer({ 'a.test': [failedWith(BUSY)] });
    const diviner = await resolveDiviner(env);

    await expect(diviner.speak(HINT, continuing())).rejects.toThrow(/active assistant turn/);
    expect(calls.filter((call) => call.method === 'message/stream')).toHaveLength(2);
  });
});
