/**
 * Two connected agents: one dying must not reach the visitor.
 *
 * The reader is shared out across every connected agent, and a turn whose agent
 * fails goes to the next one. What the visitor sees is the reader's error only once
 * all of them have failed. What must not change when a turn moves: the cards, the
 * prompt, and whose conversation the stored ids belong to.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { markAgentUp, orderAgents, readDownAgents, AGENT_COOLDOWN_MS } from '../src/worker/agent-health';
import { alertsView } from '../src/worker/alerts';
import { disconnectAgent } from '../src/worker/connect';
import { seal } from '../src/worker/crypto';
import { ensureSchema } from '../src/worker/db';
import { resolveDiviner, type DivinerRequest, type TurnOptions } from '../src/worker/tarot/diviner';
import type { ConnectedAgent } from '../src/shared/types';
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

async function connect(agentId: string, host: string, connectedAt: string) {
  const sealed = await seal(env, `token-${agentId}`);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO agents (agent_id, name, rpc_url, token_ct, token_iv, verified, connected_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
  )
    .bind(agentId, agentId, `https://${host}/rpc`, sealed.ciphertext, sealed.iv, connectedAt)
    .run();
}

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

const completed = (text: string, contextId: string) =>
  sse({
    jsonrpc: '2.0',
    id: 1,
    result: {
      kind: 'status-update',
      taskId: `t-${contextId}`,
      contextId,
      status: { state: 'completed', message: { role: 'agent', parts: [{ kind: 'text', text }] } },
      final: true,
    },
  });

/** Words reach the visitor, then the connection dies. */
const talksThenDies = () =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result: {
                kind: 'status-update',
                taskId: 't-x',
                contextId: 'c-x',
                status: { state: 'working', message: { role: 'agent', parts: [{ kind: 'text', text: 'The Fool steps' }] } },
                final: false,
              },
            })}\n\n`,
          ),
        );
        // error() throws away what has not been read yet, so let the words out first.
        setTimeout(() => controller.error(new Error('connection reset')), 20);
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );

const down = () => new Response('runner_unavailable', { status: 502 });

interface Call {
  host: string;
  contextId?: string;
  taskId?: string;
  messageId: string;
}
let calls: Call[];
type Script = Record<string, Array<() => Response>>;

/** Each host answers its calls in order; the last response repeats. */
function agentsAnswer(script: Script) {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const host = new URL(String(input)).host;
    const message = (JSON.parse(String(init?.body)) as { params: { message: Omit<Call, 'host'> } }).params.message;
    calls.push({ host, ...message });
    const queue = script[host];
    if (!queue?.length) throw new Error(`no script for ${host}`);
    return (queue.length > 1 ? queue.shift()! : queue[0])();
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

const turn = (overrides: Partial<TurnOptions> = {}): TurnOptions => ({
  idempotencyKey: 'r1-hint-0',
  contextId: null,
  taskId: null,
  threadAgentId: null,
  ...overrides,
});

const failureRows = async () =>
  (await env.DB.prepare('SELECT kind, reason FROM agent_failures ORDER BY id').all<{ kind: string; reason: string }>())
    .results ?? [];

/** The diviner as a deployment that pins agent A would see it. */
const readerPinnedTo = async (agentId: string | undefined) => {
  const pinned = { ...env, ...(agentId ? { TAROT_AGENT_ID: agentId } : {}) } as Env;
  return { diviner: await resolveDiviner(pinned), env: pinned };
};

beforeEach(async () => {
  calls = [];
  await env.DB.prepare('DELETE FROM agents').run();
  await env.DB.prepare('DELETE FROM agent_failures').run();
  await env.DB.prepare("DELETE FROM settings WHERE key LIKE 'agent:down:%' OR key LIKE 'alert:%'").run();
  await connect('agent-a', 'a.test', '2026-10-01T00:00:00Z');
  await connect('agent-b', 'b.test', '2026-10-02T00:00:00Z');
});
afterEach(() => vi.unstubAllGlobals());

describe('one agent down, one up', () => {
  it('hands the turn to the other agent: the visitor gets a reading, not an error', async () => {
    agentsAnswer({ 'a.test': [down], 'b.test': [() => completed('The Fool steps out.', 'c-b')] });
    const { diviner } = await readerPinnedTo('agent-a');
    const result = await diviner.speak(HINT, turn());
    expect(result.text).toBe('The Fool steps out.');
    expect(calls.map((call) => call.host)).toEqual(['a.test', 'b.test']);
    // The ids it hands back are agent B's, and the route stores whose they are.
    expect(result.contextId).toBe('c-b');
    expect(diviner.agentId).toBe('agent-b');
  });

  it('sends the same message id to both: it is the same turn, only the listener changed', async () => {
    agentsAnswer({ 'a.test': [down], 'b.test': [() => completed('The Fool steps out.', 'c-b')] });
    const { diviner } = await readerPinnedTo('agent-a');
    await diviner.speak(HINT, turn());
    expect(calls[0].messageId).toBe(calls[1].messageId);
  });

  it('does not hand the broken agent’s conversation to the healthy one', async () => {
    agentsAnswer({ 'a.test': [down], 'b.test': [() => completed('The Fool steps out.', 'c-b')] });
    const { diviner } = await readerPinnedTo('agent-a');
    await diviner.speak(HINT, turn({ contextId: 'c-a', taskId: 't-a', threadAgentId: 'agent-a' }));
    expect(calls[0]).toMatchObject({ host: 'a.test', contextId: 'c-a', taskId: 't-a' });
    expect(calls[1].host).toBe('b.test');
    expect(calls[1].contextId).toBeUndefined();
    expect(calls[1].taskId).toBeUndefined();
  });

  it('records the failure that was handed on, and marks that agent down', async () => {
    agentsAnswer({ 'a.test': [down], 'b.test': [() => completed('The Fool steps out.', 'c-b')] });
    const { diviner } = await readerPinnedTo('agent-a');
    await diviner.speak(HINT, turn());
    const rows = await failureRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toContain('HTTP 502');
    expect([...(await readDownAgents(env)).keys()]).toEqual(['agent-a']);
  });

  it('puts the failed agent at the back of the line: the next turn does not meet it', async () => {
    agentsAnswer({ 'a.test': [down], 'b.test': [() => completed('The Fool steps out.', 'c-b')] });
    const first = await readerPinnedTo('agent-a');
    await first.diviner.speak(HINT, turn());
    calls = [];
    const second = await readerPinnedTo('agent-a');
    await second.diviner.speak(HINT, turn({ idempotencyKey: 'r2-hint-0' }));
    expect(calls.map((call) => call.host)).toEqual(['b.test']);
    expect(await failureRows()).toHaveLength(1);
  });

  it('keeps a reading with the agent that holds its conversation while that agent is healthy', async () => {
    agentsAnswer({
      'a.test': [() => completed('from a', 'c-a')],
      'b.test': [() => completed('The Fool steps out.', 'c-b')],
    });
    const { diviner } = await readerPinnedTo('agent-a');
    await diviner.speak(HINT, turn({ contextId: 'c-b-old', taskId: 't-b-old', threadAgentId: 'agent-b' }));
    expect(calls.map((call) => call.host)).toEqual(['b.test']);
    expect(calls[0]).toMatchObject({ contextId: 'c-b-old', taskId: 't-b-old' });
  });
});

describe('both down', () => {
  it('tells the visitor, once, with the reader’s failure', async () => {
    agentsAnswer({ 'a.test': [down], 'b.test': [down] });
    const { diviner } = await readerPinnedTo('agent-a');
    await expect(diviner.speak(HINT, turn())).rejects.toThrow(/HTTP 502/);
    expect(calls.map((call) => call.host)).toEqual(['a.test', 'b.test']);
    // One row per agent that failed, none counted twice.
    expect(await failureRows()).toHaveLength(2);
  });

  it('with one agent connected, behaves as it always did: one call, one report', async () => {
    await env.DB.prepare("DELETE FROM agents WHERE agent_id = 'agent-b'").run();
    agentsAnswer({ 'a.test': [down] });
    const { diviner } = await readerPinnedTo(undefined);
    await expect(diviner.speak(HINT, turn())).rejects.toThrow(/HTTP 502/);
    expect(calls).toHaveLength(1);
    expect(await failureRows()).toHaveLength(1);
  });
});

describe('once words have reached the visitor', () => {
  it('does not start over on another agent', async () => {
    agentsAnswer({ 'a.test': [talksThenDies], 'b.test': [() => completed('The Fool steps out.', 'c-b')] });
    const { diviner } = await readerPinnedTo('agent-a');
    const seen: string[] = [];
    await expect(
      diviner.speak(HINT, turn({ onDelta: (text) => void seen.push(text) })),
    ).rejects.toBeInstanceOf(Error);
    expect(seen.length).toBeGreaterThan(0);
    expect(calls.map((call) => call.host)).toEqual(['a.test']);
    expect(await failureRows()).toHaveLength(1);
  });

  it('still hands on when nothing was said before the agent failed', async () => {
    agentsAnswer({ 'a.test': [down], 'b.test': [() => completed('The Fool steps out.', 'c-b')] });
    const { diviner } = await readerPinnedTo('agent-a');
    const seen: string[] = [];
    const result = await diviner.speak(HINT, turn({ onDelta: (text) => void seen.push(text) }));
    expect(result.text).toBe('The Fool steps out.');
    expect(seen.at(-1)).toBe('The Fool steps out.');
  });
});

describe('both up', () => {
  it('shares readings out across the agents instead of loading one', async () => {
    agentsAnswer({
      'a.test': [() => completed('from a', 'c-a')],
      'b.test': [() => completed('from b', 'c-b')],
    });
    const { diviner } = await readerPinnedTo(undefined);
    for (let reading = 0; reading < 24; reading += 1) {
      await diviner.speak(HINT, turn({ idempotencyKey: `reading-${reading}-greeting` }));
    }
    const perHost = (host: string) => calls.filter((call) => call.host === host).length;
    expect(perHost('a.test')).toBeGreaterThan(0);
    expect(perHost('b.test')).toBeGreaterThan(0);
    expect(perHost('a.test') + perHost('b.test')).toBe(24);
  });

  it('a pinned agent keeps the reading while it is healthy', async () => {
    agentsAnswer({
      'a.test': [() => completed('from a', 'c-a')],
      'b.test': [() => completed('from b', 'c-b')],
    });
    const { diviner } = await readerPinnedTo('agent-b');
    for (let reading = 0; reading < 8; reading += 1) {
      await diviner.speak(HINT, turn({ idempotencyKey: `reading-${reading}-greeting` }));
    }
    expect(new Set(calls.map((call) => call.host))).toEqual(new Set(['b.test']));
  });

  it('a pin that names no connected agent is the demo reader, as before', async () => {
    const { diviner } = await readerPinnedTo('agent-gone');
    expect(diviner.demo).toBe(true);
  });
});

describe('recovery is announced only when nothing is still down', () => {
  it('the healthy agent answering does not announce that the broken one is back', async () => {
    agentsAnswer({ 'a.test': [down], 'b.test': [() => completed('The Fool steps out.', 'c-b')] });
    const { diviner } = await readerPinnedTo('agent-a');
    await diviner.speak(HINT, turn());
    expect((await alertsView(env)).failing).toBe(true);
    // B answers again: A is still marked down, so still failing.
    const again = await readerPinnedTo('agent-b');
    await again.diviner.speak(HINT, turn({ idempotencyKey: 'r2-hint-0' }));
    expect((await alertsView(env)).failing).toBe(true);
  });

  it('is announced once the broken agent answers again', async () => {
    agentsAnswer({ 'a.test': [down, () => completed('from a', 'c-a')], 'b.test': [() => completed('from b', 'c-b')] });
    const { diviner } = await readerPinnedTo('agent-a');
    await diviner.speak(HINT, turn());
    expect((await alertsView(env)).failing).toBe(true);
    // The cooldown passes and the operator's runner is back.
    await env.DB.prepare("UPDATE settings SET value = ? WHERE key = 'agent:down:agent-a'")
      .bind(String(Date.now() - AGENT_COOLDOWN_MS - 1))
      .run();
    const later = await readerPinnedTo('agent-a');
    await later.diviner.speak(HINT, turn({ idempotencyKey: 'r3-hint-0' }));
    expect((await alertsView(env)).failing).toBe(false);
    expect((await readDownAgents(env)).size).toBe(0);
  });
});

describe('connecting and disconnecting', () => {
  it('forgets a failure when the agent is disconnected', async () => {
    agentsAnswer({ 'a.test': [down], 'b.test': [() => completed('The Fool steps out.', 'c-b')] });
    const { diviner } = await readerPinnedTo('agent-a');
    await diviner.speak(HINT, turn());
    expect((await readDownAgents(env)).has('agent-a')).toBe(true);
    await disconnectAgent(env, 'agent-a');
    expect((await readDownAgents(env)).has('agent-a')).toBe(false);
  });

  it('markAgentUp on an agent that was never down is harmless', async () => {
    await markAgentUp(env, 'agent-a');
    expect((await readDownAgents(env)).size).toBe(0);
  });
});

describe('orderAgents', () => {
  const agent = (agentId: string, verified = true) => ({ agentId, verified }) as ConnectedAgent;
  const ids = (list: ConnectedAgent[]) => list.map((entry) => entry.agentId);
  const now = 1_000_000_000_000;

  it('the same seed always gives the same order, and seeds change who goes first', () => {
    const agents = [agent('agent-a'), agent('agent-b')];
    expect(ids(orderAgents(agents, new Map(), 'k1', now))).toEqual(ids(orderAgents(agents, new Map(), 'k1', now)));
    const heads = new Set(Array.from({ length: 16 }, (_, i) => ids(orderAgents(agents, new Map(), `k${i}`, now))[0]));
    expect(heads.size).toBe(2);
  });

  it('puts an agent in its cooldown last, and restores it afterwards', () => {
    const agents = [agent('agent-a'), agent('agent-b')];
    const failedAt = new Map([['agent-a', now - 1_000]]);
    for (let i = 0; i < 8; i += 1) expect(ids(orderAgents(agents, failedAt, `k${i}`, now))).toEqual(['agent-b', 'agent-a']);
    const later = now + AGENT_COOLDOWN_MS;
    const heads = new Set(Array.from({ length: 16 }, (_, i) => ids(orderAgents(agents, failedAt, `k${i}`, later))[0]));
    expect(heads.size).toBe(2);
  });

  it('puts the preferred agent first while it is healthy, not while it is cooling', () => {
    const agents = [agent('agent-a'), agent('agent-b')];
    for (let i = 0; i < 8; i += 1) {
      expect(ids(orderAgents(agents, new Map(), `k${i}`, now, 'agent-b'))[0]).toBe('agent-b');
      expect(ids(orderAgents(agents, new Map([['agent-b', now - 1]]), `k${i}`, now, 'agent-b'))[0]).toBe('agent-a');
    }
  });
});
