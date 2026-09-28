/**
 * The built-in demo reader.
 *
 * Agent 2 is a separate agent on a separate schedule. Until it is connected —
 * and in local dev, and in any deploy whose agent later goes away — the site
 * still has to run end to end, or there is nothing to demo and nothing to test
 * against. So this module answers in the diviner's voice using the deck's own
 * keywords and the question's own words.
 *
 * It writes through the SAME tagged protocol as a real agent, so the parser,
 * the streaming path and the UI are exercised identically. What it deliberately
 * does NOT do is pretend to be Agent 2: every response it produces is flagged
 * `demo: true` all the way to the browser, which shows a notice.
 */

import { cardById, cardLabel, cardKeywords, type Locale } from '../../shared/tarot/deck';
import { spreadFor } from '../../shared/tarot/spreads';
import { NEW_READING_MARKER } from './prompt';
import type { DrawnCard } from './draw';
import type { SpreadId } from '../../shared/tarot/types';

const slotTitle = (slot: DrawnCard['slot'], locale: Locale, spreadId: SpreadId = 'current') =>
  spreadFor(spreadId, locale).slots[slot].title;

const label = (card: DrawnCard, locale: Locale): string => {
  const deckCard = cardById(card.cardId);
  return deckCard ? cardLabel(deckCard, card.reversed, locale) : card.cardId;
};

const keywords = (card: DrawnCard, locale: Locale): string => {
  const deckCard = cardById(card.cardId);
  return deckCard ? cardKeywords(deckCard, card.reversed, locale) : '';
};

/** A short, neutral echo of the question — never the whole thing, per the spec. */
function questionEcho(question: string, locale: Locale): string {
  const compact = question.replace(/\s+/g, ' ').trim();
  const limit = locale === 'zh' ? 18 : 60;
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, limit)}${locale === 'zh' ? '……' : '…'}`;
}

export function demoGreeting(question: string, locale: Locale, spreadId: SpreadId = 'current'): string {
  const echo = questionEcho(question, locale);
  const spread = spreadFor(spreadId, locale);
  if (spreadId !== 'current') {
    return locale === 'zh'
      ? `你问的是「${echo}」。这次用「${spread.title}」牌阵，让三张牌从不同角度陪你整理这件事。`
      : `You are asking about “${echo}”. We will use the ${spread.title} spread to look at this from three different angles.`;
  }
  if (locale === 'zh') {
    return [
      `你问的是「${echo}」——我听见的，是你已经在心里翻来覆去想了很久的那一件事。`,
      '让我为你抽三张牌，看看此刻的处境、隐藏的影响，以及牌面给你的指引。',
    ].join('');
  }
  return [
    `You are asking about “${echo}” — and what I hear underneath it is something you have already turned over many times.`,
    ' Let me draw three cards for you: where you stand, what is working out of sight, and what the cards point you toward.',
  ].join('');
}

export function demoHint(card: DrawnCard, locale: Locale, spreadId: SpreadId = 'current'): string {
  const name = label(card, locale);
  const meaning = keywords(card, locale);
  if (locale === 'zh') {
    return `${name}。在「${slotTitle(card.slot, locale, spreadId)}」这个位置上，它说的是：${meaning}。`;
  }
  return `${name}. In the position of "${slotTitle(card.slot, locale, spreadId)}", it speaks of ${meaning}.`;
}

interface SpreadFrame {
  conclusion: string;
  overview: string;
  actions: [string, string];
  reflection: string;
  closing: string;
}

/**
 * What each non-default spread is *for*, said in its own terms: a decision reads
 * as a trade-off, a next step as one small move, a weekly review as a look back.
 * The card paragraphs stay shared; only the framing around them changes.
 */
function spreadFrame(spreadId: SpreadId, locale: Locale, title: string, names: string[], titles: string[]): SpreadFrame {
  const [a, b, c] = names;
  const [ta, tb, tc] = titles;
  if (locale === 'zh') {
    if (spreadId === 'decision') {
      return {
        conclusion: `「${title}」这个牌阵没有替你决定答案，而是把值得衡量的部分摊开。${a}、${b}和${c}各自指出一个可以思考的角度。`,
        overview: `从「${ta}」到「${tb}」，再到「${tc}」，这三张牌带你先看清要决定的是什么，再看见拉扯你的力量，最后落到一个可以依循的原则。`,
        actions: ['写下你已经确定的事实，以及一个仍需确认的问题。', '把两个选项各自最坏和最好的结果列出来，再看哪一个你更能承担。'],
        reflection: '哪一个角度让你看这个选择的方式稍微不同了？',
        closing: '不必今天就做出决定。先把要衡量的东西看清楚。',
      };
    }
    if (spreadId === 'next-step') {
      return {
        conclusion: `「${title}」把焦点收窄到眼前：先看${ta}指出的重点，再从${tb}里挑出一个小步骤。${a}、${b}和${c}合起来，指向的是下一步，而不是整个未来。`,
        overview: `从「${ta}」到「${tb}」，再到「${tc}」，这三张牌带你从现在最值得关注的事，走到一个可以开始的小动作，以及之后要留意的信号。`,
        actions: ['选一个小到今天就能开始的行动，把它写下来。', '决定一个你会留意的信号，一周后再回头看它有没有出现。'],
        reflection: '如果只做一件小事，你希望它是什么？',
        closing: '先走出一小步，比想清楚整条路更有用。',
      };
    }
    return {
      conclusion: `「${title}」是一次回望，而不是预言。${a}、${b}和${c}把这一周整理成三件事：主题、领悟，以及带进下周的意图。`,
      overview: `从「${ta}」到「${tb}」，再到「${tc}」，这三张牌带你先看这一周的主题，再收下带得走的领悟，最后为下周留出空间。`,
      actions: ['写下这一周里一件做得还不错的事，和一件想调整的事。', '为下周挑一个小意图，把它放在你会看到的地方。'],
      reflection: '这周有什么改变，是你想带进下周的？',
      closing: '这一周已经过去，你可以只带走真正有用的部分。',
    };
  }
  if (spreadId === 'decision') {
    return {
      conclusion: `The ${title} spread does not decide for you. It lays out what is worth weighing: ${a}, ${b} and ${c} each offer a different angle.`,
      overview: `From “${ta}” through “${tb}” to “${tc}”, these cards first name what is really being decided, then the pull beneath it, and finally a principle you can decide by.`,
      actions: ['Write down what you already know for certain and one thing you still need to find out.', 'List the best and worst realistic outcome of each option, then notice which you could live with.'],
      reflection: 'Which angle changed how you see this choice, even a little?',
      closing: 'You do not have to decide today. Start by seeing what is being weighed.',
    };
  }
  if (spreadId === 'next-step') {
    return {
      conclusion: `The ${title} spread narrows things to what is in front of you: ${a}, ${b} and ${c} point at one small move, not the whole future.`,
      overview: `From “${ta}” through “${tb}” to “${tc}”, these cards move from what deserves attention now, to a small move you can begin, to a signal worth watching.`,
      actions: ['Pick a step small enough to begin today, and write it down.', 'Choose one signal to watch for, and look again in a week.'],
      reflection: 'If you did only one small thing, what would you want it to be?',
      closing: 'One small step is worth more than a fully mapped road.',
    };
  }
  return {
    conclusion: `The ${title} is a look back, not a forecast: ${a}, ${b} and ${c} sort the week into a theme, a lesson and an intention.`,
    overview: `From “${ta}” through “${tb}” to “${tc}”, these cards name the theme of the week, what you can take from it, and what to leave room for next.`,
    actions: ['Write down one thing that went well this week and one you would change.', 'Choose a small intention for next week and put it where you will see it.'],
    reflection: 'What changed this week that you want to carry into the next one?',
    closing: 'The week is done. You only have to carry the useful part.',
  };
}

/**
 * A full reading in the tagged format. Composed rather than templated word for
 * word: each section is built from the actual cards drawn, so two demo readings
 * never read the same.
 */
export function demoReading(question: string, cards: DrawnCard[], locale: Locale, spreadId: SpreadId = 'current'): string {
  const [first, second, third] = cards;
  const echo = questionEcho(question, locale);
  const names = cards.map((card) => label(card, locale));
  const meanings = cards.map((card) => keywords(card, locale));

  if (spreadId !== 'current') {
    const spread = spreadFor(spreadId, locale);
    const titles = cards.map((card) => spread.slots[card.slot].title);
    const echoLine = locale === 'zh' ? `回到「${echo}」，` : `For “${echo}”, `;
    const frame = spreadFrame(spreadId, locale, spread.title, names, titles);
    if (locale === 'zh') {
      return [
        '[CONCLUSION]',
        frame.conclusion,
        '[OVERVIEW]',
        frame.overview,
        '[CARD1]',
        `${names[0]}落在「${titles[0]}」。${meanings[0]}。先把这张牌带出的事实和感受分开看，会比较容易找出事情的重心。`,
        '[CARD2]',
        `${names[1]}落在「${titles[1]}」。${meanings[1]}。它提供另一个角度，提醒你注意其中的拉力、学习或可行的小步骤。`,
        '[CARD3]',
        `${names[2]}落在「${titles[2]}」。${meanings[2]}。把这个方向当成一个值得尝试的意图，而不是必须服从的预言。`,
        '[CONNECTIONS]',
        `${names[0]}指出的${titles[0]}，和${names[1]}带出的${titles[1]}彼此补充；${names[2]}则把两者带向一个可以实践的方向。`,
        '[RESPONSE]',
        `${echoLine}先用牌面帮你整理问题，再回到你掌握的现实信息做判断。你可以挑出最有共鸣的一点，让它成为下一步的起点。`,
        '[ACTIONS]',
        `- ${frame.actions[0]}`,
        `- ${frame.actions[1]}`,
        '[REFLECTION]',
        frame.reflection,
        '[CLOSING]',
        frame.closing,
      ].join('\n');
    }
    return [
      '[CONCLUSION]',
      frame.conclusion,
      '[OVERVIEW]',
      frame.overview,
      '[CARD1]',
      `${names[0]} lands in “${titles[0]}”. ${meanings[0]}. Separate what this brings up as fact from what it brings up as feeling; that makes the centre of the matter easier to see.`,
      '[CARD2]',
      `${names[1]} lands in “${titles[1]}”. ${meanings[1]}. It adds another angle and asks you to notice the pull, lesson or small move available here.`,
      '[CARD3]',
      `${names[2]} lands in “${titles[2]}”. ${meanings[2]}. Treat this as an intention worth trying, not a prediction you have to obey.`,
      '[CONNECTIONS]',
      `${names[0]} describes ${titles[0]}, ${names[1]} adds what is present in ${titles[1]}, and ${names[2]} carries both toward a direction you can put into practice.`,
      '[RESPONSE]',
      `${echoLine}let the cards help organize your thoughts, then return to the evidence you have. Choose the part that resonates most and let it become a starting point.`,
      '[ACTIONS]',
      `- ${frame.actions[0]}`,
      `- ${frame.actions[1]}`,
      '[REFLECTION]',
      frame.reflection,
      '[CLOSING]',
      frame.closing,
    ].join('\n');
  }

  if (locale === 'zh') {
    return [
      '[CONCLUSION]',
      `牌面的回答是：这件事还没有定论，但主动权比你以为的更多地在你手里。${names[2]}落在「${slotTitle(third.slot, locale)}」，指的是一个你已经隐约知道、却还没有开始做的动作。`,
      '[OVERVIEW]',
      `三张牌是${names[0]}、${names[1]}、${names[2]}。它们连起来讲的是一个从停滞走向选择的过程：你所处的位置已经清楚，真正没被看清的是中间那一层，而出路指向具体的行动而不是继续等待。`,
      '[CARD1]',
      `${names[0]}落在「${slotTitle(first.slot, locale)}」。${meanings[0]}。这说明你现在的处境并不是凭空而来，它是你过去一段时间里做过的选择累积出来的结果。你心里的那份不安，多半来自于你其实已经感觉到了变化，只是还没有承认它。`,
      '[CARD2]',
      `${names[1]}落在「${slotTitle(second.slot, locale)}」。${meanings[1]}。这一层是你看得最不清楚的地方——它可能是某个人的态度，也可能是你自己一直不愿意深究的动机。它一直在影响事情的走向，只是没有被放到台面上。`,
      '[CARD3]',
      `${names[2]}落在「${slotTitle(third.slot, locale)}」。${meanings[2]}。这张牌不是在预告结果，而是在告诉你，从现在起哪一种姿态最有可能把局面往你想要的方向推。`,
      '[CONNECTIONS]',
      `把三张牌放在一起看，${names[0]}描述的处境之所以卡住，正是因为${names[1]}那一层没有被说破；而${names[2]}给出的方向，恰好需要你先面对第二张牌指出的东西才走得通。换句话说，指引不是绕过隐藏的影响，而是穿过它。`,
      '[RESPONSE]',
      `回到你的问题：牌面并不认为你需要一个更完美的判断，它认为你需要一个更明确的动作。你已经掌握了足够的信息，缺的是把信息变成决定的那一步。你担心的那个最坏结果，在这组牌里没有出现。`,
      '[ACTIONS]',
      '- 把你最不愿意问出口的那个问题，直接问出来，向那个真正能给你答案的人。',
      '- 给自己设一个明确的期限，在期限之前不反复推翻已经做过的判断。',
      '- 写下你目前掌握的事实和你自己的推测，分成两栏，你会看见它们的比例。',
      '[REFLECTION]',
      '如果这件事下个月就已经有了结果，你希望回头看时，自己现在做了什么？',
      '[CLOSING]',
      '牌只是把你已经知道的东西摆到了光下。剩下的部分，一直都在你这边。',
    ].join('\n');
  }

  return [
    '[CONCLUSION]',
    `The cards answer this way: nothing here is settled, and more of it sits in your hands than you think. ${names[2]} in "${slotTitle(third.slot, locale)}" points at a move you already half know and have not yet made.`,
    '[OVERVIEW]',
    `The three cards are ${names[0]}, ${names[1]} and ${names[2]}. Together they describe a passage out of stalling and into choosing: where you stand is already clear, the middle layer is what you have not seen, and the way through is an action rather than more waiting.`,
    '[CARD1]',
    `${names[0]} lands in "${slotTitle(first.slot, locale)}". ${meanings[0]}. Your situation did not appear out of nowhere — it is the accumulation of choices you made over the last stretch. The unease you feel most likely comes from having already sensed the shift without admitting it yet.`,
    '[CARD2]',
    `${names[1]} lands in "${slotTitle(second.slot, locale)}". ${meanings[1]}. This is the layer you can see least clearly. It may be someone's real position, or a motive of your own you have avoided examining. It has been steering things the whole time without being named.`,
    '[CARD3]',
    `${names[2]} lands in "${slotTitle(third.slot, locale)}". ${meanings[2]}. This card does not announce an outcome — it tells you which stance, from here, is most likely to move things the way you want.`,
    '[CONNECTIONS]',
    `Read together: the situation in ${names[0]} is stuck precisely because the layer shown by ${names[1]} has never been said out loud, and the direction offered by ${names[2]} only works once you face what the second card names. The guidance does not route around the hidden influence — it goes through it.`,
    '[RESPONSE]',
    'Back to your question: the cards do not think you need a better judgement, they think you need a clearer move. You already hold enough information; what is missing is the step that turns information into a decision. The worst outcome you have been carrying does not appear in this spread.',
    '[ACTIONS]',
    '- Ask the question you least want to ask, directly, of the person who can actually answer it.',
    '- Set yourself a real deadline, and stop relitigating settled judgements before it arrives.',
    '- Write what you know and what you are assuming in two columns — the ratio will tell you something.',
    '[REFLECTION]',
    'If this were already resolved a month from now, what would you want to find that you had done today?',
    '[CLOSING]',
    'The cards only set what you already knew into the light. The rest of it was always yours.',
  ].join('\n');
}

export function demoFollowUp(followUp: string, cards: DrawnCard[], locale: Locale, spreadId: SpreadId = 'current'): string {
  const names = cards.map((card) => label(card, locale));
  const asked = questionEcho(followUp, locale);
  // The demo reader flags a new round on the same signals a real one would: the
  // follow-up names a different subject rather than a card on the table.
  const newTopic = /^(那|另外|还有|再问|如果我|我还想问|what about|another|also,? what)/i.test(
    followUp.trim(),
  );
  if (spreadId !== 'current') {
    const titles = cards.map((card) => slotTitle(card.slot, locale, spreadId));
    const body = locale === 'zh'
      ? `关於「${asked}」，可以先回到${names[1]}所在的「${titles[1]}」：它提供了一个重新看待问题的角度。再把${names[0]}指出的现况，和${names[2]}带出的方向放在一起，挑出最能落实的一小步。`
      : `About “${asked}”, return first to ${names[1]} in “${titles[1]}”: it offers another angle on the question. Then place the situation described by ${names[0]} beside the direction in ${names[2]} and choose one small step you can put into practice.`;
    return newTopic ? `${body}\n\n[[${NEW_READING_MARKER}]]` : body;
  }
  if (locale === 'zh') {
    const body = [
      `关于「${asked}」——留在这三张牌里看的话，${names[1]}是最值得停一停的那张。它落在「隐藏的影响」上，说明你问的这个点，答案多半不在你正盯着的地方。`,
      `${names[0]}给出的是你现在的位置，而${names[2]}给出的是方向。你问的这件事，其实是在问这两者之间的距离要怎么走。牌面的意思是：这段距离不需要一次跨完。`,
      '如果你希望我再具体一点，可以告诉我你最在意的是哪一张牌，或者哪一句话让你不太确定。',
    ].join('\n\n');
    return newTopic ? `${body}\n\n[[${NEW_READING_MARKER}]]` : body;
  }
  const body = [
    `About “${asked}” — staying inside these three cards, ${names[1]} is the one worth pausing on. It sits in the hidden influence, which suggests the answer to what you are asking is not where you have been looking.`,
    `${names[0]} gives your current position and ${names[2]} gives the direction. What you are really asking is how to cross the distance between them, and the spread says you do not have to cross it in one step.`,
    'If you want me to go further, tell me which card you keep returning to, or which line left you unsure.',
  ].join('\n\n');
  return newTopic ? `${body}\n\n[[${NEW_READING_MARKER}]]` : body;
}
