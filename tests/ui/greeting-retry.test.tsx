/**
 * @vitest-environment jsdom
 *
 * The reader does not answer the opening line.
 *
 * The visitor has already spent their reading, so the page must not leave them
 * staring at a waiting line: it says so in its own words, never the agent
 * platform's, and offers the retry on the same round.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DivinerEvent, ReadingView } from '../../src/shared/tarot/types';

const silent: ReadingView = {
  readingId: 'r1',
  status: 'greeting',
  locale: 'zh',
  question: '我最近的工作状况要往哪里走？',
  greeting: '',
  cards: [],
  pending: 0,
  interpretation: null,
  followUps: [],
  demo: false,
  createdAt: '2026-08-20T00:00:00.000Z',
};

const PLATFORM_MESSAGE = 'active hours quota reached (200h included for Pro plan this billing period)';

const streamDiviner = vi.fn(
  async (_path: string, _body: unknown, _onEvent: (event: DivinerEvent) => void) => undefined,
);

vi.mock('../../src/app/tarot/api', () => ({
  fetchJournal: vi.fn(async () => ({ entries: [] })),
  saveJournal: vi.fn(),
  ApiError: class ApiError extends Error {},
  errorText: (_error: unknown, fallback: string) => fallback,
  fetchAccess: vi.fn(async () => ({ freeUsed: true, credits: 0, canRead: false, inviteReadingId: null })),
  fetchReader: vi.fn(async () => ({ demo: false })),
  fetchReading: vi.fn(async () => ({ reading: silent })),
  startReading: vi.fn(),
  createShare: vi.fn(),
  fetchReferral: vi.fn(async () => ({ referral: null, url: null })),
  fetchShare: vi.fn(),
  stopShuffle: vi.fn(),
  streamDiviner: (path: string, body: unknown, onEvent: (event: DivinerEvent) => void) =>
    streamDiviner(path, body, onEvent),
}));

const { default: TarotApp } = await import('../../src/app/tarot/TarotApp');

beforeEach(() => {
  streamDiviner.mockReset();
  localStorage.clear();
  localStorage.setItem('taro.readingId', 'r1');
});

afterEach(() => cleanup());

describe('a greeting that fails', () => {
  it('shows the site’s own words, then retries the same round', async () => {
    streamDiviner.mockImplementationOnce(async (_path, _body, onEvent) => {
      onEvent({ type: 'error', code: 'reader_unavailable', message: PLATFORM_MESSAGE });
    });
    streamDiviner.mockImplementationOnce(async (_path, _body, onEvent) => {
      onEvent({ type: 'greeting', text: '我听见了。' });
    });

    render(<TarotApp />);

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '牌一时没有回应。稍后再试一次。');
    expect(document.body.textContent).not.toMatch(/quota|Pro plan/);

    fireEvent.click(await screen.findByRole('button', { name: '再试一次' }));

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(streamDiviner).toHaveBeenCalledTimes(2);
    expect(streamDiviner.mock.calls[1]?.[0]).toBe('/api/tarot/readings/r1/greeting');
    expect((await screen.findByRole('button', { name: '开始占卜' })) as HTMLButtonElement).toHaveProperty('disabled', false);
  });
});
