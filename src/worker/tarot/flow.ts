/**
 * The rules of one reading, as pure functions over a record.
 *
 * Every rule the product states — three cards, drawn once, turned over in
 * order, interpreted only when all three are face up — is enforced here rather
 * than in the UI, because the UI is not a place you can enforce anything. The
 * routes call these guards before touching D1 or the diviner.
 */

import type { Locale } from '../../shared/tarot/deck';
import {
  CARDS_PER_READING,
  SLOT_ORDER,
  type Interpretation,
  type ReadingStatus,
  type SpreadId,
} from '../../shared/tarot/types';
import { HttpError } from '../types';
import type { DrawnCard } from './draw';

/** A reading as it lives in the Worker: the row, decoded. */
export interface ReadingRecord {
  id: string;
  spreadId: SpreadId;
  sessionId: string;
  question: string;
  locale: Locale;
  status: ReadingStatus;
  greeting: string;
  /** null until the shuffle is stopped. */
  cards: DrawnCard[] | null;
  /** How many of the committed cards the user has turned over. */
  revealed: number;
  /** Hint lines for revealed cards, in reveal order. */
  hints: string[];
  interpretation: Interpretation | null;
  /** A2A conversation ids, scoped to THIS reading — never shared across rounds. */
  contextId: string | null;
  activeTaskId: string | null;
  agentId: string | null;
  demo: boolean;
  createdAt: string;
  updatedAt: string;
  /**
   * The UTC day of the daily card this reading was started from, or null. The
   * card itself is recomputed from it (src/shared/tarot/daily.ts), and is
   * context for the reader only — it is never among `cards`.
   */
  dailyDay: string | null;
}

const conflict = (code: string, message: string) => new HttpError(409, code, message);

/**
 * May the shuffle be stopped?
 *
 * Idempotent by design: a double-tap on "让牌停下", or a retry after a dropped
 * response, must return the cards already committed rather than draw a second
 * set. The caller distinguishes the two through the return value.
 */
export function drawDecision(reading: ReadingRecord): { draw: boolean } {
  if (reading.cards && reading.cards.length === CARDS_PER_READING) return { draw: false };
  if (reading.status !== 'greeting') {
    throw conflict('reading_not_drawable', 'This reading is past the shuffle.');
  }
  return { draw: true };
}

/**
 * May card `index` be turned over now?
 *
 * Sequential on purpose — the three prompts only make sense in order, and
 * allowing index 2 first would let a client skip straight to the guidance card.
 * Re-revealing an already-open card is allowed (it is just a read).
 */
export function assertRevealable(reading: ReadingRecord, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= CARDS_PER_READING) {
    throw new HttpError(400, 'bad_card_index', `Card index must be 0–${CARDS_PER_READING - 1}.`);
  }
  if (!reading.cards) {
    throw conflict('not_drawn_yet', 'The cards have not been drawn yet.');
  }
  if (index > reading.revealed) {
    throw conflict('reveal_out_of_order', 'Cards must be turned over one at a time, in order.');
  }
}

/** True when this reveal is the one that opens a new card (rather than a re-read). */
export const isNewReveal = (reading: ReadingRecord, index: number): boolean =>
  index === reading.revealed;

export function statusAfterReveal(revealed: number): ReadingStatus {
  return revealed >= CARDS_PER_READING ? 'revealed' : 'drawn';
}

/** The interpretation needs all three cards face up — never a partial spread. */
export function assertInterpretable(reading: ReadingRecord): void {
  if (!reading.cards) throw conflict('not_drawn_yet', 'The cards have not been drawn yet.');
  if (reading.revealed < CARDS_PER_READING) {
    throw conflict('cards_not_revealed', 'All three cards must be turned over first.');
  }
}

/** Follow-ups ("继续解读这三张牌") only exist once there is a reading to continue. */
export function assertFollowable(reading: ReadingRecord): void {
  if (reading.status !== 'interpreted' || !reading.interpretation) {
    throw conflict('not_interpreted_yet', 'There is no reading to continue yet.');
  }
}

/** Sharing freezes a finished reading; there is nothing to freeze before that. */
export function assertShareable(reading: ReadingRecord): void {
  if (reading.status !== 'interpreted' || !reading.interpretation) {
    throw conflict('not_interpreted_yet', 'A reading can only be shared once it is complete.');
  }
}

/** The slot a given reveal index belongs to. */
export const slotAt = (index: number) => SLOT_ORDER[index];
