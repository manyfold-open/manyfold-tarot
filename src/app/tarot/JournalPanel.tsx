import { useEffect, useState } from 'react';
import type { Locale } from '../../shared/tarot/deck';
import { appUrl } from '../base';
import { copyFor } from '../../shared/tarot/i18n';
import type { ReadingView } from '../../shared/tarot/types';
import { track } from './analytics';
import { errorText, fetchJournal, saveJournal } from './api';

const localDateAfter = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const REVIEW_DAYS = [7, 14, 30] as const;

const localDateFromIso = (value: string) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export default function JournalPanel({ reading, locale }: { reading: ReadingView; locale: Locale }) {
  const copy = copyFor(locale);
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState('');
  const [reviewDate, setReviewDate] = useState(localDateAfter(7));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void fetchJournal().then(({ entries }) => {
      const entry = entries.find((item) => item.readingId === reading.readingId);
      if (cancelled || !entry) return;
      setSaved(true);
      setNote(entry.note);
      if (entry.reviewDueAt) setReviewDate(localDateFromIso(entry.reviewDueAt));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [reading.readingId]);

  const persist = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const result = await saveJournal(reading.readingId, {
        note,
        reviewDueAt: new Date(`${reviewDate}T12:00:00`).toISOString(),
      });
      setSaved(true);
      track(saved ? 'journal_note_saved' : 'reading_saved', { locale });
      return result;
    } catch (caught) {
      setError(errorText(caught, copy.errors.generic));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="taro-journal-panel">
      <div className="taro-journal-panel-head">
        <a className="taro-link" href={appUrl('/journal')}>{copy.navigation.journal}</a>
        {!saved && <button type="button" className="taro-secondary" disabled={saving} onClick={() => void persist()}>
          {saving ? copy.outro.sharing : copy.journal.save}
        </button>}
        {saved && <p className="taro-journal-saved" role="status">{copy.journal.saved}</p>}
      </div>
      {saved && (
        <>
          <label className="taro-journal-label" htmlFor="taro-private-note">{copy.journal.note}</label>
          <textarea id="taro-private-note" className="taro-note-input" value={note} maxLength={4000}
            placeholder={copy.journal.notePlaceholder} onChange={(event) => setNote(event.target.value)} />
          <div className="taro-journal-review-date" role="radiogroup" aria-label={copy.journal.reviewWhen}>
            <span className="taro-journal-label">{copy.journal.reviewWhen}</span>
            <div className="taro-chips">
              {REVIEW_DAYS.map((days, index) => (
                <button key={days} type="button" role="radio" aria-checked={reviewDate === localDateAfter(days)}
                  className={`taro-chip${reviewDate === localDateAfter(days) ? ' is-on' : ''}`}
                  onClick={() => setReviewDate(localDateAfter(days))}>{copy.journal.reviewOptions[index]}</button>
              ))}
            </div>
          </div>
          <button type="button" className="taro-secondary" disabled={saving} onClick={() => void persist()}>
            {saving ? copy.outro.sharing : copy.journal.saveNote}
          </button>
        </>
      )}
      {error && <p className="taro-error" role="alert">{error}</p>}
    </section>
  );
}
