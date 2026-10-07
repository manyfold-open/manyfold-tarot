/**
 * The reading's rules, exercised where they actually live. Every one of these
 * cases is something a client could try: tapping "stop" twice, asking for the
 * guidance card first, asking for the interpretation with two cards face down.
 */

import { describe, expect, it } from 'vitest';
import { HttpError } from '../src/worker/types';
import type { DrawnCard } from '../src/worker/tarot/draw';
import {
  assertFollowable,
  assertInterpretable,
  assertRevealable,
  assertShareable,
  drawDecision,
  isNewReveal,
  slotAt,
  statusAfterReveal,
  type ReadingRecord,
} from '../src/worker/tarot/flow';
import type { Interpretation } from '../src/shared/tarot/types';

const CARDS: DrawnCard[] = [
  { slot: 'situation', cardId: 'major-00', reversed: false },
  { slot: 'hidden', cardId: 'cups-03', reversed: true },
  { slot: 'guidance', cardId: 'swords-14', reversed: false },
];

const INTERPRETATION: Interpretation = {
  conclusion: '会的。',
  overview: '',
  perCard: [],
  connections: '',
  response: '',
  actions: [],
  reflection: '',
  closing: '',
};

const reading = (overrides: Partial<ReadingRecord> = {}): ReadingRecord => ({
  id: 'r1',
  spreadId: 'current',
  sessionId: 's1',
  question: '要不要换工作？',
  locale: 'zh',
  status: 'greeting',
  greeting: '我听见了。',
  cards: null,
  revealed: 0,
  hints: [],
  interpretation: null,
  contextId: null,
  activeTaskId: null,
  agentId: null,
  demo: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  dailyDay: null,
  ...overrides,
});

const code = (fn: () => void): string => {
  try {
    fn();
  } catch (error) {
    return error instanceof HttpError ? `${error.status}:${error.code}` : 'not-http';
  }
  return 'no-throw';
};

describe('drawDecision', () => {
  it('draws once, then never again', () => {
    expect(drawDecision(reading())).toEqual({ draw: true });
    expect(drawDecision(reading({ status: 'drawn', cards: CARDS }))).toEqual({ draw: false });
    expect(drawDecision(reading({ status: 'interpreted', cards: CARDS, revealed: 3 }))).toEqual({
      draw: false,
    });
  });

  it('refuses to draw for a reading that has moved on without cards', () => {
    expect(code(() => drawDecision(reading({ status: 'drawn' })))).toBe('409:reading_not_drawable');
  });
});

describe('assertRevealable', () => {
  const drawn = reading({ status: 'drawn', cards: CARDS });

  it('rejects an index outside the spread', () => {
    expect(code(() => assertRevealable(drawn, -1))).toBe('400:bad_card_index');
    expect(code(() => assertRevealable(drawn, 3))).toBe('400:bad_card_index');
    expect(code(() => assertRevealable(drawn, 1.5))).toBe('400:bad_card_index');
    expect(code(() => assertRevealable(drawn, Number.NaN))).toBe('400:bad_card_index');
  });

  it('rejects a reveal before the shuffle was stopped', () => {
    expect(code(() => assertRevealable(reading(), 0))).toBe('409:not_drawn_yet');
  });

  it('allows only the next card, never a skip', () => {
    expect(code(() => assertRevealable(drawn, 0))).toBe('no-throw');
    expect(code(() => assertRevealable(drawn, 1))).toBe('409:reveal_out_of_order');
    expect(code(() => assertRevealable(drawn, 2))).toBe('409:reveal_out_of_order');

    const one = reading({ status: 'drawn', cards: CARDS, revealed: 1 });
    expect(code(() => assertRevealable(one, 1))).toBe('no-throw');
    expect(code(() => assertRevealable(one, 2))).toBe('409:reveal_out_of_order');
  });

  it('lets an already-open card be read again', () => {
    const two = reading({ status: 'drawn', cards: CARDS, revealed: 2 });
    expect(code(() => assertRevealable(two, 0))).toBe('no-throw');
    expect(isNewReveal(two, 0)).toBe(false);
    expect(isNewReveal(two, 2)).toBe(true);
  });
});

describe('status transitions', () => {
  it('only becomes revealed once all three are face up', () => {
    expect(statusAfterReveal(1)).toBe('drawn');
    expect(statusAfterReveal(2)).toBe('drawn');
    expect(statusAfterReveal(3)).toBe('revealed');
  });

  it('maps reveal order to the fixed slots', () => {
    expect([slotAt(0), slotAt(1), slotAt(2)]).toEqual(['situation', 'hidden', 'guidance']);
  });
});

describe('later gates', () => {
  it('will not interpret a partial spread', () => {
    expect(code(() => assertInterpretable(reading()))).toBe('409:not_drawn_yet');
    expect(
      code(() => assertInterpretable(reading({ status: 'drawn', cards: CARDS, revealed: 2 }))),
    ).toBe('409:cards_not_revealed');
    expect(
      code(() => assertInterpretable(reading({ status: 'revealed', cards: CARDS, revealed: 3 }))),
    ).toBe('no-throw');
  });

  it('will not continue or share a reading that does not exist yet', () => {
    const revealed = reading({ status: 'revealed', cards: CARDS, revealed: 3 });
    expect(code(() => assertFollowable(revealed))).toBe('409:not_interpreted_yet');
    expect(code(() => assertShareable(revealed))).toBe('409:not_interpreted_yet');

    const done = reading({
      status: 'interpreted',
      cards: CARDS,
      revealed: 3,
      interpretation: INTERPRETATION,
    });
    expect(code(() => assertFollowable(done))).toBe('no-throw');
    expect(code(() => assertShareable(done))).toBe('no-throw');
  });
});
