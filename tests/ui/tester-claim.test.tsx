/**
 * @vitest-environment jsdom
 *
 * Arriving with the test token in the fragment.
 *
 * The token must leave the address bar as soon as the page has read it, and be
 * sent exactly once, after the load requests have settled so it lands on the
 * session the browser keeps.
 */

import { cleanup, render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const redeemTesterToken = vi.fn<(token: string) => Promise<{ tester: boolean; expiresAt: string }>>();
const fetchAccess = vi.fn(async () => ({
  freeUsed: true,
  credits: 0,
  canRead: false,
  dailyExtraUsed: false,
  stickBonusAvailable: false,
  inviteReadingId: null,
  tester: false,
}));

vi.mock('../../src/app/tarot/api', () => ({
  fetchJournal: vi.fn(async () => ({ entries: [] })),
  saveJournal: vi.fn(),
  ApiError: class ApiError extends Error {},
  errorText: (_error: unknown, fallback: string) => fallback,
  fetchAccess: () => fetchAccess(),
  fetchReader: vi.fn(async () => ({
    demo: false,
    consentRequired: false,
    fortuneStickUrl: 'https://app.manyfold.ai/fortune-stick/',
  })),
  fetchReading: vi.fn(),
  redeemStickBonus: vi.fn(),
  redeemTesterToken: (token: string) => redeemTesterToken(token),
  startReading: vi.fn(),
  createShare: vi.fn(),
  createReferral: vi.fn(),
  fetchReferral: vi.fn(async () => ({ referral: null, url: null })),
  fetchShare: vi.fn(),
  stopShuffle: vi.fn(),
  streamDiviner: vi.fn(async () => undefined),
}));

const { default: TarotApp } = await import('../../src/app/tarot/TarotApp');

beforeEach(() => {
  localStorage.clear();
  redeemTesterToken.mockReset();
  redeemTesterToken.mockResolvedValue({ tester: true, expiresAt: '2026-10-29T00:00:00.000Z' });
  history.replaceState(null, '', '/tarot/#tester=abc/def+ghi=');
});

afterEach(() => {
  cleanup();
  history.replaceState(null, '', '/');
});

describe('the test token in the fragment', () => {
  it('leaves the address bar and is sent once, intact', async () => {
    render(
      <StrictMode>
        <TarotApp />
      </StrictMode>,
    );
    await waitFor(() => expect(redeemTesterToken).toHaveBeenCalled());
    expect(location.hash).toBe('');
    expect(redeemTesterToken).toHaveBeenCalledTimes(1);
    // A base64 token has "/", "+" and a trailing "=": all three must survive.
    expect(redeemTesterToken).toHaveBeenCalledWith('abc/def+ghi=');
  });
});
