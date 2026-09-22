/**
 * @vitest-environment jsdom
 *
 * The shuffle now runs itself.
 *
 * There is no button on that screen any more, so the thing worth proving is that
 * the deck still stops — exactly once, without being asked — and that what comes
 * next is the spread rather than three waiting slots and another button.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadingView } from '../../src/shared/tarot/types';

const greeting: ReadingView = {
  readingId: 'r1',
  status: 'greeting',
  locale: 'zh',
  question: '要不要换一份工作？',
  greeting: '我听见的，不只是要不要离开。',
  cards: [],
  pending: 0,
  interpretation: null,
  followUps: [],
  demo: false,
  createdAt: '2026-08-20T00:00:00.000Z',
};

const drawn: ReadingView = { ...greeting, status: 'drawn', pending: 3 };

const stopShuffle = vi.fn(async (_id: string) => ({ reading: drawn }));

vi.mock('../../src/app/tarot/api', () => ({
  ApiError: class ApiError extends Error {},
  errorText: (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback,
  fetchReader: vi.fn(async () => ({ demo: false })),
  fetchReading: vi.fn(async () => ({ reading: greeting })),
  startReading: vi.fn(),
  createShare: vi.fn(),
  fetchReferral: vi.fn(async () => ({ referral: null, url: null })),
  fetchShare: vi.fn(),
  streamDiviner: vi.fn(async () => undefined),
  stopShuffle: (id: string) => stopShuffle(id),
}));

// Imported after the mock is registered.
const { default: TarotApp } = await import('../../src/app/tarot/TarotApp');

beforeEach(() => {
  stopShuffle.mockClear();
  localStorage.clear();
  localStorage.setItem('taro.readingId', 'r1');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the shuffle', () => {
  it('stops by itself and spreads the deck, with nothing to press', async () => {
    render(<TarotApp />);

    const start = await screen.findByRole('button', { name: '开始占卜' });
    vi.useFakeTimers();
    fireEvent.click(start);

    // The deck is in motion, and asks for nothing.
    expect(screen.getByText(/在心里重新想一遍你的问题/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /让牌停下|停下/ })).toBeNull();
    expect(stopShuffle).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    vi.useRealTimers();

    expect(stopShuffle).toHaveBeenCalledTimes(1);
    expect(stopShuffle).toHaveBeenCalledWith('r1');

    // What the visitor gets is the spread, not another button.
    const spread = await screen.findByRole('group', { name: /铺开的牌/ });
    expect(spread.querySelectorAll('button')).toHaveLength(78);
  });

  it('draws once even if the clock is generous', async () => {
    render(<TarotApp />);

    const start = await screen.findByRole('button', { name: '开始占卜' });
    vi.useFakeTimers();
    fireEvent.click(start);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    vi.useRealTimers();

    // A second commit would be a second spread. The Worker refuses it too, but
    // the browser should not be asking in the first place.
    await waitFor(() => expect(stopShuffle).toHaveBeenCalledTimes(1));
  });
});
