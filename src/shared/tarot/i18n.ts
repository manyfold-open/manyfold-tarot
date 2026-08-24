/**
 * Every string the user reads, in both locales.
 *
 * Shared rather than app-only because the Worker needs some of it too: slot
 * titles go into the diviner's prompt, and the fallback hint line, the demo
 * reading and the share signature all have to speak the visitor's language.
 *
 * `Copy` is one interface implemented twice, so a missing translation is a type
 * error rather than a blank in the UI.
 */

import type { Locale } from './deck';
import type { SlotId } from './types';

export interface SlotCopy {
  /** Position name, shown above the card. */
  title: string;
  /** The line spoken as this card is about to turn over. */
  prompt: string;
}

export interface Copy {
  localeName: string;
  /** Signature printed on shared readings. Says what this is, not who made it —
   *  the site has no name, and nothing here is going to invent one. */
  signature: string;
  tagline: string;

  ask: {
    title: string;
    placeholder: string;
    submit: string;
    submitting: string;
    remaining: (n: number) => string;
    empty: string;
    hintKeys: string;
  };

  greeting: {
    thinking: string;
    start: string;
  };

  shuffle: {
    /** Shown while the deck is in motion, before it is spread out. */
    instruction: string;
    /** Announced to screen readers while the deck is in motion. */
    live: string;
    /** While the Worker is committing the three cards. */
    settling: string;
    /** Shown over the spread deck, once the visitor may pick from it. */
    pick: string;
    /** Accessible name of the spread itself. */
    spreadLabel: string;
    /** Accessible name of one face-down card in the spread. */
    cardLabel: (n: number) => string;
    /** How many are still to be picked. */
    remaining: (n: number) => string;
    /** Shown once all three are set aside and only the confirming is left. */
    chosen: string;
    /** Closes the picking. Nothing turns over until this is pressed. */
    confirm: string;
  };

  slots: Record<SlotId, SlotCopy>;

  reveal: {
    faceDown: string;
    allRevealed: string;
    listen: string;
    upright: string;
    reversed: string;
  };

  result: {
    title: string;
    loading: string[];
    overview: string;
    connections: string;
    response: string;
    actions: string;
    reflection: string;
  };

  outro: {
    share: string;
    sharing: string;
    newReading: string;
    continue: string;
    continueTitle: string;
    continuePlaceholder: string;
    continueSubmit: string;
    suggestsNewReading: string;
  };

  share: {
    title: string;
    copyLink: string;
    copied: string;
    openLink: string;
    viewTitle: string;
    viewQuestion: string;
    /** Stands over the reading itself on a shared page, under the rule that
     *  separates it from the three cards. Not `result.title` — that one says
     *  "what the cards show *you*", and on a shared page the reader is not the
     *  person the cards were dealt for. */
    readingTitle: string;
    startYours: string;
    notFound: string;
  };

  errors: {
    generic: string;
    retry: string;
    tooLong: string;
    rateLimited: string;
    lost: string;
  };

  demoNotice: string;
  languageLabel: string;
  settingsLink: string;
}

const zh: Copy = {
  localeName: '简体中文',
  signature: 'AI 塔罗',
  tagline: '三张牌，一次照见。',

  ask: {
    title: '把你的问题告诉我。',
    placeholder: '',
    submit: '开始',
    submitting: '正在递给占卜师……',
    remaining: (n) => `还可以写 ${n} 字`,
    empty: '先写下你想问的事。',
    hintKeys: 'Enter 送出，Shift + Enter 换行',
  },

  greeting: {
    thinking: '占卜师正在听你说……',
    start: '开始占卜',
  },

  shuffle: {
    instruction: '暂时放下对答案的猜测。在心里重新想一遍你的问题，牌正在为你洗动。',
    live: '牌正在洗动。',
    settling: '牌正在落定……',
    pick: '牌已经铺开了。不要挑，让手替你选。',
    spreadLabel: '铺开的牌，全部背面朝上',
    cardLabel: (n) => `第 ${n} 张，背面朝上`,
    remaining: (n) => `还要选 ${n} 张`,
    chosen: '三张都在了。想换的话，再点一次就放回去。',
    confirm: '就这三张',
  },

  slots: {
    situation: {
      title: '此刻的处境',
      prompt: '第一张，照见你此刻所处的位置。',
    },
    hidden: {
      title: '隐藏的影响',
      prompt: '第二张，揭示尚未被你看清的影响。',
    },
    guidance: {
      title: '接下来的指引',
      prompt: '最后一张，指向你接下来可以采取的行动。',
    },
  },

  reveal: {
    faceDown: '尚未翻开',
    allRevealed: '牌已经到齐。让我把它们连在一起。',
    listen: '聆听解读',
    upright: '正位',
    reversed: '逆位',
  },

  result: {
    title: '为你照见的部分',
    loading: ['我正在梳理三张牌之间的联系……', '这组牌的信息很多，让我慢慢为你展开。'],
    overview: '三张牌',
    connections: '三张牌之间',
    response: '回到你的问题',
    actions: '你可以做的事',
    reflection: '留给你的问题',
  },

  outro: {
    share: '分享这次解读',
    sharing: '正在生成分享……',
    newReading: '再问一件事',
    continue: '继续解读这三张牌',
    continueTitle: '还有什么想问这三张牌？',
    continuePlaceholder: '比如：为什么这张牌会落在“隐藏的影响”？',
    continueSubmit: '问下去',
    suggestsNewReading: '这更像是一个新的问题。要为它重新抽一次牌吗？',
  },

  share: {
    title: '分享这次解读',
    copyLink: '复制链接',
    copied: '已复制',
    openLink: '打开分享页',
    viewTitle: '一次塔罗解读',
    viewQuestion: '当时的问题',
    readingTitle: '完整解读',
    startYours: '也去问一次',
    notFound: '这份分享不存在，或已被撤下。',
  },

  errors: {
    generic: '牌一时没有回应。稍后再试一次。',
    retry: '再试一次',
    tooLong: '问题太长了，请精简一些。',
    rateLimited: '今天问得有点多了，让牌歇一会儿再来。',
    lost: '这一轮占卜已经找不到了，重新开始吧。',
  },

  demoNotice: '演示模式：占卜师尚未连接，以下解读来自内置示例。',
  languageLabel: '语言',
  settingsLink: '设置',
};

const en: Copy = {
  localeName: 'English',
  signature: 'AI Tarot',
  tagline: 'Three cards, one clear look.',

  ask: {
    title: 'Tell me what you want to ask.',
    placeholder: '',
    submit: 'Begin',
    submitting: 'Passing it to the reader…',
    remaining: (n) => `${n} characters left`,
    empty: 'Write down what you want to ask first.',
    hintKeys: 'Enter to send, Shift + Enter for a new line',
  },

  greeting: {
    thinking: 'The reader is listening…',
    start: 'Begin the reading',
  },

  shuffle: {
    instruction:
      'Set your guesses about the answer aside. Hold your question once more while the deck moves.',
    live: 'The deck is shuffling.',
    settling: 'The cards are settling…',
    pick: 'The deck is spread out. Do not choose — let your hand choose.',
    spreadLabel: 'The spread deck, every card face down',
    cardLabel: (n) => `Card ${n}, face down`,
    remaining: (n) => `${n} still to pick`,
    chosen: 'All three are set aside. Touch one again to put it back.',
    confirm: 'These three',
  },

  slots: {
    situation: {
      title: 'Where you stand',
      prompt: 'The first card shows the place you are standing in right now.',
    },
    hidden: {
      title: 'The hidden influence',
      prompt: 'The second card reveals what has been shaping this out of your sight.',
    },
    guidance: {
      title: 'What comes next',
      prompt: 'The last card points to what you can actually do from here.',
    },
  },

  reveal: {
    faceDown: 'Face down',
    allRevealed: 'All three are here. Let me draw the line between them.',
    listen: 'Hear the reading',
    upright: 'Upright',
    reversed: 'Reversed',
  },

  result: {
    title: 'What the cards show you',
    loading: [
      'I am tracing the line between the three cards…',
      'There is a lot here. Let me open it slowly.',
    ],
    overview: 'The three cards',
    connections: 'Between the cards',
    response: 'Back to your question',
    actions: 'What you can do',
    reflection: 'A question to sit with',
  },

  outro: {
    share: 'Share this reading',
    sharing: 'Preparing the share…',
    newReading: 'Ask about something else',
    continue: 'Keep reading these three cards',
    continueTitle: 'What else do you want to ask these three cards?',
    continuePlaceholder: 'For example: why did this card land on the hidden influence?',
    continueSubmit: 'Ask',
    suggestsNewReading: 'That sounds like a new question. Shall I draw a fresh set for it?',
  },

  share: {
    title: 'Share this reading',
    copyLink: 'Copy link',
    copied: 'Copied',
    openLink: 'Open share page',
    viewTitle: 'A tarot reading',
    viewQuestion: 'The question asked',
    readingTitle: 'The full reading',
    startYours: 'Ask your own',
    notFound: 'This share does not exist, or it was taken down.',
  },

  errors: {
    generic: 'The cards did not answer just now. Try once more in a moment.',
    retry: 'Try again',
    tooLong: 'That question is too long — please tighten it.',
    rateLimited: 'That is a lot of questions for one day. Let the deck rest a while.',
    lost: 'That reading can no longer be found. Let us start again.',
  },

  demoNotice: 'Demo mode: no reader is connected yet, so this reading comes from the built-in sample.',
  languageLabel: 'Language',
  settingsLink: 'Settings',
};

export const COPY: Record<Locale, Copy> = { zh, en };

export const copyFor = (locale: Locale): Copy => COPY[locale] ?? COPY.zh;

/** Normalizes anything (query param, header, stored value) to a supported locale. */
export function normalizeLocale(value: unknown): Locale {
  const raw = String(value ?? '').toLowerCase();
  if (raw.startsWith('en')) return 'en';
  return 'zh';
}
