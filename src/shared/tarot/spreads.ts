import type { Locale } from './deck';
import type { SlotId, SpreadId } from './types';

export interface SpreadDefinition {
  id: SpreadId;
  title: string;
  description: string;
  instruction: string;
  slots: Record<SlotId, { title: string; prompt: string }>;
}

type LocalizedSpread = Omit<SpreadDefinition, 'title' | 'description' | 'instruction' | 'slots'> & {
  title: Record<Locale, string>;
  description: Record<Locale, string>;
  instruction: Record<Locale, string>;
  slots: Record<SlotId, { title: Record<Locale, string>; prompt: Record<Locale, string> }>;
};

const spreads: Record<SpreadId, LocalizedSpread> = {
  current: {
    id: 'current',
    title: { zh: '理解目前状态', en: 'Understand where things stand' },
    description: { zh: '看见眼前处境、尚未察觉的影响，以及可以采取的方向。', en: 'See the situation, what is out of view, and a direction you can take.' },
    instruction: { zh: '请以「理解目前状态」为主轴解读：先辨认现况，再指出未被看见的因素，最后给出可行方向。', en: 'Read this as a way to understand the current situation: name what is happening, what is not yet in view, and a practical direction.' },
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
    instruction: { zh: '请协助来访者回顾一周，而非预言未来：整理这周的主题、辨认留下的领悟，再提出一个下周可以带著走的意图。', en: 'Help the visitor reflect on the week rather than predict the future: name its theme, identify a lesson, and suggest an intention to carry into next week.' },
    slots: {
      situation: { title: { zh: '这周的主题', en: 'The theme of the week' }, prompt: { zh: '第一张，回望这周最鲜明的主题。', en: 'The first card looks back at the week’s clearest theme.' } },
      hidden: { title: { zh: '带走的领悟', en: 'What you are taking from it' }, prompt: { zh: '第二张，照出这周留下的领悟。', en: 'The second card reveals what this week has taught you.' } },
      guidance: { title: { zh: '下周的意图', en: 'An intention for next week' }, prompt: { zh: '最后一张，为下周指出一个可以带著走的意图。', en: 'The last card offers an intention to carry into next week.' } },
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
