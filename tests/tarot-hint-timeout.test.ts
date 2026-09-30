/**
 * How long the live reader is given, and what a timeout says about it.
 *
 * The agent is a scripted SSE stream on fake timers, so a 40-second turn takes
 * no time at all. Two shapes of slow are exercised because they call for
 * different fixes and used to produce the same one-line alert: a reader that
 * never starts talking (asleep, queued, stuck), and one that is talking and
 * simply takes a while to finish.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seal } from '../src/worker/crypto';
import { ensureSchema } from '../src/worker/db';
import { resolveDiviner, type DivinerRequest } from '../src/worker/tarot/diviner';
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
     VALUES ('a1', 'tarot-master', 'https://agent.test/rpc', ?, ?, 1, ?)`,
  )
    .bind(sealed.ciphertext, sealed.iv, new Date().toISOString())
    .run();
});
afterAll(() => d1.close());

/** One step of the scripted agent: wait `after` ms, then emit this much of the reply. */
type Step = { after: number; text?: string; state?: string; final?: boolean };

const encoder = new TextEncoder();
const frame = (result: unknown) => encoder.encode(`data: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result })}\n\n`);

function scriptedAgent(steps: Step[]) {
  vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal ?? undefined;
    let index = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        signal?.addEventListener('abort', () =>
          controller.error(new DOMException('The operation was aborted.', 'AbortError')),
        );
      },
      async pull(controller) {
        const step = steps[index++];
        if (!step) {
          await new Promise(() => undefined); // a stream that just goes quiet
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, step.after));
        if (signal?.aborted) return;
        controller.enqueue(
          frame({
            kind: 'status-update',
            taskId: 't1',
            contextId: 'c1',
            status: {
              state: step.state ?? (step.final ? 'completed' : 'working'),
              ...(step.text ? { message: { role: 'agent', parts: [{ kind: 'text', text: step.text }] } } : {}),
            },
            final: step.final ?? false,
          }),
        );
      },
    });
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
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

async function speakHint() {
  const diviner = await resolveDiviner(env);
  const deltas: string[] = [];
  const outcome = diviner
    .speak(HINT, { idempotencyKey: 'r1-hint-0', contextId: null, taskId: null, threadAgentId: null, onDelta: (text) => void deltas.push(text) })
    .then(
      (result) => ({ ok: true as const, text: result.text }),
      (error: Error) => ({ ok: false as const, message: error.message }),
    );
  // D1 and WebCrypto settle on real macrotasks, so time is advanced in small
  // steps with a real turn of the event loop between them.
  let settled = false;
  void outcome.then(() => (settled = true));
  for (let elapsed = 0; !settled && elapsed < 180_000; elapsed += 500) {
    await new Promise((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(500);
  }
  return { ...(await outcome), deltas };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a hint from the live reader', () => {
  it('is not cut off while the reader is still talking', async () => {
    // 40 seconds end to end, but never more than 10 seconds between words.
    scriptedAgent([
      { after: 8_000, text: 'The Fool' },
      { after: 10_000, text: 'The Fool steps out' },
      { after: 10_000, text: 'The Fool steps out, and the ground' },
      { after: 10_000, text: 'The Fool steps out, and the ground holds.', final: true },
      { after: 2_000, final: true },
    ]);
    const result = await speakHint();
    expect(result).toMatchObject({ ok: true, text: 'The Fool steps out, and the ground holds.' });
  });

  it('gives up on a reader that never starts, and says so', async () => {
    scriptedAgent([{ after: 1_000, state: 'working' }]);
    const result = await speakHint();
    expect(result.ok).toBe(false);
    expect(result.deltas).toHaveLength(0);
    expect((result as { message: string }).message).toMatch(/did not start answering within 30s/);
    expect((result as { message: string }).message).toMatch(/working/);
  });

  it('gives up on a reader that stops mid-sentence, and says so', async () => {
    scriptedAgent([{ after: 5_000, text: 'The Fool steps' }]);
    const result = await speakHint();
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toMatch(/stopped mid-answer/);
  });

  it('names the task and when each state arrived, so the agent owner can look it up', async () => {
    scriptedAgent([
      { after: 400, state: 'submitted' },
      { after: 800, state: 'working' },
    ]);
    const result = await speakHint();
    expect(result.ok).toBe(false);
    const message = (result as { message: string }).message;
    expect(message).toMatch(/task t1/);
    expect(message).toMatch(/submitted@0\.4s → working@1\.2s/);
  });

  it('marks when the first words arrived in a mid-answer timeout', async () => {
    scriptedAgent([
      { after: 1_000, state: 'working' },
      { after: 4_000, text: 'The Fool steps' },
    ]);
    const result = await speakHint();
    const message = (result as { message: string }).message;
    expect(message).toMatch(/stopped mid-answer/);
    expect(message).toMatch(/working@1\.0s → text@5\.0s/);
  });

  it('says there were no events when the agent never sent one', async () => {
    scriptedAgent([]);
    const result = await speakHint();
    const message = (result as { message: string }).message;
    expect(message).toMatch(/did not start answering/);
    expect(message).toMatch(/no task id · no events/);
  });

  it('still has a ceiling, and says the reader was mid-answer when it hit', async () => {
    const steps: Step[] = [];
    for (let at = 0; at < 90_000; at += 5_000) steps.push({ after: 5_000, text: `word ${at}` });
    scriptedAgent(steps);
    const result = await speakHint();
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toMatch(/still answering at the 60s limit/);
  });
});
