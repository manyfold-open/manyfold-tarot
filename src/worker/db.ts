/**
 * D1 access: the schema and the settings key/value store.
 *
 * The schema lives here as a string and is applied on the first request rather than
 * through migrations, because the "Deploy to Cloudflare" button provisions the database
 * but never runs a migration command — and because `npm run dev` should work with no
 * setup at all. Every statement is idempotent, so applying it repeatedly is free.
 *
 * This module deliberately imports nothing from crypto.ts: crypto.ts reads its key
 * material from `settings` through here, and one direction keeps that simple.
 */

import type { Env } from './types';

export const now = (): string => new Date().toISOString();

/* ───────── schema ───────── */

/**
 * Database schema. Add your own tables here — they are created on the next request.
 * Keep semicolons out of statement bodies: the splitter below treats every semicolon
 * as a statement boundary.
 */
const SCHEMA = `
-- Generic key/value store. The starter keeps its generated encryption key here;
-- the rest of the namespace is yours.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One in-flight Manyfold authorization handshake. device_code_* is the only thing that
-- can redeem agent tokens, so it is stored encrypted and never leaves the server; the
-- browser only ever sees the row id.
CREATE TABLE IF NOT EXISTS connect_sessions (
  id             TEXT PRIMARY KEY,
  request_id     TEXT NOT NULL,
  user_code      TEXT NOT NULL,
  auth_url       TEXT NOT NULL,
  device_code_ct TEXT NOT NULL,
  device_code_iv TEXT NOT NULL,
  status         TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  expires_at     TEXT NOT NULL
);

-- Agents the user authorized. token_* is AES-GCM encrypted and never returned by the API.
CREATE TABLE IF NOT EXISTS agents (
  agent_id     TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  rpc_url      TEXT NOT NULL,
  card_url     TEXT,
  token_ct     TEXT NOT NULL,
  token_iv     TEXT NOT NULL,
  expires_at   TEXT,
  verified     INTEGER NOT NULL DEFAULT 0,
  warning      TEXT,
  connected_at TEXT NOT NULL
);

-- One conversation per agent. context_id / active_task_id give the agent multi-turn
-- memory across requests; both are cleared when the conversation is reset.
CREATE TABLE IF NOT EXISTS conversations (
  id             TEXT PRIMARY KEY,
  agent_id       TEXT NOT NULL UNIQUE,
  context_id     TEXT,
  active_task_id TEXT,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'complete',
  error           TEXT,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, id);

-- ───────── tarot ─────────

-- One round of divination. Each round is its own row and its own A2A context:
-- "再问一件事" never overwrites the previous reading, and two rounds never share
-- a spread. The cards column is the committed draw, written exactly once when
-- the user stops the shuffle, and revealed counts how many are turned over.
CREATE TABLE IF NOT EXISTS tarot_readings (
  id             TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL,
  question       TEXT NOT NULL,
  locale         TEXT NOT NULL DEFAULT 'zh',
  status         TEXT NOT NULL DEFAULT 'greeting',
  greeting       TEXT NOT NULL DEFAULT '',
  cards          TEXT,
  revealed       INTEGER NOT NULL DEFAULT 0,
  hints          TEXT NOT NULL DEFAULT '[]',
  interpretation TEXT,
  context_id     TEXT,
  active_task_id TEXT,
  agent_id       TEXT,
  demo           INTEGER NOT NULL DEFAULT 0,
  previous_id    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tarot_readings_session ON tarot_readings (session_id, created_at);

-- Follow-up turns inside one reading, i.e. "继续解读这三张牌".
CREATE TABLE IF NOT EXISTS tarot_followups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  reading_id TEXT NOT NULL,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tarot_followups_reading ON tarot_followups (reading_id, id);

-- Frozen public copies. The snapshot column holds the whole shared payload as it
-- was at share time, so nothing that happens to the reading afterwards can change
-- what a link already handed out.
CREATE TABLE IF NOT EXISTS tarot_shares (
  token      TEXT PRIMARY KEY,
  reading_id TEXT NOT NULL,
  snapshot   TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tarot_shares_reading ON tarot_shares (reading_id, created_at);

-- Fixed-window counters for the public tarot routes. Keyed by
-- "<scope>:<subject>:<window>", so an expired window is simply a row nobody
-- reads again and the sweeper deletes.
CREATE TABLE IF NOT EXISTS tarot_rate (
  bucket       TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tarot_rate_window ON tarot_rate (window_start);

-- One free reading per anonymous browser session per day (UTC+8), plus one
-- reading for each friend who completes a reading from that session's invite.
-- A row is the day's free reading being spent, so the primary key is what makes
-- spending it twice impossible. The older tarot_access table is no longer read.
CREATE TABLE IF NOT EXISTS tarot_daily_free (
  session_id TEXT NOT NULL,
  day        TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_id, day)
);

-- An invite belongs to the finished reading that created it. A token can be
-- completed once, so forwarding the same link cannot mint multiple rewards.
CREATE TABLE IF NOT EXISTS tarot_referrals (
  token              TEXT PRIMARY KEY,
  inviter_session_id TEXT NOT NULL,
  source_reading_id  TEXT NOT NULL UNIQUE,
  status             TEXT NOT NULL DEFAULT 'pending',
  invitee_session_id TEXT,
  invitee_reading_id TEXT,
  created_at         TEXT NOT NULL,
  expires_at         TEXT NOT NULL,
  completed_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_tarot_referrals_inviter
  ON tarot_referrals (inviter_session_id, created_at);

-- Keeps the referral attached to the invitee's server-side reading. The token
-- never needs to be trusted from a completion callback by itself.
CREATE TABLE IF NOT EXISTS tarot_referral_readings (
  reading_id     TEXT PRIMARY KEY,
  referral_token TEXT NOT NULL,
  created_at     TEXT NOT NULL
);

-- A completed referral becomes one redeemable Tarot reading for the inviter.
-- redeemed_at is the atomic one-time consumption marker.
CREATE TABLE IF NOT EXISTS tarot_rewards (
  referral_token TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL,
  redeemed_at    TEXT,
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tarot_rewards_session
  ON tarot_rewards (session_id, redeemed_at, created_at);

-- A verified Fortune Stick draw can add one Tarot reward to an anonymous
-- session for the same Taiwan calendar day. The token id is the Stick reading
-- id, so minting multiple tokens for one draw cannot add multiple rewards.
CREATE TABLE IF NOT EXISTS tarot_stick_rewards (
  token_id     TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  day          TEXT NOT NULL,
  redeemed_at  TEXT,
  created_at   TEXT NOT NULL,
  UNIQUE (session_id, day)
);

-- All extra Tarot readings share one daily slot, regardless of whether the
-- source is a Stick draw or a completed friend invitation. Unspent invite
-- rewards stay in tarot_rewards for a later day.
CREATE TABLE IF NOT EXISTS tarot_daily_extra (
  session_id TEXT NOT NULL,
  day        TEXT NOT NULL,
  source     TEXT NOT NULL,
  source_id  TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_id, day)
);
`;

/**
 * Split SQL into statements: drop `--` comments first, then split on ';'.
 * Comments go first because they are allowed to contain punctuation that would
 * otherwise split a statement in half. Statement bodies are not.
 */
export function schemaStatements(sql: string): string[] {
  return sql
    .replace(/^\s*--.*$/gm, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

let initialized: Promise<void> | null = null;

/** Idempotent; runs at most once per isolate, and retries on the next request if it fails. */
export function ensureSchema(db: D1Database): Promise<void> {
  if (!initialized) {
    initialized = db
      .batch(schemaStatements(SCHEMA).map((statement) => db.prepare(statement)))
      .then(() => undefined)
      .catch((error) => {
        initialized = null;
        throw error;
      });
  }
  return initialized;
}

/* ───────── settings ───────── */

export async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?')
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(key, value, now())
    .run();
}

/** Writes only if the key is unset. Used for the generated encryption key, where
 *  concurrent first requests must converge on a single winner. */
export async function setSettingIfAbsent(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare('INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
    .bind(key, value, now())
    .run();
}
