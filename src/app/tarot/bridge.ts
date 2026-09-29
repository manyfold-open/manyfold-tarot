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

export function readTarotHandoff(href: string): TarotHandoff {
  const url = new URL(href);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  const lang = fragment.get('lang');
  const rawSource = url.searchParams.get('utm_source');
  const source = rawSource === 'fortune-stick' || rawSource === 'tarot-share' ? rawSource : null;
  return {
    locale: lang === 'zh' || lang === 'en' ? lang : null,
    bonusToken: fragment.get('bonus'),
    testerToken: fragment.get('tester'),
    fromStick: source === 'fortune-stick',
    forceQuestion: url.searchParams.get('new') === '1',
    hasBridgeFragment: fragment.has('lang') || fragment.has('bonus') || fragment.has('tester'),
    source,
  };
}
