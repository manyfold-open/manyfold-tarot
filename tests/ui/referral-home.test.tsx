/**
 * @vitest-environment jsdom
 *
 * Coming back with nothing left to spend.
 *
 * The visitor who has used their reading lands on the question box again, and
 * the invite that would unlock the next one used to live only under a reading
 * they had already left. The home page itself has to be where that link is.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
  // The Stick is the way on from here, in place of the invite.
  it('with only the free reading spent, sends to the Stick to unlock one more', async () => {
    fetchAccess.mockResolvedValue({
      freeUsed: true,
      credits: 0,
      canRead: false,
      dailyExtraUsed: false,
      stickBonusAvailable: false,
      inviteReadingId: 'r1',
    });

    render(<TarotApp />);

    expect(await screen.findByRole('heading', { name: "Today's free reading is used." })).toBeTruthy();
    expect(screen.getByText('Draw a stick and you can ask Tarot one more question today.')).toBeTruthy();
    const stick = screen.getByRole('link', { name: 'Draw a stick for today' });
    expect(stick.getAttribute('target')).toBe('_blank');
    expect(new URL(stick.getAttribute('href')!).searchParams.get('utm_content')).toBe('locked');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Invite a friend to play one more' })).toBeNull();
  });

  it('once the extra is spent too, offers the Stick without promising another reading', async () => {
    fetchAccess.mockResolvedValue({
      freeUsed: true,
      credits: 0,
      canRead: false,
      dailyExtraUsed: true,
      stickBonusAvailable: false,
      inviteReadingId: 'r1',
    });

    render(<TarotApp />);

    expect(
      await screen.findByRole('heading', {
        name: "Today's free and extra readings are used. Come back tomorrow.",
      }),
    ).toBeTruthy();
    expect(screen.getByText('Draw a stick to see what it says. Tarot opens again tomorrow.')).toBeTruthy();
    expect(screen.queryByText('Draw a stick and you can ask Tarot one more question today.')).toBeNull();
    expect(screen.getByRole('link', { name: 'Draw a stick for today' })).toBeTruthy();
  });

  it('gives the box back when an invite reward is waiting', async () => {
    fetchAccess.mockResolvedValue({
      freeUsed: true,
      credits: 1,
      canRead: true,
      dailyExtraUsed: false,
      stickBonusAvailable: false,
      inviteReadingId: null,
    });

    render(<TarotApp />);

    await waitFor(() => expect(screen.getByRole('textbox')).toBeTruthy());
    expect(createReferral).not.toHaveBeenCalled();
  });
});

describe('the end of a round', () => {
  beforeEach(() => {
    localStorage.setItem('taro.readingId', 'r1');
    fetchReferral.mockResolvedValue({ referral: null, url: null });
  });

  it('puts the Stick beside Share, in a new tab, instead of the invite', async () => {
    fetchAccess.mockResolvedValue({
      freeUsed: true,
      credits: 0,
      canRead: false,
      dailyExtraUsed: false,
      stickBonusAvailable: false,
      inviteReadingId: 'r1',
    });

    render(<TarotApp />);

    const stick = await screen.findByRole('link', { name: 'Draw a stick for today' });
    expect(stick.getAttribute('target')).toBe('_blank');
    expect(stick.getAttribute('rel')).toContain('noopener');
    const href = new URL(stick.getAttribute('href')!);
    expect(href.searchParams.get('utm_content')).toBe('outro');
    expect(href.searchParams.get('tarot_return')).toBe(`${location.origin}/`);
    expect(screen.getByText('Draw a stick, then ask Tarot one more question today.')).toBeTruthy();
    // The invite lives on the home page now, not at the end of a round.
    expect(screen.queryByRole('button', { name: 'Invite a friend to play one more' })).toBeNull();
    expect(screen.queryByText('Want to ask again?')).toBeNull();
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
