/**
 * The adapter between the website and the reader.
 *
 * Everything above this line — routes, storage, the UI — asks for "a greeting",
 * "a hint for card 2", "the reading". What actually answers is either Agent 2
 * over A2A or the built-in demo reader, and nothing upstream has to know which.
 * That is the point: Agent 2's URL, token and real responses arrive on their own
 * schedule, and the site has to be complete before they do.
 *
 * Two invariants live here:
 *  - the request types carry cards that were ALREADY drawn. There is no request
 *    shape in which the reader chooses a card.
 *  - messageIds are derived from stored row ids, never random, so a retried turn
 *    is the same turn to the agent rather than a second billable one — the same
 *    rule the starter's chat path follows.
 */

import type { Locale } from '../../shared/tarot/deck';
import type { SpreadId } from '../../shared/tarot/types';
import { A2AError, consumeA2AStream } from '../a2a';
import { reportAgentFailure, reportAgentSuccess } from '../alerts';
import { credentialFor } from '../connect';
import type { Env } from '../types';
import { demoFollowUp, demoGreeting, demoHint, demoReading } from './demo';
import type { DrawnCard } from './draw';
import {
  buildFollowUpPrompt,
  buildGreetingPrompt,
  buildHintPrompt,
  buildReadingPrompt,
  cleanAgentText,
} from './prompt';

export type DivinerRequest =
  | { kind: 'greeting'; locale: Locale; question: string; spreadId?: SpreadId }
  | { kind: 'hint'; locale: Locale; question: string; card: DrawnCard; index: number; spreadId?: SpreadId }
  | { kind: 'interpretation'; locale: Locale; question: string; cards: DrawnCard[]; spreadId?: SpreadId }
  | {
      kind: 'followup';
      locale: Locale;
      question: string;
      cards: DrawnCard[];
      conclusion: string;
      followUp: string;
      history: { role: 'user' | 'diviner'; content: string }[];
      spreadId?: SpreadId;
    };

export interface TurnOptions {
  /**
   * Stable, caller-derived id for this turn (reading id + what it is for).
   * Becomes the A2A messageId, which is the protocol's idempotency key.
   */
  idempotencyKey: string;
  contextId: string | null;
  taskId: string | null;
  onDelta?: (fullText: string) => void | Promise<void>;
}

export interface TurnResult {
  text: string;
  contextId: string | null;
  /** Non-null only when the agent stopped at input-required. */
  taskId: string | null;
}

export interface Diviner {
  /** True when replies come from the built-in sample rather than a live agent. */
  readonly demo: boolean;
  readonly agentId: string | null;
  speak(request: DivinerRequest, options: TurnOptions): Promise<TurnResult>;
}

/** Per-kind budgets: a hint blocking the card flip for three minutes is worse than no hint. */
const TIMEOUT_MS: Record<DivinerRequest['kind'], number> = {
  greeting: 45_000,
  hint: 30_000,
  interpretation: 180_000,
  followup: 120_000,
};

function buildPrompt(request: DivinerRequest): string {
  switch (request.kind) {
    case 'greeting':
      return buildGreetingPrompt({ question: request.question, locale: request.locale, spreadId: request.spreadId ?? 'current' });
    case 'hint':
      return buildHintPrompt({
        question: request.question,
        locale: request.locale,
        card: request.card,
        index: request.index,
        spreadId: request.spreadId ?? 'current',
      });
    case 'interpretation':
      return buildReadingPrompt({
        question: request.question,
        locale: request.locale,
        cards: request.cards,
        spreadId: request.spreadId ?? 'current',
      });
    case 'followup':
      return buildFollowUpPrompt({
        question: request.question,
        locale: request.locale,
        cards: request.cards,
        conclusion: request.conclusion,
        followUp: request.followUp,
        history: request.history,
        spreadId: request.spreadId ?? 'current',
      });
  }
}

/* ───────── Agent 2 over A2A ───────── */

class AgentDiviner implements Diviner {
  readonly demo = false;
  readonly agentId: string;
  private readonly env: Env;

  constructor(env: Env, agentId: string) {
    this.env = env;
    this.agentId = agentId;
  }

  async speak(request: DivinerRequest, options: TurnOptions): Promise<TurnResult> {
    // Every live turn is reported, including hints that fall back upstream: a
    // visitor who sees the deck's line instead of the reader's is still a
    // visitor the agent failed (src/worker/alerts.ts).
    let result: TurnResult;
    try {
      result = await this.turn(request, options);
    } catch (error) {
      await reportAgentFailure(this.env, request.kind, error);
      throw error;
    }
    await reportAgentSuccess(this.env);
    return result;
  }

  private async turn(request: DivinerRequest, options: TurnOptions): Promise<TurnResult> {
    // Resolved per turn rather than cached: an expired or rotated authorization
    // must fail here, with a real message, instead of being used stale.
    const cred = await credentialFor(this.env, this.agentId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS[request.kind]);
    try {
      const snapshot = await consumeA2AStream({
        cred,
        params: {
          message: {
            kind: 'message',
            role: 'user',
            messageId: `taro-${options.idempotencyKey}`,
            ...(options.contextId ? { contextId: options.contextId } : {}),
            ...(options.taskId ? { taskId: options.taskId } : {}),
            parts: [{ kind: 'text', text: buildPrompt(request) }],
          },
          configuration: { acceptedOutputModes: ['text/plain'] },
        },
        signal: controller.signal,
        onSnapshot: async (snap) => {
          // Only the reply text reaches the browser. Task states and progress
          // lines are machinery, and the user is supposed to be at a table with
          // a reader, not watching a job run.
          if (snap.text) await options.onDelta?.(cleanAgentText(snap.text));
        },
      });

      const text = cleanAgentText(snapshot.text);
      if (!text) {
        throw new A2AError(`${cred.label} answered with nothing.`, true);
      }
      return {
        text,
        contextId: snapshot.contextId,
        taskId: snapshot.state === 'input-required' ? snapshot.taskId : null,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/* ───────── the built-in reader ───────── */

/** Roughly a paragraph per beat, so the demo streams instead of appearing whole. */
const DEMO_CHUNK_CHARS = 42;
const DEMO_CHUNK_DELAY_MS = 28;

class DemoDiviner implements Diviner {
  readonly demo = true;
  readonly agentId = null;

  async speak(request: DivinerRequest, options: TurnOptions): Promise<TurnResult> {
    const text = this.compose(request);
    if (options.onDelta) {
      for (let cut = DEMO_CHUNK_CHARS; cut < text.length; cut += DEMO_CHUNK_CHARS) {
        await options.onDelta(text.slice(0, cut));
        await new Promise((resolve) => setTimeout(resolve, DEMO_CHUNK_DELAY_MS));
      }
      await options.onDelta(text);
    }
    return { text, contextId: options.contextId, taskId: null };
  }

  private compose(request: DivinerRequest): string {
    switch (request.kind) {
      case 'greeting':
        return demoGreeting(request.question, request.locale, request.spreadId);
      case 'hint':
        return demoHint(request.card, request.locale, request.spreadId);
      case 'interpretation':
        return demoReading(request.question, request.cards, request.locale, request.spreadId);
      case 'followup':
        return demoFollowUp(request.followUp, request.cards, request.locale, request.spreadId);
    }
  }
}

/* ───────── selection ───────── */

/**
 * Which agent plays the reader.
 *
 * TAROT_AGENT_ID pins one explicitly, which is what a deployment with several
 * connected agents should do. With nothing pinned, the most recently connected
 * agent is used — that matches the one-click flow, where the visitor connects
 * exactly one agent and expects it to be the reader.
 */
async function selectAgentId(env: Env): Promise<string | null> {
  const pinned = (env.TAROT_AGENT_ID ?? '').trim();
  if (pinned) {
    const row = await env.DB.prepare('SELECT agent_id FROM agents WHERE agent_id = ?')
      .bind(pinned)
      .first<{ agent_id: string }>();
    return row?.agent_id ?? null;
  }
  const row = await env.DB.prepare(
    'SELECT agent_id FROM agents ORDER BY connected_at DESC, name LIMIT 1',
  ).first<{ agent_id: string }>();
  return row?.agent_id ?? null;
}

/**
 * Picks the reader for this request.
 *
 * Note what this does NOT do: fall back to the demo when a connected agent
 * fails. Once a real reader exists, a failure is an error the visitor is told
 * about and can retry — silently swapping in sample text would be the app
 * putting words in the reader's mouth. The demo is only for "no reader yet".
 */
export async function resolveDiviner(env: Env): Promise<Diviner> {
  if ((env.TAROT_DEMO ?? '').trim() === '1') return new DemoDiviner();
  const agentId = await selectAgentId(env);
  return agentId ? new AgentDiviner(env, agentId) : new DemoDiviner();
}

/** Exposed for tests and for the readiness surface in /api/state. */
export const demoDiviner = (): Diviner => new DemoDiviner();
