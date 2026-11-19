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
  /**
   * Optional path prefix the site is also served under, e.g. /tarot for
   * app.manyfold.ai/tarot. The root keeps working either way. See mount.ts.
   */
  BASE_PATH?: string;
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
  /**
   * Optional: SHA-256 (64 hex chars) of the token that turns a browser into a
   * test browser with no daily reading limit. A hash, not a secret — see
   * src/worker/tarot/tester.ts. Unset or empty, nobody can become a tester.
   */
  TAROT_TEST_TOKEN_SHA256?: string;
  /** Set to "1" to force the built-in demo reader even when an agent is connected. */
  TAROT_DEMO?: string;
  /**
   * Service binding to the Fortune Stick Worker, which Tarot asks whether a
   * reward code is real before granting it. Declared in wrangler.jsonc.
   */
  STICK?: Fetcher;
  /** Local development only: reach the Stick over HTTP (e.g. http://localhost:5174/) instead of the binding. */
  STICK_CLAIMS_URL?: string;
  /** Fortune Stick app URL; preview builds can point to the matching Stick preview. */
  FORTUNE_STICK_URL?: string;

  /**
   * Optional: a GA4 measurement id (`G-…`). Set it and the Worker writes the
   * Google tag into every page it serves, with Consent Mode v2 defaults ahead of
   * it; leave it unset — which is what a fresh clone does — and no analytics of
   * any kind is served. See src/worker/analytics.ts.
   */
  GA_MEASUREMENT_ID?: string;

  /** Narra Messenger gateway runtime flags, bindings, and credentials (disabled by default). */
  NARRA_GATEWAY_ENABLED?: string;
  NARRA_SYNC?: string;
  NARRA_AGENT_ID?: string;
  NARRA_MATRIX_ID?: string;
  NARRA_AGENT_TOKEN?: string;
  NARRA_API_ENDPOINT?: string;
  MATRIX_ACCESS_TOKEN?: string;
  MATRIX_HOMESERVER_URL?: string;
  MATRIX_USER_ID?: string;
  NARRA_SYNC_DO?: DurableObjectNamespace;
  NARRA_ROOM_DO?: DurableObjectNamespace;
  MANYFOLD_A2A_URL?: string;
  MANYFOLD_A2A_TOKEN?: string;
  NARRA_BROADCAST_STAGGER?: string;
  NARRA_AUTHORIZE_EVENTS?: string;
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
