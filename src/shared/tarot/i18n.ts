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
  /** Written into every share snapshot, and kept for the ones already written.
   *  No page renders it any more: the foot of both pages now carries the mark of
   *  what this was built with instead, and a shared reading is titled in its own
   *  heading. Says what this is, not who made it — the site has no name, and
   *  nothing here is going to invent one. */
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
    /** The same button when there is nothing left to ask with: it only goes
     *  home, where the invite waits. */
    backHome: string;
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
    goToStick: string;
    notFound: string;
  };

  referral: {
    description: string;
    invited: string;
    invite: string;
    inviting: string;
    copied: string;
    copyLink: string;
    pending: string;
    completed: string;
    expired: string;
    /** The home page, once today's free and extra readings are both spent. */
    lockedTitle: string;
    /** The home page, when only the free reading is spent and the extra one is still to unlock. */
    lockedFreeTitle: string;
    /** The same, when no reading has finished yet to invite from. */
    lockedNoInvite: string;
  };

  bridge: {
    stickCta: string;
    outroOffer: string;
    outroContinue: string;
    lockedOffer: string;
    /** A Stick reward is waiting behind today's free reading. */
    bonusReady: string;
    /** A Stick reward is waiting and the free reading is already spent. */
    bonusReadyNow: string;
    /** What happened to a Stick reward that could not be saved. */
    bonusExpired: string;
    bonusDailyLimit: string;
    bonusUnusable: string;
    bonusFailed: string;
    bonusRetry: string;
  };

  /** The two lines at the foot of the page. Both are links out, so both say
   *  where they go — the visible line for the eye, the label for a reader that
   *  cannot see one is about to leave the site.
   *
   *  The words "powered by" are deliberately not here. They belong to the
   *  wordmark they sit against, not to the copy, and they are set in English in
   *  both locales; Signature.tsx holds them next to the mark itself. */
  footer: {
    /** Accessible name for the wordmark, which is one link. */
    manyfold: string;
    openSource: string;
    /** The visible line already says what. This says where. */
    openSourceLabel: string;
  };

  /** The consent banner. Drawn only for visitors who are owed one — the Worker
   *  decides that from the request's country, and the tag in the page head has
   *  already denied itself in those regions before this is on screen. */
  consent: {
    line: string;
    accept: string;
    decline: string;
    more: string;
    /** Accessible name of the banner itself. */
    label: string;
  };

  /** The one page on this site that is prose: what is kept, who else sees it,
   *  and how to take back an answer already given. */
  privacy: {
    title: string;
    intro: string;
    sections: { title: string; body: string[] }[];
    choiceTitle: string;
    state: (choice: 'granted' | 'denied' | 'unset') => string;
    accept: string;
    decline: string;
    back: string;
  };

  errors: {
    generic: string;
    retry: string;
    tooLong: string;
    rateLimited: string;
    lost: string;
    readingLimit: string;
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
    backHome: '回到首页',
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
    goToStick: '也去抽一支签',
    notFound: '这份分享不存在，或已被撤下。',
  },

  referral: {
    description: '邀请一位朋友完成一次塔罗解读，你就能解锁下一次。',
    invited: '有人邀请你来问一次牌。',
    invite: '邀请朋友，再玩一次',
    inviting: '正在生成邀请链接……',
    copied: '链接已复制',
    copyLink: '复制邀请链接',
    pending: '等待朋友完成，完成后这里会自动更新。',
    completed: '朋友已完成，你已解锁下一次。',
    expired: '这个邀请已过期，再生成一个新的邀请。',
    lockedTitle: '今天的免费和额外解读都用完了，明天再来。',
    lockedFreeTitle: '今天的免费一次已经用过了。',
    lockedNoInvite: '完成一次解读后，才能邀请朋友来解锁下一次。',
  },

  bridge: {
    stickCta: '抽一支今天的签',
    outroOffer: '抽完一支签，今天还可以再问一次塔罗。',
    outroContinue: '也可以来求一支签，看看今天的提示。',
    lockedOffer: '抽一支签，解锁今天额外一次塔罗。',
    bonusReady: '求签奖励已保存。今天先用免费解读，之后还可以再问一次。',
    bonusReadyNow: '求签奖励已解锁，今天还可以再问一次。',
    bonusExpired: '这支签的奖励只在抽签当天有效，已经过期了。',
    bonusDailyLimit: '今天的额外一次已经领过或用过了，明天再来。',
    bonusUnusable: '这个奖励链接用不了，可能已在别的浏览器领取过。回求签页再开一次塔罗即可。',
    bonusFailed: '求签奖励暂时没能保存。',
    bonusRetry: '再试一次',
  },

  footer: {
    manyfold: '这个占卜由 Manyfold 搭建 —— 在新窗口打开 manyfold.ai',
    openSource: '开源项目 · 在 GitHub 上复刻',
    openSourceLabel: '开源项目 —— 在新窗口打开 GitHub 上的源码',
  },

  consent: {
    line: '我们想用 Google Analytics 记录站点的使用情况，也用它衡量广告效果。你的问题和解读内容不会被送去。',
    accept: '同意',
    decline: '不同意',
    more: '隐私说明',
    label: 'Cookie 与统计',
  },

  privacy: {
    title: '隐私说明',
    intro: '这是一个占卜站点，不需要注册，也没有账号。下面写的是它实际会保留什么，以及这些内容会经过谁的手。',
    sections: [
      {
        title: '这个站点会保留什么',
        body: [
          '一个只有编号的会话 cookie（taro_sid），用来在你刷新页面之后仍然认得出这一轮占卜是你的。它不带姓名，也不跨站点。',
          '你写下的问题、抽到的三张牌，以及占卜师给出的解读，保存在运营者的 Cloudflare 数据库里。',
          '如果你按下分享，这一次的解读会被冻结成一份快照——拿到链接的人都能看到它。',
          '如果你邀请朋友，站点会保留一枚只用一次的邀请编号和完成状态，用来给你解锁下一次占卜；它不带姓名。',
          '如果你从求签回来领取额外解读，站点会把这一天的奖励编号和使用状态记在匿名会话下；它不包含求签的问题或解读。',
          '浏览器本地还会记住三样东西：你选的语言、当前这一轮占卜的编号，以及你对下面这个问题的回答。',
        ],
      },
      {
        title: '谁还会看到',
        body: [
          '你的问题和三张牌会交给写这段解读的 Manyfold 智能体——没有它就没有解读。',
          '在你同意之后（或者你所在的地区不需要事先征询时），页面浏览、占卜过程中的关键节点、塔罗与求签的入口点击，以及额外解读的领取和使用会记录到 Google Analytics。你写的问题、抽到的牌、解读正文和奖励凭证都不会送去。',
        ],
      },
      {
        title: '关于同意',
        body: [
          '在欧洲经济区、英国和瑞士，页面在你回答之前不会存放任何统计或广告用途的标识——这是 Google Consent Mode v2 的默认拒绝状态，在统计代码加载之前就已经写好。',
          '在其他地区，统计默认开启，你同样可以在下面随时关掉。',
        ],
      },
    ],
    choiceTitle: '你现在的选择',
    state: (choice) =>
      choice === 'granted'
        ? '已同意统计。'
        : choice === 'denied'
          ? '已拒绝统计。'
          : '尚未选择；当前按你所在地区的默认处理。',
    accept: '同意统计',
    decline: '拒绝统计',
    back: '回到占卜',
  },

  errors: {
    generic: '牌一时没有回应。稍后再试一次。',
    retry: '再试一次',
    tooLong: '问题太长了，请精简一些。',
    rateLimited: '今天问得有点多了，让牌歇一会儿再来。',
    lost: '这一轮占卜已经找不到了，重新开始吧。',
    readingLimit: '今天的免费一次已经用过了。明天再来，或邀请一位朋友完成一次塔罗解读，就能再问一次。',
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
    backHome: 'Back to the home page',
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
    goToStick: 'Draw a fortune stick too',
    notFound: 'This share does not exist, or it was taken down.',
  },

  referral: {
    description: 'Invite a friend to complete a tarot reading and unlock one more for yourself.',
    invited: 'Someone invited you to ask the cards a question.',
    invite: 'Invite a friend to play one more',
    inviting: 'Making an invitation link…',
    copied: 'Invitation copied',
    copyLink: 'Copy invitation link',
    pending: 'Waiting for your friend, then this will update when they finish.',
    completed: 'Your friend finished — one more reading is unlocked.',
    expired: 'This invitation expired. Make a new one to try again.',
    lockedTitle: "Today's free and extra readings are used. Come back tomorrow.",
    lockedFreeTitle: "Today's free reading is used.",
    lockedNoInvite: 'Finish a reading first, then invite a friend to unlock the next one.',
  },

  bridge: {
    stickCta: 'Draw a stick for today',
    outroOffer: 'Draw a stick, then ask Tarot one more question today.',
    outroContinue: 'You can also draw a stick for a thought about today.',
    lockedOffer: 'Draw a stick to unlock one more Tarot reading today.',
    bonusReady: 'Your Stick reward is saved. After today’s free reading, you can ask one more question.',
    bonusReadyNow: 'Your Stick reward is unlocked. You can ask one more question today.',
    bonusExpired: 'That stick’s reward was only good on the day it was drawn, and it has expired.',
    bonusDailyLimit: 'Today’s extra reading has already been claimed or used. Come back tomorrow.',
    bonusUnusable: 'This reward link cannot be used here. It may have been claimed in another browser. Open Tarot again from your stick.',
    bonusFailed: 'Your Stick reward could not be saved just now.',
    bonusRetry: 'Try again',
  },

  footer: {
    manyfold: 'This reading is built on Manyfold — opens manyfold.ai in a new window',
    openSource: 'Open source · fork it on GitHub',
    openSourceLabel: 'Open source — opens the source on GitHub in a new window',
  },

  consent: {
    line: 'We would like to use Google Analytics to see how the site is used, and to measure our ads. Your question and your reading are never sent there.',
    accept: 'Accept',
    decline: 'Decline',
    more: 'Privacy',
    label: 'Cookies and analytics',
  },

  privacy: {
    title: 'Privacy',
    intro:
      'This is a tarot site. There is no account and nothing to sign up for. What follows is what it actually keeps, and whose hands that passes through.',
    sections: [
      {
        title: 'What this site keeps',
        body: [
          'A session cookie holding nothing but an id (taro_sid), so that a reload still recognises which round is yours. It carries no name and does not follow you anywhere else.',
          'The question you write, the three cards you draw and the reading you are given, stored in the operator’s Cloudflare database.',
          'If you press share, that reading is frozen into a snapshot anyone with the link can read.',
          'If you invite a friend, the site keeps a one-use invitation id and its completion state so it can unlock another reading for you; it carries no name.',
          'If you return from Fortune Stick for an extra reading, the day, reward id and use state are stored against your anonymous session; the Stick question and reading are not included.',
          'Three things in your own browser: the language you chose, the id of the round you are in, and your answer to the question below.',
        ],
      },
      {
        title: 'Who else sees it',
        body: [
          'Your question and the three cards go to the Manyfold agent that writes the reading — without that there is no reading.',
          'Once you accept (or, where you are, if consent is not required first), page views, reading milestones, Tarot and Fortune Stick link clicks, and extra-reading claims and use are recorded in Google Analytics. Your question, your cards, the reading text and reward codes are never sent there.',
        ],
      },
      {
        title: 'About consent',
        body: [
          'In the EEA, the UK and Switzerland nothing is stored for analytics or advertising until you answer — the tag denies itself before it loads, which is Google Consent Mode v2 in its default state.',
          'Elsewhere analytics starts on, and you can turn it off here just the same.',
        ],
      },
    ],
    choiceTitle: 'Your choice',
    state: (choice) =>
      choice === 'granted'
        ? 'Analytics is on.'
        : choice === 'denied'
          ? 'Analytics is off.'
          : 'Not answered yet; the default for where you are is in effect.',
    accept: 'Turn analytics on',
    decline: 'Turn analytics off',
    back: 'Back to the reading',
  },

  errors: {
    generic: 'The cards did not answer just now. Try once more in a moment.',
    retry: 'Try again',
    tooLong: 'That question is too long — please tighten it.',
    rateLimited: 'That is a lot of questions for one day. Let the deck rest a while.',
    lost: 'That reading can no longer be found. Let us start again.',
    readingLimit: "Today's free reading is used. Come back tomorrow, or invite a friend to complete a tarot reading and ask again.",
  },

  demoNotice: 'Demo mode: no reader is connected yet, so this reading comes from the built-in sample.',
  languageLabel: 'Language',
  settingsLink: 'Settings',
};

/** What the site is called, in the tab and nowhere else. Deliberately outside
 *  `Copy` and the same in both locales: a name is a name, and a visitor who
 *  switches language is still looking at the same site. */
export const SITE_NAME = 'AI Tarot';

export const COPY: Record<Locale, Copy> = { zh, en };

export const copyFor = (locale: Locale): Copy => COPY[locale] ?? COPY.zh;

/** Normalizes anything (query param, header, stored value) to a supported locale. */
export function normalizeLocale(value: unknown): Locale {
  const raw = String(value ?? '').toLowerCase();
  if (raw.startsWith('en')) return 'en';
  return 'zh';
}
