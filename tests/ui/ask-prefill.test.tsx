/**
 * @vitest-environment jsdom
 *
 * The question box starts from a real question.
 *
 * Choosing a spread puts that spread's example in the box, so a first-time
 * visitor edits a question instead of facing a blank line. The example is the
 * page's until the visitor types: after that, choosing another spread changes
 * the lens and leaves their words alone. Arriving from the daily card brings the
 * day along, named over the question and sent as a date — never as a card.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const startReading = vi.fn((_body: Record<string, unknown>) => new Promise(() => undefined));
const fetchDailyCard = vi.fn(async (_locale: string, date: string) => ({
  date,
  cardId: 'swords-14',
  reversed: true,
  reflection: 'r',
  keywords: 'k',
}));

vi.mock('../../src/app/tarot/api', () => ({
  fetchJournal: vi.fn(async () => ({ entries: [] })),
  saveJournal: vi.fn(),
  ApiError: class ApiError extends Error {},
  errorText: (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback,
  fetchAccess: vi.fn(async () => ({ freeUsed: false, credits: 0, canRead: true, inviteReadingId: null })),
  fetchReader: vi.fn(async () => ({ demo: false })),
  fetchReading: vi.fn(),
  fetchDailyCard: (locale: string, date: string) => fetchDailyCard(locale, date),
  startReading: (body: Record<string, unknown>) => startReading(body),
  createShare: vi.fn(),
  createReferral: vi.fn(),
  fetchReferral: vi.fn(),
  fetchShare: vi.fn(),
  stopShuffle: vi.fn(),
  streamDiviner: vi.fn(async () => undefined),
}));

const { default: TarotApp } = await import('../../src/app/tarot/TarotApp');

// Found by its class: its accessible name is the page title, which changes with the language.
const box = () => document.querySelector('.taro-ask-input') as HTMLTextAreaElement;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('taro.locale', 'en');
  history.replaceState(null, '', '/');
  startReading.mockClear();
  fetchDailyCard.mockClear();
  // jsdom has no matchMedia; a desktop pointer is the case that moves focus.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => ({ matches: false }),
  });
});

afterEach(() => {
  cleanup();
});

describe('choosing a spread', () => {
  it('fills an empty box with that spread’s example', () => {
    render(<TarotApp />);
    expect(box().value).toBe('');
    expect(box().placeholder).toBe('Where do things really stand with my work right now, and what am I not seeing?');

    fireEvent.click(screen.getByLabelText('Make a decision'));
    expect(box().value).toBe('Should I take the new job offer, or stay where I am?');
  });

  it('swaps an untouched example for the next spread’s', () => {
    render(<TarotApp />);
    fireEvent.click(screen.getByLabelText('Make a decision'));
    fireEvent.click(screen.getByLabelText('Reflect on the next step'));
    expect(box().value).toBe('I want to start a side project of my own. Where should the first step be?');
  });

  it('never writes over a question the visitor has typed', () => {
    render(<TarotApp />);
    fireEvent.click(screen.getByLabelText('Make a decision'));
    fireEvent.change(box(), { target: { value: 'Should I move to Lisbon?' } });
    fireEvent.click(screen.getByLabelText('Weekly review'));
    expect(box().value).toBe('Should I move to Lisbon?');
  });

  it('rewrites an untouched example in the new language', async () => {
    render(<TarotApp />);
    fireEvent.click(screen.getByLabelText('Make a decision'));
    fireEvent.click(screen.getByRole('button', { name: '中文' }));
    await waitFor(() => expect(box().value).toBe('我该接受新的工作机会，还是留在现在的公司？'));
  });
});

describe('arriving from the daily card', () => {
  it('names today’s card over the question and sends only its date', async () => {
    history.replaceState(null, '', '/?spread=next-step&prompt=daily&daily=2026-10-07');
    render(<TarotApp />);

    expect(box().value).toBe('What small thing deserves a little more of my attention today?');
    expect(await screen.findByText('Bringing today’s card: King of Swords · Reversed')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Begin' }));
    await waitFor(() => expect(startReading).toHaveBeenCalledTimes(1));
    const body = startReading.mock.calls[0][0];
    expect(body.dailyDate).toBe('2026-10-07');
    expect(body.spreadId).toBe('next-step');
    expect(body).not.toHaveProperty('cardId');
  });

  it('leaves the card out once the visitor sets it aside', async () => {
    history.replaceState(null, '', '/?spread=next-step&prompt=daily&daily=2026-10-07');
    render(<TarotApp />);

    fireEvent.click(await screen.findByRole('button', { name: 'Leave today’s card out' }));
    expect(screen.queryByText(/Bringing today’s card/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Begin' }));
    await waitFor(() => expect(startReading).toHaveBeenCalledTimes(1));
    expect(startReading.mock.calls[0][0].dailyDate).toBeUndefined();
  });
});
