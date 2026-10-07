/**
 * The tarot API surface, shared by the Worker and the browser.
 *
 * Serializable only — no runtime imports from either side except the deck's
 * `Locale`, which is plain data too.
 *
 * The load-bearing rule these types encode: the browser never states which
 * cards were drawn or which way up they landed. It asks the Worker to draw, and
 * the Worker tells it. `DrawnCardView` only exists for cards already revealed.
 */

import type { Locale } from './deck';

export type { Locale };

/** The three positions in every spread, in reveal order. */
export type SlotId = 'situation' | 'hidden' | 'guidance';

export type SpreadId = 'current' | 'decision' | 'next-step' | 'weekly-review';

export const SLOT_ORDER: readonly SlotId[] = ['situation', 'hidden', 'guidance'] as const;

export const CARDS_PER_READING = 3;

/**
 * Lifecycle of one reading. Forward-only; every transition is enforced server-side.
 *   greeting  — question accepted, diviner is answering / has answered
 *   drawn     — the shuffle was stopped and three cards are committed, all face down
 *   revealed  — all three have been turned over
 *   interpreted — the full reading exists
 */
export type ReadingStatus = 'greeting' | 'drawn' | 'revealed' | 'interpreted';

/** A card the user has already turned over. Absent from the API until then. */
export interface DrawnCardView {
  slot: SlotId;
  /** 0-based position in reveal order. */
  index: number;
  cardId: string;
  reversed: boolean;
  /** One-line guidance shown on the card as it turns over. */
  hint: string;
}

/** The eight fixed sections of a full reading, in the order they are shown. */
export interface Interpretation {
  /** 1. 直接结论 — the answer, first, in one or two sentences. */
  conclusion: string;
  /** 2. 三张牌概览 */
  overview: string;
  /** 3. 每张牌在对应牌位的解释, one entry per slot, in reveal order. */
  perCard: { slot: SlotId; text: string }[];
  /** 4. 三张牌之间的联系 */
  connections: string;
  /** 5. 对用户问题的综合回应 */
  response: string;
  /** 6. 两至三个现实行动建议 */
  actions: string[];
  /** 7. 一个反思问题 */
  reflection: string;
  /** 8. 收尾语 */
  closing: string;
}

/** A follow-up exchange inside one reading — "继续解读这三张牌". */
export interface FollowUpMessage {
  id: number;
  role: 'user' | 'diviner';
  content: string;
  createdAt: string;
}

/** Everything the browser needs to render a reading at any point in its life. */
export interface ReadingView {
  readingId: string;
  /** Missing only on responses from an older deployed Worker. */
  spreadId?: SpreadId;
  status: ReadingStatus;
  locale: Locale;
  question: string;
  greeting: string;
  /** Only the cards turned over so far, in reveal order. */
  cards: DrawnCardView[];
  /** How many cards are committed but still face down (0 before the draw). */
  pending: number;
  interpretation: Interpretation | null;
  followUps: FollowUpMessage[];
  /** True when the reading is rendered by the built-in demo diviner, not Agent 2. */
  demo: boolean;
  createdAt: string;
  /**
   * Present only when the reading was started from the daily card. It is the
   * context the reader was given, not a fourth card: it holds no position and
   * is never one of `cards`. The Worker works it out from the day itself.
   */
  dailyCard?: DailyCardContext;
}

/** Today's card as handed to the reader: which card, and which way up. */
export interface DailyCardContext {
  cardId: string;
  reversed: boolean;
}

/**
 * A frozen, public, read-only copy of one reading. Never changes after creation.
 *
 * What it carries is a deliberate line, not an accident of what was handy. A
 * share link is opened by someone who is not the person who asked, so it holds
 * the reading *of the cards* — the three of them together, each one where it
 * fell, and the line between them — and stops before the parts of the
 * interpretation that are addressed to the asker: the reply to their question,
 * the things they could do about it, and the question left with them to sit
 * with. Those are half of a private conversation, and a stranger reading them is
 * reading someone's mail.
 *
 * The three reading fields are optional, and will stay optional forever. Rows
 * written before shares carried the reading itself are frozen by design — they
 * cannot be backfilled, so every reader of this type has to cope with their
 * absence rather than assume a migration fixed it.
 */
export interface ShareSnapshot {
  token: string;
  readingId: string;
  locale: Locale;
  /** Present only when the user opted in at share time. */
  question: string | null;
  cards: { slot: SlotId; cardId: string; reversed: boolean }[];
  /** The one sentence the whole reading comes down to. Always present. */
  conclusion: string;
  /** What the three cards say taken together, before they are taken apart. */
  overview?: string;
  /** What each card meant in the position it landed in — the substance of the
   *  reading, and the reason a shared link is worth opening twice. */
  perCard?: { slot: SlotId; text: string }[];
  /** How the three speak to each other. */
  connections?: string;
  /** Product identity / diviner signature shown on the shared card. */
  signature: string;
  createdAt: string;
  mode?: ShareMode;
  spreadId?: SpreadId;
}

export type ShareMode = 'card' | 'summary' | 'full';

/**
 * Events streamed to the browser while the diviner speaks (SSE `data:` payloads).
 * `delta` carries the FULL text so far — the client replaces, never appends,
 * exactly like the starter's chat stream.
 */
export type DivinerEvent =
  | { type: 'delta'; text: string }
  | { type: 'greeting'; text: string }
  /** Sent the moment a reveal is authorized, so the card can turn over at once
   *  while its line is still being spoken. This is the first time the browser
   *  learns what the card is. */
  | { type: 'card'; card: DrawnCardView }
  | { type: 'hint'; index: number; text: string }
  | { type: 'interpretation'; interpretation: Interpretation }
  | { type: 'followup'; text: string; suggestsNewReading: boolean }
  /** `code` is an HttpError's code, or READER_UNAVAILABLE when the reader itself
   *  failed. The browser words the second one in the visitor's language; the
   *  message is only a fallback for a client that does not know the code. */
  | { type: 'error'; code?: string; message: string };

/** The `error` event's code when the agent behind the reader could not answer. */
export const READER_UNAVAILABLE = 'reader_unavailable';
export const READER_UNAVAILABLE_MESSAGE = 'The reader could not answer just now.';

/* ───────── request bodies ───────── */

export interface CreateReadingBody {
  question: string;
  locale?: Locale;
  /** Carries the prior reading id so a new round can keep light continuity. */
  previousReadingId?: string | null;
  /** Opaque invite token carried by a friend opening a referral link. */
  referralToken?: string | null;
  spreadId?: SpreadId;
  /**
   * The UTC day (`YYYY-MM-DD`) of the daily card this reading was started
   * from. Only today or yesterday counts; anything else is ignored, not
   * refused. There is deliberately no field for the card itself.
   */
  dailyDate?: string;
}

export interface ShareBody {
  includeQuestion?: boolean;
  mode?: ShareMode;
  cardIndex?: number;
}

export const QUESTION_MAX_CHARS = 500;
export const FOLLOW_UP_MAX_CHARS = 500;
