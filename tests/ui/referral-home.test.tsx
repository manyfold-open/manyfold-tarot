/**
 * @vitest-environment jsdom
 *
 * Coming back with nothing left to spend.
 *
 * The visitor who has used their reading lands on the question box again, and
 * the invite that would unlock the next one used to live only under a reading
 * they had already left. The home page itself has to be where that link is.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadingView } from '../../src/shared/tarot/types';

const finished: ReadingView = {
  readingId: 'r1',
  status: 'interpreted',
  locale: 'en',
  question: 'Should I change jobs?',
  greeting: 'I hear it.',
  cards: [
    { slot: 'situation', index: 0, cardId: 'major-00', reversed: false, hint: '' },
    { slot: 'hidden', index: 1, cardId: 'cups-03', reversed: true, hint: '' },
    { slot: 'guidance', index: 2, cardId: 'swords-14', reversed: false, hint: '' },
  ],
  pending: 0,
  interpretation: {
    conclusion: 'Not yet.',
    overview: 'o',
    perCard: [],
    connections: 'c',
    response: 'r',
    actions: ['a'],
    reflection: 'q',
    closing: 'x',
  },
  followUps: [],
  demo: false,
  createdAt: '2026-08-20T00:00:00.000Z',
};

type Access = {
  freeUsed: boolean;
  credits: number;
  canRead: boolean;
  dailyExtraUsed?: boolean;
  stickBonusAvailable?: boolean;
  inviteReadingId: string | null;
};
type Referral = {
  referral: { token: string; status: 'pending' | 'completed' | 'expired'; expiresAt: string } | null;
  url: string | null;
};

const LINK = 'https://tarot.example/?ref=tok';
const pending = {
  referral: { token: 'tok', status: 'pending' as const, expiresAt: '2099-01-01T00:00:00.000Z' },
  url: LINK,
};

const fetchAccess = vi.fn<() => Promise<Access>>();
const fetchReferral = vi.fn<(id: string) => Promise<Referral>>();
const createReferral = vi.fn(async (_id: string) => pending);

vi.mock('../../src/app/tarot/api', () => ({
  ApiError: class ApiError extends Error {},
  errorText: (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback,
  fetchAccess: () => fetchAccess(),
  fetchReader: vi.fn(async () => ({ demo: false })),
  fetchReading: vi.fn(async () => ({ reading: finished })),
  startReading: vi.fn(),
  createShare: vi.fn(),
  createReferral: (id: string) => createReferral(id),
  fetchReferral: (id: string) => fetchReferral(id),
  fetchShare: vi.fn(),
  stopShuffle: vi.fn(),
  streamDiviner: vi.fn(async () => undefined),
}));

const { default: TarotApp } = await import('../../src/app/tarot/TarotApp');

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('taro.locale', 'en');
  fetchAccess.mockReset();
  fetchReferral.mockReset();
  createReferral.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('the home page with no reading left', () => {
  it('offers the invite in place of the question box', async () => {
    fetchAccess.mockResolvedValue({
      freeUsed: true,
      credits: 0,
      canRead: false,
      inviteReadingId: 'r1',
    });
    fetchReferral.mockResolvedValue({ referral: null, url: null });

    render(<TarotApp />);

    expect(
      await screen.findByRole('heading', {
        name: "Today's free and extra readings are used. Come back tomorrow.",
      }),
    ).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Invite a friend to play one more' }));
    await waitFor(() => expect(createReferral).toHaveBeenCalledWith('r1'));
    expect(((await screen.findByDisplayValue(LINK)) as HTMLInputElement).value).toBe(LINK);
  });

  it('shows the link that is already out, and gives the box back once it completes', async () => {
    fetchAccess
      .mockResolvedValueOnce({ freeUsed: true, credits: 0, canRead: false, inviteReadingId: 'r1' })
      .mockResolvedValue({ freeUsed: true, credits: 1, canRead: true, inviteReadingId: null });
    fetchReferral.mockResolvedValue({
      referral: { ...pending.referral, status: 'completed' },
      url: LINK,
    });

    render(<TarotApp />);

    expect(
      await screen.findByText('Your friend finished — one more reading is unlocked.'),
    ).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('textbox')).toBeTruthy());
    expect(createReferral).not.toHaveBeenCalled();
  });

  it('says what to do when there is no finished reading to invite from', async () => {
    fetchAccess.mockResolvedValue({
      freeUsed: true,
      credits: 0,
      canRead: false,
      inviteReadingId: null,
    });

    render(<TarotApp />);

    expect(await screen.findByText(/Finish a reading first/)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('the end of a round', () => {
  beforeEach(() => {
    localStorage.setItem('taro.readingId', 'r1');
    fetchReferral.mockResolvedValue({ referral: null, url: null });
  });

  it('invites the way Share shares: one button, the link, then the wait', async () => {
    fetchAccess.mockResolvedValue({
      freeUsed: true,
      credits: 0,
      canRead: false,
      inviteReadingId: 'r1',
    });

    render(<TarotApp />);

    const invite = await screen.findByRole('button', { name: 'Invite a friend to play one more' });
    expect(screen.queryByText('Want to ask again?')).toBeNull();
    fireEvent.click(invite);

    await waitFor(() => expect(createReferral).toHaveBeenCalledWith('r1'));
    expect(await screen.findByDisplayValue(LINK)).toBeTruthy();
    expect(
      screen.getByText('Waiting for your friend, then this will update when they finish.'),
    ).toBeTruthy();
  });

  it('only promises another question when there is one to ask', async () => {
    fetchAccess.mockResolvedValue({
      freeUsed: true,
      credits: 0,
      canRead: false,
      inviteReadingId: 'r1',
    });
    render(<TarotApp />);
    expect(await screen.findByRole('button', { name: 'Back to the home page' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ask about something else' })).toBeNull();
  });

  it('offers another question once a friend has unlocked one', async () => {
    fetchAccess.mockResolvedValue({
      freeUsed: true,
      credits: 1,
      canRead: true,
      inviteReadingId: null,
    });
    render(<TarotApp />);
    expect(await screen.findByRole('button', { name: 'Ask about something else' })).toBeTruthy();
  });
});
