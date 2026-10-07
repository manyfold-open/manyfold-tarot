/**
 * Today's card: one card per UTC day, the same for every visitor.
 *
 * It is a pure function of the date rather than a draw, which is what lets the
 * Worker recompute it whenever it needs it instead of trusting a card id the
 * browser sends back. A reading started from the daily page carries the *day*;
 * the card is always worked out here, from the day, on the Worker's side.
 *
 * Shared because the rule is plain arithmetic over the deck and has no reason
 * to exist twice — but only the Worker's answer is ever taken as the truth.
 */

import { DECK, DECK_SIZE, cardById, cardKeywords, type Locale } from './deck';
import type { DailyCardContext } from './types';

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD`, the only shape a day is ever written in. */
export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The UTC calendar day of `date` (now, by default), as `YYYY-MM-DD`. */
export const utcDay = (date: Date = new Date()): string => date.toISOString().slice(0, 10);

export interface DailyCard {
  day: string;
  cardId: string;
  reversed: boolean;
}

/**
 * The card for one UTC day: days since the epoch, wrapped around the deck, and
 * reversed on odd days. `GET /api/tarot/daily` has always answered with exactly
 * this, so changing the arithmetic would change a card people already saw.
 *
 * The odd-day test is a plain `% 2 === 1`, which calls every day before 1970
 * upright. Nobody opens the daily page from the sixties, and keeping it means
 * no published day changes its card.
 */
export function dailyCardFor(day: string): DailyCard {
  const dayNumber = Math.floor(Date.parse(`${day}T00:00:00.000Z`) / DAY_MS);
  const index = ((dayNumber % DECK_SIZE) + DECK_SIZE) % DECK_SIZE;
  return { day, cardId: DECK[index].id, reversed: dayNumber % 2 === 1 };
}

/**
 * What a reading started from the daily card carries for its reader, recomputed
 * from the stored day — or undefined for every other reading.
 */
export function dailyCardContext(day: string | null): DailyCardContext | undefined {
  if (!day) return undefined;
  const { cardId, reversed } = dailyCardFor(day);
  return { cardId, reversed };
}

/** The keyword line for a daily card in its own orientation. */
export function dailyCardKeywords(daily: DailyCard, locale: Locale): string {
  const card = cardById(daily.cardId);
  return card ? cardKeywords(card, daily.reversed, locale) : '';
}

/**
 * The day a reading may say it came from, or null.
 *
 * Only today or yesterday (UTC) is taken: a page opened at 23:59 and tapped at
 * 00:01 is still telling the truth, and anything older is a page left open for
 * days, whose card is no longer "today's". Everything else — not a string, the
 * wrong shape, a past or a future day — is null, and the caller simply reads
 * without a daily card rather than refusing the reading.
 */
export function acceptedDailyDay(requested: unknown, now: Date = new Date()): string | null {
  if (typeof requested !== 'string' || !DAY_PATTERN.test(requested)) return null;
  const today = utcDay(now);
  const yesterday = utcDay(new Date(now.getTime() - DAY_MS));
  return requested === today || requested === yesterday ? requested : null;
}
