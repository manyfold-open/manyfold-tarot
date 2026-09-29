/**
 * Sharing the round on screen.
 *
 * One press, once it is open. At the end of a reading the panel is folded
 * behind the share icon (TarotApp owns `open`); unfolded, the choices are all
 * on the page and one press mints the link, puts it on the clipboard, and says
 * so. The question stays out unless the box is ticked.
 *
 * Two things this file is still careful about:
 *
 * 1. It shares the reading it was handed — the one being read right now. There
 *    is no "share my last reading" path anywhere, so a visitor scrolling an old
 *    round can never publish a newer one by accident.
 * 2. It mints at most one link per round. Pressing again re-copies the link it
 *    already has rather than writing a second snapshot row for the same three
 *    cards, so a person who presses twice because they weren't sure it worked
 *    does not quietly leave two public copies behind.
 */

import { useEffect, useState } from 'react';
import { cardById, type Locale } from '../../shared/tarot/deck';
import { copyFor } from '../../shared/tarot/i18n';
import type { ReadingView, ShareMode } from '../../shared/tarot/types';
import { spreadFor } from '../../shared/tarot/spreads';
import { track } from './analytics';
import { createShare, errorText } from './api';

export default function ShareBox({
  reading,
  locale,
  open = true,
}: {
  reading: ReadingView;
  locale: Locale;
  /** Folded behind the share icon at the end of a reading. State survives folding. */
  open?: boolean;
}) {
  const copy = copyFor(locale);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<ShareMode>('summary');
  const [cardIndex, setCardIndex] = useState(0);
  const [includeQuestion, setIncludeQuestion] = useState(false);
  const spread = spreadFor(reading.spreadId, locale);

  // A different round is on screen: nothing from the last one carries over.
  useEffect(() => {
    setUrl('');
    setCopied(false);
    setError('');
    setMode('summary');
    setCardIndex(0);
    setIncludeQuestion(false);
  }, [reading.readingId]);

  const share = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const link = url || (await createShare(reading.readingId, { includeQuestion, mode, cardIndex })).url;
      setUrl(link);
      if (!url) track('reading_shared', { locale, mode, question_included: includeQuestion });
      try {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2400);
      } catch {
        /* No clipboard permission. Not an error worth showing — the link is on
           screen below, selected on focus, and the button still offers to try
           again. Telling someone the share failed when it plainly did not is
           worse than saying nothing. */
      }
    } catch (caught) {
      setError(errorText(caught, copy.errors.generic));
    } finally {
      setBusy(false);
    }
  };

  /* Four labels for one button, and the order matters: what it is doing beats
     what it just did beats what it will do. */
  const label = busy
    ? copy.outro.sharing
    : copied
      ? copy.share.copied
      : url
        ? copy.share.copyLink
        : copy.share.createLink;

  if (!open) return null;

  return (
    <div className="taro-share">
      <fieldset className="taro-share-options">
        <legend>{copy.share.modeTitle}</legend>
        {(['card', 'summary', 'full'] as ShareMode[]).map((value) => (
          <label key={value}>
            <input type="radio" name={`share-mode-${reading.readingId}`} checked={mode === value} onChange={() => { setMode(value); setUrl(''); setCopied(false); }} />
            {value === 'card' ? copy.share.modeCard : value === 'full' ? copy.share.modeFull : copy.share.modeSummary}
          </label>
        ))}
        {mode === 'card' && (
          <div className="taro-share-select" role="radiogroup" aria-label={copy.share.selectedCard}>
            <span className="taro-journal-label">{copy.share.selectedCard}</span>
            <div className="taro-chips">
              {reading.cards.map((card, index) => {
                const entry = cardById(card.cardId);
                return (
                  <button key={card.index} type="button" role="radio" aria-checked={cardIndex === index}
                    className={`taro-chip${cardIndex === index ? ' is-on' : ''}`}
                    onClick={() => { setCardIndex(index); setUrl(''); setCopied(false); }}>
                    {spread.slots[card.slot].title} · {entry?.name[locale]}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <label className="taro-share-question">
          <input type="checkbox" checked={includeQuestion} onChange={(event) => { setIncludeQuestion(event.target.checked); setUrl(''); setCopied(false); }} />
          {copy.share.includeQuestion}
        </label>
      </fieldset>

      <button type="button" className="taro-primary" onClick={() => void share()} disabled={busy}>
        {label}
      </button>

      {url && (
        <div className="taro-share-row">
          <input
            className="taro-share-url"
            readOnly
            value={url}
            onFocus={(event) => event.target.select()}
            aria-label={copy.share.copyLink}
          />
          <a className="taro-link" href={url} target="_blank" rel="noreferrer">
            {copy.share.openLink}
          </a>
        </div>
      )}

      {error && <p className="taro-error">{error}</p>}
    </div>
  );
}
