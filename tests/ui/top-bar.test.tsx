/**
 * @vitest-environment jsdom
 *
 * The strip every page shares: a door to the Fortune Stick on the left, the
 * page's own links and the language switch on the right.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchReader = vi.fn();
vi.mock('../../src/app/tarot/api', () => ({ fetchReader: () => fetchReader() }));

const { default: TopBar } = await import('../../src/app/tarot/TopBar');

afterEach(() => {
  cleanup();
  fetchReader.mockReset();
});

describe('TopBar', () => {
  it('links to the Stick in a new tab, counted as the header, and carries the way back', () => {
    render(<TopBar locale="en" onLocale={() => undefined} stickUrl="https://stick.example/play" />);
    const link = screen.getByRole('link', { name: 'Open the Fortune Stick in a new tab' });
    const href = new URL(link.getAttribute('href')!);
    expect(href.origin + href.pathname).toBe('https://stick.example/play');
    expect(href.searchParams.get('utm_source')).toBe('tarot');
    expect(href.searchParams.get('utm_content')).toBe('header');
    expect(href.searchParams.get('tarot_return')).toBeTruthy();
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('does not ask the Worker where the Stick is when the page already knows', () => {
    render(<TopBar locale="zh" onLocale={() => undefined} stickUrl="https://stick.example/" />);
    expect(fetchReader).not.toHaveBeenCalled();
  });

  it('asks once for the Stick address when the page does not know it', async () => {
    fetchReader.mockResolvedValue({ demo: false, consentRequired: false, fortuneStickUrl: 'https://elsewhere.example/stick' });
    render(<TopBar locale="en" onLocale={() => undefined} />);
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /Fortune Stick/ });
      expect(link.getAttribute('href')).toContain('https://elsewhere.example/stick');
    });
    expect(fetchReader).toHaveBeenCalledTimes(1);
  });

  it('keeps the default address when asking fails', async () => {
    fetchReader.mockRejectedValue(new Error('offline'));
    render(<TopBar locale="en" onLocale={() => undefined} />);
    await waitFor(() => expect(fetchReader).toHaveBeenCalled());
    expect(screen.getByRole('link', { name: /Fortune Stick/ }).getAttribute('href')).toContain('app.manyfold.ai/fortune-stick');
  });

  it('shows the page links only when it is given some, and switches language', () => {
    const onLocale = vi.fn();
    const { rerender } = render(<TopBar locale="en" onLocale={onLocale} stickUrl="https://s.example/" />);
    expect(screen.queryByRole('navigation')).toBeNull();

    rerender(
      <TopBar locale="en" onLocale={onLocale} stickUrl="https://s.example/" links={[{ href: '/daily', label: 'Daily card' }]} />,
    );
    expect(screen.getByRole('link', { name: 'Daily card' }).getAttribute('href')).toBe('/daily');

    fireEvent.click(screen.getByRole('button', { name: '中文' }));
    expect(onLocale).toHaveBeenCalledWith('zh');
    expect(screen.getByRole('button', { name: 'EN' }).getAttribute('aria-pressed')).toBe('true');
  });
});
