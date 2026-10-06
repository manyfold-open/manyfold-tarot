/**
 * The one strip of chrome every page of this site shares: a door to the Fortune
 * Stick on the left, the page's own links and the language switch on the right.
 *
 * The Stick door is a link out, so it opens in a new tab and a reading in
 * progress stays where it is. It says where it goes in words (the mark alone
 * would mean nothing to someone who has never seen it) and on a phone the label
 * shortens, and on the narrowest phones gives way to the mark alone, so that the
 * row never has to wrap.
 */

import { useEffect, useState } from 'react';
import type { Locale } from '../../shared/tarot/deck';
import { copyFor } from '../../shared/tarot/i18n';
import { track } from './analytics';
import { fetchReader } from './api';
import { DEFAULT_STICK_URL, stickLink } from './stick';
import StickIcon from './StickIcon';

export interface TopBarLink {
  href: string;
  label: string;
}

export default function TopBar({
  locale,
  onLocale,
  links = [],
  stickUrl,
}: {
  locale: Locale;
  onLocale: (locale: Locale) => void;
  links?: readonly TopBarLink[];
  /** The page already knows where the Stick lives; without it the bar asks once itself. */
  stickUrl?: string;
}) {
  const copy = copyFor(locale);
  const [fetched, setFetched] = useState(DEFAULT_STICK_URL);

  useEffect(() => {
    if (stickUrl) return;
    let live = true;
    void fetchReader()
      .then((info) => {
        if (live && info.fortuneStickUrl) setFetched(info.fortuneStickUrl);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [stickUrl]);

  return (
    <header className="taro-top">
      <a
        className="taro-stick-pill"
        href={stickLink(stickUrl ?? fetched, 'header')}
        target="_blank"
        rel="noopener"
        aria-label={copy.navigation.stickLabel}
        onClick={() => track('stick_opened', { from: 'header' })}
      >
        <StickIcon />
        <span className="taro-stick-pill-long">{copy.navigation.stick}</span>
        <span className="taro-stick-pill-short" aria-hidden>
          {copy.navigation.stickShort}
        </span>
      </a>
      {links.length > 0 && (
        <nav className="taro-product-nav" aria-label="Tarot">
          {links.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
      )}
      <div className="taro-lang" role="group" aria-label={copy.languageLabel}>
        <button
          type="button"
          className={locale === 'zh' ? 'is-on' : ''}
          aria-pressed={locale === 'zh'}
          onClick={() => onLocale('zh')}
        >
          中文
        </button>
        <button
          type="button"
          className={locale === 'en' ? 'is-on' : ''}
          aria-pressed={locale === 'en'}
          onClick={() => onLocale('en')}
        >
          EN
        </button>
      </div>
    </header>
  );
}
