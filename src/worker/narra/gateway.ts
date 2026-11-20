/**
 * Narra Messenger Gateway integration for AI Tarot (`tarot-master-2`).
 *
 * Keeps `NARRA_GATEWAY_ENABLED` and `NARRA_SYNC` strictly fail-closed (`"off"` by default),
 * provides crisis safety responses, local CSPRNG three-card / daily draws in pure
 * `zh-Hant` / `zh-Hans` / `en`, opt-in weekly broadcasts, and Manyfold A2A fallback.
 */

import {
  MemoryStore,
  detectExplicitLangSwitch,
  detectLang,
  isNarraGatewayEnabled,
  stripAgentMentions,
  type AgentSpec,
  type AgentUpdateItem,
  type InboundEvent,
  type LangCode,
  type RecallTurnResult,
  type TriageDecision,
} from '@manyfold/narra-agent-kit';
import {
  getNarraGatewayStatus,
  kickNarraGateway,
  type NarraA2ACredentialResult,
  type NarraGatewayConfig,
  type NarraGatewayKickResult,
  type NarraGatewayStatus,
} from '@manyfold/narra-agent-kit/worker';
import { dailyCardFor, dailyCardKeywords, utcDay } from '../../shared/tarot/daily';
import { cardById, cardKeywords, cardLabel, type Locale } from '../../shared/tarot/deck';
import { spreadFor } from '../../shared/tarot/spreads';
import type { SpreadId } from '../../shared/tarot/types';
import { credentialFor, listConnectedAgents } from '../connect';
import { ensureSchema } from '../db';
import { drawReading, type RandomSource } from '../tarot/draw';
import type { Env } from '../types';
import { toZhHant } from './zh-hant';

export const TAROT_AGENT_ID = 'tarot-master-2';
export const TAROT_DEFAULT_AGENT_RECORD_ID = 'agt_agqvtek2554apclfoq3uc7yweq';
export const TAROT_DEFAULT_MATRIX_ID = '@agent-852feddf:matrix.netmind.chat';
export const TAROT_SITE_URL = 'https://app.manyfold.ai/tarot/';

export const TAROT_AGENT_SPEC: AgentSpec = {
  id: TAROT_AGENT_ID,
  matrixId: TAROT_DEFAULT_MATRIX_ID,
  name: 'AI Tarot',
  aliases: ['tarot-master-2', 'Tarot Master', '塔羅大師', '塔罗大师', '塔羅師', '塔罗师'],
  domainDescription:
    'Three-card AI tarot readings, daily card draws, tarot spreads, upright/reversed card meanings, and reflective guidance for life, career, and relationship decisions in zh-Hant, zh-Hans, and en.',
  domainKeywords: [
    'tarot',
    'tarot reading',
    'tarot card',
    'tarot cards',
    'draw cards',
    'three cards',
    'three-card',
    'major arcana',
    'minor arcana',
    'daily card',
    /\btoday'?s?\s*card\b/i,
    'tarot spread',
    '塔羅',
    '塔罗',
    '塔羅牌',
    '塔罗牌',
    '抽牌',
    '抽一牌',
    '抽一張',
    '抽一张',
    '抽一張牌',
    '抽一张牌',
    '抽三張',
    '抽三张',
    '抽三張牌',
    '抽三张牌',
    '幫我抽',
    '帮我抽',
    '占卜',
    '牌陣',
    '牌阵',
    '正位',
    '逆位',
    '每日一牌',
    '今日一牌',
    '今天的一牌',
    '解牌',
  ],
  antiKeywords: [
    'fortune stick',
    'fortune sticks',
    'wenyiqian',
    '求籤',
    '求签',
    '問一籤',
    '问一签',
    '抽籤',
    '抽签',
    '解籤',
    '解签',
    '籤詩',
    '签诗',
    '搖籤',
    '摇签',
    'restaurant',
    'restaurants',
    'ramen',
    'dim sum',
    'hotpot',
    'bubble tea',
    'boba',
    'chinatown',
    'soho',
    '餐廳',
    '餐厅',
    '美食',
    '拉麵',
    '拉面',
    '火鍋',
    '火锅',
    '奶茶',
    '點心',
    '点心',
    '中餐',
    '川菜',
    'voucher',
    'vouchers',
    'promo code',
    'discount',
    'coupon',
    'cashback',
    'split',
    'owe',
    'expense',
    'receipt',
    '優惠碼',
    '优惠码',
    '折扣',
    '代金券',
    '分帳',
    '分账',
    'ai news',
    'newsletter',
    'openai',
    'anthropic',
    'llm',
    'AI新聞',
    'AI新闻',
    '新聞',
    '新闻',
    'popup',
    'pop-up',
    'pop up',
    'exhibition',
    'sample sale',
    '快閃',
    '快闪',
    '市集',
    'visa',
    'hackathon',
    'recall',
    'food alert',
    '簽證',
    '签证',
    '召回',
  ],
  sessionWindowMs: 180_000,
  silenceThreshold: 0.55,
  capabilities: {
    supportsVoice: true,
    supportsImages: false,
    supportsProactiveDm: true,
  },
};

const HANT_SIGNAL_RE =
  /[羅籤搖運勢牌陣週決態隱處導幫覺殺撐這們說帳賬還麼為錢誰嗎過個對沒開關請問謝購買賣優惠碼號網頁鏈記錄裡裏點電話車飯館倫國給讓覺得應該會樣時間現剛後邊塊張條筆實際薦評價雞麵湯鍋燒餃餅魚蝦豬鴨鵝鹹熱凍廳樓區訂預約單掃發總結轉聯繫試錯誤漏補刪變換選擇歡認識聽寫讀學習業產務題詳細簡複雜難兩萬億歲體驗視頻聲語銀幣鎊歐減費郵滿贈禮獎勵積員級專屬貴劃維護與雖經較處種從離來進無動飲]/;
const HANS_SIGNAL_RE =
  /[罗签摇运势牌阵周决态隐处导帮觉杀撑这们说帐账还么为钱谁吗过个对没开关请问谢购买卖优惠码号网页链记录里点电话车饭馆伦国给让觉得应该会样时间现刚后边块张条笔实际荐评价鸡汤锅烧饺饼鱼虾猪鸭鹅咸热冻厅楼区订预约单扫发总结转联系试错误漏补删变换选择欢认识听写读学习业产物题详细简复杂难两万亿岁体验视频声语银币镑欧减费邮满赠礼奖励积员级专属贵划维护与虽经较处种从离来进无动饮]/;

const EN_CRISIS_RE =
  /\b(?:suicid(?:e|al)|kill\s+myself|end\s+my\s+life|want\s+to\s+die|wanna\s+die|better\s+off\s+dead|self[- ]?harm|hurt\s+myself|cut\s+myself|overdose|hang\s+myself|kill\s+someone|hurt\s+someone|in\s+immediate\s+danger)\b/i;
const ZH_CRISIS_RE =
  /(?:想死|不想活|活不下去了|活不下去|自殺|自杀|輕生|轻生|尋死|寻死|結束生命|结束生命|了結生命|了结生命|割腕|跳樓|跳楼|上吊|服毒|自殘|自残|傷害自己|伤害自己|傷害別人|伤害别人|殺了別人|杀了别人|遇到危險|遇到危险)/;

const ALL_KNOWN_MENTION_NAMES = [
  'AI Tarot',
  'Tarot Master',
  'tarot-master-2',
  '塔羅大師',
  '塔罗大师',
  '塔羅師',
  '塔罗师',
  'AI Fortune Stick',
  'fortune-stick',
  'wenyiqian',
  '問一籤',
  '问一签',
  '解籤師',
  '解签师',
  'AI in 5',
  'AI5',
  'ai5-chat',
  'AI新聞',
  'AI新闻',
  'Spotted London',
  'spotted-guide',
  'London Chinese Food',
  'lcf-guide',
  'Manyfold Data',
  'mfd-guide',
  'Penny',
  'penny',
  '記帳狗',
  'Quidpaw',
  'QuidPaw',
  '省錢小幫手',
];

const BARE_DRAW_TRIGGER_RE =
  /^(?:抽|抽牌|抽吧|抽卡|抽三張|抽三张|抽塔羅|抽塔罗|來抽牌|来抽牌|開抽|开抽|開始抽|开始抽|再抽一次|draw|draw\s+cards?|draw\s+tarot|draw\s+(?:a\s+)?spread|pull\s+cards?)$/i;
const SESSION_CONFIRM_RE = /^(?:ok|okay|go|ready|yes|好|好的|可以|來吧|来吧|開始|开始|請|请)$/i;
const DAILY_CARD_PHRASE_RE =
  /(?:每日一牌|今日一牌|今天的一牌|每天一牌|\bdaily\s*card\b|\btoday'?s?\s*card\b|\bone[- ]card\b)/i;
const SINGLE_CARD_DRAW_RE =
  /(?:抽[一1]張牌?|抽[一1]张牌?|抽[一1]牌|抽個牌|抽个牌|\b(?:draw|pull)\s+(?:one|a|1)\s+(?:tarot\s+)?card\b|\bsingle[- ]?card\s+(?:draw|reading)\b)/i;
const MULTI_CARD_OR_SPREAD_RE = /三張|三张|three[- ]?cards?|牌陣|牌阵|spread/i;
const EXPLICIT_DRAW_PHRASE_RE =
  /(?:抽三張|抽三张|抽塔羅|抽塔罗|抽牌|幫我抽|帮我抽|來抽|来抽|draw\s+(?:three|3)\s+cards?|draw\s+(?:a\s+)?(?:tarot|spread|cards?)|pull\s+(?:three|3)\s+cards?)/i;

const OPT_IN_WEEKLY_RE =
  /^(?:訂閱每週|订阅每周|開啟每週|开启每周|打開每週|打开每周|opt[- ]?in\s+weekly|subscribe\s+weekly)\b/i;
const OPT_OUT_WEEKLY_RE =
  /^(?:取消每週|取消每周|關閉每週|关闭每周|停止每週|停止每周|退訂每週|退订每周|opt[- ]?out\s+weekly|unsubscribe\s+weekly)\b/i;
const DM_GREETING_RE =
  /^(?:hi|hello|hey|yo|morning|good\s+(?:morning|afternoon|evening)|你好|您好|哈囉|哈啰|嗨|安安|早安|午安|晚安|在嗎|在吗|有人嗎|有人吗)$/i;
const DM_THANKS_RE =
  /(?:謝謝|谢谢|感謝|感谢|多謝|多谢|謝啦|谢啦|\b(?:thanks?|thank\s+you|thx|tysm|cheers|appreciated)\b)/i;
const CAPABILITY_RE =
  /(?:你能(?:幫我|帮我)?(?:做|算|抽|看)(?:什麼|什么|哪些)|你可以(?:幫我|帮我)?(?:做|算|抽|看)(?:什麼|什么|哪些)|what\s+can\s+you\s+(?:do|help))/i;
const CASUAL_SMALL_TALK_PHRASE_RE =
  /天氣|天气|下雨|下雪|晴天|陰天|阴天|出太陽|出太阳|刮風|刮风|降溫|降温|回暖|好冷|好熱|好热|早點休息|早点休息|早點睡|早点睡|去睡覺|去睡觉|睡覺了|睡觉了|想睡了|先休息|休息了|去休息|先去忙|去忙一下|先忙了|去忙了|晚點聊|晚点聊|晚點見|晚点见|下次聊|改天聊|回頭聊|回头聊|先這樣|先这样|先走了|先走囉|掰掰|拜拜|晚安|沒事了|没事了|不用了|先不用|下線了|下线了|(?:好[喔哦啊呀]?[，,\s]*)?(?:謝謝|谢谢|感謝|感谢|多謝|多谢)(?:你|您)?(?:啦|喔|哦|呀)?(?:[!！。.~～\s]*$|[，,\s]*(?:我先|先去|沒事|没事|先這樣|先这样|早點|早点|晚點|晚点|掰掰|拜拜|大家|各位|了))|\b(?:nice\s+weather|good\s+weather|bad\s+weather|weather\s+(?:is|today)|going\s+to\s+(?:bed|sleep)|go\s+to\s+(?:bed|sleep)|get\s+some\s+rest|heading\s+out|got\s+to\s+go|gotta\s+go|gtg|g2g|brb|ttyl|see\s+(?:you|ya)|bye(?:\s+bye)?|goodbye|good\s*night|goodnight|never\s*mind|nvm|talk\s+later)\b|\b(?:thanks?(?:\s+(?:a\s+lot|so\s+much))?|thank\s+you(?:\s+(?:so\s+much|very\s+much))?|thx|tysm|ty|cheers)\b(?:\s*[!！.。~～]*$|\s*,?\s*(?:i(?:'m|\s+am)?\s+(?:going|heading|off)|got\s+to\s+go|gotta\s+go|gtg|g2g|brb|ttyl|bye|see\s+(?:you|ya)|talk\s+later|good\s*night|goodnight))/i;
const BARE_GREETING_OR_THANKS_RE =
  /^(?:(?:(?:hi|hello|hey|yo|gm|gn|morning|afternoon|evening|good\s+(?:morning|afternoon|evening|night)|goodnight|你好|您好|哈囉|哈啰|嗨|安安|早安|午安|晚安|早啊?|大家好|各位好|各位早|大家早|在嗎|在吗|有人嗎|有人吗|打擾了|打扰了)(?:[\s,，!！.。~～]*(?:各位|大家|all|everyone|there))?)(?:[,，\s]+)?|(?:(?:(?:hi|hello|hey|你好|您好|嗨|早安|午安|晚安)[,，\s]+|(?:好[喔哦啊呀]?|好的|嗯嗯?)[,，\s]*|(?:ok(?:ay)?|got\s+it|alright|sure|cool)[,，\s]+)?(?:(?:非常|真的|太|很)?(?:謝謝(?:你|您|大家)?|谢谢(?:你|您|大家)?|謝啦|谢啦|感謝(?:你|您|大家)?|感谢(?:你|您|大家)?|多謝|多谢|辛苦了|麻煩你?了|麻烦你?了)(?:的幫忙|的帮助)?|thanks?(?:\s+(?:you|a\s+lot|so\s+much))?|thank\s+you(?:\s+(?:so\s+much|very\s+much))?|thx|tysm|ty|cheers|appreciated)(?:\s+for\s+(?:your\s+help|the\s+help|helping|everything))?)|好[喔哦]|嗯嗯|了解|收到|好累[喔哦啊呀]?|累死了|好睏|好困|哈哈+|呵呵+|笑死|lol|lmao)[!！.。~～?？\s]*$/i;
const TAROT_FOLLOWUP_CUE_RE =
  /(?:抽|牌|占卜|正位|逆位|大阿爾|大阿尔|小阿爾|小阿尔|解讀|解读|解釋|解释|怎麼解|怎么解|第\s*[0-9一二三四五六七八九十兩两]+\s*[張张位]|[這那][張张組组]|再來[一三]?[張张]|再来[一三]?[张张]|最後一[張张]|最后一[张张]|深問|深问|\b(?:tarot|cards?|spread|draw|pull|reading|upright|reversed|arcana|interpret(?:ation)?|explain|meaning)\b)/i;

const USER_REFLECTION_QUESTION: Record<SpreadId, Record<LangCode, string>> = {
  current: {
    'zh-Hant': '這三張牌裡，哪一張最貼近你此刻心裡的感受？',
    'zh-Hans': '这三张牌里，哪一张最贴近你此刻心里的感受？',
    en: 'Which of these three cards feels closest to where you are right now?',
  },
  decision: {
    'zh-Hant': '這三張牌裡，哪一張最提醒你現在真正該衡量的是什麼？',
    'zh-Hans': '这三张牌里，哪一张最提醒你现在真正该衡量的是什么？',
    en: 'Which of these cards points most clearly to what you really need to weigh?',
  },
  'next-step': {
    'zh-Hant': '如果今天只有十分鐘，哪一個最小的一步是你現在願意先走出去的？',
    'zh-Hans': '如果今天只有十分钟，哪一个最小的一步是你现在愿意先走出去的？',
    en: 'If you only had ten minutes today, what is the smallest first step you are willing to take?',
  },
  'weekly-review': {
    'zh-Hant': '回看這一週，哪一個瞬間最值得你記住，又有什麼可以放心放下？',
    'zh-Hans': '回看这一周，哪一个瞬间最值得你记住，又有什么可以放心放下？',
    en: 'Looking back at this week, which moment is worth keeping, and what can you set down?',
  },
};

function stripMentionsAndPunct(text: string): string {
  return stripAgentMentions(text ?? '', ALL_KNOWN_MENTION_NAMES)
    .replace(/^[\s,，.。!！?？:：;；"'「」『』()（）]+|[\s,，.。!！?？:：;；"'「」『』()（）]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Checks whether the inbound message expresses acute self-harm, violence, or immediate danger. */
export function isCrisisMessage(text: string): boolean {
  const clean = (text ?? '').trim();
  if (!clean) return false;
  return EN_CRISIS_RE.test(clean) || ZH_CRISIS_RE.test(clean);
}

/** Resolves pure `'zh-Hant' | 'zh-Hans' | 'en'` matching the speaker's script or explicit hint. */
export function resolveTarotLang(
  text: string,
  decisionLang: LangCode,
  memories?: RecallTurnResult,
): LangCode {
  const clean = stripMentionsAndPunct(text);
  const explicitSwitch = detectExplicitLangSwitch(clean);
  if (explicitSwitch) return explicitSwitch;

  const hasHant = HANT_SIGNAL_RE.test(clean);
  const hasHans = HANS_SIGNAL_RE.test(clean);
  if (hasHant && !hasHans) return 'zh-Hant';
  if (hasHans && !hasHant) return 'zh-Hans';

  const stored = memories?.userMemories.find((m) => m.key === 'lang')?.value;
  const storedOrDecision: LangCode =
    stored === 'zh-Hant' || stored === 'zh-Hans' || stored === 'en' ? stored : decisionLang;
  return detectLang(clean, storedOrDecision, storedOrDecision, {
    extraMentionNames: ALL_KNOWN_MENTION_NAMES,
  });
}

export function crisisReply(lang: LangCode): string {
  if (lang === 'zh-Hant') {
    return [
      '聽到你現在很不容易，我們先不抽牌。',
      '如果你有傷害自己或他人的念頭，或正處於危險之中，請立刻聯絡身邊信任的人或專業支援：',
      '英國請撥緊急電話 999 或 Samaritans 116 123；美國請撥 911 或 988；中國大陸請撥 110／120 或心理援助熱線 12356。你不需要一個人扛著。',
    ].join('\n');
  }
  if (lang === 'zh-Hans') {
    return [
      '听到你现在很不容易，我们先不抽牌。',
      '如果你有伤害自己或他人的念头，或正处于危险之中，请立刻联系身边信任的人或专业支持：',
      '英国请拨紧急电话 999 或 Samaritans 116 123；美国请拨 911 或 988；中国大陆请拨 110／120 或心理援助热线 12356。你不需要一个人扛着。',
    ].join('\n');
  }
  return [
    'I hear how heavy things feel right now, so let us pause the cards.',
    'If you are in immediate danger or thinking of hurting yourself or someone else, please reach someone right away: emergency services (UK 999, US 911, China 110 or 120) or a crisis line (UK Samaritans 116 123, US 988, China 12356). You do not have to carry this alone.',
  ].join('\n');
}

export function detectSpreadFromText(text: string): SpreadId {
  if (/決定|决定|選擇|选择|二選一|二选一|還是|还是|\bdecision\b|\bchoose\b|\bshould\s+i\b.+\bor\b/i.test(text)) {
    return 'decision';
  }
  if (/下一步|接下來|接下来|第一步|怎麼開始|怎么开始|\bnext[- ]step\b|\bfirst\s+step\b/i.test(text)) {
    return 'next-step';
  }
  if (/每週|每周|這週|这周|本週|本周|回顧|回顾|\bweekly\b/i.test(text)) {
    return 'weekly-review';
  }
  return 'current';
}

function localizedSpreadText(raw: string, lang: LangCode): string {
  return lang === 'zh-Hant' ? toZhHant(raw) : raw;
}

/** Formats a deterministic CSPRNG three-card tarot draw in pure `zh-Hant` / `zh-Hans` / `en`. */
export function formatLocalTarotDraw(
  lang: LangCode,
  spreadId: SpreadId,
  options: { isVoice?: boolean; random?: RandomSource } = {},
): string {
  const deckLocale: Locale = lang === 'en' ? 'en' : 'zh';
  const spread = spreadFor(spreadId, deckLocale);
  const drawn = drawReading(options.random);
  const loc = (s: string) => localizedSpreadText(s, lang);

  const cardLines = drawn.map((item, idx) => {
    const card = cardById(item.cardId);
    if (!card) return '';
    const slotTitle = loc(spread.slots[item.slot].title);
    const label = loc(cardLabel(card, item.reversed, deckLocale));
    const kw = loc(cardKeywords(card, item.reversed, deckLocale));
    if (options.isVoice) {
      if (lang === 'en') {
        return `For ${slotTitle}, you drew ${label}, pointing to ${kw}.`;
      }
      const keyLabel = lang === 'zh-Hans' ? '关键是' : '關鍵是';
      return `${slotTitle}抽到${label}，${keyLabel}${kw}。`;
    }
    if (lang === 'en') {
      return `${idx + 1}. ${slotTitle}: ${label} (${kw})`;
    }
    return `${idx + 1}. ${slotTitle}：${label}（${kw}）`;
  });

  const reflectionQuestion = USER_REFLECTION_QUESTION[spreadId][lang];

  if (options.isVoice) {
    const spreadTitle = loc(spread.title);
    if (lang === 'zh-Hant') {
      return `這是為你抽出的「${spreadTitle}」三張牌。${cardLines.join(' ')} ${reflectionQuestion} 如果想針對其中一張牌深問，直接告訴我。`;
    }
    if (lang === 'zh-Hans') {
      return `这是为你抽出的「${spreadTitle}」三张牌。${cardLines.join(' ')} ${reflectionQuestion} 如果想针对其中一张牌深问，直接告诉我。`;
    }
    return `Here is your three-card "${spreadTitle}" draw. ${cardLines.join(' ')} ${reflectionQuestion} Tell me if you want to explore any of these cards further.`;
  }

  const spreadTitle = loc(spread.title);
  if (lang === 'zh-Hant') {
    return [
      `牌陣：${spreadTitle}`,
      ...cardLines,
      `方向提醒：${loc(spread.description)}`,
      `留給你的問題：${reflectionQuestion}`,
      `若想繼續深問這組牌（不用重新抽），直接接著問即可。線上牌桌：${TAROT_SITE_URL}`,
    ].join('\n');
  }
  if (lang === 'zh-Hans') {
    return [
      `牌阵：${spreadTitle}`,
      ...cardLines,
      `方向提醒：${spread.description}`,
      `留给你的问题：${reflectionQuestion}`,
      `如果想继续深问这组牌（不用重新抽），直接接着问即可。在线牌桌：${TAROT_SITE_URL}`,
    ].join('\n');
  }
  return [
    `Spread: ${spreadTitle}`,
    ...cardLines,
    `Focus: ${spread.description}`,
    `Question to sit with: ${reflectionQuestion}`,
    `Ask a follow-up about these three cards anytime, or open the table at ${TAROT_SITE_URL}`,
  ].join('\n');
}

/** Formats today's daily card deterministically in pure `zh-Hant` / `zh-Hans` / `en`. */
export function formatDailyCardReply(lang: LangCode, date = new Date(), isVoice = false): string {
  const daily = dailyCardFor(utcDay(date));
  const card = cardById(daily.cardId);
  if (!card) return '';
  const deckLocale: Locale = lang === 'en' ? 'en' : 'zh';
  const label = localizedSpreadText(cardLabel(card, daily.reversed, deckLocale), lang);
  const kw = localizedSpreadText(dailyCardKeywords(daily, deckLocale), lang);
  if (lang === 'zh-Hant') {
    return isVoice
      ? `今日一牌是${label}，關鍵詞是${kw}。今天哪一件小事值得你多留意一點？`
      : `今日一牌（${daily.day}）：${label}（${kw}）\n今天，哪一件小事值得你多留意一點？ ${TAROT_SITE_URL}`;
  }
  if (lang === 'zh-Hans') {
    return isVoice
      ? `今日一牌是${label}，关键词是${kw}。今天哪一件小事值得你多留意一点？`
      : `今日一牌（${daily.day}）：${label}（${kw}）\n今天，哪一件小事值得你多留意一点？ ${TAROT_SITE_URL}`;
  }
  return isVoice
    ? `Today's card is ${label}, pointing to ${kw}. What small thing deserves a little more of your attention today?`
    : `Today's card (${daily.day}): ${label} (${kw})\nWhat small thing deserves a little more of your attention today? ${TAROT_SITE_URL}`;
}

/** Formats a crisp single-card CSPRNG tarot draw in pure `zh-Hant` / `zh-Hans` / `en`. */
export function formatSingleCardLocalDraw(
  lang: LangCode,
  options: { isVoice?: boolean; random?: RandomSource } = {},
): string {
  const deckLocale: Locale = lang === 'en' ? 'en' : 'zh';
  const drawn = drawReading(options.random);
  const first = drawn[0];
  const card = first ? cardById(first.cardId) : null;
  if (!card || !first) return '';

  const label = localizedSpreadText(cardLabel(card, first.reversed, deckLocale), lang);
  const kw = localizedSpreadText(cardKeywords(card, first.reversed, deckLocale), lang);

  if (lang === 'zh-Hant') {
    const reflection = first.reversed
      ? '此刻有什麼地方可以先停下來多看一眼？'
      : '眼前最值得先確認或跨出的一小步是什麼？';
    return options.isVoice
      ? `為你抽出一張牌：${label}，關鍵是${kw}。${reflection} 如果想就這張牌深問，直接告訴我。`
      : [
          `單張抽牌：${label}（${kw}）`,
          `留給你的問題：${reflection}`,
          `若想繼續深問這張牌，直接接著問即可。線上牌桌：${TAROT_SITE_URL}`,
        ].join('\n');
  }

  if (lang === 'zh-Hans') {
    const reflection = first.reversed
      ? '此刻有什么地方可以先停下来多看一眼？'
      : '眼前最值得先确认或跨出的一小步是什么？';
    return options.isVoice
      ? `为你抽出一张牌：${label}，关键是${kw}。${reflection} 如果想就这张牌深问，直接告诉我。`
      : [
          `单张抽牌：${label}（${kw}）`,
          `留给你的问题：${reflection}`,
          `如果想继续深问这张牌，直接接着问即可。在线牌桌：${TAROT_SITE_URL}`,
        ].join('\n');
  }

  const reflection = first.reversed
    ? 'What here might need a closer look or a pause before you move?'
    : 'What small step in front of you feels clearest to confirm or take next?';
  return options.isVoice
    ? `I drew one card for you: ${label}, pointing to ${kw}. ${reflection} Tell me if you want to explore this card further.`
    : [
        `Single-card draw: ${label} (${kw})`,
        `Question to sit with: ${reflection}`,
        `Ask a follow-up about this card anytime, or open the table at ${TAROT_SITE_URL}`,
      ].join('\n');
}

function isoWeekKey(date: Date): string {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CJK_CHAR_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/;

function matchSpecKeyword(text: string, lowerText: string, kw: string | RegExp): boolean {
  if (kw instanceof RegExp) return kw.test(text);
  const needle = kw.trim().toLowerCase();
  if (!needle) return false;
  if (CJK_CHAR_RE.test(needle)) return lowerText.includes(needle);
  return new RegExp(`(?<![a-z0-9])${escapeRegex(needle)}(?![a-z0-9])`, 'i').test(text);
}

function hasAnyDomainKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return (TAROT_AGENT_SPEC.domainKeywords ?? []).some((kw) => matchSpecKeyword(text, lower, kw));
}

function hasAnyAntiKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return (TAROT_AGENT_SPEC.antiKeywords ?? []).some((kw) => matchSpecKeyword(text, lower, kw));
}

/** Checks whether `text` asks for a single daily card rather than a three-card spread. */
export function isDailyCardRequest(text: string): boolean {
  return DAILY_CARD_PHRASE_RE.test(text) && !MULTI_CARD_OR_SPREAD_RE.test(text);
}

function hasTarotFollowUpCue(text: string): boolean {
  return (
    hasAnyDomainKeyword(text) ||
    BARE_DRAW_TRIGGER_RE.test(text) ||
    SESSION_CONFIRM_RE.test(text) ||
    isDailyCardRequest(text) ||
    EXPLICIT_DRAW_PHRASE_RE.test(text) ||
    TAROT_FOLLOWUP_CUE_RE.test(text)
  );
}

function isCasualActiveSessionChatter(text: string): boolean {
  if (!text || hasTarotFollowUpCue(text)) return false;
  return CASUAL_SMALL_TALK_PHRASE_RE.test(text) || BARE_GREETING_OR_THANKS_RE.test(text);
}

/**
 * `fastRespond` handler for `tarot-master-2`:
 * 1. Crisis safety net (always runs first, never draws cards).
 * 2. Explicit weekly opt-in/opt-out & language switch memory commands.
 * 3. Active-session off-topic chatter silence guard.
 * 4. Local CSPRNG three-card / daily card draw in pure `zh-Hant` / `zh-Hans` / `en`.
 * 5. Returns `null` for nuanced readings/follow-ups so Manyfold A2A answers.
 */
export async function tarotFastRespond(
  env: Env,
  event: InboundEvent,
  decision: TriageDecision,
  memories: RecallTurnResult,
): Promise<string | null> {
  const lang = resolveTarotLang(event.text, decision.detectedLang, memories);

  if (isCrisisMessage(event.text)) {
    return crisisReply(lang);
  }

  const stripped = stripMentionsAndPunct(event.text);

  // Explicit language switch persistence
  const explicitLangSwitch = detectExplicitLangSwitch(stripped);
  if (explicitLangSwitch) {
    if (env.DB) {
      await new MemoryStore(env.DB, TAROT_AGENT_ID)
        .rememberUser({
          userId: event.senderId,
          key: 'lang',
          value: explicitLangSwitch,
          kind: 'language',
          originChatType: event.chatType,
          originRoomId: event.roomId,
        })
        .catch(() => undefined);
    }
    if (explicitLangSwitch === 'zh-Hant') {
      return '好的，接下來我會用繁體中文陪你看牌。想問什麼事，隨時告訴我。';
    }
    if (explicitLangSwitch === 'zh-Hans') {
      return '好的，接下来我会用简体中文陪你看牌。想问什么事，随时告诉我。';
    }
    return 'Of course — I will reply in English from here. Tell me what is on your mind when you are ready.';
  }

  // Explicit opt-in / opt-out for weekly review broadcasts
  if (OPT_IN_WEEKLY_RE.test(stripped)) {
    if (env.DB) {
      await new MemoryStore(env.DB, TAROT_AGENT_ID)
        .rememberRoom({
          roomId: event.roomId,
          key: 'opt_in_weekly',
          value: 'true',
          kind: 'preference',
          updatedBy: event.senderId,
        })
        .catch(() => undefined);
    }
    if (lang === 'zh-Hant') return '好的，已為這個房間開啟每週塔羅回顧提醒。想隨時取消告訴我一聲即可。';
    if (lang === 'zh-Hans') return '好的，已为这个房间开启每周塔罗回顾提醒。想随时取消告诉我一声即可。';
    return 'Done — weekly tarot review reminders are now enabled for this room. Let me know anytime if you want to turn them off.';
  }
  if (OPT_OUT_WEEKLY_RE.test(stripped)) {
    if (env.DB) {
      await new MemoryStore(env.DB, TAROT_AGENT_ID)
        .rememberRoom({
          roomId: event.roomId,
          key: 'opt_in_weekly',
          value: 'false',
          kind: 'preference',
          updatedBy: event.senderId,
        })
        .catch(() => undefined);
    }
    if (lang === 'zh-Hant') return '好的，已關閉這個房間的每週塔羅提醒。';
    if (lang === 'zh-Hans') return '好的，已关闭这个房间的每周塔罗提醒。';
    return 'Got it — weekly tarot review reminders are turned off for this room.';
  }

  const isUnmentionedGroup =
    event.chatType === 'group' &&
    decision.reason !== 'explicit_mention' &&
    decision.reason !== 'reply_to_self';

  // Keep unmentioned group turns silent on off-topic anti-keywords and casual active-session chatter
  if (isUnmentionedGroup) {
    if (
      !BARE_DRAW_TRIGGER_RE.test(stripped) &&
      !SESSION_CONFIRM_RE.test(stripped) &&
      !isDailyCardRequest(stripped) &&
      hasAnyAntiKeyword(stripped) &&
      !hasAnyDomainKeyword(stripped)
    ) {
      return '[NO_REPLY]';
    }
    if (decision.reason === 'active_session' && isCasualActiveSessionChatter(stripped)) {
      return '[NO_REPLY]';
    }
  }

  const isDirectConversation =
    event.chatType === 'dm' || decision.reason === 'dm' || decision.reason === 'explicit_mention';

  if (
    isDirectConversation &&
    (!stripped || DM_GREETING_RE.test(stripped) || CAPABILITY_RE.test(stripped))
  ) {
    if (lang === 'zh-Hant') {
      return '嗨！我是塔羅大師（AI Tarot）🔮 想看哪方面的指引？直接跟我說「幫我抽三張牌看這週運勢」、「每日一牌」，或把心裡猶豫的事告訴我就可以開始。';
    }
    if (lang === 'zh-Hans') {
      return '嗨！我是塔罗大师（AI Tarot）🔮 想看哪方面的指引？直接跟我说“帮我抽三张牌看这周运势”、“每日一牌”，或把心里犹豫的事告诉我就可以开始。';
    }
    return 'Hi! I am Tarot Master 🔮 Ready whenever you are — say "draw 3 cards", "daily card", or tell me what is on your mind.';
  }

  if (
    isDirectConversation &&
    DM_THANKS_RE.test(stripped) &&
    !BARE_DRAW_TRIGGER_RE.test(stripped) &&
    !EXPLICIT_DRAW_PHRASE_RE.test(stripped) &&
    !SINGLE_CARD_DRAW_RE.test(stripped) &&
    !isDailyCardRequest(stripped) &&
    !/[?？]$/.test(event.text.trim())
  ) {
    if (lang === 'zh-Hant') {
      return '不客氣 🔮 希望這張牌有帶給你一點靈感！之後有新問題或想再抽牌時，隨時跟我說。';
    }
    if (lang === 'zh-Hans') {
      return '不客气 🔮 希望这张牌有带给你一点灵感！之后有新问题或想再抽牌时，随时跟我说。';
    }
    return "You're very welcome 🔮 I'm glad that resonated! Whenever you have a new question or want another draw, just say the word.";
  }

  if (isDailyCardRequest(stripped)) {
    return formatDailyCardReply(lang, new Date(event.timestampMs || Date.now()), event.isVoice === true);
  }

  if (SINGLE_CARD_DRAW_RE.test(stripped) && !MULTI_CARD_OR_SPREAD_RE.test(stripped)) {
    return formatSingleCardLocalDraw(lang, { isVoice: event.isVoice === true });
  }

  const isDirectDraw =
    BARE_DRAW_TRIGGER_RE.test(stripped) ||
    (decision.reason === 'active_session' && SESSION_CONFIRM_RE.test(stripped)) ||
    EXPLICIT_DRAW_PHRASE_RE.test(stripped);

  if (isDirectDraw) {
    const spreadId = detectSpreadFromText(stripped);
    return formatLocalTarotDraw(lang, spreadId, { isVoice: event.isVoice === true });
  }

  return null;
}

/**
 * Fetches weekly review broadcasts ONLY for rooms that explicitly opted in (`opt_in_weekly = 'true'`).
 * Returns `[]` by default so groups never receive unsolicited broadcasts.
 */
export async function fetchTarotUpdates(env: Env, _sinceIso: string): Promise<AgentUpdateItem[]> {
  if (!isNarraGatewayEnabled(env) || !env.DB) return [];
  try {
    const { results } = await env.DB
      .prepare(
        `SELECT room_id AS roomId
         FROM narra_room_memory
         WHERE agent_id = ?
           AND memory_key = 'opt_in_weekly'
           AND LOWER(memory_value) IN ('true', 'on', '1', 'yes')`,
      )
      .bind(TAROT_AGENT_ID)
      .all<{ roomId: string }>();

    if (!results || results.length === 0) return [];
    const week = isoWeekKey(new Date());
    const items: AgentUpdateItem[] = [];

    for (const row of results) {
      const langRow = await env.DB
        .prepare(
          `SELECT memory_value AS lang
           FROM narra_room_memory
           WHERE agent_id = ? AND room_id = ? AND memory_key = 'lang'`,
        )
        .bind(TAROT_AGENT_ID, row.roomId)
        .first<{ lang: string }>();
      const lang: LangCode =
        langRow?.lang === 'zh-Hans' || langRow?.lang === 'en' || langRow?.lang === 'zh-Hant'
          ? langRow.lang
          : 'zh-Hant';
      const spreadLocale: Locale = lang === 'en' ? 'en' : 'zh';
      const spread = spreadFor('weekly-review', spreadLocale);
      const text =
        lang === 'zh-Hant'
          ? `每週回顧（${week}）：${toZhHant(spread.description)} 想整理這週抽三張牌的話，回覆「抽 每週回顧」即可。 ${TAROT_SITE_URL}`
          : lang === 'zh-Hans'
            ? `每周回顾（${week}）：${spread.description} 想整理这周抽三张牌的话，回复「抽 每周回顾」即可。 ${TAROT_SITE_URL}`
            : `Weekly review (${week}): ${spread.description} Reply "draw weekly review" whenever you want three cards for the week. ${TAROT_SITE_URL}`;

      items.push({
        updateKey: `weekly:${week}`,
        roomId: row.roomId,
        title: `Weekly tarot review ${week}`,
        text,
        lang,
        priority: 'normal',
      });
    }
    return items;
  } catch {
    return [];
  }
}

/** Resolves A2A credential from `MANYFOLD_A2A_URL`/`MANYFOLD_A2A_TOKEN` or connected D1 agents. */
export async function resolveTarotA2ACredential(
  env: Env,
): Promise<NarraA2ACredentialResult | null> {
  const directUrl = (env.MANYFOLD_A2A_URL ?? '').trim();
  const directToken = (env.MANYFOLD_A2A_TOKEN ?? '').trim();
  if (directUrl && directToken) {
    return { url: directUrl, token: directToken, label: TAROT_AGENT_SPEC.name };
  }
  if (!env.DB) return null;
  try {
    await ensureSchema(env.DB);
    const agents = await listConnectedAgents(env);
    const preferredId = (env.NARRA_AGENT_ID ?? env.TAROT_AGENT_ID ?? '').trim();
    const chosen =
      (preferredId ? agents.find((a) => a.agentId === preferredId) : undefined) ?? agents[0];
    if (!chosen) return null;
    const cred = await credentialFor(env, chosen.agentId);
    return { url: cred.rpcUrl, token: cred.token, label: cred.label };
  } catch {
    return null;
  }
}

export const narraGatewayConfig: NarraGatewayConfig<Env> = {
  spec: TAROT_AGENT_SPEC,
  fastRespond: tarotFastRespond,
  fetchUpdates: fetchTarotUpdates,
  resolveA2ACredential: resolveTarotA2ACredential,
};

export function kickTarotNarraGateway(env: Env): Promise<NarraGatewayKickResult> {
  return kickNarraGateway(env, narraGatewayConfig);
}

export function getTarotNarraGatewayStatus(env: Env): Promise<NarraGatewayStatus> {
  return getNarraGatewayStatus(env, narraGatewayConfig);
}
