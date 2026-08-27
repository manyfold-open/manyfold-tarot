/**
 * /privacy — what is kept, who else sees it, and how to take back an answer.
 *
 * It exists for three reasons and all three are load-bearing: the banner has to
 * point somewhere; withdrawing consent has to be as easy as giving it, which
 * means a control that is always reachable rather than a banner that never comes
 * back; and an ad account needs the page to exist at all.
 *
 * The copy is in i18n.ts with everything else, in both languages, and it
 * describes what this code does rather than what a policy generator thinks a
 * site like this probably does. Whoever runs a deployment should add their own
 * contact route and their own retention decision to it — those are theirs to
 * make, and this file will not invent them.
 */

import { useEffect, useState } from 'react';
import type { Locale } from '../../shared/tarot/deck';
import { SITE_NAME, copyFor, normalizeLocale } from '../../shared/tarot/i18n';
import Signature from './Signature';
import Sky from './Sky';
import { setConsent, storedConsent, type Consent } from './analytics';

const LOCALE_KEY = 'taro.locale';

export default function PrivacyPage() {
  const [locale, setLocale] = useState<Locale>(() =>
    normalizeLocale(localStorage.getItem(LOCALE_KEY) ?? navigator.language),
  );
  const [choice, setChoice] = useState<Consent | null>(() => storedConsent());
  const copy = copyFor(locale);

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-Hans' : 'en';
    document.title = `${copy.privacy.title} · ${SITE_NAME}`;
    localStorage.setItem(LOCALE_KEY, locale);
  }, [locale, copy]);

  const answer = (next: Consent) => {
    setConsent(next);
    setChoice(next);
  };

  return (
    <div className="taro">
      <Sky />

      <header className="taro-top">
        <div className="taro-lang" role="group" aria-label={copy.languageLabel}>
          <button
            type="button"
            className={locale === 'zh' ? 'is-on' : ''}
            aria-pressed={locale === 'zh'}
            onClick={() => setLocale('zh')}
          >
            中文
          </button>
          <button
            type="button"
            className={locale === 'en' ? 'is-on' : ''}
            aria-pressed={locale === 'en'}
            onClick={() => setLocale('en')}
          >
            EN
          </button>
        </div>
      </header>

      <main className="taro-stage">
        <article className="taro-prose">
          <h1>{copy.privacy.title}</h1>
          <p className="taro-prose-lead">{copy.privacy.intro}</p>

          {copy.privacy.sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              {section.body.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </section>
          ))}

          <section className="taro-choice">
            <h2>{copy.privacy.choiceTitle}</h2>
            <p role="status">{copy.privacy.state(choice ?? 'unset')}</p>
            <div className="taro-consent-answer">
              <button
                type="button"
                className="taro-consent-button"
                aria-pressed={choice === 'denied'}
                onClick={() => answer('denied')}
              >
                {copy.privacy.decline}
              </button>
              <button
                type="button"
                className="taro-consent-button"
                aria-pressed={choice === 'granted'}
                onClick={() => answer('granted')}
              >
                {copy.privacy.accept}
              </button>
            </div>
          </section>

          <p>
            <a className="taro-link" href="/">
              {copy.privacy.back}
            </a>
          </p>
        </article>
      </main>

      <footer className="taro-foot">
        <Signature locale={locale} />
      </footer>
    </div>
  );
}
