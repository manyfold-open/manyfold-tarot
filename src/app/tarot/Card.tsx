/**
 * One card in the spread, face down or face up.
 *
 * The face is the deck's own art, looked up from the card id — which is also why
 * a reversed card is genuinely the same card turned around (`rotate(180deg)`)
 * rather than a second picture. The name and the numeral are printed on the art
 * in English; the caption under the card carries the localized name, so the two
 * never say the same thing twice in the same language.
 *
 * The component is told what to show; it never decides. A face-down slot has no
 * card prop at all, which is also the literal truth over the wire: the browser
 * has not been told what that card is yet, and there is no image for it to have
 * fetched early.
 */

import { useState } from 'react';
import { cardArt, cardById, type Locale } from '../../shared/tarot/deck';
import { copyFor } from '../../shared/tarot/i18n';
import { appUrl } from '../base';
import type { DrawnCardView, SlotId } from '../../shared/tarot/types';

export interface CardSlotProps {
  slot: SlotId;
  locale: Locale;
  /** Present only once the visitor has turned this card over. */
  card: DrawnCardView | null;
  /** Face-down cards animate in place while the deck is still settling. */
  settling?: boolean;
}

export default function CardSlot({ slot, locale, card, settling = false }: CardSlotProps) {
  const copy = copyFor(locale);
  const slotCopy = copy.slots[slot];
  const entry = card ? cardById(card.cardId) : null;
  const faceUp = Boolean(card && entry);

  /* Which card's art has actually arrived. Holding the id rather than a boolean
     means the next round resets it by itself: a new card is not yet loaded until
     its own onLoad says so. The art fades in over the dark card stock, so a slow
     network shows a card still turning rather than a hole in the table. */
  const [loaded, setLoaded] = useState('');

  return (
    <figure className={`taro-slot${faceUp ? ' is-up' : ''}`}>
      <div className={`taro-card${faceUp ? ' is-up' : ''}${settling ? ' is-settling' : ''}`}>
        <div className="taro-card-inner">
          <div className="taro-card-face taro-card-back" aria-hidden={faceUp} />
          <div className="taro-card-face taro-card-front" aria-hidden={!faceUp}>
            {entry && card && (
              <div className={`taro-card-art${card.reversed ? ' is-reversed' : ''}`}>
                <img
                  key={card.cardId}
                  className={`taro-card-photo${loaded === card.cardId ? ' is-loaded' : ''}`}
                  src={appUrl(cardArt(card.cardId))}
                  // The caption names the card; an alt here would say it twice.
                  alt=""
                  decoding="async"
                  draggable={false}
                  onLoad={() => setLoaded(card.cardId)}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <figcaption className="taro-slot-caption">
        <span className="taro-slot-title">{slotCopy.title}</span>
        {faceUp && entry && card ? (
          <span className="taro-card-label">
            <strong>{entry.name[locale]}</strong>
            <span className={card.reversed ? 'taro-orient is-reversed' : 'taro-orient'}>
              {card.reversed ? copy.reveal.reversed : copy.reveal.upright}
            </span>
          </span>
        ) : (
          <span className="taro-card-label muted">{copy.reveal.faceDown}</span>
        )}
      </figcaption>
    </figure>
  );
}
