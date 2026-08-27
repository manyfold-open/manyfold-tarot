/**
 * Sharing the round on screen.
 *
 * One press. It mints the link, puts it on the clipboard, and says so — there is
 * no panel to open first and no box to tick. The tick box asked a question
 * nobody was in a position to answer: the question is the whole reason a shared
 * reading makes sense to the person receiving it, and a share of three cards and
 * one sentence with no question attached is a card trick. So the question goes
 * in, and the wire still carries the flag because the server has always decided
 * this, not the button.
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
import type { Locale } from '../../shared/tarot/deck';
import { copyFor } from '../../shared/tarot/i18n';
import type { ReadingView } from '../../shared/tarot/types';
import { track } from './analytics';
import { createShare, errorText } from './api';

export default function ShareBox({ reading, locale }: { reading: ReadingView; locale: Locale }) {
  const copy = copyFor(locale);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  // A different round is on screen: nothing from the last one carries over.
  useEffect(() => {
    setUrl('');
    setCopied(false);
    setError('');
  }, [reading.readingId]);

  const share = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const link = url || (await createShare(reading.readingId, true)).url;
      setUrl(link);
      // Counted where the snapshot is minted, not where the button is pressed:
      // pressing again re-copies a link that already exists, and one round that
      // was shared once is one share.
      if (!url) track('reading_shared', { locale });
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
        : copy.outro.share;

  return (
    <div className="taro-share">
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
