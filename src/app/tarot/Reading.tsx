/**
 * The full reading: eight sections, never relabelled as machine output.
 *
 *   1 直接结论 · 2 三张牌概览 · 3 每张牌在牌位上的解释 · 4 三张牌之间的联系
 *   5 对问题的综合回应 · 6 现实行动建议 · 7 一个反思问题 · 8 收尾语
 *
 * The reader writes them in that order; the page shows them in the order they
 * are used. The answer, then what to do about it and the question to keep —
 * the parts people come back for — and only then the reading of the cards,
 * folded into one list to be opened rather than scrolled past. The sequence
 * lives here, written out, so that a section cannot quietly go missing or swap
 * places: whatever the reader sends back is poured into this shape.
 */

import { cardById, type Locale } from '../../shared/tarot/deck';
import { copyFor } from '../../shared/tarot/i18n';
import type { DrawnCardView, Interpretation, SlotId, SpreadId } from '../../shared/tarot/types';
import { spreadFor } from '../../shared/tarot/spreads';
import { track } from './analytics';

/** Renders reader prose: blank lines become paragraphs, nothing else is parsed. */
export function Prose({ text, className }: { text: string; className?: string }) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return null;
  return (
    <div className={className ? `taro-text ${className}` : 'taro-text'}>
      {paragraphs.map((block, index) => (
        <p key={index}>
          {block.split('\n').map((line, lineIndex, lines) => (
            <span key={lineIndex}>
              {line}
              {lineIndex < lines.length - 1 && <br />}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}

export interface ReadingProps {
  interpretation: Interpretation;
  cards: DrawnCardView[];
  locale: Locale;
  spreadId?: SpreadId;
  onFollowUpPrompt?: (prompt: string) => void;
}

export default function Reading({ interpretation, cards, locale, spreadId = 'current', onFollowUpPrompt }: ReadingProps) {
  const copy = copyFor(locale);
  const spread = spreadFor(spreadId, locale);
  const bySlot = new Map<SlotId, DrawnCardView>(cards.map((card) => [card.slot, card]));

  const cardLine = (slot: SlotId): string => {
    const drawn = bySlot.get(slot);
    const entry = drawn ? cardById(drawn.cardId) : null;
    if (!drawn || !entry) return copy.slots[slot].title;
    const orientation = drawn.reversed ? copy.reveal.reversed : copy.reveal.upright;
    return `${entry.name[locale]} · ${orientation}`;
  };

  return (
    <article className="taro-reading">
      <h2 className="taro-reading-title">{copy.result.title}</h2>

      {/* 1 — the answer, before anything else */}
      <Prose text={interpretation.conclusion} className="taro-conclusion" />

      {/* 6 — what to do about it, straight after the answer */}
      {interpretation.actions.length > 0 && (
        <section className="taro-section">
          <h3>{copy.result.actions}</h3>
          <ol className="taro-actions">
            {interpretation.actions.map((action, index) => (
              <li key={index}>{action}</li>
            ))}
          </ol>
        </section>
      )}

      {/* 7 */}
      {interpretation.reflection.trim() && (
        <section className="taro-section taro-reflection">
          <h3>{copy.result.reflection}</h3>
          <Prose text={interpretation.reflection} />
        </section>
      )}

      {/* 2, 3, 4, 5 — the reading of the cards, one row each, opened on demand.
          Each card's row carries an id so the spread beside it can open it. */}
      <section className="taro-reading-details" aria-label={copy.result.fullReading}>
        <h3 className="taro-reading-details-title">{copy.result.fullReading}</h3>
        <details className="taro-section taro-detail" onToggle={(event) => {
          if (event.currentTarget.open) track('result_detail_opened', { locale, section: 'overview' });
        }}>
          <summary>{copy.result.overview}</summary>
          <Prose text={interpretation.overview} />
        </details>

        {interpretation.perCard.map((entry) => (
          <details className="taro-section taro-detail" id={`taro-detail-${entry.slot}`} data-slot={entry.slot} key={entry.slot} onToggle={(event) => {
            if (event.currentTarget.open) track('result_detail_opened', { locale, section: `card_${entry.slot}` });
          }}>
            <summary>
              <span>{spread.slots[entry.slot].title}</span>
              <span className="taro-section-card">{cardLine(entry.slot)}</span>
            </summary>
            <Prose text={entry.text} />
          </details>
        ))}

        <details className="taro-section taro-detail" onToggle={(event) => {
          if (event.currentTarget.open) track('result_detail_opened', { locale, section: 'connections' });
        }}>
          <summary>{copy.result.connections}</summary>
          <Prose text={interpretation.connections} />
        </details>

        <details className="taro-section taro-detail" onToggle={(event) => {
          if (event.currentTarget.open) track('result_detail_opened', { locale, section: 'response' });
        }}>
          <summary>{copy.result.response}</summary>
          <Prose text={interpretation.response} />
        </details>
      </section>

      {/* 8 */}
      {interpretation.closing.trim() && (
        <Prose text={interpretation.closing} className="taro-closing" />
      )}

      {onFollowUpPrompt && (
        <section className="taro-quick-followups" aria-label={copy.outro.continueTitle}>
          {(spread.quickFollowUps ?? copy.result.quickFollowUps).map((prompt, index) => (
            <button key={index} type="button" className="taro-quick-prompt" onClick={() => {
              track('follow_up_prompt_selected', { locale, prompt_index: index });
              onFollowUpPrompt(prompt);
            }}>{prompt}</button>
          ))}
        </section>
      )}
    </article>
  );
}
