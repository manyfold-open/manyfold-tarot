/**
 * @vitest-environment jsdom
 *
 * One press to share, with the choices already on the page.
 *
 * The rule this file exists to hold: pressing the share button once mints the
 * link and puts it on the clipboard. What is shared (one card, the summary, the
 * full reading) is chosen by options that are always visible — there is no panel
 * to open first and no second press required. The question is NOT sent unless
 * the person ticked the box: private by default.
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

const createShare = vi.fn(async (id: string, options: { includeQuestion: boolean }) => {
  if (mintFails) throw new Error('牌一时没有回应。');
  minted.push({ id, includeQuestion: options.includeQuestion });
  return { share: {}, url: `https://example.test/s/tok${minted.length}` };
});

vi.mock('../../src/app/tarot/api', () => ({
  ApiError: class ApiError extends Error {},
  errorText: (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback,
  createShare: (id: string, options: { includeQuestion: boolean }) => createShare(id, options),
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
  it('is one press: the options are already on the page, and the question is off', () => {
    render(<ShareBox reading={reading} locale="zh" />);

    expect(button()).toBeTruthy();
    expect(button().textContent).toBe('分享这次解读');
    // Three things to share, the summary chosen; nothing to open first.
    const modes = document.querySelectorAll('.taro-share-options input[type="radio"]');
    expect(modes).toHaveLength(3);
    expect((modes[1] as HTMLInputElement).checked).toBe(true);
    // The question is private until somebody ticks the box.
    const question = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(question.checked).toBe(false);
  });

  it('mints the link without the question and copies it, on that one press', async () => {
    render(<ShareBox reading={reading} locale="zh" />);
    fireEvent.click(button());

    await waitFor(() => expect(written).toHaveLength(1));

    expect(minted).toEqual([{ id: 'r1', includeQuestion: false }]);
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

describe('the share panel at the end of a reading', () => {
  it('renders nothing while folded, and keeps its link across fold and unfold', async () => {
    const { rerender } = render(<ShareBox reading={reading} locale="zh" open={false} />);
    expect(document.querySelector('.taro-share')).toBeNull();

    rerender(<ShareBox reading={reading} locale="zh" open />);
    fireEvent.click(button());
    await waitFor(() => expect(urlField()?.value).toBe('https://example.test/s/tok1'));

    rerender(<ShareBox reading={reading} locale="zh" open={false} />);
    expect(document.querySelector('.taro-share')).toBeNull();
    rerender(<ShareBox reading={reading} locale="zh" open />);
    expect(urlField()?.value).toBe('https://example.test/s/tok1');
    expect(createShare).toHaveBeenCalledTimes(1);
  });
});
