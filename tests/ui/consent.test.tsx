/**
 * @vitest-environment jsdom
 *
 * The banner, and the four times it must not be on screen.
 *
 * It is drawn only where consent is owed, only while it is unanswered, and only
 * when there is a tag to consent to — a fork with no `GA_MEASUREMENT_ID` set
 * serves no Google at all, and a cookie banner over a site that sets no cookies
 * is a lie with a button on it.
 *
 * The last test is the one worth keeping: both buttons carry the same class, so
 * neither answer can quietly be made harder to give than the other.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchReader = vi.fn(async () => ({ demo: true, consentRequired: true }));

vi.mock('../../src/app/tarot/api', () => ({
  ApiError: class ApiError extends Error {},
  fetchReader: () => fetchReader(),
}));

const { default: Consent } = await import('../../src/app/tarot/Consent');
const { CONSENT_KEY } = await import('../../src/app/tarot/analytics');

/** Every consent call the component made, in order. */
let pushed: unknown[][] = [];

beforeEach(() => {
  pushed = [];
  localStorage.clear();
  fetchReader.mockClear();
  // Stands in for the tag the Worker injects. Its presence is what tells the
  // component there is anything to ask about.
  window.gtag = ((...args: unknown[]) => void pushed.push(args)) as typeof window.gtag;
});

afterEach(() => {
  cleanup();
  delete window.gtag;
});

const banner = () => document.querySelector('.taro-consent');

describe('when it appears', () => {
  it('asks where consent is owed', () => {
    render(<Consent locale="en" required />);
    expect(banner()).not.toBeNull();
    expect(screen.getByText('Accept')).toBeTruthy();
    expect(screen.getByText('Decline')).toBeTruthy();
  });

  it('says nothing where it is not owed', () => {
    render(<Consent locale="en" required={false} />);
    expect(banner()).toBeNull();
  });

  it('says nothing to a visitor who already answered', () => {
    localStorage.setItem(CONSENT_KEY, 'denied');
    render(<Consent locale="en" required />);
    expect(banner()).toBeNull();
  });

  it('says nothing when the page carries no tag at all', () => {
    delete window.gtag;
    render(<Consent locale="en" required />);
    expect(banner()).toBeNull();
  });

  it('asks the Worker itself when nobody handed it an answer', async () => {
    render(<Consent locale="en" />);
    expect(fetchReader).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Accept')).toBeTruthy();
  });

  it('does not make that request when the answer is already stored', () => {
    localStorage.setItem(CONSENT_KEY, 'granted');
    render(<Consent locale="en" />);
    expect(fetchReader).not.toHaveBeenCalled();
  });
});

describe('answering', () => {
  it('grants, remembers, and gets out of the way', () => {
    render(<Consent locale="en" required />);
    fireEvent.click(screen.getByText('Accept'));

    expect(localStorage.getItem(CONSENT_KEY)).toBe('granted');
    expect(pushed).toEqual([
      [
        'consent',
        'update',
        {
          ad_storage: 'granted',
          ad_user_data: 'granted',
          ad_personalization: 'granted',
          analytics_storage: 'granted',
        },
      ],
    ]);
    expect(banner()).toBeNull();
  });

  it('declines all four, not just the analytics one', () => {
    render(<Consent locale="zh" required />);
    fireEvent.click(screen.getByText('不同意'));

    expect(localStorage.getItem(CONSENT_KEY)).toBe('denied');
    expect(pushed[0]?.[2]).toEqual({
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'denied',
    });
    expect(banner()).toBeNull();
  });

  it('gives both answers the same weight', () => {
    render(<Consent locale="en" required />);
    const accept = screen.getByText('Accept');
    const decline = screen.getByText('Decline');
    expect(accept.className).toBe(decline.className);
  });
});
