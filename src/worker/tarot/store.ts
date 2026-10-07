/**
 * D1 access for readings, follow-ups and shares.
 *
 * Two things in here are load-bearing beyond ordinary CRUD:
 *
 *  - `toReadingView` is the only path from a stored reading to the browser, and
 *    it emits a card only once the user has turned it over. The full spread
 *    exists in the row from the moment the shuffle stops, but nothing sends it
 *    early — otherwise the three reveals would be theatre over data the client
 *    already had, and anyone with devtools could read ahead.
 *
 *  - `buildShareSnapshot` copies, never references. A share link resolves to the
 *    JSON frozen at share time; later follow-ups, or a re-interpretation, cannot
 *    reach back and change what somebody already sent to a friend.
 */

import { copyFor, normalizeLocale } from '../../shared/tarot/i18n';
import { cardKeywords, cardById, type Locale } from '../../shared/tarot/deck';
import {
  CARDS_PER_READING,
  type FollowUpMessage,
  type Interpretation,
  type ReadingStatus,
  type ReadingView,
  type ShareMode,
  type ShareSnapshot,
  type SpreadId,
} from '../../shared/tarot/types';
import { HttpError, type Env } from '../types';
import { now } from '../db';
import { parseDraw, serializeDraw, type DrawnCard } from './draw';
import { statusAfterReveal, type ReadingRecord } from './flow';
import { shareConclusion } from './prompt';
import { isSpreadId } from '../../shared/tarot/spreads';
import { dailyCardContext } from '../../shared/tarot/daily';

interface ReadingRow {
  id: string;
  session_id: string;
  question: string;
  locale: string;
  status: string;
  greeting: string;
  cards: string | null;
  revealed: number;
  hints: string;
  interpretation: string | null;
  context_id: string | null;
  active_task_id: string | null;
  agent_id: string | null;
  demo: number;
  created_at: string;
  updated_at: string;
  spread_id: string | null;
  daily_day: string | null;
}

const READING_COLUMNS = `id, session_id, question, locale, status, greeting, cards, revealed, hints,
  interpretation, context_id, active_task_id, agent_id, demo, created_at, updated_at`;

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toRecord(row: ReadingRow): ReadingRecord {
  const cards = parseDraw(row.cards);
  const hints = parseJson<string[]>(row.hints, []);
  // `revealed` is clamped to what the stored draw can actually support: a row
  // that somehow claims four reveals must not produce a fourth card.
  const revealed = Math.max(0, Math.min(Number(row.revealed) || 0, cards ? cards.length : 0));
  return {
    id: row.id,
    spreadId: isSpreadId(row.spread_id) ? row.spread_id : 'current',
    sessionId: row.session_id,
    question: row.question,
    locale: normalizeLocale(row.locale),
    status: row.status as ReadingStatus,
    greeting: row.greeting ?? '',
    cards,
    revealed,
    hints: hints.slice(0, CARDS_PER_READING),
    interpretation: parseJson<Interpretation | null>(row.interpretation, null),
    contextId: row.context_id,
    activeTaskId: row.active_task_id,
    agentId: row.agent_id,
    demo: row.demo === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dailyDay: row.daily_day ?? null,
  };
}

/* ───────── readings ───────── */

export async function createReading(
  env: Env,
  input: {
    sessionId: string;
    question: string;
    locale: Locale;
    previousReadingId: string | null;
    spreadId: SpreadId;
    /** Already checked by the caller (`acceptedDailyDay`); null for every other reading. */
    dailyDay: string | null;
  },
): Promise<ReadingRecord> {
  const id = crypto.randomUUID();
  const timestamp = now();
  // One batch, so a reading never exists without the rows that say what kind
  // of reading it is.
  const statements = [
    env.DB.prepare(
    `INSERT INTO tarot_readings
     (id, session_id, question, locale, status, greeting, cards, revealed, hints,
      interpretation, context_id, active_task_id, agent_id, demo, previous_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'greeting', '', NULL, 0, '[]', NULL, NULL, NULL, NULL, 0, ?, ?, ?)`,
    ).bind(
      id,
      input.sessionId,
      input.question,
      input.locale,
      input.previousReadingId,
      timestamp,
      timestamp,
    ),
    env.DB.prepare('INSERT INTO tarot_reading_spreads (reading_id, spread_id) VALUES (?, ?)')
      .bind(id, input.spreadId),
  ];
  if (input.dailyDay) {
    statements.push(
      env.DB.prepare('INSERT INTO tarot_reading_daily (reading_id, day) VALUES (?, ?)')
        .bind(id, input.dailyDay),
    );
  }
  await env.DB.batch(statements);
  const created = await loadReading(env, id);
  if (!created) throw new HttpError(500, 'reading_not_created', 'Could not start the reading.');
  return created;
}

export async function loadReading(env: Env, readingId: string): Promise<ReadingRecord | null> {
  const row = await env.DB.prepare(
    `SELECT ${READING_COLUMNS},
      (SELECT spread_id FROM tarot_reading_spreads WHERE reading_id = tarot_readings.id) AS spread_id,
      (SELECT day FROM tarot_reading_daily WHERE reading_id = tarot_readings.id) AS daily_day
     FROM tarot_readings WHERE id = ?`,
  )
    .bind(readingId)
    .first<ReadingRow>();
  return row ? toRecord(row) : null;
}

/**
 * Loads a reading and proves it belongs to this browser.
 *
 * Deliberately answers 404 for someone else's reading rather than 403: a
 * distinguishable "exists but not yours" would turn reading ids into something
 * worth enumerating.
 */
export async function requireOwnedReading(
  env: Env,
  readingId: string,
  sessionId: string,
): Promise<ReadingRecord> {
  const reading = await loadReading(env, readingId);
  if (!reading || reading.sessionId !== sessionId) {
    throw new HttpError(404, 'reading_not_found', 'That reading no longer exists.');
  }
  return reading;
}

export async function saveGreeting(
  env: Env,
  readingId: string,
  fields: { greeting: string; contextId: string | null; taskId: string | null; demo: boolean; agentId: string | null },
): Promise<void> {
  await env.DB.prepare(
    `UPDATE tarot_readings SET greeting = ?, context_id = COALESCE(?, context_id),
       active_task_id = ?, demo = ?, agent_id = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      fields.greeting,
      fields.contextId,
      fields.taskId,
      fields.demo ? 1 : 0,
      fields.agentId,
      now(),
      readingId,
    )
    .run();
}

/**
 * Writes the committed draw, once.
 *
 * The `cards IS NULL` condition is the whole point: two taps on "让牌停下", or a
 * retry after a lost response, must not produce a second spread. The loser of
 * that race reads back the winner's cards.
 */
export async function commitDraw(
  env: Env,
  readingId: string,
  cards: DrawnCard[],
): Promise<ReadingRecord> {
  await env.DB.prepare(
    `UPDATE tarot_readings SET cards = ?, status = 'drawn', updated_at = ?
     WHERE id = ? AND cards IS NULL`,
  )
    .bind(serializeDraw(cards), now(), readingId)
    .run();
  const reading = await loadReading(env, readingId);
  if (!reading?.cards) {
    throw new HttpError(500, 'draw_failed', 'The cards could not be committed.');
  }
  return reading;
}

/** Records one card turning over, with the line spoken as it lands. */
export async function recordReveal(
  env: Env,
  readingId: string,
  index: number,
  hint: string,
  existingHints: string[],
): Promise<void> {
  const hints = [...existingHints];
  hints[index] = hint;
  const revealed = index + 1;
  await env.DB.prepare(
    `UPDATE tarot_readings SET revealed = MAX(revealed, ?), hints = ?, status = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(revealed, JSON.stringify(hints), statusAfterReveal(revealed), now(), readingId)
    .run();
}

export async function saveInterpretation(
  env: Env,
  readingId: string,
  fields: {
    interpretation: Interpretation;
    contextId: string | null;
    taskId: string | null;
    demo: boolean;
    agentId: string | null;
  },
): Promise<void> {
  await env.DB.prepare(
    `UPDATE tarot_readings SET interpretation = ?, status = 'interpreted',
       context_id = COALESCE(?, context_id), active_task_id = ?, demo = ?, agent_id = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      JSON.stringify(fields.interpretation),
      fields.contextId,
      fields.taskId,
      fields.demo ? 1 : 0,
      fields.agentId,
      now(),
      readingId,
    )
    .run();
}

export async function rememberContext(
  env: Env,
  readingId: string,
  contextId: string | null,
  taskId: string | null,
): Promise<void> {
  await env.DB.prepare(
    'UPDATE tarot_readings SET context_id = COALESCE(?, context_id), active_task_id = ?, updated_at = ? WHERE id = ?',
  )
    .bind(contextId, taskId, now(), readingId)
    .run();
}

/* ───────── follow-ups ───────── */

export async function addFollowUp(
  env: Env,
  readingId: string,
  role: 'user' | 'diviner',
  content: string,
): Promise<number> {
  const result = await env.DB.prepare(
    'INSERT INTO tarot_followups (reading_id, role, content, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(readingId, role, content, now())
    .run();
  return Number(result.meta.last_row_id);
}

export async function listFollowUps(env: Env, readingId: string): Promise<FollowUpMessage[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, role, content, created_at AS createdAt FROM tarot_followups
     WHERE reading_id = ? ORDER BY id`,
  )
    .bind(readingId)
    .all<FollowUpMessage>();
  return results ?? [];
}

export async function countUserFollowUps(env: Env, readingId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM tarot_followups WHERE reading_id = ? AND role = 'user'",
  )
    .bind(readingId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/* ───────── views ───────── */

/**
 * The reading as the browser is allowed to see it right now.
 *
 * `pending` is how many cards are committed but still face down — enough for the
 * UI to render three backs without knowing what any of them are.
 */
export function toReadingView(reading: ReadingRecord, followUps: FollowUpMessage[]): ReadingView {
  const committed = reading.cards ?? [];
  const revealed = committed.slice(0, reading.revealed).map((card, index) => ({
    slot: card.slot,
    index,
    cardId: card.cardId,
    reversed: card.reversed,
    hint: reading.hints[index] ?? '',
  }));
  return {
    readingId: reading.id,
    spreadId: reading.spreadId ?? 'current',
    status: reading.status,
    locale: reading.locale,
    question: reading.question,
    greeting: reading.greeting,
    cards: revealed,
    pending: Math.max(0, committed.length - revealed.length),
    interpretation: reading.interpretation,
    followUps,
    demo: reading.demo,
    createdAt: reading.createdAt,
    // Absent rather than null for every other reading, so a plain reading's
    // view is exactly what it was before daily cards existed.
    ...(reading.dailyDay ? { dailyCard: dailyCardContext(reading.dailyDay) } : {}),
  };
}

export async function readingViewFor(env: Env, reading: ReadingRecord): Promise<ReadingView> {
  const followUps =
    reading.status === 'interpreted' ? await listFollowUps(env, reading.id) : [];
  return toReadingView(reading, followUps);
}

/* ───────── shares ───────── */

const SHARE_TOKEN_BYTES = 18;

export function newShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SHARE_TOKEN_BYTES));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The frozen payload.
 *
 * What it carries is exactly the product rule: the three cards with their
 * positions and orientations, one sentence of conclusion, and a signature. What
 * it never carries: the follow-up conversation, anything identifying the
 * visitor, any other round — and the question itself only when the user ticked
 * the box.
 */
export function buildShareSnapshot(
  reading: ReadingRecord,
  options: { token: string; includeQuestion: boolean; mode?: ShareMode; cardIndex?: number; createdAt: string },
): ShareSnapshot {
  const interpretation = reading.interpretation;
  if (!interpretation || !reading.cards) {
    throw new HttpError(409, 'not_interpreted_yet', 'A reading can only be shared once complete.');
  }
  /* Empty rather than absent is the failure mode worth guarding: a section the
     diviner left blank must not reach the page as a heading over nothing. An
     undefined key is dropped by JSON.stringify, so a thin reading is stored thin
     and renders as if the field had never existed — which is exactly how the
     snapshots written before this all render. */
  /* The question stays private unless the box was ticked, and that has to hold
     for the reader's own prose too: a diviner that quotes the question back in a
     card paragraph would otherwise publish it through the side door. */
  const question = reading.question.trim();
  const scrub = (text: string): string =>
    options.includeQuestion || question.length < 4 ? text : text.split(question).join('…');
  const said = (text: string): string | undefined => scrub(text).trim() || undefined;
  const perCard = interpretation.perCard
    .filter((entry) => entry.text.trim())
    .map((entry) => ({ slot: entry.slot, text: scrub(entry.text).trim() }));

  const mode = options.mode ?? 'full';
  const selectedIndex = Number.isInteger(options.cardIndex) ? Number(options.cardIndex) : 0;
  if (mode === 'card' && (selectedIndex < 0 || selectedIndex >= reading.cards.length)) {
    throw new HttpError(400, 'bad_share_card', 'Choose a card from this reading.');
  }
  const selectedCard = reading.cards[mode === 'card' ? selectedIndex : 0];
  const selectedFace = cardById(selectedCard.cardId);
  const selectedText = selectedFace ? cardKeywords(selectedFace, selectedCard.reversed, reading.locale) : '';
  return {
    token: options.token,
    readingId: reading.id,
    spreadId: reading.spreadId ?? 'current',
    locale: reading.locale,
    question: options.includeQuestion ? reading.question : null,
    cards: (mode === 'card' ? [selectedCard] : reading.cards).map((card) => ({
      slot: card.slot,
      cardId: card.cardId,
      reversed: card.reversed,
    })),
    conclusion: mode === 'card' ? said(selectedText ?? '') ?? scrub(shareConclusion(interpretation)) : scrub(shareConclusion(interpretation)),
    overview: mode === 'card' ? undefined : said(interpretation.overview),
    perCard: mode === 'full' && perCard.length ? perCard : undefined,
    connections: mode === 'full' ? said(interpretation.connections) : undefined,
    signature: copyFor(reading.locale).signature,
    createdAt: options.createdAt,
    mode,
  };
}

export async function createShare(
  env: Env,
  reading: ReadingRecord,
  options: boolean | { includeQuestion: boolean; mode: ShareMode; cardIndex?: number },
): Promise<ShareSnapshot> {
  const shareOptions = typeof options === 'boolean'
    ? { includeQuestion: options, mode: 'full' as const }
    : options;
  const snapshot = buildShareSnapshot(reading, {
    token: newShareToken(),
    ...shareOptions,
    createdAt: now(),
  });
  await env.DB.prepare(
    'INSERT INTO tarot_shares (token, reading_id, snapshot, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(snapshot.token, reading.id, JSON.stringify(snapshot), snapshot.createdAt)
    .run();
  return snapshot;
}

export interface JournalEntry {
  readingId: string;
  spreadId: SpreadId;
  createdAt: string;
  savedAt: string;
  cards: { slot: string; cardId: string; reversed: boolean }[];
  note: string;
  reviewDueAt: string | null;
  reviewNote: string;
  reviewedAt: string | null;
}

export async function listJournal(env: Env, sessionId: string): Promise<JournalEntry[]> {
  const { results } = await env.DB.prepare(
    `SELECT j.reading_id AS readingId, COALESCE(s.spread_id, 'current') AS spreadId,
       r.created_at AS createdAt, j.saved_at AS savedAt, r.cards,
       j.note, j.review_due_at AS reviewDueAt, j.review_note AS reviewNote,
       j.reviewed_at AS reviewedAt
     FROM tarot_journal j
     JOIN tarot_readings r ON r.id = j.reading_id
     LEFT JOIN tarot_reading_spreads s ON s.reading_id = r.id
     WHERE j.session_id = ? AND r.status = 'interpreted'
     ORDER BY j.saved_at DESC`,
  ).bind(sessionId).all<{
    readingId: string; spreadId: string; createdAt: string; savedAt: string; cards: string | null;
    note: string; reviewDueAt: string | null; reviewNote: string; reviewedAt: string | null;
  }>();
  return (results ?? []).map((row) => ({
    readingId: row.readingId,
    spreadId: isSpreadId(row.spreadId) ? row.spreadId : 'current',
    createdAt: row.createdAt,
    savedAt: row.savedAt,
    cards: parseDraw(row.cards)?.map(({ slot, cardId, reversed }) => ({ slot, cardId, reversed })) ?? [],
    note: row.note,
    reviewDueAt: row.reviewDueAt,
    reviewNote: row.reviewNote,
    reviewedAt: row.reviewedAt,
  }));
}

export async function journalFor(env: Env, readingId: string, sessionId: string) {
  return env.DB.prepare(
    `SELECT reading_id AS readingId, note, review_due_at AS reviewDueAt,
       review_note AS reviewNote, reviewed_at AS reviewedAt, saved_at AS savedAt
     FROM tarot_journal WHERE reading_id = ? AND session_id = ?`,
  ).bind(readingId, sessionId).first<{
    readingId: string; note: string; reviewDueAt: string | null; reviewNote: string;
    reviewedAt: string | null; savedAt: string;
  }>();
}

export async function saveJournal(
  env: Env,
  readingId: string,
  sessionId: string,
  fields: { note: string; reviewDueAt: string | null; reviewNote?: string; reviewedAt?: string | null },
) {
  const timestamp = now();
  await env.DB.prepare(
    `INSERT INTO tarot_journal (reading_id, session_id, note, review_due_at, review_note, reviewed_at, saved_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(reading_id) DO UPDATE SET note = excluded.note, review_due_at = excluded.review_due_at,
       review_note = excluded.review_note, reviewed_at = excluded.reviewed_at, updated_at = excluded.updated_at
     WHERE tarot_journal.session_id = excluded.session_id`,
  ).bind(
    readingId, sessionId, fields.note, fields.reviewDueAt, fields.reviewNote ?? '',
    fields.reviewedAt ?? null, timestamp, timestamp,
  ).run();
  return journalFor(env, readingId, sessionId);
}

export async function deleteReadingData(env: Env, readingId: string) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM tarot_shares WHERE reading_id = ?').bind(readingId),
    env.DB.prepare('DELETE FROM tarot_followups WHERE reading_id = ?').bind(readingId),
    env.DB.prepare('DELETE FROM tarot_journal WHERE reading_id = ?').bind(readingId),
    env.DB.prepare('DELETE FROM tarot_reading_spreads WHERE reading_id = ?').bind(readingId),
    env.DB.prepare('DELETE FROM tarot_reading_daily WHERE reading_id = ?').bind(readingId),
    env.DB.prepare('DELETE FROM tarot_reading_access WHERE reading_id = ?').bind(readingId),
    env.DB.prepare('DELETE FROM tarot_readings WHERE id = ?').bind(readingId),
  ]);
}

export async function clearJournalAndReadings(env: Env, sessionId: string) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM tarot_shares WHERE reading_id IN (SELECT id FROM tarot_readings WHERE session_id = ?)').bind(sessionId),
    env.DB.prepare('DELETE FROM tarot_followups WHERE reading_id IN (SELECT id FROM tarot_readings WHERE session_id = ?)').bind(sessionId),
    env.DB.prepare('DELETE FROM tarot_journal WHERE session_id = ?').bind(sessionId),
    env.DB.prepare('DELETE FROM tarot_reading_spreads WHERE reading_id IN (SELECT id FROM tarot_readings WHERE session_id = ?)').bind(sessionId),
    env.DB.prepare('DELETE FROM tarot_reading_daily WHERE reading_id IN (SELECT id FROM tarot_readings WHERE session_id = ?)').bind(sessionId),
    env.DB.prepare('DELETE FROM tarot_reading_access WHERE session_id = ?').bind(sessionId),
    env.DB.prepare('DELETE FROM tarot_readings WHERE session_id = ?').bind(sessionId),
  ]);
}

export async function loadShare(env: Env, token: string): Promise<ShareSnapshot | null> {
  const row = await env.DB.prepare('SELECT snapshot FROM tarot_shares WHERE token = ?')
    .bind(token)
    .first<{ snapshot: string }>();
  if (!row) return null;
  return parseJson<ShareSnapshot | null>(row.snapshot, null);
}
