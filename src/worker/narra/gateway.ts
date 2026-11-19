/**
 * Narra Messenger Gateway integration for AI Tarot (`tarot-master-2`).
 *
 * Keeps `NARRA_GATEWAY_ENABLED` and `NARRA_SYNC` strictly fail-closed (`"off"` by default),
 * provides crisis safety responses, local CSPRNG three-card / daily draws in pure
 * `zh-Hant` / `zh-Hans` / `en`, opt-in weekly broadcasts, and Manyfold A2A fallback.
 */

import {
  MemoryStore,
  detectLang,
  isNarraGatewayEnabled,
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
export const TAROT_DEFAULT_MATRIX_ID = '@agent-1aac6abd:matrix.netmind.chat';
export const TAROT_SITE_URL = 'https://app.manyfold.ai/tarot/';

export const TAROT_AGENT_SPEC: AgentSpec = {
  id: TAROT_AGENT_ID,
  matrixId: TAROT_DEFAULT_MATRIX_ID,
  name: 'AI Tarot',
  aliases: ['tarot-master-2', 'Tarot Master', '塔羅師', '塔罗师'],
  domainDescription:
    'Three-card AI tarot readings, card meanings, spreads, and reflective follow-ups in zh-Hant, zh-Hans, and en.',
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
    'tarot spread',
    '塔羅',
    '塔罗',
    '塔羅牌',
    '塔罗牌',
    '抽牌',
    '抽三張',
    '抽三张',
    '占卜',
    '牌陣',
    '牌阵',
    '正位',
    '逆位',
    '每日一牌',
    '今日一牌',
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

const BARE_MENTION_RE =
  /\[@[^\]\n]{1,80}\]\(@[A-Za-z0-9._=\-/+]+:[A-Za-z0-9.-]+(?::\d{1,5})?\)|@[A-Za-z0-9._=\-/+]+(?::[A-Za-z0-9.-]+(?::\d{1,5})?)?/g;

const BARE_DRAW_TRIGGER_RE =
  /^(?:抽|抽牌|抽吧|抽卡|抽三張|抽三张|抽塔羅|抽塔罗|來抽牌|来抽牌|開抽|开抽|開始抽|开始抽|再抽一次|draw|draw\s+cards?|draw\s+tarot|draw\s+(?:a\s+)?spread|pull\s+cards?)$/i;
const SESSION_CONFIRM_RE = /^(?:ok|okay|go|ready|yes|好|好的|可以|來吧|来吧|開始|开始|請|请)$/i;
const DAILY_CARD_TRIGGER_RE = /^(?:每日一牌|今日一牌|今天的一牌|daily\s*card|today'?s?\s*card)$/i;
const EXPLICIT_DRAW_PHRASE_RE =
  /(?:抽三張|抽三张|抽塔羅|抽塔罗|抽牌|幫我抽|帮我抽|來抽|来抽|draw\s+(?:three|3)\s+cards?|draw\s+(?:a\s+)?(?:tarot|spread|cards?)|pull\s+(?:three|3)\s+cards?)/i;

const OPT_IN_WEEKLY_RE =
  /^(?:訂閱每週|订阅每周|開啟每週|开启每周|打開每週|打开每周|opt[- ]?in\s+weekly|subscribe\s+weekly)\b/i;
const OPT_OUT_WEEKLY_RE =
  /^(?:取消每週|取消每周|關閉每週|关闭每周|停止每週|停止每周|退訂每週|退订每周|opt[- ]?out\s+weekly|unsubscribe\s+weekly)\b/i;

function stripMentionsAndPunct(text: string): string {
  return (text ?? '')
    .replace(BARE_MENTION_RE, ' ')
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
  const clean = (text ?? '').trim();
  if (/用繁體|繁體中文|正體中文/i.test(clean)) return 'zh-Hant';
  if (/用简体|简体中文/i.test(clean)) return 'zh-Hans';
  if (/\b(?:in\s+english|speak\s+english|english\s+please)\b/i.test(clean)) return 'en';

  const hasHant = HANT_SIGNAL_RE.test(clean);
  const hasHans = HANS_SIGNAL_RE.test(clean);
  if (hasHant && !hasHans) return 'zh-Hant';
  if (hasHans && !hasHant) return 'zh-Hans';

  const stored = memories?.userMemories.find((m) => m.key === 'lang')?.value;
  if (stored === 'zh-Hant' || stored === 'zh-Hans' || stored === 'en') {
    return detectLang(clean, stored, stored);
  }
  return decisionLang;
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

  if (options.isVoice) {
    const spreadTitle = loc(spread.title);
    if (lang === 'zh-Hant') {
      return `這是為你抽出的「${spreadTitle}」三張牌。${cardLines.join(' ')} ${loc(spread.guidance.reflection)} 如果想針對其中一張牌深問，直接告訴我。`;
    }
    if (lang === 'zh-Hans') {
      return `这是为你抽出的「${spreadTitle}」三张牌。${cardLines.join(' ')} ${spread.guidance.reflection} 如果想针对其中一张牌深问，直接告诉我。`;
    }
    return `Here is your three-card "${spreadTitle}" draw. ${cardLines.join(' ')} ${spread.guidance.reflection} Tell me if you want to explore any of these cards further.`;
  }

  const spreadTitle = loc(spread.title);
  if (lang === 'zh-Hant') {
    return [
      `牌陣：${spreadTitle}`,
      ...cardLines,
      `方向提醒：${loc(spread.instruction)}`,
      `留給你的問題：${loc(spread.guidance.reflection)}`,
      `若想繼續深問這組牌（不用重新抽），直接接著問即可。線上牌桌：${TAROT_SITE_URL}`,
    ].join('\n');
  }
  if (lang === 'zh-Hans') {
    return [
      `牌阵：${spreadTitle}`,
      ...cardLines,
      `方向提醒：${spread.instruction}`,
      `留给你的问题：${spread.guidance.reflection}`,
      `如果想继续深问这组牌（不用重新抽），直接接着问即可。在线牌桌：${TAROT_SITE_URL}`,
    ].join('\n');
  }
  return [
    `Spread: ${spreadTitle}`,
    ...cardLines,
    `Focus: ${spread.instruction}`,
    `Question to sit with: ${spread.guidance.reflection}`,
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

function isoWeekKey(date: Date): string {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function hasAnyDomainKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return (TAROT_AGENT_SPEC.domainKeywords ?? []).some((kw) =>
    typeof kw === 'string' ? lower.includes(kw.toLowerCase()) : kw.test(text),
  );
}

function hasAnyAntiKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return (TAROT_AGENT_SPEC.antiKeywords ?? []).some((kw) =>
    typeof kw === 'string' ? lower.includes(kw.toLowerCase()) : kw.test(text),
  );
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
  if (/^(?:用繁體|請用繁體|請用繁體中文|用正體中文|繁體中文)$/i.test(stripped)) {
    if (env.DB) {
      await new MemoryStore(env.DB, TAROT_AGENT_ID)
        .rememberUser({
          userId: event.senderId,
          key: 'lang',
          value: 'zh-Hant',
          kind: 'language',
          originChatType: event.chatType,
          originRoomId: event.roomId,
        })
        .catch(() => undefined);
    }
    return '好的，接下來我會用繁體中文陪你看牌。想問什麼事，隨時告訴我。';
  }
  if (/^(?:用简体|请用简体|请用简体中文|简体中文)$/i.test(stripped)) {
    if (env.DB) {
      await new MemoryStore(env.DB, TAROT_AGENT_ID)
        .rememberUser({
          userId: event.senderId,
          key: 'lang',
          value: 'zh-Hans',
          kind: 'language',
          originChatType: event.chatType,
          originRoomId: event.roomId,
        })
        .catch(() => undefined);
    }
    return '好的，接下来我会用简体中文陪你看牌。想问什么事，随时告诉我。';
  }
  if (/^(?:in\s+english|speak\s+english|english\s+please|english)$/i.test(stripped)) {
    if (env.DB) {
      await new MemoryStore(env.DB, TAROT_AGENT_ID)
        .rememberUser({
          userId: event.senderId,
          key: 'lang',
          value: 'en',
          kind: 'language',
          originChatType: event.chatType,
          originRoomId: event.roomId,
        })
        .catch(() => undefined);
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

  // Keep group active sessions silent on unrelated side chatter
  if (
    decision.reason === 'active_session' &&
    event.chatType === 'group' &&
    !BARE_DRAW_TRIGGER_RE.test(stripped) &&
    !SESSION_CONFIRM_RE.test(stripped) &&
    !DAILY_CARD_TRIGGER_RE.test(stripped) &&
    hasAnyAntiKeyword(stripped) &&
    !hasAnyDomainKeyword(stripped)
  ) {
    return '[NO_REPLY]';
  }

  if (DAILY_CARD_TRIGGER_RE.test(stripped)) {
    return formatDailyCardReply(lang, new Date(event.timestampMs || Date.now()), event.isVoice === true);
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
