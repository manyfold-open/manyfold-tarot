/**
 * The way out to the Fortune Stick: where it lives, and how a link to it is
 * built. Every link from this site to the Stick goes through `stickLink`, so
 * the visitor is counted and the reward comes back to this host.
 */

import { appUrl } from '../base';

export const DEFAULT_STICK_URL = 'https://app.manyfold.ai/fortune-stick/';

/** Where on the page the link sat: the end of a reading, the page with nothing left, or the top bar. */
export type StickPlacement = 'outro' | 'locked' | 'header';

export const stickLink = (base: string, placement: StickPlacement): string => {
  const url = new URL(base, location.href);
  url.searchParams.set('utm_source', 'tarot');
  url.searchParams.set('utm_medium', 'referral');
  url.searchParams.set('utm_content', placement);
  // Where the Stick should send this visitor back to, so the reward lands in
  // this host's session. The Stick Worker only honours hosts it knows.
  url.searchParams.set('tarot_return', `${location.origin}${appUrl('/')}`);
  return url.toString();
};
