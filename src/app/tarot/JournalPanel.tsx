/**
 * The journal card at the end of a reading: the second thing this page wants
 * done, after the Stick. Choosing when to look back is what saving means here,
 * so the review date sits on the card and one press keeps both. The private
 * note is optional and stays folded until someone asks for it.
 */

import { useEffect, useState } from 'react';
import type { Locale } from '../../shared/tarot/deck';
import { copyFor } from '../../shared/tarot/i18n';
import type { ReadingView } from '../../shared/tarot/types';
import { track } from './analytics';
import { errorText, fetchJournal, saveJournal } from './api';

const toLocalDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const localDateAfter = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toLocalDate(date);
};

const REVIEW_DAYS = [7, 14, 30] as const;

export default function JournalPanel({ reading, locale }: { reading: ReadingView; locale: Locale }) {
  const copy = copyFor(locale);
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState('');
  const [savedNote, setSavedNote] = useState('');
  const [reviewDate, setReviewDate] = useState(localDateAfter(7));
  const [savedDate, setSavedDate] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void fetchJournal().then(({ entries }) => {
      const entry = entries.find((item) => item.readingId === reading.readingId);
      if (cancelled || !entry) return;
      const date = entry.reviewDueAt ? toLocalDate(new Date(entry.reviewDueAt)) : localDateAfter(7);
      setSaved(true);
      setNote(entry.note);
      setSavedNote(entry.note);
      setReviewDate(date);
      setSavedDate(date);
      if (entry.note) setNoteOpen(true);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [reading.readingId]);

  const persist = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await saveJournal(reading.readingId, {
        note,
        reviewDueAt: new Date(`${reviewDate}T12:00:00`).toISOString(),
      });
      track(saved ? 'journal_note_saved' : 'reading_saved', { locale });
      setSaved(true);
      setSavedNote(note);
      setSavedDate(reviewDate);
    } catch (caught) {
      setError(errorText(caught, copy.errors.generic));
    } finally {
      setSaving(false);
    }
  };

  const changed = saved && (note !== savedNote || reviewDate !== savedDate);

  return (
    <section className={`taro-journal-card${saved ? ' is-saved' : ''}`}>
      <div className="taro-journal-card-head">
        <span className="taro-journal-card-mark" aria-hidden>{saved ? '✓' : '✦'}</span>
        <div>
          <p className="taro-journal-card-title" role={saved ? 'status' : undefined}>
            {saved ? copy.journal.saved : copy.journal.cardTitle}
          </p>
          <p className="taro-journal-card-prompt">{copy.journal.cardPrompt}</p>
        </div>
      </div>

      <div className="taro-journal-card-row">
        <div className="taro-chips" role="radiogroup" aria-label={copy.journal.reviewWhen}>
          {REVIEW_DAYS.map((days, index) => (
            <button key={days} type="button" role="radio" aria-checked={reviewDate === localDateAfter(days)}
              className={`taro-chip${reviewDate === localDateAfter(days) ? ' is-on' : ''}`}
              onClick={() => setReviewDate(localDateAfter(days))}>{copy.journal.reviewOptions[index]}</button>
          ))}
        </div>
        {!saved && (
          <button type="button" className="taro-journal-save" disabled={saving} onClick={() => void persist()}>
            {saving ? copy.journal.saving : copy.journal.saveNow}
          </button>
        )}
      </div>

      {saved && !noteOpen && (
        <button type="button" className="taro-link taro-journal-add-note" onClick={() => setNoteOpen(true)}>
          {copy.journal.addNote}
        </button>
      )}
      {saved && noteOpen && (
        <>
          <label className="taro-journal-label" htmlFor="taro-private-note">{copy.journal.note}</label>
          <textarea id="taro-private-note" className="taro-note-input" value={note} maxLength={4000}
            placeholder={copy.journal.notePlaceholder} onChange={(event) => setNote(event.target.value)} />
        </>
      )}
      {changed && (
        <button type="button" className="taro-journal-save" disabled={saving} onClick={() => void persist()}>
          {saving ? copy.journal.saving : copy.journal.saveNote}
        </button>
      )}
      {error && <p className="taro-error" role="alert">{error}</p>}
    </section>
  );
}
