import { useEffect, useState } from 'react';
import { appUrl } from '../base';
import type { Locale } from '../../shared/tarot/deck';
import { cardById } from '../../shared/tarot/deck';
import { copyFor, normalizeLocale } from '../../shared/tarot/i18n';
import type { DrawnCardView } from '../../shared/tarot/types';
import { track } from './analytics';
import { errorText, fetchDailyCard } from './api';
import CardSlot from './Card';
import Signature from './Signature';
import Sky from './Sky';

const LOCALE_KEY = 'taro.locale';
const DAILY_REMINDER_KEY = 'taro.dailyReminder';

export default function DailyPage() {
  const [locale, setLocale] = useState<Locale>(() => normalizeLocale(localStorage.getItem(LOCALE_KEY) ?? navigator.language));
  const [daily, setDaily] = useState<Awaited<ReturnType<typeof fetchDailyCard>> | null>(null);
  const [error, setError] = useState('');
  const [reminder, setReminder] = useState(() => localStorage.getItem(DAILY_REMINDER_KEY) === 'on');
  const copy = copyFor(locale);

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-Hans' : 'en';
    document.title = `${copy.daily.title} · AI Tarot`;
    localStorage.setItem(LOCALE_KEY, locale);
    let cancelled = false;
    void fetchDailyCard(locale).then((result) => {
      if (!cancelled) {
        setDaily(result);
        track('daily_card_opened', { locale });
      }
    }).catch((caught) => { if (!cancelled) setError(errorText(caught, copy.errors.generic)); });
    return () => { cancelled = true; };
  }, [locale, copy]);

  const entry = daily ? cardById(daily.cardId) : null;
  const card: DrawnCardView | null = daily && entry ? {
    slot: 'situation', index: 0, cardId: daily.cardId, reversed: daily.reversed, hint: daily.keywords,
  } : null;

  return (
    <div className="taro">
      <Sky />
      <header className="taro-top">
        <nav className="taro-product-nav" aria-label="Tarot">
          <a href={appUrl('/')}>{copy.navigation.back}</a><a href={appUrl('/journal')}>{copy.navigation.journal}</a>
        </nav>
        <div className="taro-lang" role="group" aria-label={copy.languageLabel}>
          <button type="button" className={locale === 'zh' ? 'is-on' : ''} aria-pressed={locale === 'zh'} onClick={() => setLocale('zh')}>中文</button>
          <button type="button" className={locale === 'en' ? 'is-on' : ''} aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>EN</button>
        </div>
      </header>
      <main className="taro-stage taro-daily-page">
        <h1 className="taro-ask-title">{copy.daily.title}</h1>
        <p className="taro-instruction">{copy.daily.intro}</p>
        {error && <p className="taro-error" role="alert">{error}</p>}
        {daily && entry && (
          <>
            <p className="taro-daily-date">{new Intl.DateTimeFormat(locale === 'zh' ? 'zh-Hans' : 'en-GB', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${daily.date}T12:00:00Z`))}</p>
            <div className="taro-daily-card">
              <CardSlot slot="situation" locale={locale} card={card} positionTitle={copy.daily.title} />
              <p className="taro-daily-keywords">{daily.keywords}</p>
            </div>
            <section className="taro-daily-reflection">
              <h2>{copy.result.reflection}</h2>
              <p>{daily.reflection}</p>
            </section>
            <a className="taro-primary" href={appUrl(`/?spread=next-step&prompt=daily`)}>{copy.daily.openReading}</a>
          </>
        )}
        <section className="taro-reminder-settings">
          <label>
            <input type="checkbox" checked={reminder} onChange={(event) => {
              const enabled = event.target.checked;
              setReminder(enabled);
              localStorage.setItem(DAILY_REMINDER_KEY, enabled ? 'on' : 'off');
              track('reminder_enabled', { kind: 'daily_card', enabled, locale });
            }} />
            {reminder ? copy.daily.reminderOff : copy.daily.reminderOn}
          </label>
          <p>{copy.daily.reminderHint}</p>
        </section>
      </main>
      <footer className="taro-foot"><Signature locale={locale} /><a className="taro-foot-link" href={appUrl('/privacy')}>{copy.consent.more}</a></footer>
    </div>
  );
}
