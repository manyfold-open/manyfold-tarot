/**
 * @vitest-environment jsdom
 *
 * The journal card at the end of a reading: pick when to look back, save in
 * one press. The note is optional and stays folded until asked for.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadingView } from '../../src/shared/tarot/types';

const reading = {
  readingId: 'r1',
  status: 'interpreted',
  locale: 'zh',
  question: '这周该专注什么？',
  greeting: '',
  cards: [],
  pending: 0,
  interpretation: null,
  followUps: [],
  demo: false,
  createdAt: '2026-09-29T00:00:00.000Z',
} as unknown as ReadingView;

let entries: Array<{ readingId: string; note: string; reviewDueAt: string | null }> = [];
const saveJournal = vi.fn(async (_id: string, _body: { note: string; reviewDueAt: string }) => ({ entry: {} }));

vi.mock('../../src/app/tarot/api', () => ({
  errorText: (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback),
  fetchJournal: async () => ({ entries }),
  saveJournal: (id: string, body: { note: string; reviewDueAt: string }) => saveJournal(id, body),
}));

const { default: JournalPanel } = await import('../../src/app/tarot/JournalPanel');

const localDateAfter = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const dueIn = (days: number) => new Date(`${localDateAfter(days)}T12:00:00`).toISOString();
const chip = (label: string) => screen.getByRole('radio', { name: label });

beforeEach(() => {
  entries = [];
  saveJournal.mockClear();
});
afterEach(() => cleanup());

describe('the journal card', () => {
  it('saves with the review date chosen on the card, in one press', async () => {
    render(<JournalPanel reading={reading} locale="zh" />);

    expect(screen.getByText('存进日志，之后回来看')).toBeTruthy();
    expect(chip('1 周').getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('textarea')).toBeNull();

    fireEvent.click(chip('2 周'));
    fireEvent.click(screen.getByRole('button', { name: '存下' }));

    await waitFor(() => expect(saveJournal).toHaveBeenCalledTimes(1));
    expect(saveJournal).toHaveBeenCalledWith('r1', { note: '', reviewDueAt: dueIn(14) });
    await screen.findByText('已存入日志');
    expect(document.querySelector('.taro-journal-card.is-saved')).toBeTruthy();
  });

  it('keeps the note folded until asked, and saves it when written', async () => {
    render(<JournalPanel reading={reading} locale="zh" />);
    fireEvent.click(screen.getByRole('button', { name: '存下' }));
    await screen.findByText('已存入日志');

    // Nothing changed yet: no second save button waiting.
    expect(screen.queryByRole('button', { name: '保存笔记' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '加一句笔记（选填）' }));
    const box = document.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '先把两件事做完' } });
    fireEvent.click(screen.getByRole('button', { name: '保存笔记' }));

    await waitFor(() => expect(saveJournal).toHaveBeenCalledTimes(2));
    expect(saveJournal).toHaveBeenLastCalledWith('r1', { note: '先把两件事做完', reviewDueAt: dueIn(7) });
  });

  it('opens already saved, with its date and note, for a reading in the journal', async () => {
    entries = [{ readingId: 'r1', note: '旧笔记', reviewDueAt: dueIn(30) }];
    render(<JournalPanel reading={reading} locale="zh" />);

    await screen.findByText('已存入日志');
    expect(chip('1 个月').getAttribute('aria-checked')).toBe('true');
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('旧笔记');
    expect(screen.queryByRole('button', { name: '存下' })).toBeNull();
  });
});
