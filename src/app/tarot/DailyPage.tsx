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
import TopBar from './TopBar';

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
      <TopBar locale={locale} onLocale={setLocale} links={[{ href: appUrl('/'), label: copy.navigation.back }, { href: appUrl('/journal'), label: copy.navigation.journal }]} />
      {/* One card, read top to bottom in the order it matters: which day, which
          card, what it means, what to ask yourself, what to do next. The page
          names itself once, in a quiet line, so that the card's own name is the
          largest thing on it — and the card is cut short enough on a phone for
          that name to be on the first screen with it. */}
      <main className="taro-stage taro-daily-page">
        <h1 className="taro-daily-head">
          {copy.daily.title}
          {daily && (
            <span> · {new Intl.DateTimeFormat(locale === 'zh' ? 'zh-Hans' : 'en-GB', { weekday: 'short', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${daily.date}T12:00:00Z`))}</span>
          )}
        </h1>
        {error && <p className="taro-error" role="alert">{error}</p>}
        {daily && entry && (
          <>
            <div className="taro-daily-card">
              <CardSlot slot="situation" locale={locale} card={card} positionTitle={null} />
            </div>
            <p className="taro-daily-keywords">{daily.keywords}</p>
            <section className="taro-daily-reflection">
              <h2>{copy.result.reflection}</h2>
              <p>{daily.reflection}</p>
            </section>
            <a className="taro-primary" href={appUrl(`/?spread=next-step&prompt=daily&daily=${daily.date}`)}>{copy.daily.openReading}</a>
          </>
        )}
        <section className="taro-reminder-settings">
          <label className="taro-switch">
            <span>{copy.daily.reminderLabel}</span>
            <input type="checkbox" role="switch" checked={reminder} onChange={(event) => {
              const enabled = event.target.checked;
              setReminder(enabled);
              localStorage.setItem(DAILY_REMINDER_KEY, enabled ? 'on' : 'off');
              track('reminder_enabled', { kind: 'daily_card', enabled, locale });
            }} />
          </label>
          <p>{copy.daily.reminderHint}</p>
        </section>
      </main>
      <footer className="taro-foot"><Signature locale={locale} /><a className="taro-foot-link" href={appUrl('/privacy')}>{copy.consent.more}</a></footer>
    </div>
  );
}
