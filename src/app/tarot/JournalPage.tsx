import { useEffect, useState } from 'react';
import { appUrl } from '../base';
import type { Locale } from '../../shared/tarot/deck';
import { cardById } from '../../shared/tarot/deck';
import { copyFor, normalizeLocale } from '../../shared/tarot/i18n';
import { spreadFor } from '../../shared/tarot/spreads';
import type { SpreadId } from '../../shared/tarot/types';
import { track } from './analytics';
import { clearJournal, deleteJournalEntry, errorText, fetchJournal, saveJournalReview, type JournalEntry } from './api';
import Signature from './Signature';
import Sky from './Sky';

const LOCALE_KEY = 'taro.locale';
const WEEKLY_REMINDER_KEY = 'taro.weeklyReviewReminder';

export default function JournalPage() {
  const [locale, setLocale] = useState<Locale>(() => normalizeLocale(localStorage.getItem(LOCALE_KEY) ?? navigator.language));
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [weeklyReminder, setWeeklyReminder] = useState(() => localStorage.getItem(WEEKLY_REMINDER_KEY) === 'on');
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, string>>({});
  const [reviewOpen, setReviewOpen] = useState<Record<string, boolean>>({});
  const copy = copyFor(locale);

  const refresh = async () => {
    setLoading(true);
    try {
      const result = await fetchJournal();
      setEntries(result.entries);
      setError('');
    } catch (caught) {
      setError(errorText(caught, copy.errors.generic));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-Hans' : 'en';
    document.title = `${copy.journal.title} · AI Tarot`;
    localStorage.setItem(LOCALE_KEY, locale);
  }, [locale, copy]);

  useEffect(() => { void refresh(); }, []);

  const remove = async (entry: JournalEntry) => {
    if (!window.confirm(copy.journal.deleteConfirm)) return;
    try {
      await deleteJournalEntry(entry.readingId);
      setEntries((current) => current.filter((item) => item.readingId !== entry.readingId));
      if (localStorage.getItem('taro.readingId') === entry.readingId) localStorage.removeItem('taro.readingId');
    } catch (caught) {
      setError(errorText(caught, copy.errors.generic));
    }
  };

  const clearAll = async () => {
    if (!entries.length || !window.confirm(copy.journal.clearConfirm)) return;
    try {
      await clearJournal();
      setEntries([]);
      localStorage.removeItem('taro.readingId');
    } catch (caught) {
      setError(errorText(caught, copy.errors.generic));
    }
  };

  const saveReview = async (entry: JournalEntry) => {
    try {
      await saveJournalReview(entry.readingId, reviewDrafts[entry.readingId] ?? entry.reviewNote);
      track('journal_review_saved', { locale });
      setReviewOpen((current) => ({ ...current, [entry.readingId]: false }));
      await refresh();
    } catch (caught) {
      setError(errorText(caught, copy.errors.generic));
    }
  };

  return (
    <div className="taro">
      <Sky />
      <header className="taro-top">
        <nav className="taro-product-nav" aria-label="Tarot">
          <a href={appUrl('/')}>{copy.navigation.back}</a><a href={appUrl('/daily')}>{copy.navigation.daily}</a>
        </nav>
        <div className="taro-lang" role="group" aria-label={copy.languageLabel}>
          <button type="button" className={locale === 'zh' ? 'is-on' : ''} aria-pressed={locale === 'zh'} onClick={() => setLocale('zh')}>中文</button>
          <button type="button" className={locale === 'en' ? 'is-on' : ''} aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>EN</button>
        </div>
      </header>
      <main className="taro-stage taro-journal-page">
        <h1 className="taro-ask-title">{copy.journal.title}</h1>
        <p className="taro-instruction">{copy.journal.intro}</p>

        <section className="taro-reminder-settings">
          <label>
            <input type="checkbox" checked={weeklyReminder} onChange={(event) => {
              const enabled = event.target.checked;
              setWeeklyReminder(enabled);
              localStorage.setItem(WEEKLY_REMINDER_KEY, enabled ? 'on' : 'off');
              track('reminder_enabled', { kind: 'weekly_review', enabled, locale });
            }} />
            {weeklyReminder ? copy.journal.reminderOff : copy.journal.reminderOn}
          </label>
          <p>{copy.journal.reminderHint}</p>
        </section>

        <a className="taro-secondary taro-weekly-start" href={appUrl('/?spread=weekly-review&prompt=weekly')}>{copy.navigation.weeklyReview}</a>

        {error && <p className="taro-error" role="alert">{error}</p>}
        {loading ? <p className="taro-instruction" role="status">{copy.journal.loading}</p> : entries.length === 0 ? (
          <p className="taro-journal-empty">{copy.journal.empty}</p>
        ) : (
          <div className="taro-journal-list">
            {entries.map((entry) => {
              const spread = spreadFor(entry.spreadId, locale);
              const due = Boolean(entry.reviewDueAt && new Date(entry.reviewDueAt).getTime() <= Date.now() && !entry.reviewedAt);
              return (
                <article className="taro-journal-entry" key={entry.readingId}>
                  <div className="taro-journal-entry-head">
                    <div>
                      <h2>{spread.title}</h2>
                      <p>{new Intl.DateTimeFormat(locale === 'zh' ? 'zh-Hans' : 'en-GB', { dateStyle: 'medium' }).format(new Date(entry.createdAt))}</p>
                    </div>
                    {due && <span className="taro-review-due">{copy.journal.reviewIsDue}</span>}
                  </div>
                  <ol className="taro-journal-cards">
                    {entry.cards.map((card) => {
                      const deckCard = cardById(card.cardId);
                      return <li key={card.slot}>{spread.slots[card.slot as keyof typeof spread.slots].title} · {deckCard?.name[locale]} · {card.reversed ? copy.reveal.reversed : copy.reveal.upright}</li>;
                    })}
                  </ol>
                  <div className="taro-journal-note-display">
                    <strong>{copy.journal.note}</strong>
                    <p>{entry.note || '—'}</p>
                  </div>
                  {entry.reviewNote && <div className="taro-journal-note-display"><strong>{copy.journal.reviewed}</strong><p>{entry.reviewNote}</p></div>}
                  {(due || !entry.reviewedAt || reviewOpen[entry.readingId]) && (
                    <div className="taro-journal-review">
                      {reviewOpen[entry.readingId] ? (
                        <>
                          <label htmlFor={`review-${entry.readingId}`}>{copy.journal.reviewPrompt}</label>
                          <textarea id={`review-${entry.readingId}`} className="taro-note-input" value={reviewDrafts[entry.readingId] ?? entry.reviewNote}
                            placeholder={copy.journal.reviewPlaceholder} maxLength={4000}
                            onChange={(event) => setReviewDrafts((current) => ({ ...current, [entry.readingId]: event.target.value }))} />
                          <button type="button" className="taro-secondary" onClick={() => void saveReview(entry)}>{copy.journal.saveReview}</button>
                        </>
                      ) : (
                        <button type="button" className="taro-link" onClick={() => {
                          setReviewDrafts((current) => ({ ...current, [entry.readingId]: entry.reviewNote }));
                          setReviewOpen((current) => ({ ...current, [entry.readingId]: true }));
                        }}>{due ? copy.journal.reviewNow : copy.journal.reviewPrompt}</button>
                      )}
                    </div>
                  )}
                  <footer className="taro-journal-entry-actions">
                    <a className="taro-link" href={appUrl(`/?reading=${encodeURIComponent(entry.readingId)}`)}>{copy.journal.openReading}</a>
                    <button type="button" className="taro-link" onClick={() => void remove(entry)}>{copy.journal.delete}</button>
                  </footer>
                </article>
              );
            })}
          </div>
        )}
        <button type="button" className="taro-danger-link" disabled={!entries.length} onClick={() => void clearAll()}>{copy.journal.clear}</button>
      </main>
      <footer className="taro-foot"><Signature locale={locale} /><a className="taro-foot-link" href={appUrl('/privacy')}>{copy.consent.more}</a></footer>
    </div>
  );
}

export const weeklyReminderEnabled = (): boolean => localStorage.getItem(WEEKLY_REMINDER_KEY) === 'on';
export const weeklyReminderKey = WEEKLY_REMINDER_KEY;
export const currentLocale = (): Locale => normalizeLocale(localStorage.getItem(LOCALE_KEY) ?? navigator.language);
export const validSpreadId = (value: string): value is SpreadId => ['current', 'decision', 'next-step', 'weekly-review'].includes(value);
