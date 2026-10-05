/**
 * Running one turn against whichever connected agent can take it.
 *
 * Connect a second agent, ideally one that runs somewhere else, and the reader is
 * shared out across the connected agents. When the one a turn lands on fails (its
 * runner is gone, the stream dies, it says nothing, it is out of quota, it times
 * out) the same turn goes to the next one. The visitor only sees the reader's
 * error once every agent has failed.
 *
 * What does not change when a turn moves to another agent:
 *  - the cards. The request already carries them; this module only chooses who
 *    speaks (the invariant in diviner.ts);
 *  - the prompt and the A2A messageId. A messageId only means something to the
 *    agent that receives it, so two agents cannot dedupe each other, and the second
 *    agent is a different bill only because the first one never answered;
 *  - grounding. Every prompt carries the question, the cards and the history, so
 *    an agent that never saw the first turn answers the same reading.
 *
 * What does: the agent's own contextId / taskId belong to the agent that issued
 * them. The reading stores which agent that is (`threadAgentId`), and an agent that
 * is not it starts a fresh conversation (`AgentReader.run`).
 *
 * A turn is only handed on while nothing has reached the visitor. Once words are on
 * their screen, a second agent starting over would rewrite them under their eyes.
 */

import type { ConnectedAgent } from '../../shared/types';
import { reportAgentFailure, reportAgentSuccess } from '../alerts';
import { markAgentDown, markAgentUp, orderAgents, readDownAgents } from '../agent-health';
import { listConnectedAgents } from '../connect';
import type { Env } from '../types';
import type { Diviner, DivinerRequest, TurnOptions, TurnResult } from './diviner';

/**
 * The most a turn that has somewhere to go may spend on one agent. The ordinary
 * limits (up to three minutes for a reading) are for the last agent standing: a
 * visitor should not wait out a dead reader before the second one is even asked.
 */
export const HANDOFF_LIMITS = { start: 45_000, idle: 60_000, total: 120_000 } as const;

/** One agent, able to take a turn. `capped` is true while there is another to hand on to. */
export interface AgentReader {
  readonly agent: ConnectedAgent;
  run(request: DivinerRequest, options: TurnOptions, capped: boolean): Promise<TurnResult>;
}

/**
 * A turn succeeded on `agentId`. Clears that agent's mark, and announces a
 * recovery only if nothing else is still down: the healthy agent answering is not
 * news while the broken one is still broken.
 */
export async function noteAgentOk(env: Env, agentId: string): Promise<void> {
  await markAgentUp(env, agentId);
  const connected = new Set((await listConnectedAgents(env)).map((agent) => agent.agentId));
  const stillDown = [...(await readDownAgents(env)).keys()].some((id) => connected.has(id));
  if (!stillDown) await reportAgentSuccess(env);
}

export class FailoverDiviner implements Diviner {
  readonly demo = false;
  private answeredBy: string | null = null;

  /**
   * @param readers every connected agent
   * @param pinned  TAROT_AGENT_ID, when set: tried first while it is healthy
   */
  constructor(
    private readonly env: Env,
    private readonly readers: AgentReader[],
    private readonly pinned: string | null = null,
  ) {}

  /**
   * The agent that answered, so the route can store whose conversation the ids
   * belong to. Before any turn it is only a guess, and nothing reads it then.
   */
  get agentId(): string | null {
    return this.answeredBy ?? this.readers[0]?.agent.agentId ?? null;
  }

  async speak(request: DivinerRequest, options: TurnOptions): Promise<TurnResult> {
    const byId = new Map(this.readers.map((reader) => [reader.agent.agentId, reader]));
    // The reading's own agent first (its conversation lives there), else the pin,
    // else a spread of turns over the agents by the turn's stable key.
    const order = orderAgents(
      this.readers.map((reader) => reader.agent),
      await readDownAgents(this.env),
      options.idempotencyKey,
      Date.now(),
      options.threadAgentId ?? this.pinned,
    );

    let streamed = false;
    const guarded: TurnOptions = {
      ...options,
      onDelta: async (fullText) => {
        if (fullText) streamed = true;
        await options.onDelta?.(fullText);
      },
    };

    let failure: unknown;
    for (let index = 0; index < order.length; index += 1) {
      const reader = byId.get(order[index].agentId);
      if (!reader) continue;
      const hasNext = index < order.length - 1;
      try {
        const result = await reader.run(request, guarded, hasNext);
        this.answeredBy = reader.agent.agentId;
        await noteAgentOk(this.env, reader.agent.agentId);
        return result;
      } catch (error) {
        failure = error;
        await markAgentDown(this.env, reader.agent.agentId);
        // Words already reached the visitor: this failure ends the turn.
        if (streamed || !hasNext) break;
        // A failure that is handed on is still a failure of that agent.
        await reportAgentFailure(this.env, request.kind, error);
      }
    }
    // The failure that ends the turn is reported here, once, exactly as the
    // single reader always did.
    await reportAgentFailure(this.env, request.kind, failure);
    throw failure;
  }
}
