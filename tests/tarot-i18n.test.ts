/**
 * The copy is part of the product, not decoration around it. The spec fixes a
 * number of sentences word for word, forbids the machine's vocabulary entirely,
 * and asks for two languages — so all three are asserted here rather than left
 * to a reviewer's eye.
 */

import { describe, expect, it } from 'vitest';
import { DECK, LOCALES, type Locale } from '../src/shared/tarot/deck';
import { COPY, copyFor, normalizeLocale, type Copy } from '../src/shared/tarot/i18n';
import { SPREAD_IDS, spreadFor } from '../src/shared/tarot/spreads';
import { QUESTION_MAX_CHARS, SLOT_ORDER } from '../src/shared/tarot/types';

/** Every string in a Copy tree, with a dotted path, for sweeping assertions. */
function leaves(value: unknown, path = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]];
  if (typeof value === 'function') return [[path, String((value as (n: number) => string)(7))]];
  if (Array.isArray(value)) return value.flatMap((item, i) => leaves(item, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) =>
      leaves(item, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

const shapeOf = (copy: Copy): string[] => leaves(copy).map(([path]) => path).sort();

describe('the sentences the spec pinned', () => {
  const zh = copyFor('zh');

  it('opens with the question and nothing else', () => {
    expect(zh.ask.title).toBe('把你的问题告诉我。');
    expect(zh.ask.submit).toBe('开始');
  });

  it('asks for nothing during the shuffle but the question itself', () => {
    expect(zh.greeting.start).toBe('开始占卜');
    expect(zh.shuffle.instruction).toContain('在心里重新想一遍你的问题');
    // The deck now stops on its own, so there is no longer anything to press.
    expect(zh.shuffle.instruction).not.toContain('让牌停下');
  });

  it('names the three positions and their lines', () => {
    expect(zh.slots.situation.title).toBe('此刻的处境');
    expect(zh.slots.hidden.title).toBe('隐藏的影响');
    expect(zh.slots.guidance.title).toBe('接下来的指引');

    expect(zh.slots.situation.prompt).toBe('第一张，照见你此刻所处的位置。');
    expect(zh.slots.hidden.prompt).toBe('第二张，揭示尚未被你看清的影响。');
    expect(zh.slots.guidance.prompt).toBe('最后一张，指向你接下来可以采取的行动。');
  });

  it('closes the reveal and opens the reading with the given lines', () => {
    expect(zh.reveal.allRevealed).toBe('牌已经到齐。让我把它们连在一起。');
    expect(zh.reveal.listen).toBe('聆听解读');
    expect(zh.reveal.upright).toBe('正位');
    expect(zh.reveal.reversed).toBe('逆位');
  });

  it('offers exactly the three closing actions, in the spec order', () => {
    expect(zh.outro.share).toBe('分享这次解读');
    expect(zh.outro.newReading).toBe('再问一件事');
    expect(zh.outro.continue).toBe('继续解读这三张牌');
  });
});

describe('the machine never speaks', () => {
  const forbidden = [
    'AI 正在分析',
    'AI正在分析',
    'AI 分析结果',
    '模型正在生成',
    '系统处理中',
    '推理过程',
    'Chain of Thought',
    'chain of thought',
    '内部工具调用',
    'prompt',
    'token',
  ];

  it('says none of it, in either language', () => {
    for (const locale of LOCALES) {
      for (const [path, text] of leaves(COPY[locale])) {
        for (const phrase of forbidden) {
          expect(text.toLowerCase(), `${locale}.${path}`).not.toContain(phrase.toLowerCase());
        }
      }
    }
  });

  it('titles the reading after the cards, not after the model', () => {
    expect(copyFor('zh').result.title).toBe('为你照见的部分');
    expect(copyFor('en').result.title).toBe('What the cards show you');
  });

  it('waits in the diviner voice, with more than one line to say', () => {
    for (const locale of LOCALES) {
      const lines = copyFor(locale).result.loading;
      expect(lines.length, locale).toBeGreaterThanOrEqual(2);
      for (const line of lines) expect(line.trim(), locale).not.toBe('');
    }
  });
});

describe('picking from the spread', () => {
  it('invites the visitor to pick, without pretending they are choosing a card', () => {
    expect(copyFor('zh').shuffle.pick).toBe('牌已经铺开了。不要挑，让手替你选。');
    expect(copyFor('zh').shuffle.settling).toBe('牌正在落定……');
  });

  it('names a face-down card by its place and nothing else', () => {
    for (const locale of LOCALES) {
      const copy = copyFor(locale);
      expect(copy.shuffle.spreadLabel, locale).toMatch(/背面朝上|face down/);

      const label = copy.shuffle.cardLabel(12);
      expect(label, locale).toContain('12');
      // A place in the spread is not a card. If a label could carry a name or an
      // orientation, the browser would be deciding something it must not decide.
      for (const card of DECK) {
        expect(label, `${locale} leaks ${card.id}`).not.toContain(card.name[locale]);
      }
      expect(label, locale).not.toContain(copy.reveal.upright);
      expect(label, locale).not.toContain(copy.reveal.reversed);
    }
  });

  it('counts down how many are still to be picked', () => {
    for (const locale of LOCALES) {
      expect(copyFor(locale).shuffle.remaining(3), locale).toContain('3');
    }
  });
});

describe('two languages, one shape', () => {
  it('translates every single string', () => {
    expect(shapeOf(COPY.en)).toEqual(shapeOf(COPY.zh));
  });

  it('gives every spread a whole example question, in both languages', () => {
    // Choosing a spread puts its example in the box, so a first-time visitor
    // starts from a question to edit rather than a blank line.
    for (const id of SPREAD_IDS) {
      const zh = spreadFor(id, 'zh').example;
      const en = spreadFor(id, 'en').example;
      expect(zh.trim(), `${id}.zh`).not.toBe('');
      expect(en.trim(), `${id}.en`).not.toBe('');
      expect(en, id).not.toBe(zh);
      expect(zh.length, `${id}.zh`).toBeLessThanOrEqual(QUESTION_MAX_CHARS);
      expect(en.length, `${id}.en`).toBeLessThanOrEqual(QUESTION_MAX_CHARS);
    }
  });

  it('leaves nothing else blank and nothing untranslated', () => {
    const zh = new Map(leaves(COPY.zh));
    for (const [path, english] of leaves(COPY.en)) {
      expect(english.trim(), `en.${path}`).not.toBe('');
      expect(english, `en.${path}`).not.toBe(zh.get(path));
    }
  });

  it('covers all three slots in both', () => {
    for (const locale of LOCALES) {
      for (const slot of SLOT_ORDER) {
        const copy = copyFor(locale).slots[slot];
        expect(copy.title.trim(), `${locale}.${slot}`).not.toBe('');
        expect(copy.prompt.trim(), `${locale}.${slot}`).not.toBe('');
      }
    }
  });
});

describe('normalizeLocale', () => {
  it('recognises the two we have', () => {
    expect(normalizeLocale('en')).toBe('en');
    expect(normalizeLocale('EN')).toBe('en');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('zh')).toBe('zh');
    expect(normalizeLocale('zh-CN')).toBe('zh');
  });

  it('falls back to Chinese rather than failing', () => {
    for (const value of [null, undefined, '', 'fr', 42, {}, [], 'zh; DROP TABLE']) {
      expect(normalizeLocale(value)).toBe('zh');
    }
  });

  it('always returns something copyFor can use', () => {
    const locales: Locale[] = [...LOCALES];
    for (const locale of locales) expect(copyFor(locale).tagline.trim()).not.toBe('');
    expect(copyFor('de' as Locale).tagline).toBe(COPY.zh.tagline);
  });
});
