/**
 * The Fortune Stick at the end of a reading: the one next step this page most
 * wants taken, so it is a card of its own and holds the only filled button.
 *
 * It promises another Tarot question only when drawing a stick would actually
 * unlock one (`offer`); otherwise it just invites a stick for today. The link
 * opens in a new tab so this reading stays where it is.
 */

import type { Locale } from '../../shared/tarot/deck';
import { copyFor } from '../../shared/tarot/i18n';
import StickIcon from './StickIcon';

export default function StickCard({
  href,
  offer,
  locale,
  onOpen,
}: {
  href: string;
  offer: boolean;
  locale: Locale;
  onOpen?: () => void;
}) {
  const copy = copyFor(locale);
  return (
    <div className="taro-stick-card">
      <div className="taro-stick-card-text">
        <p className="taro-stick-card-title">
          {copy.bridge.stickCta}
          <StickIcon />
        </p>
        <p className="taro-stick-card-line">{offer ? copy.bridge.outroOffer : copy.bridge.outroContinue}</p>
      </div>
      <a
        className="taro-stick-go"
        href={href}
        target="_blank"
        rel="noopener"
        aria-label={copy.bridge.stickCta}
        onClick={onOpen}
      >
        {copy.bridge.stickGo}
      </a>
    </div>
  );
}
