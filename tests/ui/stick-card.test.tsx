/**
 * @vitest-environment jsdom
 *
 * The one filled button at the end of a reading. It only promises another
 * Tarot question when a stick would actually unlock one.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StickCard from '../../src/app/tarot/StickCard';

afterEach(() => cleanup());

const link = () => document.querySelector('.taro-stick-card a.taro-stick-go') as HTMLAnchorElement;

describe('StickCard', () => {
  it('promises another reading only when a stick would unlock one', () => {
    const { rerender } = render(<StickCard href="https://stick.test/?from=outro" offer locale="zh" />);
    expect(document.querySelector('.taro-stick-card')?.textContent).toContain('抽完一支签，今天还可以再问一次塔罗。');

    rerender(<StickCard href="https://stick.test/?from=outro" offer={false} locale="zh" />);
    const text = document.querySelector('.taro-stick-card')?.textContent ?? '';
    expect(text).toContain('也可以来求一支签，看看今天的提示。');
    expect(text).not.toContain('再问一次塔罗');
  });

  it('opens the Stick in a new tab and reports the click', () => {
    const onOpen = vi.fn();
    render(<StickCard href="https://stick.test/?from=outro" offer locale="en" onOpen={onOpen} />);
    expect(link().getAttribute('href')).toBe('https://stick.test/?from=outro');
    expect(link().getAttribute('target')).toBe('_blank');
    expect(link().getAttribute('aria-label')).toBe('Draw a stick for today');
    expect(link().textContent).toBe('Draw');
    fireEvent.click(link());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
