import { useEffect, useState } from 'react';
import type { Locale } from '../../shared/tarot/deck';
import { copyFor } from '../../shared/tarot/i18n';
import type { ReadingView } from '../../shared/tarot/types';
import { track } from './analytics';
import { createReferral, errorText, fetchReferral } from './api';

export default function ReferralBox({
  reading,
  locale,
  onNewReading,
}: {
  reading: ReadingView;
  locale: Locale;
  onNewReading: () => void;
}) {
  const copy = copyFor(locale);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<'pending' | 'completed' | 'expired' | null>(null);

  // Restore an invite when the owner comes back to a finished reading. This is
  // also the first status check, so the owner does not need to press the invite
  // button again just to learn that a friend already used it.
  useEffect(() => {
    let cancelled = false;
    setUrl('');
    setCopied(false);
    setError('');
    setStatus(null);

    void fetchReferral(reading.readingId)
      .then((current) => {
        if (cancelled || !current.referral || !current.url) return;
        setUrl(current.url);
        setStatus(current.referral.status);
      })
      .catch((caught) => {
        if (!cancelled) setError(errorText(caught, copy.errors.generic));
      });

    return () => {
      cancelled = true;
    };
  }, [reading.readingId, copy.errors.generic]);

  // A referral is completed in the invitee's interpretation request, so the
  // owner can be looking at this page while it happens. Poll only while there
  // is an outstanding invite; completion and expiry both stop the timer.
  useEffect(() => {
    if (!url || status !== 'pending') return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void fetchReferral(reading.readingId)
        .then((current) => {
          if (cancelled || !current.referral || !current.url) return;
          setUrl(current.url);
          setStatus(current.referral.status);
        })
        .catch(() => {
          /* A transient status check failure should not hide the invite. */
        });
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [reading.readingId, status, url]);

  const invite = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const created = url && status !== 'expired' ? null : await createReferral(reading.readingId);
      const link = created?.url ?? url;
      setUrl(link);
      if (created) setStatus(created.referral.status);
      if (!url) track('referral_created', { locale });
      try {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2400);
      } catch {
        /* The link remains visible for manual copying. */
      }
    } catch (caught) {
      setError(errorText(caught, copy.errors.generic));
    } finally {
      setBusy(false);
    }
  };

  const label = status === 'completed'
    ? copy.referral.copyLink
    : busy
    ? copy.referral.inviting
    : copied
      ? copy.referral.copied
      : url
        ? copy.referral.copyLink
        : copy.referral.invite;

  return (
    <div className="taro-referral">
      <p className="taro-referral-title">{copy.referral.title}</p>
      <p className="taro-referral-copy">{copy.referral.description}</p>
      <button type="button" className="taro-secondary" onClick={() => void invite()} disabled={busy}>
        {label}
      </button>
      {url && (
        <input
          className="taro-share-url"
          readOnly
          value={url}
          onFocus={(event) => event.target.select()}
          aria-label={copy.referral.copyLink}
        />
      )}
      {status === 'pending' && <p className="taro-referral-status" role="status">{copy.referral.pending}</p>}
      {status === 'completed' && (
        <>
          <p className="taro-referral-status is-complete" role="status">
            {copy.referral.completed}
          </p>
          <button type="button" className="taro-link" onClick={onNewReading}>
            {copy.referral.startAgain}
          </button>
        </>
      )}
      {status === 'expired' && <p className="taro-referral-status">{copy.referral.expired}</p>}
      {error && <p className="taro-error">{error}</p>}
    </div>
  );
}
