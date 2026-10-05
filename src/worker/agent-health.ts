/**
 * Which agents recently failed, kept in `settings` (no schema of its own).
 *
 * One key per agent, `agent:down:<agentId>`, holding when its last turn failed.
 * It is written when a turn fails and deleted when a turn succeeds, when the
 * agent is connected again and when it is disconnected. Two readers:
 *
 *  · ordering: an agent that failed in the last AGENT_COOLDOWN_MS goes to the back
 *    of the line, so visitors stop queueing behind a dead runner. It is still tried
 *    last, which is how a single agent keeps working and how a recovery is noticed;
 *  · alerts: "recovered" is only announced once no connected agent is marked down,
 *    otherwise the healthy one succeeding would announce a recovery of the broken one.
 *
 * Nothing here may break a reading: a health write that fails is logged and dropped.
 */

import type { ConnectedAgent } from '../shared/types';
import { safeErrorText } from './a2a';
import type { Env } from './types';

/** How long a failed agent is kept at the back of the line. */
export const AGENT_COOLDOWN_MS = 5 * 60_000;

const PREFIX = 'agent:down:';

async function quietly(label: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error(label, safeErrorText(error instanceof Error ? error.message : error));
  }
}

/** agentId → when its last turn failed (ms since epoch), for every agent still marked down. */
export async function readDownAgents(env: Env): Promise<Map<string, number>> {
  const down = new Map<string, number>();
  try {
    const { results } = await env.DB.prepare('SELECT key, value FROM settings WHERE key LIKE ?')
      .bind(`${PREFIX}%`)
      .all<{ key: string; value: string }>();
    for (const row of results ?? []) {
      const at = Number(row.value);
      if (Number.isFinite(at)) down.set(row.key.slice(PREFIX.length), at);
    }
  } catch (error) {
    console.error('agent health read failed', safeErrorText(error instanceof Error ? error.message : error));
  }
  return down;
}

export function markAgentDown(env: Env, agentId: string, at: number = Date.now()): Promise<void> {
  return quietly('agent health write failed', async () => {
    await env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
      .bind(`${PREFIX}${agentId}`, String(at), new Date(at).toISOString())
      .run();
  });
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
 *  3. agents in cooldown come last, the one that failed longest ago first.
 */
export function orderAgents(
  agents: ConnectedAgent[],
  down: Map<string, number>,
  seed: string,
  nowMs: number,
  preferred: string | null = null,
): ConnectedAgent[] {
  const cooling = (agent: ConnectedAgent): boolean => {
    const at = down.get(agent.agentId);
    return at !== undefined && nowMs - at < AGENT_COOLDOWN_MS;
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
    .sort((a, b) => (down.get(a.agentId) ?? 0) - (down.get(b.agentId) ?? 0) || byId(a, b));
  return [...ordered, ...resting];
}
