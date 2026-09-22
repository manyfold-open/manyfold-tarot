import { useEffect, useState } from 'react';
import type { Locale } from '../../shared/tarot/deck';
import { copyFor } from '../../shared/tarot/i18n';
import type { ReadingView } from '../../shared/tarot/types';
import { track } from './analytics';
import { createReferral, errorText } from './api';

export default function ReferralBox({ reading, locale }: { reading: ReadingView; locale: Locale }) {
  const copy = copyFor(locale);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<'pending' | 'completed' | 'expired' | null>(null);

  useEffect(() => {
    setUrl('');
    setCopied(false);
    setError('');
    setStatus(null);
  }, [reading.readingId]);

  const invite = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const created = url ? null : await createReferral(reading.readingId);
      const link = url || created!.url;
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
    ? copy.referral.completed
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
      <button type="button" className="taro-secondary" onClick={() => void invite()} disabled={busy || status === 'completed'}>
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
      {error && <p className="taro-error">{error}</p>}
    </div>
  );
}
