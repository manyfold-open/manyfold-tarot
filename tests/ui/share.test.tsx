/**
 * @vitest-environment jsdom
 *
 * One press to share.
 *
 * The rule this file exists to hold: pressing the share button once mints the
 * link, sends the question with it, and puts the link on the clipboard. There is
 * no panel to open first, no box to tick, and no second press required — the two
 * steps that used to stand between "I want to share this" and "the link is on my
 * clipboard" are gone, and this is where they stay gone.
 *
 * The second rule is quieter and matters more: pressing again does not mint a
 * second link. A public snapshot is a row in a table and a URL somebody may keep;
 * a button that writes a new one every time it is pressed leaves a trail of them
 * behind whenever a person is unsure whether the first press registered.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadingView } from '../../src/shared/tarot/types';

const reading: ReadingView = {
  readingId: 'r1',
  status: 'interpreted',
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

/** Every createShare call, so both the count and the flag can be asserted. */
const minted: Array<{ id: string; includeQuestion: boolean }> = [];
let mintFails = false;

const createShare = vi.fn(async (id: string, includeQuestion: boolean) => {
  if (mintFails) throw new Error('牌一时没有回应。');
  minted.push({ id, includeQuestion });
  return { share: {}, url: `https://example.test/s/tok${minted.length}` };
});

vi.mock('../../src/app/tarot/api', () => ({
  ApiError: class ApiError extends Error {},
  errorText: (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback,
  createShare: (id: string, includeQuestion: boolean) => createShare(id, includeQuestion),
}));

// Imported after the mock is registered.
const { default: ShareBox } = await import('../../src/app/tarot/ShareBox');

const written: string[] = [];
let clipboardFails = false;

const button = (): HTMLButtonElement =>
  document.querySelector('.taro-share .taro-primary') as HTMLButtonElement;

const urlField = (): HTMLInputElement | null =>
  document.querySelector('.taro-share-url') as HTMLInputElement | null;

beforeEach(() => {
  minted.length = 0;
  written.length = 0;
  mintFails = false;
  clipboardFails = false;
  createShare.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: vi.fn(async (text: string) => {
        if (clipboardFails) throw new Error('denied');
        written.push(text);
      }),
    },
  });
});

afterEach(() => {
  cleanup();
});

describe('the share button', () => {
  it('is one press: no panel, no checkbox, nothing to open first', () => {
    render(<ShareBox reading={reading} locale="zh" />);

    expect(button()).toBeTruthy();
    expect(button().textContent).toBe('分享这次解读');
    // The two things that used to stand in the way.
    expect(document.querySelector('.taro-check')).toBeNull();
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('mints the link with the question in it and copies it, on that one press', async () => {
    render(<ShareBox reading={reading} locale="zh" />);
    fireEvent.click(button());

    await waitFor(() => expect(written).toHaveLength(1));

    expect(minted).toEqual([{ id: 'r1', includeQuestion: true }]);
    expect(written[0]).toBe('https://example.test/s/tok1');
    await screen.findByText('已复制');
  });

  it('re-copies the link it already has rather than minting a second one', async () => {
    render(<ShareBox reading={reading} locale="zh" />);

    fireEvent.click(button());
    await waitFor(() => expect(written).toHaveLength(1));
    await waitFor(() => expect(button().textContent).toBe('已复制'));

    fireEvent.click(button());
    await waitFor(() => expect(written).toHaveLength(2));

    // Copied twice, minted once, and the same URL both times.
    expect(createShare).toHaveBeenCalledTimes(1);
    expect(written[1]).toBe(written[0]);
  });

  it('shows the link so it can still be taken by hand when the clipboard says no', async () => {
    clipboardFails = true;
    render(<ShareBox reading={reading} locale="zh" />);
    fireEvent.click(button());

    await waitFor(() => expect(urlField()?.value).toBe('https://example.test/s/tok1'));

    // A refused clipboard is not a failed share, and must not be reported as one.
    expect(document.querySelector('.taro-error')).toBeNull();
    expect(button().textContent).toBe('复制链接');
  });

  it('reports a share that genuinely failed, and mints nothing', async () => {
    mintFails = true;
    render(<ShareBox reading={reading} locale="zh" />);
    fireEvent.click(button());

    await screen.findByText('牌一时没有回应。');
    expect(minted).toHaveLength(0);
    expect(urlField()).toBeNull();
  });

  it('drops the last round’s link when a new round arrives', async () => {
    const { rerender } = render(<ShareBox reading={reading} locale="zh" />);
    fireEvent.click(button());
    await waitFor(() => expect(urlField()).toBeTruthy());

    rerender(<ShareBox reading={{ ...reading, readingId: 'r2' }} locale="zh" />);

    // Nothing from the previous round is on screen or one press from being sent.
    await waitFor(() => expect(urlField()).toBeNull());
    expect(button().textContent).toBe('分享这次解读');
  });
});
