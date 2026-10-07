/**
 * @vitest-environment jsdom
 *
 * The finished reading, in the order it is used.
 *
 * The reader writes eight sections in a fixed order; the page shows the answer
 * first, then what to do about it and the question to keep, and only then the
 * reading of the cards — folded into one list of rows, each card's row carrying
 * an id the spread beside it can open.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import Reading from '../../src/app/tarot/Reading';
import type { DrawnCardView, Interpretation } from '../../src/shared/tarot/types';

const cards: DrawnCardView[] = [
  { slot: 'situation', index: 0, cardId: 'major-00', reversed: false, hint: '' },
  { slot: 'hidden', index: 1, cardId: 'cups-03', reversed: true, hint: '' },
  { slot: 'guidance', index: 2, cardId: 'swords-14', reversed: false, hint: '' },
];

const interpretation: Interpretation = {
  conclusion: 'Not yet.',
  overview: 'Overview.',
  perCard: [
    { slot: 'situation', text: 'First.' },
    { slot: 'hidden', text: 'Second.' },
    { slot: 'guidance', text: 'Third.' },
  ],
  connections: 'Between.',
  response: 'Back to it.',
  actions: ['Do one thing.'],
  reflection: 'What would change?',
  closing: 'Go gently.',
};

afterEach(() => cleanup());

describe('the finished reading', () => {
  it('puts the answer, what to do and the question to keep before the reading of the cards', () => {
    const { container } = render(<Reading interpretation={interpretation} cards={cards} locale="en" />);
    const headings = Array.from(container.querySelectorAll('h3')).map((heading) => heading.textContent);
    expect(headings).toEqual(['What you can do', 'A question to sit with', 'The full reading']);

    const text = container.textContent ?? '';
    const at = (needle: string) => text.indexOf(needle);
    expect(at('Not yet.')).toBeLessThan(at('Do one thing.'));
    expect(at('Do one thing.')).toBeLessThan(at('What would change?'));
    expect(at('What would change?')).toBeLessThan(at('Overview.'));
    expect(at('Back to it.')).toBeLessThan(at('Go gently.'));
  });

  it('folds the reading of the cards into closed rows, each card\'s row reachable by id', () => {
    const { container } = render(<Reading interpretation={interpretation} cards={cards} locale="en" />);
    const rows = Array.from(container.querySelectorAll<HTMLDetailsElement>('.taro-reading-details details'));
    expect(rows).toHaveLength(6);
    expect(rows.every((row) => !row.open)).toBe(true);
    expect(Array.from(container.querySelectorAll('.taro-detail[data-slot]')).map((row) => row.id)).toEqual([
      'taro-detail-situation',
      'taro-detail-hidden',
      'taro-detail-guidance',
    ]);
  });
});
