/**
 * @vitest-environment jsdom
 *
 * The page a share link opens.
 *
 * Two rules, and the second one is the expensive one to break.
 *
 * The first: a shared reading now shows the reading. Each card gets its own
 * section with its own face, its name, which way up it fell, the keywords the
 * deck attaches to that orientation, and what the diviner said about it in that
 * position. Before this, a link resolved to three pictures and one sentence, and
 * a stranger receiving it had no way to tell whether the sentence was earned.
 *
 * The second: snapshots are frozen rows. Every one written before shares carried
 * prose has no overview, no per-card text and no connections, and no migration
 * can reach back and give them any — the whole promise of a share link is that
 * it is a photograph. So an old snapshot must render as the page it has always
 * rendered, and a snapshot that arrives thin must not put a heading over
 * nothing. That is checked here rather than trusted, because the failure is
 * silent: it looks like an empty section, on somebody else's link, months later.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShareSnapshot } from '../../src/shared/tarot/types';

const full: ShareSnapshot = {
  token: 'tok',
  readingId: 'r1',
  locale: 'zh',
  question: '我要不要换工作？',
  cards: [
    { slot: 'situation', cardId: 'major-00', reversed: false },
    { slot: 'hidden', cardId: 'cups-03', reversed: true },
    { slot: 'guidance', cardId: 'swords-14', reversed: false },
  ],
  conclusion: '可以试。但不要今天就辞。',
  overview: '整体偏向行动。',
  perCard: [
    { slot: 'situation', text: '你站在一个还没有代价的路口。' },
    { slot: 'hidden', text: '你以为在等条件，其实在等许可。' },
    { slot: 'guidance', text: '先把话说清楚，再决定走不走。' },
  ],
  connections: '三张牌指向同一件事：先谈，再走。',
  signature: 'AI 塔罗',
  createdAt: '2026-02-02T00:00:00.000Z',
};

/** Exactly what a row written before any of this looks like when it is read. */
const legacy: ShareSnapshot = {
  token: 'old',
  readingId: 'r0',
  locale: 'zh',
  question: null,
  cards: full.cards,
  conclusion: '可以试。',
  signature: 'AI 塔罗',
  createdAt: '2026-01-01T00:00:00.000Z',
};

let served: ShareSnapshot = full;

vi.mock('../../src/app/tarot/api', () => ({
  ApiError: class ApiError extends Error {},
  errorText: (_error: unknown, fallback: string) => fallback,
  fetchShare: async () => ({ share: served }),
}));

// Imported after the mock is registered.
const { default: SharePage } = await import('../../src/app/tarot/SharePage');

const sections = (): HTMLElement[] => Array.from(document.querySelectorAll('.taro-read-card'));

const show = async (snapshot: ShareSnapshot) => {
  served = snapshot;
  render(<SharePage />);
  await screen.findByText(snapshot.conclusion);
};

beforeEach(() => {
  served = full;
  history.replaceState(null, '', '/s/tok');
});

afterEach(() => {
  cleanup();
});

describe('a shared reading', () => {
  it('gives every card its own section, not just the short answer', async () => {
    await show(full);

    await waitFor(() => expect(sections()).toHaveLength(3));

    // The reading itself, in the order the cards were dealt.
    expect(sections().map((el) => el.querySelector('h2')?.textContent)).toEqual([
      '此刻的处境',
      '隐藏的影响',
      '接下来的指引',
    ]);
    for (const entry of full.perCard ?? []) {
      expect(screen.getByText(entry.text)).toBeTruthy();
    }

    // And the parts that frame it.
    expect(screen.getByText('整体偏向行动。')).toBeTruthy();
    expect(screen.getByText('三张牌指向同一件事：先谈，再走。')).toBeTruthy();
  });

  it('names the card in the section, and shows the card', async () => {
    await show(full);
    await waitFor(() => expect(sections()).toHaveLength(3));

    const hidden = sections()[1];
    expect(hidden.querySelector('.taro-read-card-line strong')?.textContent).toBe('圣杯三');
    expect(hidden.querySelector('.taro-orient')?.textContent).toBe('逆位');

    // The same art file the spread above already fetched, turned around because
    // the card was — never a second picture and never a badge standing in.
    const face = hidden.querySelector('.taro-read-face') as HTMLImageElement;
    expect(face.getAttribute('src')).toBe('/cards/cups-03.webp');
    expect(face.className).toContain('is-reversed');
    expect(sections()[0].querySelector('.taro-read-face')?.className).not.toContain('is-reversed');
  });

  /* The keywords come out of the deck, not out of the snapshot — which is why
     they can be shown at all for a card whose reading text was never frozen,
     and why they are the reversed set when the card fell reversed. */
  it('shows the deck’s own keywords for the orientation the card landed in', async () => {
    await show(full);
    await waitFor(() => expect(sections()).toHaveLength(3));

    const { cardById, cardKeywords } = await import('../../src/shared/tarot/deck');
    const cups = cardById('cups-03');
    expect(cups).toBeTruthy();
    expect(sections()[1].querySelector('.taro-read-keywords')?.textContent).toBe(
      cardKeywords(cups!, true, 'zh'),
    );
  });

  it('still renders a snapshot frozen before any of this existed', async () => {
    await show(legacy);

    // The page it always was: three cards and one sentence.
    expect(document.querySelectorAll('.taro-cards .taro-slot')).toHaveLength(3);
    expect(screen.getByText('可以试。')).toBeTruthy();
    expect(screen.getByText('也去问一次')).toBeTruthy();

    // And not one empty heading, rule or section from the new block.
    expect(document.querySelector('.taro-shared-reading')).toBeNull();
    expect(sections()).toHaveLength(0);
    expect(screen.queryByText('完整解读')).toBeNull();
  });

  it('puts no heading over a section the diviner left blank', async () => {
    await show({ ...legacy, perCard: full.perCard });

    await waitFor(() => expect(sections()).toHaveLength(3));

    // The block is there because the cards were read; the two framing sections
    // are not, because nothing was written for them.
    expect(document.querySelector('.taro-shared-reading')).toBeTruthy();
    expect(screen.queryByText('三张牌')).toBeNull();
    expect(screen.queryByText('三张牌之间')).toBeNull();
  });

  it('leaves the question out when it was never shared', async () => {
    await show(legacy);
    expect(document.querySelector('.taro-asked')).toBeNull();
  });
});
