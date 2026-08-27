/**
 * The one banner on the site, and the rules it obeys.
 *
 * It appears only where consent is actually owed — the EEA, the UK and
 * Switzerland — because a visitor in São Paulo being asked to agree to something
 * that already applies to them is a dialogue box with no question in it. The
 * Worker makes that call from the request's country and hands the answer down
 * (`required`); the share page has nobody to hand it down, so the banner asks
 * for itself, and only when it has no stored answer to go on.
 *
 * Accepting and declining are the same size and the same weight. A "Decline"
 * styled as the quiet one is a dark pattern with a stylesheet, and it is also
 * the specific thing that gets consent thrown out.
 *
 * Nothing here is load-bearing for privacy: by the time this renders, the tag in
 * the page head has already denied itself in every region that requires it
 * (src/worker/analytics.ts). This is how the visitor changes that, not what
 * enforces it.
 */

import { useEffect, useState } from 'react';
import type { Locale } from '../../shared/tarot/deck';
import { copyFor } from '../../shared/tarot/i18n';
import { measuring, setConsent, storedConsent, type Consent as Choice } from './analytics';
import { fetchReader } from './api';

export default function Consent({
  locale,
  required,
}: {
  locale: Locale;
  /** What the Worker said, when somebody already asked it. Undefined means
   *  nobody did, and this component will ask. */
  required?: boolean;
}) {
  const copy = copyFor(locale);
  const [answered, setAnswered] = useState(() => storedConsent() !== null);
  const [owed, setOwed] = useState<boolean | null>(required ?? null);

  useEffect(() => {
    if (required !== undefined) setOwed(required);
  }, [required]);

  useEffect(() => {
    // Only the case nobody answered for us, and only while it can still matter:
    // a browser that has already chosen never makes this request.
    if (required !== undefined || answered || !measuring()) return;
    let cancelled = false;
    void fetchReader()
      .then((info) => {
        if (!cancelled) setOwed(info.consentRequired);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [required, answered]);

  if (answered || owed !== true || !measuring()) return null;

  const answer = (choice: Choice) => {
    setConsent(choice);
    setAnswered(true);
  };

  return (
    <aside className="taro-consent" role="region" aria-label={copy.consent.label}>
      <p className="taro-consent-line">
        {copy.consent.line}{' '}
        <a className="taro-link" href="/privacy">
          {copy.consent.more}
        </a>
      </p>
      <div className="taro-consent-answer">
        <button type="button" className="taro-consent-button" onClick={() => answer('denied')}>
          {copy.consent.decline}
        </button>
        <button type="button" className="taro-consent-button" onClick={() => answer('granted')}>
          {copy.consent.accept}
        </button>
      </div>
    </aside>
  );
}
