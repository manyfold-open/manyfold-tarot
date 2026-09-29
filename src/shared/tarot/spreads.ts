import type { Locale } from './deck';
import type { SlotId, SpreadId } from './types';

export interface SpreadDefinition {
  id: SpreadId;
  title: string;
  description: string;
  instruction: string;
  /**
   * What the reader is asked for in the three closing sections of a full reading.
   * The sections are the same for every spread; what each one is *for* is not —
   * a decision weighs, a next step narrows, a weekly review looks back.
   */
  guidance: { response: string; actions: string; reflection: string; followUp: string };
  /** Three suggested follow-ups under the reading; absent means the site-wide ones. */
  quickFollowUps?: [string, string, string];
  slots: Record<SlotId, { title: string; prompt: string }>;
}

type LocalizedSpread = Omit<SpreadDefinition, 'title' | 'description' | 'instruction' | 'guidance' | 'quickFollowUps' | 'slots'> & {
  title: Record<Locale, string>;
  description: Record<Locale, string>;
  instruction: Record<Locale, string>;
  guidance: Record<'response' | 'actions' | 'reflection' | 'followUp', Record<Locale, string>>;
  quickFollowUps?: Record<Locale, [string, string, string]>;
  slots: Record<SlotId, { title: Record<Locale, string>; prompt: Record<Locale, string> }>;
};

const spreads: Record<SpreadId, LocalizedSpread> = {
  current: {
    id: 'current',
    title: { zh: '理解目前状态', en: 'Understand where things stand' },
    description: { zh: '看见眼前处境、尚未察觉的影响，以及可以采取的方向。', en: 'See the situation, what is out of view, and a direction you can take.' },
    instruction: { zh: '请以「理解目前状态」为主轴解读：先辨认现况，再指出未被看见的因素，最后给出可行方向。', en: 'Read this as a way to understand the current situation: name what is happening, what is not yet in view, and a practical direction.' },
    guidance: {
      response: { zh: '回到来访者的问题，给出综合回应，说明牌面对这个具体处境意味着什么。', en: 'Back to their question: what this spread means for this specific situation.' },
      actions: { zh: '两到三条现实中可以做的事，每条独占一行，以「- 」开头，具体、可执行、不空泛。', en: 'Two or three things they can actually do, each on its own line starting with "- ", concrete and doable.' },
      reflection: { zh: '一个留给对方自己想的问题，一句话。', en: 'One question for them to sit with, a single sentence.' },
      followUp: { zh: '', en: '' },
    },
    slots: {
      situation: { title: { zh: '此刻的处境', en: 'Where you stand' }, prompt: { zh: '第一张，照见你此刻所处的位置。', en: 'The first card shows where you are standing now.' } },
      hidden: { title: { zh: '隐藏的影响', en: 'The hidden influence' }, prompt: { zh: '第二张，揭示尚未被你看清的影响。', en: 'The second card reveals what has not yet come into view.' } },
      guidance: { title: { zh: '接下来的指引', en: 'What comes next' }, prompt: { zh: '最后一张，指向你接下来可以采取的行动。', en: 'The last card points to a move you can make from here.' } },
    },
  },
  decision: {
    id: 'decision',
    title: { zh: '做一个决定', en: 'Make a decision' },
    description: { zh: '整理选择的拉力、取舍，以及值得依循的原则。', en: 'Clarify the pull, the trade-off, and a principle to decide by.' },
    instruction: { zh: '请以决策为主轴，不替来访者决定，也不要预言结果；比较各方拉力，点出取舍，最后提出一个可用来判断的原则。', en: 'Read this as decision support. Do not decide for the visitor or predict an outcome; compare the forces, name the trade-off, and offer a principle they can use.' },
    guidance: {
      response: { zh: '回到来访者的问题：把他要在哪些选项之间取舍说清楚——每个选项各自会得到什么、要放下什么。问题里没写明选项时，就从问题推出最可能的两边。不要替他选，也不要暗示哪一边“对”；只说明牌面让哪一边的分量显得更重，以及为什么。', en: 'Back to their question: lay out what they are choosing between — what each option would give them and what it would cost. If the question names no options, infer the two most likely sides. Do not choose for them or hint that one side is "right"; say only which side the cards make weigh more, and why.' },
      actions: { zh: '两到三条帮助他做决定的现实步骤，每条独占一行，以「- 」开头，例如：把某个选项最坏和最好的结果各写下来、向某个具体的人确认一个事实、给自己设一个做出决定的期限。要具体、可执行，而不是直接告诉他该选什么。', en: 'Two or three practical steps that help them decide, each on its own line starting with "- " — for example writing down the worst and best realistic outcome of an option, checking one fact with a specific person, or setting a date by which to decide. Concrete and doable; never a verdict on what to pick.' },
      reflection: { zh: '一个帮他分辨自己真正想要什么的问题，一句话，不带倾向。', en: 'One question that helps them tell what they actually want, a single sentence, leaning neither way.' },
      followUp: { zh: '继续帮他权衡，而不是替他决定：如果追问在问“该选哪个”，就回到各个选项的取舍和可用来判断的原则，不给答案。', en: 'Keep helping them weigh, not deciding for them: if the follow-up asks "which one should I pick", return to the trade-offs and the principle to decide by, and do not give a verdict.' },
    },
    quickFollowUps: {
      zh: ['这几张牌里，哪一张最提醒我该衡量什么？', '两边各自最坏的情况是什么？', '在做决定之前，我可以先确认哪一件事？'],
      en: ['Which card most points at what I should weigh?', 'What is the worst case on each side?', 'What can I check before I decide?'],
    },
    slots: {
      situation: { title: { zh: '真正要决定的是什么', en: 'What is really being decided' }, prompt: { zh: '第一张，照出这个决定真正牵动的事。', en: 'The first card shows what this decision is really about.' } },
      hidden: { title: { zh: '选择背后的拉力', en: 'The pull beneath the choice' }, prompt: { zh: '第二张，揭示让你靠近或避开某个选项的力量。', en: 'The second card reveals what is pulling you toward or away from an option.' } },
      guidance: { title: { zh: '值得依循的原则', en: 'A principle to decide by' }, prompt: { zh: '最后一张，提出一个可以帮你衡量选项的原则。', en: 'The last card offers a principle for weighing your options.' } },
    },
  },
  'next-step': {
    id: 'next-step',
    title: { zh: '下一步反思', en: 'Reflect on the next step' },
    description: { zh: '找到值得关注的地方、第一个小步骤，以及需要留意的信号。', en: 'Find your focus, one small first move, and a signal to watch.' },
    instruction: { zh: '请聚焦在可采取的下一步：辨认优先事项，提出一个小而具体的行动，并指出后续值得观察的信号。', en: 'Focus on a next step: identify the priority, suggest one small concrete action, and name a signal worth watching.' },
    guidance: {
      response: { zh: '回到来访者的问题，只谈眼前，不谈整个未来：指出现在最该优先的一件事、为什么是它，以及可以先放一放的部分。', en: 'Back to their question, about what is in front of them and not the whole future: name the one thing to put first, why it is that one, and what can wait.' },
      actions: { zh: '恰好两条，每条独占一行，以「- 」开头：第一条是一个小到今天或本周就能开始的行动，写清楚做什么、怎么做；第二条是一个要留意的信号，说明出现什么迹象代表方向对了，或需要调整。', en: 'Exactly two, each on its own line starting with "- ": first, one action small enough to begin today or this week, with what to do and how; second, one signal to watch for — what would show the direction is right, or needs adjusting.' },
      reflection: { zh: '一个帮他确认“这一步够不够小、自己愿不愿意走”的问题，一句话。', en: 'One question that checks whether this step is small enough and whether they are willing to take it, a single sentence.' },
      followUp: { zh: '保持在“下一步”的尺度：把回答落到一个更小、更具体的行动或一个可观察的信号上，不要展开成长期规划。', en: 'Stay at the scale of the next step: land the answer on one smaller, more concrete move or one observable signal, and do not expand it into a long-term plan.' },
    },
    quickFollowUps: {
      zh: ['这一步还能再小一点吗？', '我要留意的信号具体会是什么样子？', '如果今天只有十分钟，我该做什么？'],
      en: ['Can this step be made even smaller?', 'What would the signal I am watching for look like?', 'If I only had ten minutes today, what should I do?'],
    },
    slots: {
      situation: { title: { zh: '现在最值得关注', en: 'What deserves attention now' }, prompt: { zh: '第一张，指出此刻最值得你留意的地方。', en: 'The first card points to what deserves your attention now.' } },
      hidden: { title: { zh: '可以开始的小步骤', en: 'A small move to begin' }, prompt: { zh: '第二张，照出一个可以开始的小步骤。', en: 'The second card shows a small step you can begin.' } },
      guidance: { title: { zh: '接下来留意什么', en: 'What to watch for next' }, prompt: { zh: '最后一张，提醒你接下来可以观察的信号。', en: 'The last card names a signal to watch for as you move ahead.' } },
    },
  },
  'weekly-review': {
    id: 'weekly-review',
    title: { zh: '每周回顾', en: 'Weekly review' },
    description: { zh: '回看这周发生的事、带走一个领悟，并为下周留出空间。', en: 'Look back at the week, name what you learned, and make room for next week.' },
    instruction: { zh: '请协助来访者回顾一周，而非预言未来：整理这周的主题、辨认留下的领悟，再提出一个下周可以带着走的意图。', en: 'Help the visitor reflect on the week rather than predict the future: name its theme, identify a lesson, and suggest an intention to carry into next week.' },
    guidance: {
      response: { zh: '回到来访者的问题，以“这一周”为范围：这周发生了什么、哪里消耗了他、哪里给了他力量，以及他带走的是什么。如果问题与这周无关，就把它当作这周背景的一部分，不要转去预测未来。', en: 'Back to their question, within the span of this one week: what happened, what drained them, what gave them strength, and what they are taking from it. If the question is not about this week, treat it as part of the week’s background rather than turning to predict the future.' },
      actions: { zh: '两到三条下周可以带着走的具体做法，每条独占一行，以「- 」开头：一件想继续做的事、一件想放下或调整的事，以及一个放进下周日程的小意图。不要写成宏大的目标。', en: 'Two or three concrete things to carry into next week, each on its own line starting with "- ": one thing to keep doing, one to let go of or adjust, and one small intention to put in next week’s calendar. No grand goals.' },
      reflection: { zh: '一个让他回看这一周的问题，一句话，指向已经发生的事，而不是预测。', en: 'One question that looks back over the week, a single sentence, pointing at what has already happened rather than predicting.' },
      followUp: { zh: '保持在“这一周”的范围：帮他回看已经发生的事和留下的领悟，不预测未来，也不替下周做大计划。', en: 'Stay within this one week: help them look back at what has happened and what it left them with, without predicting or planning next week at length.' },
    },
    quickFollowUps: {
      zh: ['这一周里，哪一件事最值得我记住？', '哪一张牌最像这一周的我？', '下周我可以放下什么？'],
      en: ['Which moment of this week is worth remembering?', 'Which card is most like me this week?', 'What can I set down next week?'],
    },
    slots: {
      situation: { title: { zh: '这周的主题', en: 'The theme of the week' }, prompt: { zh: '第一张，回望这周最鲜明的主题。', en: 'The first card looks back at the week’s clearest theme.' } },
      hidden: { title: { zh: '带走的领悟', en: 'What you are taking from it' }, prompt: { zh: '第二张，照出这周留下的领悟。', en: 'The second card reveals what this week has taught you.' } },
      guidance: { title: { zh: '下周的意图', en: 'An intention for next week' }, prompt: { zh: '最后一张，为下周指出一个可以带着走的意图。', en: 'The last card offers an intention to carry into next week.' } },
    },
  },
};

export const SPREAD_IDS = Object.keys(spreads) as SpreadId[];

export function isSpreadId(value: unknown): value is SpreadId {
  return typeof value === 'string' && Object.hasOwn(spreads, value);
}

export function spreadFor(id: SpreadId | null | undefined, locale: Locale): SpreadDefinition {
  const spread = spreads[id && isSpreadId(id) ? id : 'current'];
  return {
    id: spread.id,
    title: spread.title[locale],
    description: spread.description[locale],
    instruction: spread.instruction[locale],
    guidance: {
      response: spread.guidance.response[locale],
      actions: spread.guidance.actions[locale],
      reflection: spread.guidance.reflection[locale],
      followUp: spread.guidance.followUp[locale],
    },
    quickFollowUps: spread.quickFollowUps?.[locale],
    slots: Object.fromEntries(
      Object.entries(spread.slots).map(([slot, copy]) => [slot, {
        title: copy.title[locale],
        prompt: copy.prompt[locale],
      }]),
    ) as SpreadDefinition['slots'],
  };
}

export function allSpreads(locale: Locale): SpreadDefinition[] {
  return SPREAD_IDS.map((id) => spreadFor(id, locale));
}
