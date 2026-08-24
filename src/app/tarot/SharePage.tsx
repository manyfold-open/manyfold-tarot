/**
 * A shared reading, at /s/:token.
 *
 * Everything on this page comes out of the snapshot row, which was written once
 * and is never updated. Nothing here fetches the reading it came from, so a page
 * opened today shows exactly what was shared, whatever has happened to that
 * round since.
 *
 * No session, no ownership: a share link is meant to be opened by anyone, which
 * is also why the snapshot stops where it does — the reading of the cards, and
 * not the half of the interpretation that is addressed to the person who asked.
 *
 * The page is read in two passes and is built to be read that way. Above the
 * rule is the whole thing at a glance: three cards, and the one sentence they
 * came down to — which is all this page used to be, and all that some visitors
 * will want. Below the rule is the reading itself, one section per card, for the
 * visitor who wants to know *why* the sentence says what it does. Neither half
 * is folded behind a control: a shared link that arrives closed up asks a
 * stranger to press something before it will explain itself, and most of them
 * will simply not press it.
 *
 * Every field below the rule is optional in the snapshot and treated as optional
 * here. Rows written before shares carried the reading have none of them, and
 * those rows are frozen — so an old link still renders as exactly the page it
 * always rendered, with the rule and everything under it simply absent.
 */

import { useEffect, useState } from 'react';
import { cardArt, cardById, cardKeywords, type Locale } from '../../shared/tarot/deck';
import { copyFor, normalizeLocale } from '../../shared/tarot/i18n';
import type { ShareSnapshot, SlotId } from '../../shared/tarot/types';
import CardSlot from './Card';
import { Prose } from './Reading';
import Signature from './Signature';
import Sky from './Sky';
import { fetchShare } from './api';

const tokenFromPath = (): string => decodeURIComponent(location.pathname.replace(/^\/s\//, ''));

export default function SharePage() {
  const [snapshot, setSnapshot] = useState<ShareSnapshot | null>(null);
  const [missing, setMissing] = useState(false);
  const locale = snapshot ? snapshot.locale : normalizeLocale(navigator.language);
  const copy = copyFor(locale);

  useEffect(() => {
    void fetchShare(tokenFromPath())
      .then(({ share }) => setSnapshot(share))
      .catch(() => setMissing(true));
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-Hans' : 'en';
    document.title = copy.share.viewTitle;
  }, [locale, copy]);

  if (missing) {
    return (
      <div className="taro">
        <Sky />
        <main className="taro-stage">
          <p className="taro-error">{copy.share.notFound}</p>
          <a className="taro-primary" href="/">
            {copy.share.startYours}
          </a>
        </main>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="taro">
        <Sky />
        <main className="taro-stage">
          <p className="taro-instruction">…</p>
        </main>
      </div>
    );
  }

  const drawn = new Map(snapshot.cards.map((card) => [card.slot, card]));
  const perCard = snapshot.perCard ?? [];
  const hasReading = Boolean(snapshot.overview || perCard.length || snapshot.connections);

  return (
    <div className="taro">
      <Sky />
      <main className="taro-stage taro-shared">
        <h1 className="taro-shared-title">{copy.share.viewTitle}</h1>

        {snapshot.question && (
          <p className="taro-asked">
            <span className="taro-asked-label">{copy.share.viewQuestion}</span>
            {snapshot.question}
          </p>
        )}

        <div className="taro-cards">
          {snapshot.cards.map((card, index) => (
            <CardSlot
              key={card.slot}
              slot={card.slot}
              locale={locale}
              card={{
                slot: card.slot,
                index,
                cardId: card.cardId,
                reversed: card.reversed,
                hint: '',
              }}
            />
          ))}
        </div>

        <p className="taro-conclusion">{snapshot.conclusion}</p>

        {hasReading && (
          <div className="taro-reading taro-shared-reading">
            <p className="taro-reading-title">{copy.share.readingTitle}</p>

            {snapshot.overview && (
              <section className="taro-section">
                <h2>{copy.result.overview}</h2>
                <Prose text={snapshot.overview} />
              </section>
            )}

            {/* One card, one section, and the card is inside it. The spread at
                the top of the page is the picture of the reading, but by the
                time a visitor is four paragraphs down it has scrolled away, and
                a heading naming a card the reader can no longer see sends them
                back up to find out which one it was. So each section carries its
                own face — the same file the spread already loaded, so it costs a
                cache hit and nothing else. */}
            {perCard.map((entry) => (
              <ReadCard
                key={entry.slot}
                slot={entry.slot}
                card={drawn.get(entry.slot) ?? null}
                text={entry.text}
                locale={locale}
              />
            ))}

            {snapshot.connections && (
              <section className="taro-section">
                <h2>{copy.result.connections}</h2>
                <Prose text={snapshot.connections} />
              </section>
            )}
          </div>
        )}

        {/* The invitation first, the mark under it. A visitor arrives here having
            read someone else's three cards; the one thing this page wants from
            them sits directly under the sentence they just finished, and the
            mark closes the page rather than interrupting it. The line about the
            snapshot being frozen is gone: it answered a question nobody asked,
            and a shared reading that has to explain its own storage model is not
            a reading any more.

            The mark is tagged as coming from a share. This is the only page a
            stranger can land on without having chosen to, so where its traffic
            goes next is a different number from the app's own — and the
            snapshot's stored signature is no longer what stands here, because
            the heading at the top of the page already says what this is. */}
        <footer className="taro-foot">
          <a className="taro-primary" href="/">
            {copy.share.startYours}
          </a>
          <Signature locale={locale} from="share" />
        </footer>
      </main>
    </div>
  );
}

/**
 * One card's section: its face, where it fell, what it is, and what it meant
 * here.
 *
 * The face and the name are a header row and the reading runs full width beneath
 * it, rather than in a column beside a rail of art. A 48px rail costs a
 * paragraph a tenth of its measure on a phone, and the whole reason this page
 * scrolls now is that there is finally something on it long enough to be worth
 * reading properly.
 *
 * Under the card's name is its keyword line, taken from the deck rather than
 * from the snapshot. It is the raw material the diviner was handed, and printing
 * it here is the difference between a stranger reading an assertion about a card
 * and a stranger being shown the ground that assertion stands on. Taking it from
 * the deck also means it costs the snapshot nothing and cannot go stale against
 * it: the card id was frozen, and the card id is all this needs.
 */
function ReadCard({
  slot,
  card,
  text,
  locale,
}: {
  slot: SlotId;
  card: { cardId: string; reversed: boolean } | null;
  text: string;
  locale: Locale;
}) {
  const copy = copyFor(locale);
  const entry = card ? cardById(card.cardId) : null;

  return (
    <section className="taro-section taro-read-card">
      <header className="taro-read-head">
        {entry && card && (
          <img
            className={`taro-read-face${card.reversed ? ' is-reversed' : ''}`}
            src={cardArt(card.cardId)}
            // The name is printed right beside it; an alt here would say it twice.
            alt=""
            decoding="async"
            draggable={false}
          />
        )}
        <div className="taro-read-name">
          <h2>{copy.slots[slot].title}</h2>
          {entry && card && (
            <p className="taro-read-card-line">
              <strong>{entry.name[locale]}</strong>
              <span className={card.reversed ? 'taro-orient is-reversed' : 'taro-orient'}>
                {card.reversed ? copy.reveal.reversed : copy.reveal.upright}
              </span>
            </p>
          )}
          {entry && card && (
            <p className="taro-read-keywords">{cardKeywords(entry, card.reversed, locale)}</p>
          )}
        </div>
      </header>
      <Prose text={text} />
    </section>
  );
}
