/**
 * @vitest-environment jsdom
 *
 * Deleting from the journal asks on the page.
 *
 * window.confirm is not shown by every in-app browser — it can silently answer
 * "no" — which left "clear all" a button that did nothing. The question is now
 * part of the page, and nothing is deleted until its own yes is pressed.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const entry = (readingId: string) => ({
  readingId,
  spreadId: 'current',
  createdAt: '2026-09-29T00:00:00.000Z',
  savedAt: '2026-09-29T00:00:00.000Z',
  cards: [
    { slot: 'situation', cardId: 'major-00', reversed: false },
    { slot: 'hidden', cardId: 'cups-03', reversed: true },
    { slot: 'guidance', cardId: 'swords-14', reversed: false },
  ],
  note: '',
  reviewDueAt: null,
  reviewNote: '',
  reviewedAt: null,
});

const clearJournal = vi.fn(async () => ({ ok: true }));
const deleteJournalEntry = vi.fn(async (_id: string) => ({ ok: true }));

vi.mock('../../src/app/tarot/api', () => ({
  ApiError: class ApiError extends Error {},
  errorText: (_error: unknown, fallback: string) => fallback,
  fetchJournal: vi.fn(async () => ({ entries: [entry('r1'), entry('r2')] })),
  saveJournalReview: vi.fn(),
  clearJournal: () => clearJournal(),
  deleteJournalEntry: (id: string) => deleteJournalEntry(id),
}));

const { default: JournalPage } = await import('../../src/app/tarot/JournalPage');

let confirmSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('taro.locale', 'zh');
  clearJournal.mockClear();
  deleteJournalEntry.mockClear();
  // The in-app browser case: a confirm that never says yes.
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  confirmSpy.mockRestore();
});

describe('clearing the whole journal', () => {
  it('asks on the page, deletes nothing until the yes, and never opens a native dialog', async () => {
    render(<JournalPage />);
    fireEvent.click(await screen.findByRole('button', { name: '清除全部记录' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/这会删除这个浏览器的所有阅读/)).toBeTruthy();
    expect(clearJournal).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(clearJournal).toHaveBeenCalledTimes(1));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('cancels without deleting', async () => {
    render(<JournalPage />);
    fireEvent.click(await screen.findByRole('button', { name: '清除全部记录' }));
    fireEvent.click(await screen.findByRole('button', { name: '取消' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(clearJournal).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '清除全部记录' })).toBeTruthy();
  });
});

describe('deleting one reading', () => {
  it('asks under that reading, and deletes only it', async () => {
    render(<JournalPage />);
    const deletes = await screen.findAllByRole('button', { name: '删除这笔阅读' });
    fireEvent.click(deletes[0]!);

    expect(deleteJournalEntry).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(deleteJournalEntry).toHaveBeenCalledWith('r1'));
    expect(deleteJournalEntry).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
