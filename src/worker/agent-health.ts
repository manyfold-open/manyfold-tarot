/**
 * Which agents recently failed, kept in `settings` (no schema of its own).
 *
 * One key per agent, `agent:down:<agentId>`, holding when its last turn failed and
 * how many turns in a row it has failed (`{"at": ms, "streak": n}`). It is written
 * when a turn fails and deleted when a turn succeeds, when the agent is connected
 * again and when it is disconnected. Two readers:
 *
 *  · ordering: an agent in its cooldown goes to the back of the line, so visitors
 *    stop queueing behind a dead runner. It is still tried last, which is how a
 *    single agent keeps working and how a recovery is noticed. The cooldown doubles
 *    with every failure in a row (cooldownFor): an agent that is merely flaky is
 *    back in a few minutes, one that is dead stops taking a share of the readings.
 *    Seen in production [2026-10-08 → 2026-10-16]: a sandbox that failed every turn
 *    for eight days came back into rotation every five minutes;
 *  · alerts: "recovered" is only announced once no connected agent is marked down,
 *    otherwise the healthy one succeeding would announce a recovery of the broken one.
 *
 * Nothing here may break a reading: a health write that fails is logged and dropped.
 */

import type { ConnectedAgent } from '../shared/types';
import { safeErrorText } from './a2a';
import type { Env } from './types';

/** How long an agent that failed once is kept at the back of the line. */
export const AGENT_COOLDOWN_MS = 5 * 60_000;
/** The longest cooldown, however many turns in a row the agent has failed. */
export const AGENT_COOLDOWN_MAX_MS = 60 * 60_000;

/** An agent whose last turn failed: when, and how many turns in a row. */
export interface AgentDown {
  at: number;
  streak: number;
}

/** 5, 10, 20, 40, then 60 minutes. */
export function cooldownFor(streak: number): number {
  return Math.min(AGENT_COOLDOWN_MS * 2 ** Math.max(0, streak - 1), AGENT_COOLDOWN_MAX_MS);
}

const PREFIX = 'agent:down:';

async function quietly(label: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error(label, safeErrorText(error instanceof Error ? error.message : error));
  }
}

/** agentId → its last failure, for every agent still marked down. */
export async function readDownAgents(env: Env): Promise<Map<string, AgentDown>> {
  const down = new Map<string, AgentDown>();
  try {
    const { results } = await env.DB.prepare('SELECT key, value FROM settings WHERE key LIKE ?')
      .bind(`${PREFIX}%`)
      .all<{ key: string; value: string }>();
    for (const row of results ?? []) {
      const mark = parseMark(row.value);
      if (mark) down.set(row.key.slice(PREFIX.length), mark);
    }
  } catch (error) {
    console.error('agent health read failed', safeErrorText(error instanceof Error ? error.message : error));
  }
  return down;
}

function parseMark(value: string): AgentDown | null {
  try {
    const mark = JSON.parse(value) as Partial<AgentDown>;
    if (Number.isFinite(mark.at) && Number.isInteger(mark.streak) && mark.streak! > 0) return mark as AgentDown;
  } catch {
    /* not a mark */
  }
  return null;
}

/** Marks one more failed turn; returns how many turns in a row the agent has now failed (0 if the write failed). */
export async function markAgentDown(env: Env, agentId: string, at: number = Date.now()): Promise<number> {
  let streak = 0;
  await quietly('agent health write failed', async () => {
    const row = await env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, json_object('at', ?, 'streak', 1), ?)
       ON CONFLICT (key) DO UPDATE SET
         value = json_object('at', ?, 'streak', coalesce(json_extract(settings.value, '$.streak'), 0) + 1),
         updated_at = excluded.updated_at
       RETURNING json_extract(value, '$.streak') AS streak`,
    )
      .bind(`${PREFIX}${agentId}`, at, new Date(at).toISOString(), at)
      .first<{ streak: number }>();
    streak = Number(row?.streak ?? 0);
  });
  return streak;
}

export function markAgentUp(env: Env, agentId: string): Promise<void> {
  return quietly('agent health write failed', async () => {
    await env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(`${PREFIX}${agentId}`).run();
  });
}

/** FNV-1a: a stable spread of reading ids over the agents, with no state to keep. */
function spread(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * The order agents are tried in. Pure, so the policy can be tested without a database.
 *
 *  1. agents not in cooldown, verified ones first. Within each group the order is
 *     rotated by the seed, so readings are shared out across the agents rather than
 *     all landing on the first one;
 *  2. `preferred` (the agent that already holds this reading's context) jumps to the
 *     front if it is healthy;
 *  3. agents in cooldown (cooldownFor their streak) come last, the one that failed
 *     longest ago first.
 */
export function orderAgents(
  agents: ConnectedAgent[],
  down: Map<string, AgentDown>,
  seed: string,
  nowMs: number,
  preferred: string | null = null,
): ConnectedAgent[] {
  const cooling = (agent: ConnectedAgent): boolean => {
    const mark = down.get(agent.agentId);
    return mark !== undefined && nowMs - mark.at < cooldownFor(mark.streak);
  };
  const byId = (a: ConnectedAgent, b: ConnectedAgent) => (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0);
  const rotate = (list: ConnectedAgent[]): ConnectedAgent[] => {
    if (list.length < 2) return list;
    const start = spread(seed) % list.length;
    return [...list.slice(start), ...list.slice(0, start)];
  };

  const healthy = agents.filter((agent) => !cooling(agent)).sort(byId);
  const ordered = [
    ...rotate(healthy.filter((agent) => agent.verified)),
    ...rotate(healthy.filter((agent) => !agent.verified)),
  ];
  const first = preferred ? ordered.findIndex((agent) => agent.agentId === preferred) : -1;
  if (first > 0) ordered.unshift(...ordered.splice(first, 1));

  const resting = agents
    .filter(cooling)
    .sort((a, b) => (down.get(a.agentId)?.at ?? 0) - (down.get(b.agentId)?.at ?? 0) || byId(a, b));
  return [...ordered, ...resting];
}
