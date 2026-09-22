import { useEffect, useRef, useState } from 'react';
import type { Locale } from '../../shared/tarot/deck';
import { copyFor } from '../../shared/tarot/i18n';
import { track } from './analytics';
import { createReferral, errorText, fetchReferral } from './api';

/**
 * The invite for one finished reading. It lives in two places: beside Share
 * under a reading that has just ended, and on the home page once the visitor
 * has nothing left to spend — which is where they actually go looking for it.
 *
 * Beside Share it behaves exactly like Share: one button that mints the link,
 * copies it and says so, with the link underneath for anyone whose clipboard
 * refused. The two halves of that row are one gesture, so they read as one.
 */
export default function ReferralBox({
  readingId,
  locale,
  onCompleted,
  intro = false,
}: {
  readingId: string;
  locale: Locale;
  /** Told once when this page watches the invite complete. */
  onCompleted?: () => void;
  /** The home page has no Share beside it to explain what this is for. */
  intro?: boolean;
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

    void fetchReferral(readingId)
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
  }, [readingId, copy.errors.generic]);

  // A referral is completed in the invitee's interpretation request, so the
  // owner can be looking at this page while it happens. Poll only while there
  // is an outstanding invite; completion and expiry both stop the timer.
  useEffect(() => {
    if (!url || status !== 'pending') return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void fetchReferral(readingId)
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
  }, [readingId, status, url]);

  // The home page waits on this to put the question box back.
  const completedRef = useRef(onCompleted);
  completedRef.current = onCompleted;
  useEffect(() => {
    if (status === 'completed') completedRef.current?.();
  }, [status]);

  const invite = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const created = url && status !== 'expired' ? null : await createReferral(readingId);
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

  /* Same order as Share: what it is doing beats what it just did beats what it
     will do. */
  const label = busy
    ? copy.referral.inviting
    : copied
      ? copy.referral.copied
      : url
        ? copy.referral.copyLink
        : copy.referral.invite;

  return (
    <div className={intro ? 'taro-share taro-referral-home' : 'taro-share'}>
      {intro && <p className="taro-referral-copy">{copy.referral.description}</p>}
      {/* A used link is worth nothing to copy, so once the friend has finished
          the button gives way to saying so. */}
      {status !== 'completed' && (
        <button type="button" className="taro-primary" onClick={() => void invite()} disabled={busy}>
          {label}
        </button>
      )}
      {url && status !== 'completed' && (
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
        <p className="taro-referral-status is-complete" role="status">
          {copy.referral.completed}
        </p>
      )}
      {status === 'expired' && <p className="taro-referral-status">{copy.referral.expired}</p>}
      {error && <p className="taro-error">{error}</p>}
    </div>
  );
}
