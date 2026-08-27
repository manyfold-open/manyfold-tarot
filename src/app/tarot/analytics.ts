/**
 * The browser half of measurement: naming the moments, and carrying the
 * visitor's answer to the banner back to the tag.
 *
 * The tag itself is not set up here — the Worker writes it into `<head>` before
 * this bundle exists (src/worker/analytics.ts), which is why everything below is
 * written to do nothing at all when `gtag` is absent. That is the normal state
 * of a fork, of `npm run dev`, and of every test in this repo, and none of them
 * should have to know what an event is.
 *
 * The five events are the reading itself, in order. They are here so a campaign
 * can be judged on whether anyone got a reading rather than on whether anyone
 * arrived — `reading_completed` is the one worth importing into Google Ads as a
 * conversion; the rest are the funnel that explains it.
 */

export const CONSENT_KEY = 'taro.consent';

export type Consent = 'granted' | 'denied';

type Gtag = (...args: unknown[]) => void;

declare global {
  interface Window {
    gtag?: Gtag;
    /** Set by the injected tag; absent when nothing was injected. */
    dataLayer?: unknown[];
  }
}

const gtag = (...args: unknown[]): void => {
  if (typeof window.gtag === 'function') window.gtag(...args);
};

/** Whether this page has a Google tag on it at all. */
export const measuring = (): boolean => typeof window.gtag === 'function';

/** The choice this browser made last time, if it made one. */
export function storedConsent(): Consent | null {
  try {
    const value = localStorage.getItem(CONSENT_KEY);
    return value === 'granted' || value === 'denied' ? value : null;
  } catch {
    // Storage can be denied outright (private mode, embedded webview). A visitor
    // who cannot be remembered is asked again, which is the honest fallback.
    return null;
  }
}

/**
 * Records an answer and tells the tag about it in the same breath.
 *
 * The order matters on the way out: the tag is updated whether or not the write
 * succeeds, so a browser that refuses localStorage still gets the consent it was
 * given for this page view.
 */
export function setConsent(choice: Consent): void {
  const state = {
    ad_storage: choice,
    ad_user_data: choice,
    ad_personalization: choice,
    analytics_storage: choice,
  };
  gtag('consent', 'update', state);
  try {
    localStorage.setItem(CONSENT_KEY, choice);
  } catch {
    /* see storedConsent */
  }
}

/** One named moment in the reading. Silent when nothing is measuring. */
export const track = (event: string, params: Record<string, unknown> = {}): void => {
  gtag('event', event, params);
};
