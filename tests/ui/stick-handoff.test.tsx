/**
 * @vitest-environment jsdom
 *
 * Arriving from the Fortune Stick with a reward in the fragment.
 *
 * The fragment is cleared as soon as the page reads it, so whatever happens to
 * the reward has to be said on the page: silence would leave a visitor waiting
 * for a reading that is never coming.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const redeemStickBonus = vi.fn<(token: string) => Promise<{ status: string }>>();
const fetchAccess = vi.fn(async () => ({
  freeUsed: false,
  credits: 0,
  canRead: true,
  dailyExtraUsed: false,
  stickBonusAvailable: false,
  inviteReadingId: null,
}));

vi.mock('../../src/app/tarot/api', () => ({
  ApiError: class ApiError extends Error {},
  errorText: (_error: unknown, fallback: string) => fallback,
  fetchAccess: () => fetchAccess(),
  fetchReader: vi.fn(async () => ({
    demo: false,
    consentRequired: false,
    fortuneStickUrl: 'https://app.manyfold.ai/fortune-stick/',
  })),
  fetchReading: vi.fn(),
  redeemStickBonus: (token: string) => redeemStickBonus(token),
  startReading: vi.fn(),
  createShare: vi.fn(),
  createReferral: vi.fn(),
  fetchReferral: vi.fn(async () => ({ referral: null, url: null })),
  fetchShare: vi.fn(),
  stopShuffle: vi.fn(),
  streamDiviner: vi.fn(async () => undefined),
}));

const { default: TarotApp } = await import('../../src/app/tarot/TarotApp');

const arriveFromStick = () =>
  history.replaceState(
    null,
    '',
    '/tarot/?utm_source=fortune-stick&utm_medium=referral#lang=en&bonus=claim.sig',
  );

beforeEach(() => {
  localStorage.clear();
  redeemStickBonus.mockReset();
  arriveFromStick();
});

afterEach(() => {
  cleanup();
  history.replaceState(null, '', '/');
});

describe('a reward from the Fortune Stick', () => {
  it('takes the claim out of the address bar and saves it', async () => {
    redeemStickBonus.mockResolvedValue({ status: 'granted' });
    render(<TarotApp />);
    await waitFor(() => expect(redeemStickBonus).toHaveBeenCalledWith('claim.sig'));
    expect(location.hash).toBe('');
    expect(
      await screen.findByText(
        'Your Stick reward is saved. After today’s free reading, you can ask one more question.',
      ),
    ).toBeTruthy();
  });

  it.each([
    ['expired', 'That stick’s reward was only good on the day it was drawn, and it has expired.'],
    ['daily_limit', 'Today’s extra reading has already been claimed or used. Come back tomorrow.'],
    ['unavailable', 'This reward link cannot be used here. It may have been claimed in another browser. Open Tarot again from your stick.'],
    ['invalid', 'This reward link cannot be used here. It may have been claimed in another browser. Open Tarot again from your stick.'],
  ])('says why a %s claim was not saved', async (status, line) => {
    redeemStickBonus.mockResolvedValue({ status });
    render(<TarotApp />);
    expect(await screen.findByText(line)).toBeTruthy();
  });

  it('offers a retry when saving failed, with the claim kept in memory', async () => {
    redeemStickBonus.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ status: 'granted' });
    render(<TarotApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(redeemStickBonus).toHaveBeenCalledTimes(2));
    expect(redeemStickBonus).toHaveBeenLastCalledWith('claim.sig');
    expect(
      await screen.findByText(
        'Your Stick reward is saved. After today’s free reading, you can ask one more question.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});
