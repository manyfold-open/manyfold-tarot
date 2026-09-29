/** Cross-app state that is safe to carry in a Tarot URL. Never reads question text. */

import type { Locale } from '../../shared/tarot/deck';

export interface TarotHandoff {
  locale: Locale | null;
  bonusToken: string | null;
  /** The test token, from `#tester=`. Only the fragment is read: it never reaches a server log. */
  testerToken: string | null;
  fromStick: boolean;
  forceQuestion: boolean;
  hasBridgeFragment: boolean;
  source: string | null;
}

/**
 * The test token, read from the raw fragment. URLSearchParams would turn a "+"
 * into a space, and base64 — which is what the token is — is full of them.
 */
function testerTokenFrom(hash: string): string | null {
  const raw = /(?:^#|&)tester=([^&]*)/.exec(hash)?.[1];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function readTarotHandoff(href: string): TarotHandoff {
  const url = new URL(href);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  const lang = fragment.get('lang');
  const rawSource = url.searchParams.get('utm_source');
  const source = rawSource === 'fortune-stick' || rawSource === 'tarot-share' ? rawSource : null;
  return {
    locale: lang === 'zh' || lang === 'en' ? lang : null,
    bonusToken: fragment.get('bonus'),
    testerToken: testerTokenFrom(url.hash),
    fromStick: source === 'fortune-stick',
    forceQuestion: url.searchParams.get('new') === '1',
    hasBridgeFragment: fragment.has('lang') || fragment.has('bonus') || fragment.has('tester'),
    source,
  };
}
