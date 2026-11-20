import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  MemoryStore,
  createWorkersAiTriageModel,
  isNarraGatewayEnabled,
  routeEvent,
  type InboundEvent,
  type RoomContext,
} from '@manyfold/narra-agent-kit';
import worker, { NarraMatrixSync, NarraRoomCoordinator } from '../src/worker/index';
import { DECK } from '../src/shared/tarot/deck';
import { allSpreads } from '../src/shared/tarot/spreads';
import {
  TAROT_AGENT_ID,
  TAROT_AGENT_SPEC,
  TAROT_DEFAULT_MATRIX_ID,
  TAROT_SITE_URL,
  fetchTarotUpdates,
  formatLocalTarotDraw,
  formatSingleCardLocalDraw,
  kickTarotNarraGateway,
  resolveTarotLang,
  tarotFastRespond,
} from '../src/worker/narra/gateway';
import { toZhHant } from '../src/worker/narra/zh-hant';
import type { Env } from '../src/worker/types';
import { createD1, type FakeD1 } from './support/d1';

const ORIGIN = 'https://taro.test';

// Simplified-only single chars & tokens that must NEVER appear in zh-Hant tarot output
const FORBIDDEN_CHARS_IN_ZH_HANT =
  /[状态处隐决顾这周来签云开听范韧烛碍羡松发划卷系获疗愈欲权圣宝剑币术师运轮义战车恋节审们个与为对说时会学国门问间认记讲许论设访评识诉词试诚话该语误诱请读谁调谈谓]/;
const FORBIDDEN_TOKENS_IN_ZH_HANT = [
  '状态',
  '处境',
  '隐藏',
  '决定',
  '回顾',
  '这周',
  '下周',
  '本周',
  '每周',
  '接下来',
  '权杖',
  '圣杯',
  '宝剑',
  '星币',
  '魔术师',
  '命运之轮',
  '节制',
  '恶魔',
  '隐者',
  '战车',
  '恋人',
  '审判',
  '正义',
  '疗愈',
  '听不',
  '规范',
  '柔韧',
  '欲望',
];

// Context-sensitive characters allowed only inside legitimate Traditional words (e.g. 皇后, 干擾, 千里, 恢復, 復盤, 周圍)
function assertPureZhHant(text: string): void {
  for (const token of FORBIDDEN_TOKENS_IN_ZH_HANT) {
    expect(text, `Simplified token ${token} leaked in: ${text}`).not.toContain(token);
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '后' && i > 0 && text[i - 1] === '皇') continue;
    if (ch === '干' && text.slice(i, i + 2) === '干擾') continue;
    if (ch === '周' && text.slice(i, i + 2) === '周圍') continue;
    if (ch === '系' && text.slice(Math.max(0, i - 1), i + 1) === '體系') continue;
    if (
      ch === '复' &&
      (text.slice(i, i + 2) === '復盤' ||
        text.slice(Math.max(0, i - 1), i + 1) === '恢復' ||
        text.slice(Math.max(0, i - 1), i + 1) === '修復')
    ) {
      continue;
    }
    if (
      ch === '里' &&
      (text.slice(Math.max(0, i - 1), i + 1) === '千里' ||
        text.slice(Math.max(0, i - 1), i + 2) === '三里橋')
    ) {
      continue;
    }
    expect(FORBIDDEN_CHARS_IN_ZH_HANT.test(ch), `Simplified char ${ch} leaked in: ${text}`).toBe(
      false,
    );
  }
}

const FORBIDDEN_IN_ZH_HANS =
  /[狀態處隱決顧這週來籤雲開聽範韌燭礙羨復鬆裡發後佔劃捲聯繫穫療癒慾權聖寶劍幣術師運輪義戰車戀節審們個與為說時會學國門問見觀覺認記講許論設訪評識訴詞試誠話該語誤誘請讀誰調談謂]/;

function assertPureZhHans(text: string): void {
  expect(FORBIDDEN_IN_ZH_HANS.test(text), `Traditional-only char leaked in: ${text}`).toBe(false);
}

class FakeDOStorage {
  readonly data = new Map<string, unknown>();
  alarmAt: number | null = null;

  async get<T>(key: string): Promise<T | undefined> {
    if (!this.data.has(key)) return undefined;
    return structuredClone(this.data.get(key)) as T;
  }
  async put(key: string, value: unknown): Promise<void> {
    this.data.set(key, structuredClone(value));
  }
  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }
  async list<T>(options: { prefix?: string; limit?: number } = {}): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    const prefix = options.prefix ?? '';
    for (const k of [...this.data.keys()].filter((key) => key.startsWith(prefix)).sort()) {
      if (options.limit && out.size >= options.limit) break;
      out.set(k, structuredClone(this.data.get(k)) as T);
    }
    return out;
  }
  async getAlarm(): Promise<number | null> {
    return this.alarmAt;
  }
  async setAlarm(scheduledTime: number | Date): Promise<void> {
    this.alarmAt = typeof scheduledTime === 'number' ? scheduledTime : scheduledTime.getTime();
  }
  async deleteAlarm(): Promise<void> {
    this.alarmAt = null;
  }
}

function makeFakeDOState(storage = new FakeDOStorage()): DurableObjectState {
  return {
    storage,
    id: { toString: () => 'fake-do', equals: () => false },
    waitUntil: () => undefined,
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
  } as unknown as DurableObjectState;
}

function makeInboundEvent(overrides: Partial<InboundEvent> = {}): InboundEvent {
  const nowMs = overrides.timestampMs ?? Date.now();
  return {
    roomId: '!grp1:matrix.netmind.chat',
    chatType: 'group',
    eventId: '$ev_1',
    senderId: '@alice:matrix.netmind.chat',
    senderName: 'Alice',
    type: 'm.room.message',
    kind: 'text',
    msgtype: 'm.text',
    text: 'hello',
    timestampMs: nowMs,
    timeIso: new Date(nowMs).toISOString(),
    mentions: [],
    ...overrides,
  };
}

let d1: FakeD1;
let baseEnv: Env;

beforeAll(() => {
  d1 = createD1();
  baseEnv = {
    DB: d1.db,
    ASSETS: { fetch: async () => new Response('asset', { status: 200 }) } as unknown as Fetcher,
    ENVIRONMENT: 'test',
    TAROT_DEMO: '1',
    BASE_PATH: '/tarot',
  } as Env;
});

afterAll(() => d1.close());

const execCtx = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

describe('wrangler.jsonc & fail-closed safety invariants', () => {
  it('keeps database_id, service binding, routes, BASE_PATH intact and enables bound Narra gateway', () => {
    const raw = new TextDecoder().decode(
      readFileSync(fileURLToPath(new URL('../wrangler.jsonc', import.meta.url))),
    );
    const stripped = raw.replace(/^\s*\/\/.*$/gm, '');
    const parsed = JSON.parse(stripped) as {
      ai?: { binding: string };
      routes: Array<{ pattern: string }>;
      services: Array<{ binding: string; service: string }>;
      d1_databases: Array<{ binding: string; database_id: string }>;
      triggers: { crons: string[] };
      durable_objects: { bindings: Array<{ name: string; class_name: string }> };
      migrations: Array<{ tag: string; new_sqlite_classes: string[] }>;
      vars: Record<string, string>;
    };

    expect(parsed.ai).toEqual({ binding: 'AI' });
    expect(parsed.d1_databases[0].database_id).toBe('f05ec677-9cd9-4cba-85ac-864c1a4f5891');
    expect(parsed.services).toEqual([{ binding: 'STICK', service: 'manyfold-fortune-stick' }]);
    expect(parsed.routes.map((r) => r.pattern)).toEqual([
      'tarot.manyfold.ai',
      'app.manyfold.ai/tarot',
      'app.manyfold.ai/tarot/*',
    ]);
    expect(parsed.vars.BASE_PATH).toBe('/tarot');
    expect(parsed.vars.NARRA_GATEWAY_ENABLED).toBe('on');
    expect(parsed.vars.NARRA_SYNC).toBe('on');
    expect(parsed.vars.NARRA_AGENT_ID).toBe('agt_agqvtek2554apclfoq3uc7yweq');
    expect(parsed.vars.NARRA_MATRIX_ID).toBe('@agent-852feddf:matrix.netmind.chat');
    expect(parsed.triggers.crons).toEqual(['*/5 * * * *']);
    expect(parsed.durable_objects.bindings).toEqual([
      { name: 'NARRA_SYNC_DO', class_name: 'NarraMatrixSync' },
      { name: 'NARRA_ROOM_DO', class_name: 'NarraRoomCoordinator' },
    ]);
    expect(parsed.migrations[0].new_sqlite_classes).toEqual([
      'NarraMatrixSync',
      'NarraRoomCoordinator',
    ]);
  });

  it('kickTarotNarraGateway and scheduled() make 0 external or D1 calls when disabled', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const dbExecSpy = vi.fn();
    const doFetchSpy = vi.fn();
    const disabledEnv = {
      ...baseEnv,
      DB: { exec: dbExecSpy, prepare: vi.fn() } as unknown as D1Database,
      NARRA_GATEWAY_ENABLED: 'off',
      NARRA_SYNC: 'off',
      NARRA_AGENT_TOKEN: 'secret_token_should_not_run',
      NARRA_SYNC_DO: {
        idFromName: (n: string) => n as unknown as DurableObjectId,
        get: () => ({ fetch: doFetchSpy }),
      } as unknown as DurableObjectNamespace,
    } as Env;

    expect(isNarraGatewayEnabled(disabledEnv)).toBe(false);
    const res = await kickTarotNarraGateway(disabledEnv);
    expect(res).toEqual({
      enabled: false,
      syncKicked: false,
      syncRunning: false,
      broadcast: null,
    });

    await worker.scheduled(
      { cron: '*/5 * * * *', scheduledTime: Date.now(), noRetry: () => undefined } as ScheduledController,
      disabledEnv,
      execCtx,
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(dbExecSpy).not.toHaveBeenCalled();
    expect(doFetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('admin-gated GET /api/gateway/status', () => {
  it('returns 401 when unauthenticated or when ADMIN_PASSWORD is unset', async () => {
    const resNoConfig = await worker.fetch(new Request(`${ORIGIN}/api/gateway/status`), baseEnv, execCtx);
    expect(resNoConfig.status).toBe(401);

    const envWithPw = { ...baseEnv, ADMIN_PASSWORD: 'correct-horse-battery' } as Env;
    const resMissing = await worker.fetch(
      new Request(`${ORIGIN}/api/gateway/status`),
      envWithPw,
      execCtx,
    );
    expect(resMissing.status).toBe(401);

    const resWrong = await worker.fetch(
      new Request(`${ORIGIN}/tarot/api/gateway/status`, {
        headers: { 'x-admin-password': 'wrong-password' },
      }),
      envWithPw,
      execCtx,
    );
    expect(resWrong.status).toBe(401);
  });

  it('returns redacted gateway status when authenticated and never leaks tokens', async () => {
    const NARRA_SECRET = 'narra_tok_super_secret_tarot_999';
    const MATRIX_SECRET = 'syt_matrix_secret_tarot_888';
    const A2A_SECRET = 'a2a_secret_tarot_777';
    const envWithSecrets = {
      ...baseEnv,
      ADMIN_PASSWORD: 'tarot-admin-secret',
      NARRA_GATEWAY_ENABLED: 'off',
      NARRA_SYNC: 'off',
      NARRA_AGENT_TOKEN: NARRA_SECRET,
      MATRIX_ACCESS_TOKEN: MATRIX_SECRET,
      MANYFOLD_A2A_TOKEN: A2A_SECRET,
    } as Env;

    const res = await worker.fetch(
      new Request(`${ORIGIN}/tarot/api/gateway/status`, {
        headers: { 'x-admin-password': 'tarot-admin-secret' },
      }),
      envWithSecrets,
      execCtx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      enabled: boolean;
      syncEnabled: boolean;
      agentId: string;
      matrixId: string;
      config: Record<string, unknown>;
    };
    expect(body.enabled).toBe(false);
    expect(body.syncEnabled).toBe(false);
    expect(body.agentId).toBe(TAROT_AGENT_ID);
    expect(body.matrixId).toBe(TAROT_DEFAULT_MATRIX_ID);
    expect(body.config.hasNarraAgentToken).toBe(true);
    expect(body.config.hasMatrixAccessToken).toBe(true);

    const rawJson = JSON.stringify(body);
    expect(rawJson).not.toContain(NARRA_SECRET);
    expect(rawJson).not.toContain(MATRIX_SECRET);
    expect(rawJson).not.toContain(A2A_SECRET);
  });
});

describe('AgentSpec routing, 3-min active session & antiKeywords', () => {
  const baseContext: RoomContext = {
    roomId: '!grp1:matrix.netmind.chat',
    chatType: 'group',
    members: [
      { matrixId: '@alice:matrix.netmind.chat', displayName: 'Alice', isAgent: false },
      { matrixId: TAROT_DEFAULT_MATRIX_ID, displayName: 'AI Tarot', isAgent: true },
      { matrixId: '@agent-74f30ae5:matrix.netmind.chat', displayName: 'lcf-guide', isAgent: true },
    ],
    recentHistory: [],
  };

  it('triggers on tarot domain keywords and rejects off-topic antiKeywords', async () => {
    for (const text of [
      'Can I get a tarot reading?',
      '想問一件工作上的事，幫我占卜一下',
      '最近想抽牌看看塔羅',
      '帮我看看塔罗牌阵',
    ]) {
      const dec = await routeEvent(makeInboundEvent({ text }), baseContext, TAROT_AGENT_SPEC);
      expect(dec.shouldReply, text).toBe(true);
    }

    for (const offTopic of [
      '抽空去吃拉麵嗎',
      'draw a quick diagram of the API',
      'Any good ramen restaurant in Soho?',
      'Has anyone got a Boots voucher code or discount?',
      'Latest OpenAI AI news headline today',
      'Weekend pop-up exhibition near Chinatown',
      '我想去求籤問一籤',
      '@tarot-master-2 @lcf-guide 倫敦中國城有什麼好吃的拉麵餐廳？',
    ]) {
      const dec = await routeEvent(makeInboundEvent({ text: offTopic }), baseContext, TAROT_AGENT_SPEC);
      expect(dec.shouldReply, offTopic).toBe(false);
    }
  });

  it('supports seamless 3-minute active session follow-ups on 抽 and draw', async () => {
    const nowMs = 1_760_000_000_000;
    const activeCtx: RoomContext = {
      ...baseContext,
      activeSession: {
        active: true,
        lastAgentReplyAtMs: nowMs - 60_000,
        expiresAtMs: nowMs + 120_000,
      },
    };
    expect(TAROT_AGENT_SPEC.sessionWindowMs).toBe(180_000);

    const drawZh = await routeEvent(makeInboundEvent({ text: '抽', timestampMs: nowMs }), activeCtx, TAROT_AGENT_SPEC, { nowMs });
    expect(drawZh.shouldReply).toBe(true);
    expect(drawZh.reason).toBe('active_session');

    const drawEn = await routeEvent(makeInboundEvent({ text: 'draw', timestampMs: nowMs }), activeCtx, TAROT_AGENT_SPEC, { nowMs });
    expect(drawEn.shouldReply).toBe(true);
    expect(drawEn.reason).toBe('active_session');

    const followUp = await routeEvent(
      makeInboundEvent({ text: '那第二張牌呢？', timestampMs: nowMs }),
      activeCtx,
      TAROT_AGENT_SPEC,
      { nowMs },
    );
    expect(followUp.shouldReply).toBe(true);
    expect(followUp.reason).toBe('active_session');

    for (const chatter of [
      '今天天氣真不錯，晚上想早點休息',
      '好喔謝謝，我先去忙一下',
      'Any good ramen restaurant in Soho?',
    ]) {
      const dec = await routeEvent(
        makeInboundEvent({ text: chatter, timestampMs: nowMs }),
        activeCtx,
        TAROT_AGENT_SPEC,
        { nowMs },
      );
      expect(dec.shouldReply, chatter).toBe(false);
    }
  });

  it('disambiguates multi-@ prompts containing daily card and tarot draw phrases', async () => {
    const multiAgentContext: RoomContext = {
      roomId: '!grp_tarot_multi:matrix.netmind.chat',
      chatType: 'group',
      members: [
        { matrixId: '@alice:matrix.netmind.chat', displayName: 'Alice', isAgent: false },
        { matrixId: '@agent-b9908957:matrix.netmind.chat', displayName: 'Spotted London', isAgent: true },
        { matrixId: TAROT_DEFAULT_MATRIX_ID, displayName: 'AI Tarot', isAgent: true },
      ],
      recentHistory: [],
    };

    for (const text of [
      '@Spotted London @AI Tarot 幫我抽三張牌',
      '@Spotted London @AI Tarot 帮我抽三张牌',
      '@Spotted London @AI Tarot 抽一牌',
      '@Spotted London @AI Tarot 今天的一牌',
      "@Spotted London @AI Tarot today's card",
    ]) {
      const dec = await routeEvent(
        makeInboundEvent({
          text,
          mentions: ['@agent-b9908957:matrix.netmind.chat', TAROT_DEFAULT_MATRIX_ID],
        }),
        multiAgentContext,
        TAROT_AGENT_SPEC,
      );
      expect(dec.shouldReply, text).toBe(true);
      expect(dec.reason, text).toBe('multi_mention_domain_match');
    }
  });
});

describe('fastRespond crisis safety, CSPRNG draw & pure zh-Hant/zh-Hans/en', () => {
  it('refuses to draw and emits crisis helplines in pure matching script', async () => {
    for (const [text, expectedLang, checkFn] of [
      ['我好累，真的想自殺不想活了', 'zh-Hant', assertPureZhHant],
      ['我觉得活不下去了，想结束生命', 'zh-Hans', assertPureZhHans],
      ['I feel hopeless and want to kill myself tonight', 'en', () => undefined],
    ] as const) {
      const ev = makeInboundEvent({ chatType: 'dm', text });
      const dec = await routeEvent(ev, { roomId: ev.roomId, chatType: 'dm', members: [], recentHistory: [] }, TAROT_AGENT_SPEC);
      const reply = await tarotFastRespond(baseEnv, ev, dec, {
        userMemories: [],
        roomMemories: [],
        promptSafeLines: [],
      });
      expect(reply).not.toBeNull();
      expect(dec.detectedLang).toBe(expectedLang);
      expect(reply).toContain('999');
      expect(reply).toContain('116 123');
      expect(reply).toContain('911');
      expect(reply).toContain('988');
      expect(reply).toContain('110');
      expect(reply).toContain('120');
      expect(reply).toContain('12356');
      expect(reply).not.toContain('牌陣');
      expect(reply).not.toContain('牌阵');
      expect(reply).not.toContain('Spread:');
      checkFn(reply!);
    }
  });

  it('exhaustively converts all 78 cards & 4 spreads with zero zh-Hant/zh-Hans script leaks', () => {
    for (const card of DECK) {
      assertPureZhHans(card.name.zh);
      assertPureZhHans(card.upright.zh);
      assertPureZhHans(card.reversed.zh);

      assertPureZhHant(toZhHant(card.name.zh));
      assertPureZhHant(toZhHant(card.upright.zh));
      assertPureZhHant(toZhHant(card.reversed.zh));
    }

    for (const spread of allSpreads('zh')) {
      const jsonHans = JSON.stringify(spread);
      assertPureZhHans(jsonHans);
      assertPureZhHant(toZhHant(jsonHans));
    }

    const forbiddenInternalPromptPhrases = [
      '來訪者',
      '来访者',
      '請協助',
      '请协助',
      'Help the visitor',
      'One question that',
    ];
    for (const spreadId of ['current', 'decision', 'next-step', 'weekly-review'] as const) {
      const zhHant = formatLocalTarotDraw('zh-Hant', spreadId);
      assertPureZhHant(zhHant);
      const zhHans = formatLocalTarotDraw('zh-Hans', spreadId);
      assertPureZhHans(zhHans);
      const en = formatLocalTarotDraw('en', spreadId);
      expect(en).not.toMatch(/[\u4e00-\u9fff]/);
      for (const sample of [zhHant, zhHans, en]) {
        for (const phrase of forbiddenInternalPromptPhrases) {
          expect(sample).not.toContain(phrase);
        }
      }
    }

    const hantOut = formatLocalTarotDraw('zh-Hant', 'decision');
    assertPureZhHant(hantOut);
    expect(hantOut).toContain('牌陣：做一個決定');

    const hansOut = formatLocalTarotDraw('zh-Hans', 'next-step');
    assertPureZhHans(hansOut);
    expect(hansOut).toContain('牌阵：下一步反思');

    const enOut = formatLocalTarotDraw('en', 'weekly-review');
    expect(enOut).toContain('Spread: Weekly review');
    expect(enOut).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it('replies immediately to DM and explicit-mention greetings without calling A2A', async () => {
    const emptyMem = { userMemories: [], roomMemories: [], promptSafeLines: [] };
    for (const [text, expectedLang, expectedSubstring] of [
      ['你好', 'zh-Hant', '幫我抽三張牌'],
      ['嗨', 'zh-Hant', '每日一牌'],
      ['hello', 'en', 'Tarot Master'],
    ] as const) {
      const ev = makeInboundEvent({ chatType: 'dm', text });
      const dec = await routeEvent(ev, { roomId: ev.roomId, chatType: 'dm', members: [], recentHistory: [] }, TAROT_AGENT_SPEC);
      const reply = await tarotFastRespond(baseEnv, ev, dec, emptyMem);
      expect(dec.reason).toBe('dm');
      expect(dec.detectedLang).toBe(expectedLang);
      expect(reply).not.toBeNull();
      expect(reply).toContain(expectedSubstring);
    }
  });

  it('strips Chinese/sibling @mentions before script detection and handles DM daily card', async () => {
    const emptyMem = { userMemories: [], roomMemories: [], promptSafeLines: [] };
    const storedHantMem = {
      userMemories: [
        {
          id: 'mem_hant',
          scope: 'user' as const,
          agentId: TAROT_AGENT_ID,
          userId: '@alice:matrix.netmind.chat',
          originChatType: 'group' as const,
          kind: 'language' as const,
          key: 'lang',
          value: 'zh-Hant',
          createdAt: '2026-11-19T00:00:00.000Z',
          updatedAt: '2026-11-19T00:00:00.000Z',
        },
      ],
      roomMemories: [],
      promptSafeLines: [],
    };
    const groupCtx: RoomContext = {
      roomId: '!grp1:matrix.netmind.chat',
      chatType: 'group',
      userLanguageHint: 'zh-Hant',
      members: [
        { matrixId: '@alice:matrix.netmind.chat', displayName: 'Alice', isAgent: false },
        { matrixId: TAROT_DEFAULT_MATRIX_ID, displayName: 'AI Tarot', isAgent: true },
      ],
      recentHistory: [],
    };

    // 1. @塔羅大師 每日一牌 -> today's card in pure zh-Hant
    const dailyMentionEv = makeInboundEvent({ text: '@塔羅大師 每日一牌' });
    const dailyMentionDec = await routeEvent(dailyMentionEv, groupCtx, TAROT_AGENT_SPEC);
    expect(dailyMentionDec.shouldReply).toBe(true);
    const dailyMentionReply = await tarotFastRespond(baseEnv, dailyMentionEv, dailyMentionDec, emptyMem);
    expect(dailyMentionReply).not.toBeNull();
    expect(dailyMentionReply).toContain('今日一牌');
    assertPureZhHant(dailyMentionReply!);

    // 2. @塔羅大師 daily card with userHint: 'zh-Hant' and stored 'zh-Hant' -> pure English
    const enMentionEv = makeInboundEvent({ text: '@塔羅大師 daily card' });
    const enMentionDec = await routeEvent(enMentionEv, groupCtx, TAROT_AGENT_SPEC);
    expect(enMentionDec.shouldReply).toBe(true);
    expect(enMentionDec.detectedLang).toBe('en');
    const enMentionReply = await tarotFastRespond(
      baseEnv,
      enMentionEv,
      { ...enMentionDec, detectedLang: 'zh-Hant' },
      storedHantMem,
    );
    expect(enMentionReply).not.toBeNull();
    expect(enMentionReply).toContain("Today's card");
    expect(enMentionReply).not.toMatch(/[\u4e00-\u9fff]/);

    // 3. @塔羅大師 帮我抽三张牌 with userHint: 'zh-Hant' -> pure zh-Hans
    const hansMentionEv = makeInboundEvent({ text: '@塔羅大師 帮我抽三张牌' });
    const hansMentionDec = await routeEvent(hansMentionEv, groupCtx, TAROT_AGENT_SPEC);
    expect(hansMentionDec.shouldReply).toBe(true);
    expect(hansMentionDec.detectedLang).toBe('zh-Hans');
    const hansMentionReply = await tarotFastRespond(
      baseEnv,
      hansMentionEv,
      { ...hansMentionDec, detectedLang: 'zh-Hant' },
      storedHantMem,
    );
    expect(hansMentionReply).not.toBeNull();
    expect(hansMentionReply).toContain('牌阵：');
    assertPureZhHans(hansMentionReply!);

    // 4. DM bare 你好 (chatType: 'dm', decision.reason: 'dm') -> instant zh-Hant DM greeting
    const dmHiEv = makeInboundEvent({ chatType: 'dm', text: '你好' });
    const dmHiDec = await routeEvent(
      dmHiEv,
      { roomId: dmHiEv.roomId, chatType: 'dm', members: [], recentHistory: [] },
      TAROT_AGENT_SPEC,
    );
    expect(dmHiDec.reason).toBe('dm');
    const dmHiReply = await tarotFastRespond(baseEnv, dmHiEv, dmHiDec, emptyMem);
    expect(dmHiReply).toContain('我是塔羅大師');
    assertPureZhHant(dmHiReply!);

    // 5. DM 每日一牌 (chatType: 'dm', decision.reason: 'dm') -> today's card in zh-Hant
    const dmDailyEv = makeInboundEvent({ chatType: 'dm', text: '每日一牌' });
    const dmDailyDec = await routeEvent(
      dmDailyEv,
      { roomId: dmDailyEv.roomId, chatType: 'dm', members: [], recentHistory: [] },
      TAROT_AGENT_SPEC,
    );
    expect(dmDailyDec.reason).toBe('dm');
    const dmDailyReply = await tarotFastRespond(baseEnv, dmDailyEv, dmDailyDec, emptyMem);
    expect(dmDailyReply).toContain('今日一牌');
    assertPureZhHant(dmDailyReply!);
  });

  it('returns today\'s daily card in pure zh-Hans for "帮我抽一张每日一牌看看今天塔罗" while keeping 3-card draws', async () => {
    const emptyMem = { userMemories: [], roomMemories: [], promptSafeLines: [] };
    const groupCtx: RoomContext = {
      roomId: '!grp1:matrix.netmind.chat',
      chatType: 'group',
      userLanguageHint: 'zh-Hant',
      members: [
        { matrixId: '@alice:matrix.netmind.chat', displayName: 'Alice', isAgent: false },
        { matrixId: TAROT_DEFAULT_MATRIX_ID, displayName: 'AI Tarot', isAgent: true },
      ],
      recentHistory: [],
    };

    for (const [chatType, text] of [
      ['group', '帮我抽一张每日一牌看看今天塔罗'],
      ['group', '@AI Tarot 帮我抽一张每日一牌看看今天塔罗'],
      ['dm', '帮我抽一张每日一牌看看今天塔罗'],
      ['dm', '给我看看每天一牌'],
    ] as const) {
      const ev = makeInboundEvent({ chatType, text });
      const ctx: RoomContext =
        chatType === 'dm'
          ? { roomId: ev.roomId, chatType: 'dm', members: [], recentHistory: [] }
          : groupCtx;
      const dec = await routeEvent(ev, ctx, TAROT_AGENT_SPEC);
      expect(dec.shouldReply, text).toBe(true);
      expect(dec.detectedLang, text).toBe('zh-Hans');
      const reply = await tarotFastRespond(baseEnv, ev, dec, emptyMem);
      expect(reply, text).not.toBeNull();
      expect(reply, text).toContain('今日一牌');
      expect(reply, text).not.toContain('牌阵：');
      expect(reply, text).not.toContain('牌陣：');
      assertPureZhHans(reply!);
    }

    const enOneCardEv = makeInboundEvent({ chatType: 'dm', text: 'draw a one-card reading please' });
    const enOneCardDec = await routeEvent(
      enOneCardEv,
      { roomId: enOneCardEv.roomId, chatType: 'dm', members: [], recentHistory: [] },
      TAROT_AGENT_SPEC,
    );
    const enOneCardReply = await tarotFastRespond(baseEnv, enOneCardEv, enOneCardDec, emptyMem);
    expect(enOneCardReply).toContain("Today's card");
    expect(enOneCardReply).not.toContain('Spread:');

    for (const [text, expectedLang, expectedHeader] of [
      ['帮我抽三张牌看看今天塔罗', 'zh-Hans', '牌阵：'],
      ['帮我抽三张每日一牌', 'zh-Hans', '牌阵：'],
      ['幫我抽三張牌看看這週運勢', 'zh-Hant', '牌陣：'],
      ['draw 3 cards', 'en', 'Spread:'],
      ['draw a spread', 'en', 'Spread:'],
    ] as const) {
      const ev = makeInboundEvent({ chatType: 'dm', text });
      const dec = await routeEvent(
        ev,
        { roomId: ev.roomId, chatType: 'dm', members: [], recentHistory: [] },
        TAROT_AGENT_SPEC,
      );
      expect(dec.detectedLang, text).toBe(expectedLang);
      const reply = await tarotFastRespond(baseEnv, ev, dec, emptyMem);
      expect(reply, text).not.toBeNull();
      expect(reply, text).toContain(expectedHeader);
      expect(reply, text).not.toContain('今日一牌');
      expect(reply, text).not.toContain("Today's card");
      if (expectedLang === 'zh-Hans') assertPureZhHans(reply!);
      if (expectedLang === 'zh-Hant') assertPureZhHant(reply!);
    }
  });

  it('executes local CSPRNG draw inside NarraRoomCoordinator DO and falls back to A2A for follow-ups', async () => {
    let nowMs = 1_760_500_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);
    const posted: string[] = [];
    let a2aCalled = 0;

    try {
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.endsWith('/api/agent-runtime/chat/send')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as { text: string };
          posted.push(body.text);
          return Response.json({ status: 'ok', data: { event_id: `$sent_${posted.length}` } });
        }
        if (url === 'https://a2a.tarot.test/rpc') {
          a2aCalled++;
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: '1',
              result: {
                kind: 'message',
                role: 'agent',
                parts: [{ kind: 'text', text: '這組牌提醒你先把手上的條件攤開再做決定。' }],
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response('not found', { status: 404 });
      });

      vi.stubGlobal('fetch', fetchMock);
      const gwEnv = {
        ...baseEnv,
        NARRA_GATEWAY_ENABLED: 'on',
        NARRA_SYNC: 'off',
        NARRA_AGENT_TOKEN: 'narra_tarot_test_tok',
        MANYFOLD_A2A_URL: 'https://a2a.tarot.test/rpc',
        MANYFOLD_A2A_TOKEN: 'a2a_tarot_test_tok',
      } as Env;

      const roomState = makeFakeDOState();
      const roomDo = new NarraRoomCoordinator(roomState, gwEnv);
      const syncDo = new NarraMatrixSync(makeFakeDOState(), gwEnv);
      expect(roomDo).toBeInstanceOf(NarraRoomCoordinator);
      expect(syncDo).toBeInstanceOf(NarraMatrixSync);

      const roomId = '!tarot_grp:matrix.netmind.chat';
      // 1. Nuanced question -> A2A fallback
      await roomDo.fetch(
        new Request('https://narra-room/events', {
          method: 'POST',
          body: JSON.stringify({
            roomId,
            chatType: 'group',
            events: [
              {
                event_id: '$t1',
                sender: '@alice:matrix.netmind.chat',
                type: 'm.room.message',
                origin_server_ts: nowMs,
                content: {
                  msgtype: 'm.text',
                  body: '@AI Tarot 我最近在考慮要不要換工作，有點猶豫',
                  'm.mentions': { user_ids: [TAROT_DEFAULT_MATRIX_ID] },
                },
              },
            ],
          }),
        }),
      );
      vi.setSystemTime(nowMs + 2_000);
      await roomDo.alarm();
      expect(a2aCalled).toBe(1);
      expect(posted).toHaveLength(1);
      expect(posted[0]).toContain('這組牌提醒你');

      // 2. Seamless 3-min follow-up "抽" without re-@ -> local CSPRNG draw in zh-Hant!
      nowMs += 30_000;
      vi.setSystemTime(nowMs);
      await roomDo.fetch(
        new Request('https://narra-room/events', {
          method: 'POST',
          body: JSON.stringify({
            roomId,
            events: [
              {
                event_id: '$t2',
                sender: '@alice:matrix.netmind.chat',
                type: 'm.room.message',
                origin_server_ts: nowMs,
                content: { msgtype: 'm.text', body: '抽' },
              },
            ],
          }),
        }),
      );
      vi.setSystemTime(nowMs + 2_000);
      await roomDo.alarm();
      expect(a2aCalled).toBe(1); // handled locally, no extra A2A call!
      expect(posted).toHaveLength(2);
      expect(posted[1]).toContain('牌陣：');
      assertPureZhHant(posted[1]);

      // 3. Valid active-session follow-up without @ falls back to A2A cleanly
      nowMs += 20_000;
      vi.setSystemTime(nowMs);
      await roomDo.fetch(
        new Request('https://narra-room/events', {
          method: 'POST',
          body: JSON.stringify({
            roomId,
            events: [
              {
                event_id: '$t3',
                sender: '@alice:matrix.netmind.chat',
                type: 'm.room.message',
                origin_server_ts: nowMs,
                content: { msgtype: 'm.text', body: '那第二張牌呢？' },
              },
            ],
          }),
        }),
      );
      vi.setSystemTime(nowMs + 2_000);
      await roomDo.alarm();
      expect(a2aCalled).toBe(2);
      expect(posted).toHaveLength(3);

      // 4. Unmentioned casual chatter in active session stays silent (no A2A, no Matrix send)
      nowMs += 20_000;
      vi.setSystemTime(nowMs);
      await roomDo.fetch(
        new Request('https://narra-room/events', {
          method: 'POST',
          body: JSON.stringify({
            roomId,
            events: [
              {
                event_id: '$t4',
                sender: '@alice:matrix.netmind.chat',
                type: 'm.room.message',
                origin_server_ts: nowMs,
                content: { msgtype: 'm.text', body: '今天天氣真不錯，晚上想早點休息' },
              },
            ],
          }),
        }),
      );
      vi.setSystemTime(nowMs + 2_000);
      await roomDo.alarm();
      expect(a2aCalled).toBe(2);
      expect(posted).toHaveLength(3);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('silences unmentioned group off-topic and casual active_session chatter while keeping follow-ups intact', async () => {
    const emptyMem = { userMemories: [], roomMemories: [], promptSafeLines: [] };
    const makeDecision = (reason: string, detectedLang: 'zh-Hant' | 'zh-Hans' | 'en' = 'zh-Hant') => ({
      shouldReply: true,
      tier: 0 as const,
      reason,
      confidence: 0.9,
      detectedLang,
      shouldQuote: false,
    });

    // Any unmentioned group turn with antiKeywords and no domainKeywords -> [NO_REPLY]
    for (const reason of ['active_session', 'domain_match', 'multi_mention_domain_match']) {
      for (const offTopic of [
        '抽空去吃拉麵嗎',
        '倫敦中國城有什麼好吃的餐廳？',
        'Latest OpenAI AI news today',
        '幫我求籤問一籤',
      ]) {
        const reply = await tarotFastRespond(
          baseEnv,
          makeInboundEvent({ chatType: 'group', text: offTopic }),
          makeDecision(reason),
          emptyMem,
        );
        expect(reply, `${reason}: ${offTopic}`).toBe('[NO_REPLY]');
      }
    }

    // Active-session casual greeting/closing/weather/thanks without card/reading cue -> [NO_REPLY]
    for (const [text, lang] of [
      ['今天天氣真不錯，晚上想早點休息', 'zh-Hant'],
      ['好喔謝謝，我先去忙一下', 'zh-Hant'],
      ['你好', 'zh-Hant'],
      ['嗨', 'zh-Hant'],
      ['早安', 'zh-Hant'],
      ['晚安', 'zh-Hant'],
      ['謝謝', 'zh-Hant'],
      ['好的，謝謝！', 'zh-Hant'],
      ['感謝', 'zh-Hant'],
      ['拜拜', 'zh-Hant'],
      ['hello', 'en'],
      ['thanks', 'en'],
      ['ok thanks', 'en'],
      ['goodnight, going to bed', 'en'],
    ] as const) {
      const reply = await tarotFastRespond(
        baseEnv,
        makeInboundEvent({ chatType: 'group', text }),
        makeDecision('active_session', lang),
        emptyMem,
      );
      expect(reply, `active_session casual: ${text}`).toBe('[NO_REPLY]');
    }

    // Valid active-session follow-ups without @ MUST keep working
    const drawReply = await tarotFastRespond(
      baseEnv,
      makeInboundEvent({ chatType: 'group', text: '抽' }),
      makeDecision('active_session', 'zh-Hant'),
      emptyMem,
    );
    expect(drawReply).toContain('牌陣：');

    const dailyReply = await tarotFastRespond(
      baseEnv,
      makeInboundEvent({ chatType: 'group', text: '每日一牌' }),
      makeDecision('active_session', 'zh-Hant'),
      emptyMem,
    );
    expect(dailyReply).toContain('今日一牌');

    for (const [followUp, lang] of [
      ['那第二張牌呢？', 'zh-Hant'],
      ['謝謝，那第二張牌呢？', 'zh-Hant'],
      ['這張逆位牌是什麼意思？', 'zh-Hant'],
      ['Thanks! What does the second card mean?', 'en'],
      ['What does The Tower card mean for my career?', 'en'],
    ] as const) {
      const reply = await tarotFastRespond(
        baseEnv,
        makeInboundEvent({ chatType: 'group', text: followUp }),
        makeDecision('active_session', lang),
        emptyMem,
      );
      expect(reply, `valid follow-up: ${followUp}`).toBeNull();
    }

    // Explicit @ mention greeting in group still replies
    const explicitGreeting = await tarotFastRespond(
      baseEnv,
      makeInboundEvent({ chatType: 'group', text: '@AI Tarot 你好' }),
      makeDecision('explicit_mention', 'zh-Hant'),
      emptyMem,
    );
    expect(explicitGreeting).toContain('我是塔羅大師');
  });

  it('fetchTarotUpdates returns [] by default and emits weekly items only for opted-in rooms', async () => {
    const enabledEnv = {
      ...baseEnv,
      NARRA_GATEWAY_ENABLED: 'on',
      NARRA_AGENT_TOKEN: 'narra_bcast_tok',
    } as Env;

    const mem = new MemoryStore(d1.db, TAROT_AGENT_ID);
    await mem.ensureSchema();

    expect(await fetchTarotUpdates(enabledEnv, new Date().toISOString())).toEqual([]);

    await mem.rememberRoom({
      roomId: '!tarot_weekly_room:matrix.netmind.chat',
      key: 'opt_in_weekly',
      value: 'true',
      kind: 'preference',
    });
    await mem.rememberRoom({
      roomId: '!tarot_weekly_room:matrix.netmind.chat',
      key: 'lang',
      value: 'zh-Hans',
      kind: 'language',
    });

    const updates = await fetchTarotUpdates(enabledEnv, new Date().toISOString());
    expect(updates).toHaveLength(1);
    expect(updates[0].roomId).toBe('!tarot_weekly_room:matrix.netmind.chat');
    expect(updates[0].updateKey).toMatch(/^weekly:\d{4}-W\d{2}$/);
    assertPureZhHans(updates[0].text);
  });

  it('T11: handles cross-script explicit language switch commands and persists D1 lang preference', async () => {
    expect(resolveTarotLang('請用簡體', 'zh-Hant')).toBe('zh-Hans');
    expect(resolveTarotLang('请用繁体', 'zh-Hans')).toBe('zh-Hant');
    expect(resolveTarotLang('用英文', 'zh-Hant')).toBe('en');
    expect(resolveTarotLang('speak English', 'zh-Hant')).toBe('en');

    const mem = new MemoryStore(d1.db, TAROT_AGENT_ID);
    await mem.ensureSchema();
    const senderId = '@tarot_lang_switch:matrix.netmind.chat';
    const roomId = '!grp_tarot_lang:matrix.netmind.chat';
    const emptyMem = { userMemories: [], roomMemories: [], promptSafeLines: [] };
    const makeSwitchDecision = (detectedLang: 'zh-Hant' | 'zh-Hans' | 'en') => ({
      shouldReply: true,
      tier: 0 as const,
      reason: 'explicit_mention',
      confidence: 1,
      detectedLang,
      shouldQuote: false,
    });

    // Traditional request asking to switch to Simplified ("@AI Tarot 請用簡體")
    const toHansReply = await tarotFastRespond(
      baseEnv,
      makeInboundEvent({ roomId, senderId, chatType: 'group', text: '@AI Tarot 請用簡體' }),
      makeSwitchDecision('zh-Hant'),
      emptyMem,
    );
    expect(toHansReply).toContain('简体中文');
    assertPureZhHans(toHansReply!);
    expect(await mem.getPreferredLang(senderId, 'group')).toBe('zh-Hans');

    // Subsequent script-neutral query uses persisted zh-Hans
    const recalledHans = await mem.recallForTurn({ roomId, userId: senderId, chatType: 'group' });
    const dailyHans = await tarotFastRespond(
      baseEnv,
      makeInboundEvent({ roomId, senderId, chatType: 'group', text: '@AI Tarot 每日一牌' }),
      makeSwitchDecision('zh-Hant'),
      recalledHans,
    );
    expect(dailyHans).toContain('今日一牌');
    assertPureZhHans(dailyHans!);

    // Traditional request asking for Traditional ("@AI Tarot 請用繁體")
    const toHantFromTrad = await tarotFastRespond(
      baseEnv,
      makeInboundEvent({ roomId, senderId, chatType: 'group', text: '@AI Tarot 請用繁體' }),
      makeSwitchDecision('zh-Hans'),
      recalledHans,
    );
    expect(toHantFromTrad).toContain('繁體中文');
    assertPureZhHant(toHantFromTrad!);
    expect(await mem.getPreferredLang(senderId, 'group')).toBe('zh-Hant');

    // Switch back to Simplified, then Simplified request asking for Traditional ("@AI Tarot 请用繁体")
    await tarotFastRespond(
      baseEnv,
      makeInboundEvent({ roomId, senderId, chatType: 'group', text: '@AI Tarot 請用簡體' }),
      makeSwitchDecision('zh-Hant'),
      emptyMem,
    );
    expect(await mem.getPreferredLang(senderId, 'group')).toBe('zh-Hans');

    const toHantFromSimp = await tarotFastRespond(
      baseEnv,
      makeInboundEvent({ roomId, senderId, chatType: 'group', text: '@AI Tarot 请用繁体' }),
      makeSwitchDecision('zh-Hans'),
      emptyMem,
    );
    expect(toHantFromSimp).toContain('繁體中文');
    assertPureZhHant(toHantFromSimp!);
    expect(await mem.getPreferredLang(senderId, 'group')).toBe('zh-Hant');

    // Chinese request asking for English ("@AI Tarot 用英文")
    const toEnReply = await tarotFastRespond(
      baseEnv,
      makeInboundEvent({ roomId, senderId, chatType: 'group', text: '@AI Tarot 用英文' }),
      makeSwitchDecision('zh-Hant'),
      emptyMem,
    );
    expect(toEnReply).toContain('English');
    expect(toEnReply).not.toMatch(/[\u4e00-\u9fff]/);
    expect(await mem.getPreferredLang(senderId, 'group')).toBe('en');
  });

  it('uses env.AI Workers AI triage with refined domainDescription for ambiguous group turns and stays silent on anecdotes', async () => {
    const aiPrompts: string[] = [];
    const aiMock = {
      run: vi.fn(async (_model: string, input: { messages: Array<{ role: string; content: string }> }) => {
        aiPrompts.push(input.messages.map((m) => m.content).join('\n'));
        const userMsg = input.messages.find((m) => m.role === 'user')?.content ?? '';
        if (userMsg.includes('換工作')) {
          return { response: JSON.stringify({ score: 0.86, reason: 'tarot_decision_guidance' }) };
        }
        return { response: JSON.stringify({ score: 0.1, reason: 'peer_or_noise' }) };
      }),
    };

    const peerCtx: RoomContext = {
      roomId: '!grp_ai_triage:matrix.netmind.chat',
      chatType: 'group',
      members: [
        { matrixId: '@alice:matrix.netmind.chat', displayName: 'Alice', isAgent: false },
        { matrixId: TAROT_DEFAULT_MATRIX_ID, displayName: 'AI Tarot', isAgent: true },
        { matrixId: '@agent-bc3282c7:matrix.netmind.chat', displayName: 'AI Fortune Stick', isAgent: true },
      ],
      recentHistory: [],
    };
    const triageModel = createWorkersAiTriageModel(aiMock);

    const decisionYes = await routeEvent(
      makeInboundEvent({ text: '最近在猶豫要不要換工作，不知道怎麼選比較好？' }),
      peerCtx,
      TAROT_AGENT_SPEC,
      { triageModel },
    );
    expect(decisionYes.shouldReply).toBe(true);
    expect(decisionYes.triageSource).toBe('model');
    expect(aiMock.run).toHaveBeenCalledTimes(1);
    expect(aiPrompts[0]).toContain(TAROT_AGENT_SPEC.domainDescription);
    expect(aiPrompts[0]).toContain('AI Fortune Stick');

    // Past-tense anecdote is filtered deterministically without invoking Workers AI
    const anecdoteDec = await routeEvent(
      makeInboundEvent({ text: '我朋友昨天去算塔羅超準，抽完就去吃飯了' }),
      peerCtx,
      TAROT_AGENT_SPEC,
      { triageModel },
    );
    expect(anecdoteDec.shouldReply).toBe(false);
    expect(aiMock.run).toHaveBeenCalledTimes(1);

    // End-to-end inside NarraRoomCoordinator with env.AI binding
    let nowMs = 1_760_600_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);
    const posted: string[] = [];
    let a2aCalled = 0;

    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
          if (url.endsWith('/api/agent-runtime/chat/send')) {
            const body = JSON.parse(String(init?.body ?? '{}')) as { text: string };
            posted.push(body.text);
            return Response.json({ status: 'ok', data: { event_id: `$sent_ai_${posted.length}` } });
          }
          if (url === 'https://a2a.tarot.test/rpc') {
            a2aCalled++;
            return new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id: '1',
                result: {
                  kind: 'message',
                  role: 'agent',
                  parts: [{ kind: 'text', text: '如果你想透過三張牌釐清換工作的考量，回覆「抽」即可。' }],
                },
              }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            );
          }
          return new Response('not found', { status: 404 });
        }),
      );

      const gwEnv = {
        ...baseEnv,
        AI: aiMock as unknown as Ai,
        NARRA_GATEWAY_ENABLED: 'on',
        NARRA_SYNC: 'off',
        NARRA_AGENT_TOKEN: 'narra_tarot_ai_tok',
        MANYFOLD_A2A_URL: 'https://a2a.tarot.test/rpc',
        MANYFOLD_A2A_TOKEN: 'a2a_tarot_ai_tok',
      } as Env;

      const roomDo = new NarraRoomCoordinator(makeFakeDOState(), gwEnv);
      await roomDo.fetch(
        new Request('https://narra-room/events', {
          method: 'POST',
          body: JSON.stringify({
            roomId: '!grp_do_ai:matrix.netmind.chat',
            chatType: 'group',
            members: [
              { matrixId: '@alice:matrix.netmind.chat', displayName: 'Alice', isAgent: false },
              { matrixId: TAROT_DEFAULT_MATRIX_ID, displayName: 'AI Tarot', isAgent: true },
            ],
            events: [
              {
                event_id: '$ai_t1',
                sender: '@alice:matrix.netmind.chat',
                type: 'm.room.message',
                origin_server_ts: nowMs,
                content: {
                  msgtype: 'm.text',
                  body: '最近在猶豫要不要換工作，不知道怎麼選比較好？',
                },
              },
            ],
          }),
        }),
      );
      vi.setSystemTime(nowMs + 2_000);
      await roomDo.alarm();

      expect(aiMock.run).toHaveBeenCalledTimes(2);
      expect(a2aCalled).toBe(1);
      expect(posted).toHaveLength(1);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('I1a: handles single-card CSPRNG draws locally in pure zh-Hant/zh-Hans/en without 3-card or A2A fallback, plus bare @AI Tarot', async () => {
    const emptyMem = { userMemories: [], roomMemories: [], promptSafeLines: [] };
    const groupCtx: RoomContext = {
      roomId: '!grp_tarot_i1a:matrix.netmind.chat',
      chatType: 'group',
      userLanguageHint: 'zh-Hant',
      members: [
        { matrixId: '@alice:matrix.netmind.chat', displayName: 'Alice', isAgent: false },
        { matrixId: TAROT_DEFAULT_MATRIX_ID, displayName: 'AI Tarot', isAgent: true },
      ],
      recentHistory: [],
    };

    // 1. I1a: @AI Tarot 今天適合部署上線嗎？抽一張牌就好 -> 1-card CSPRNG draw in zh-Hant
    const i1aEvent = makeInboundEvent({
      roomId: groupCtx.roomId,
      chatType: 'group',
      text: '@AI Tarot 今天適合部署上線嗎？抽一張牌就好',
      mentions: [TAROT_DEFAULT_MATRIX_ID],
    });
    const i1aDecision = await routeEvent(i1aEvent, groupCtx, TAROT_AGENT_SPEC);
    expect(i1aDecision.shouldReply).toBe(true);
    expect(i1aDecision.reason).toBe('explicit_mention');
    expect(i1aDecision.detectedLang).toBe('zh-Hant');

    const i1aReply = await tarotFastRespond(baseEnv, i1aEvent, i1aDecision, emptyMem);
    expect(i1aReply).not.toBeNull();
    expect(i1aReply).toContain('單張抽牌：');
    expect(i1aReply).toMatch(/（正位）|（逆位）/);
    expect(i1aReply).toContain(TAROT_SITE_URL);
    expect(i1aReply).not.toContain('牌陣：');
    expect(i1aReply).not.toContain('今日一牌');
    expect(i1aReply).not.toContain('三張');
    assertPureZhHant(i1aReply!);

    // Also matches unmentioned domainKeywords for single-card draw
    expect(TAROT_AGENT_SPEC.domainKeywords).toEqual(
      expect.arrayContaining(['抽一張', '抽一张', '抽一張牌', '抽一张牌']),
    );
    const unmentionedSingleDec = await routeEvent(
      makeInboundEvent({ text: '今天適合部署上線嗎？抽一張牌就好' }),
      groupCtx,
      TAROT_AGENT_SPEC,
    );
    expect(unmentionedSingleDec.shouldReply).toBe(true);

    // 2. zh-Hans, en, and voice single-card variants
    const hansEvent = makeInboundEvent({
      roomId: groupCtx.roomId,
      chatType: 'group',
      text: '@AI Tarot 今天适合部署上线吗？抽一张牌就好',
      mentions: [TAROT_DEFAULT_MATRIX_ID],
    });
    const hansDecision = await routeEvent(hansEvent, groupCtx, TAROT_AGENT_SPEC);
    expect(hansDecision.detectedLang).toBe('zh-Hans');
    const hansReply = await tarotFastRespond(baseEnv, hansEvent, hansDecision, emptyMem);
    expect(hansReply).not.toBeNull();
    expect(hansReply).toContain('单张抽牌：');
    expect(hansReply).toMatch(/（正位）|（逆位）/);
    expect(hansReply).toContain(TAROT_SITE_URL);
    expect(hansReply).not.toContain('牌阵：');
    assertPureZhHans(hansReply!);

    const enEvent = makeInboundEvent({
      roomId: groupCtx.roomId,
      chatType: 'group',
      text: '@AI Tarot should I deploy today? Draw a card please',
      mentions: [TAROT_DEFAULT_MATRIX_ID],
    });
    const enDecision = await routeEvent(enEvent, groupCtx, TAROT_AGENT_SPEC);
    expect(enDecision.detectedLang).toBe('en');
    const enReply = await tarotFastRespond(baseEnv, enEvent, enDecision, emptyMem);
    expect(enReply).not.toBeNull();
    expect(enReply).toContain('Single-card draw:');
    expect(enReply).toMatch(/\(upright\)|\(reversed\)/);
    expect(enReply).toContain(TAROT_SITE_URL);
    expect(enReply).not.toContain('Spread:');
    expect(enReply).not.toMatch(/[\u4e00-\u9fff]/);

    const voiceEvent = makeInboundEvent({
      roomId: groupCtx.roomId,
      chatType: 'group',
      text: '@AI Tarot 抽一張牌',
      mentions: [TAROT_DEFAULT_MATRIX_ID],
      isVoice: true,
    });
    const voiceDecision = await routeEvent(voiceEvent, groupCtx, TAROT_AGENT_SPEC);
    const voiceReply = await tarotFastRespond(baseEnv, voiceEvent, voiceDecision, emptyMem);
    expect(voiceReply).not.toBeNull();
    expect(voiceReply).toContain('為你抽出一張牌：');
    expect(voiceReply).not.toContain('https://');
    assertPureZhHant(voiceReply!);

    // Multi-card phrase with 抽一張 still yields 3 cards if 三張/牌陣 is present
    const threeCardEvent = makeInboundEvent({
      chatType: 'dm',
      text: '幫我抽三張牌看看',
    });
    const threeCardDec = await routeEvent(
      threeCardEvent,
      { roomId: threeCardEvent.roomId, chatType: 'dm', members: [], recentHistory: [] },
      TAROT_AGENT_SPEC,
    );
    const threeCardReply = await tarotFastRespond(baseEnv, threeCardEvent, threeCardDec, emptyMem);
    expect(threeCardReply).toContain('牌陣：');
    expect(threeCardReply).not.toContain('單張抽牌：');

    // 3. Exhaustively validate formatSingleCardLocalDraw across all 78 cards (upright & reversed)
    for (let cardIdx = 0; cardIdx < DECK.length; cardIdx++) {
      for (const reversedBit of [0, 1]) {
        let calls = 0;
        const detRandom = (max: number) => {
          calls += 1;
          if (calls === 1 && max === DECK.length) return cardIdx;
          if (calls === 2 && max === 2) return reversedBit;
          return 0;
        };
        const outHant = formatSingleCardLocalDraw('zh-Hant', { random: detRandom });
        assertPureZhHant(outHant);
        expect(outHant).toContain(TAROT_SITE_URL);

        calls = 0;
        const outHans = formatSingleCardLocalDraw('zh-Hans', { random: detRandom });
        assertPureZhHans(outHans);
        expect(outHans).toContain(TAROT_SITE_URL);

        calls = 0;
        const outEn = formatSingleCardLocalDraw('en', { random: detRandom });
        expect(outEn).not.toMatch(/[\u4e00-\u9fff]/);
        expect(outEn).toContain(TAROT_SITE_URL);
      }
    }

    // 4. Bare @AI Tarot in group explicit_mention responds locally instead of returning null
    const bareMentionEv = makeInboundEvent({
      roomId: groupCtx.roomId,
      chatType: 'group',
      text: '@AI Tarot',
      mentions: [TAROT_DEFAULT_MATRIX_ID],
    });
    const bareMentionDec = await routeEvent(bareMentionEv, groupCtx, TAROT_AGENT_SPEC);
    expect(bareMentionDec.shouldReply).toBe(true);
    expect(bareMentionDec.reason).toBe('explicit_mention');
    expect(bareMentionDec.detectedLang).toBe('zh-Hant');

    const bareReplyHant = await tarotFastRespond(baseEnv, bareMentionEv, bareMentionDec, emptyMem);
    expect(bareReplyHant).not.toBeNull();
    expect(bareReplyHant).toContain('我是塔羅大師');
    assertPureZhHant(bareReplyHant!);

    const bareReplyEn = await tarotFastRespond(
      baseEnv,
      bareMentionEv,
      { ...bareMentionDec, detectedLang: 'en' },
      emptyMem,
    );
    expect(bareReplyEn).toContain('Hi! I am Tarot Master');
  });
});
