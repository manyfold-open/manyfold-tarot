/**
 * @vitest-environment jsdom
 *
 * Choosing, and then turning over — two rooms, never the same one.
 *
 * The rule this file exists to hold: over the spread nothing is face up and
 * nothing is even waiting to be, and once the spread is gone it does not come
 * back. Before, a card turned the instant it was touched and the visitor watched
 * three slots fill in above a deck they were still picking from; the two halves
 * of the ritual ran on top of each other. Everything asserted here is about
 * keeping them apart.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DivinerEvent, DrawnCardView, ReadingView } from '../../src/shared/tarot/types';

const drawn: ReadingView = {
  readingId: 'r1',
  status: 'drawn',
  locale: 'zh',
  question: '要不要换一份工作？',
  greeting: '我听见的，不只是要不要离开。',
  cards: [],
  pending: 3,
  interpretation: null,
  followUps: [],
  demo: false,
  createdAt: '2026-08-20T00:00:00.000Z',
};

const DEALT: DrawnCardView[] = [
  { slot: 'situation', index: 0, cardId: 'major-00', reversed: false, hint: '' },
  { slot: 'hidden', index: 1, cardId: 'cups-03', reversed: true, hint: '' },
  { slot: 'guidance', index: 2, cardId: 'swords-14', reversed: false, hint: '' },
];

/** Every /reveal the app asked for, in order. */
const revealed: number[] = [];

const streamDiviner = vi.fn(
  async (path: string, body: unknown, onEvent: (event: DivinerEvent) => void) => {
    if (!path.endsWith('/reveal')) return;
    const index = (body as { index: number }).index;
    revealed.push(index);
    onEvent({ type: 'card', card: DEALT[index] });
    onEvent({ type: 'hint', index, text: `第 ${index + 1} 张的话。` });
  },
);

vi.mock('../../src/app/tarot/api', () => ({
  ApiError: class ApiError extends Error {},
  errorText: (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback,
  fetchReader: vi.fn(async () => ({ demo: false })),
  fetchReading: vi.fn(async () => ({ reading: drawn })),
  startReading: vi.fn(),
  createShare: vi.fn(),
  fetchReferral: vi.fn(async () => ({ referral: null, url: null })),
  fetchShare: vi.fn(),
  stopShuffle: vi.fn(),
  streamDiviner: (path: string, body: unknown, onEvent: (event: DivinerEvent) => void) =>
    streamDiviner(path, body, onEvent),
}));

// Imported after the mock is registered.
const { default: TarotApp } = await import('../../src/app/tarot/TarotApp');

const backs = (): HTMLButtonElement[] =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('.taro-fan-card'));

const spread = () => document.querySelector('.taro-fan');
const slots = () => document.querySelectorAll('.taro-slot');
const facesUp = () => document.querySelectorAll('.taro-slot.is-up');

/**
 * Walks the whole turn sequence to its end.
 *
 * One card per act() boundary: each card is only asked for by an effect that
 * re-arms after the previous turn's state has been committed, and inside a
 * single act() nothing commits until it closes. Six passes is twice what three
 * cards need.
 */
const letThemTurn = async () => {
  for (let pass = 0; pass < 6; pass += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
  }
};

beforeEach(() => {
  revealed.length = 0;
  streamDiviner.mockClear();
  localStorage.clear();
  localStorage.setItem('taro.readingId', 'r1');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('over the spread', () => {
  it('shows the deck and nothing else — no slots, no captions, nothing face up', async () => {
    render(<TarotApp />);
    await screen.findByRole('group', { name: /铺开的牌/ });

    expect(backs()).toHaveLength(78);
    // The three places do not exist yet. There is nothing to fill in.
    expect(slots()).toHaveLength(0);
    expect(screen.queryByText('背面朝上')).toBeNull();
    expect(screen.queryByText('此刻的处境')).toBeNull();
  });

  it('marks a touched back instead of turning it over', async () => {
    render(<TarotApp />);
    await screen.findByRole('group', { name: /铺开的牌/ });

    fireEvent.click(backs()[6]);

    expect(backs()[6].getAttribute('aria-pressed')).toBe('true');
    expect(backs()).toHaveLength(78);
    // Nothing was asked of the Worker, so nothing could have been learned.
    expect(streamDiviner).not.toHaveBeenCalled();
    expect(facesUp()).toHaveLength(0);
  });

  it('counts down, then stops taking a fourth', async () => {
    render(<TarotApp />);
    await screen.findByRole('group', { name: /铺开的牌/ });

    expect(screen.getByText('还要选 3 张')).toBeTruthy();
    fireEvent.click(backs()[3]);
    expect(screen.getByText('还要选 2 张')).toBeTruthy();
    fireEvent.click(backs()[10]);
    fireEvent.click(backs()[40]);

    fireEvent.click(backs()[55]);
    expect(backs()[55].getAttribute('aria-pressed')).toBe('false');
    expect(backs().filter((card) => card.getAttribute('aria-pressed') === 'true')).toHaveLength(3);
  });

  it('lets a mark be taken back off', async () => {
    render(<TarotApp />);
    await screen.findByRole('group', { name: /铺开的牌/ });

    fireEvent.click(backs()[3]);
    fireEvent.click(backs()[3]);

    expect(backs()[3].getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('还要选 3 张')).toBeTruthy();
  });

  it('will not let the picking close early', async () => {
    render(<TarotApp />);
    await screen.findByRole('group', { name: /铺开的牌/ });

    const confirm = screen.getByRole('button', { name: '就这三张' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.click(backs()[1]);
    fireEvent.click(backs()[2]);
    expect(confirm.disabled).toBe(true);

    fireEvent.click(backs()[3]);
    expect(confirm.disabled).toBe(false);
  });
});

describe('after the picking is closed', () => {
  const pickThree = async () => {
    render(<TarotApp />);
    await screen.findByRole('group', { name: /铺开的牌/ });
    fireEvent.click(backs()[1]);
    fireEvent.click(backs()[2]);
    fireEvent.click(backs()[3]);
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: '就这三张' }));
  };

  it('puts the spread away and shows only the three that were chosen', async () => {
    await pickThree();

    expect(spread()).toBeNull();
    expect(slots()).toHaveLength(3);

    await letThemTurn();
    // The deck does not come back once the choosing is over.
    expect(spread()).toBeNull();
  });

  it('turns them over one after the next, in the order of the spread', async () => {
    await pickThree();

    // The first card has not turned yet: there is a beat before it does.
    expect(facesUp()).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(revealed).toEqual([0]);
    expect(facesUp()).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(revealed).toEqual([0, 1]);
    expect(facesUp()).toHaveLength(2);

    await letThemTurn();
    expect(revealed).toEqual([0, 1, 2]);
    expect(facesUp()).toHaveLength(3);
  });

  it('asks for each card exactly once, however long the clock runs', async () => {
    await pickThree();
    await letThemTurn();
    // Well past the last card, with nothing left to turn.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(revealed).toEqual([0, 1, 2]);
  });

  it('offers the reading only once all three are up', async () => {
    await pickThree();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.queryByRole('button', { name: '聆听解读' })).toBeNull();

    await letThemTurn();
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByRole('button', { name: '聆听解读' })).toBeTruthy());
  });
});
