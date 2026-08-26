/**
 * Worker-side types. `Env` mirrors the bindings and vars declared in wrangler.jsonc —
 * if you add a binding there, add it here too.
 */

export interface Env {
  /** Static build output in dist/client. Non-/api/ requests are served from here. */
  ASSETS: Fetcher;
  /** D1 database. The starter uses five tables; the rest is yours. */
  DB: D1Database;

  /** Manyfold API base, e.g. https://api.manyfold.ai */
  MANYFOLD_API_BASE_URL?: string;
  /** "production" enables https-only and private-IP checks on agent URLs. */
  ENVIRONMENT?: string;
  /** Optional: >=32 chars. Without it a key is generated and kept in D1. */
  CONFIG_ENCRYPTION_KEY?: string;
  /**
   * The operator password, and the only one. Operator routes always require
   * `x-admin-password`; this decides what it has to be. Unset, nothing matches
   * and the console does not open for anyone — see admin.ts for why there is no
   * default. /api/tarot/* stays public either way.
   */
  ADMIN_PASSWORD?: string;

  /**
   * Optional: pins which connected agent plays the tarot reader. Without it the
   * most recently connected agent is used, which is what the one-click flow
   * produces. Set it on a deployment that has several agents connected.
   */
  TAROT_AGENT_ID?: string;
  /** Set to "1" to force the built-in demo reader even when an agent is connected. */
  TAROT_DEMO?: string;
}

/** Everything needed to talk to one agent over A2A. */
export interface AgentCredential {
  rpcUrl: string;
  token: string;
  /** Human-readable agent name, used in error messages. */
  label: string;
}

/** Errors that already know their HTTP shape. Thrown anywhere, mapped in index.ts. */
export class HttpError extends Error {
  // Plain fields rather than constructor parameter properties: keeps the class
  // friendly to any TS toolchain that only strips types.
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}
