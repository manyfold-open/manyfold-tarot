# 牌面 · Facing the Cards

An AI tarot site built on this Worker. Three cards, one question, one reading.

The starter it grew out of is untouched and still there — the operator console moved from `/`
to `/settings`. Everything tarot lives in three new directories and one new set of tables.

```
/            the tarot site            src/app/tarot/     public, no password
/s/:token    a frozen shared reading   src/app/tarot/SharePage.tsx
/settings    the starter's console     src/app/App.tsx    password (also at /console)
```

Nothing on the tarot site links to the console, and the console asks for a password before it
renders — see `src/worker/admin.ts`. The reading never does.

## The flow

| # | State | What happens |
| --- | --- | --- |
| 1 | 提问 | One input, one button. No welcome page, no examples, no spread picker. |
| 2 | 接住 | The reader answers the question in one to three sentences. Nothing is drawn yet, so nothing may be named. |
| 3 | 洗牌 | The deck shuffles itself for a few seconds — there is nothing to press. **The server commits three cards** the moment it settles. |
| 4 | 抽牌 | The whole pack is spread face down. The visitor picks three backs out of it, and each turns over in its position, with its orientation and one line. |
| 5 | 解读 | One reading of all three cards in eight fixed sections — never three meanings stapled together. |
| 6 | 收尾 | 分享这次解读 · 再问一件事 · 继续解读这三张牌 |

Positions are fixed and not configurable: **此刻的处境 · 隐藏的影响 · 接下来的指引**.
Reversals are always on. The three cards are always distinct.

## Where the cards come from

`src/worker/tarot/draw.ts`, and nowhere else.

- A CSPRNG (`crypto.getRandomValues`) with rejection sampling, so the distribution is flat —
  no modulo bias — and a partial Fisher–Yates for distinctness.
- The browser never picks a card, an orientation, or a seed. It says the shuffle is over; the
  Worker answers with what it committed.
- **A place in the spread is not a card.** The three cards are sealed on the server before a
  single back is on screen, so touching the seventh back rather than the fortieth changes
  nothing about what turns over — exactly as at a physical table, where the deck is already
  shuffled and every back is identical. `Fan.tsx` is never told a card id and has no prop
  through which it could be told one; what the visitor chooses is the moment, not the card.
- **The reader never picks either.** Every request type in `diviner.ts` carries cards that
  were already drawn. There is no request shape in which a card can be chosen, so the reading
  cannot be steered by the question.
- Face-down cards do not exist over the wire: `ReadingView.cards` contains only cards already
  turned over, and `pending` counts the rest.
- The draw is committed exactly once. Pressing the button twice is the same spread.

## The art

79 lossless WebP files in `public/cards/`, served as Worker static assets: 78 faces named for
their deck id (`major-00.webp`, `cups-07.webp`, …) and one `back.webp`. The file name *is* the
index — `cardArt(id)` in `deck.ts` derives the URL and there is no second table to fall out of
step, so a card cannot point at another card's picture. `tests/tarot-art.test.ts` holds the
other half: every id has a file, every file has an id, each is a real WebP, and no two faces
share a hash.

**Backs are surface, faces are content.** The back is a CSS background — one image behind all
78 cards in the spread and behind every face-down slot — and it is preloaded in `index.html`,
because it is the first thing anyone sees. Faces are `<img>` elements that do not exist until
the card is known, and they are deliberately **not** preloaded: the browser is not told what
was drawn until it turns over, so there is nothing in the network log to read ahead. A reversed
card is the same picture rotated 180°, which is what a reversed card is.

The card's name and numeral are printed on the art, in English. The localized name is the
caption under the card, not on it.

## The reader (Agent 2)

The site talks to one connected Manyfold agent over A2A. Until one is connected it runs its
own demo reader, so the whole site is usable and demonstrable standalone.

```
POST /api/tarot/readings/:id/greeting        →  diviner.speak({kind: 'greeting', …})
POST /api/tarot/readings/:id/reveal          →  diviner.speak({kind: 'hint', card, index, …})
POST /api/tarot/readings/:id/interpretation  →  diviner.speak({kind: 'interpretation', cards, …})
POST /api/tarot/readings/:id/follow-ups      →  diviner.speak({kind: 'followup', …})
```

**Connecting one:** open `/settings`, give the admin password, connect an agent as usual. The most recently connected
agent becomes the reader. On a deployment with several agents, pin one with `TAROT_AGENT_ID`.
Set `TAROT_DEMO=1` to force the demo reader even when an agent is connected.

**What the reader does:** catch the question, speak in an immersive diviner voice, give a
short line per card as it turns, interpret the three cards as one spread, connect them, answer
follow-ups about *this* spread, and say when a question has become a new round.

**What the reader cannot do**, structurally, not by instruction: draw a card, choose an
orientation, write to the database, mint a share link, read site files, reach the network,
execute code, see another visitor's reading, or change what the frontend is showing.

**If the reader fails** the visitor is told and can retry. The site does not quietly serve
sample text over a real reader's failure — the one exception is a single card's line during
the flip, which falls back to the deck's own keyword line rather than stalling the ritual.

## Protocol in, prose out

`src/worker/tarot/prompt.ts` is the airlock.

- The visitor's text is fenced as material, never as instructions, and protocol markers are
  stripped from it — a question cannot forge a `[CONCLUSION]` section or a new-round verdict.
- The reply is parsed into the eight sections by tag, with a readable fallback when the reader
  ignores the tags, and an explicit "unusable" verdict rather than a blank page.
- `<think>` blocks, scratchpads and reasoning preambles are stripped.
- The browser deliberately **ignores `delta` events** for the interpretation, so the tagged
  draft never reaches the screen. The wait is filled with the reader's own voice.

Nowhere in the UI, in either language: AI 正在分析 / 模型正在生成 / 系统处理中 / 推理过程 /
Chain of Thought / 内部工具调用. There is a test that enforces this over every string in
`src/shared/tarot/i18n.ts`.

## Sharing

`分享这次解读` always shares the round currently on screen. Each round is its own record and a
new round never overwrites an old one.

A share is a **frozen copy**, not a view: the snapshot is serialized into `tarot_shares` at
share time, and nothing that happens to the reading afterwards can change what a link already
handed out. Two shares of the same reading are two independent records.

Shared by default: the three cards, their positions, upright/reversed, the one-sentence
conclusion, and the product signature. Never shared: the private conversation, the visitor's
identity, other rounds. The original question is included only if the visitor ticks the box.

## Who a reading belongs to

There are no accounts. Each browser gets one opaque HttpOnly cookie (`taro_sid`) that means
only "the same browser as before". A reading belongs to the session that started it; anyone
else asking for it gets **404, not 403**, so an id cannot be probed for existence. Share links
are the deliberate exception: public, no cookie, no ownership.

Every path that can cost an agent turn is metered per session *and* per IP
(`src/worker/tarot/ratelimit.ts`), because these routes are public by design — a visitor
cannot be asked for the operator password before they are allowed to ask a question.

## Files

| File | Purpose |
| --- | --- |
| `public/cards/` | 78 faces and one back, named for their deck ids |
| `src/shared/tarot/deck.ts` | The 78-card deck, both languages, upright and reversed |
| `src/shared/tarot/i18n.ts` | Every string the visitor reads, in both languages |
| `src/shared/tarot/types.ts` | The API surface shared by Worker and browser |
| `src/worker/tarot/draw.ts` | The draw. CSPRNG, distinct, server-side, once |
| `src/worker/tarot/flow.ts` | The state machine: what may happen next, and what may not |
| `src/worker/tarot/diviner.ts` | The adapter: A2A agent or built-in demo reader |
| `src/worker/tarot/prompt.ts` | Prompts out, parsing back, injection hardening |
| `src/worker/tarot/store.ts` | D1: readings, follow-ups, frozen share snapshots |
| `src/worker/tarot/ratelimit.ts` | Fixed-window meters, per session and per IP |
| `src/worker/tarot/routes.ts` | `/api/tarot/*` |
| `src/app/tarot/TarotApp.tsx` | The six states |
| `src/app/tarot/Fan.tsx` | The spread the visitor picks from. Knows no card ids |
| `src/app/tarot/SharePage.tsx` | `/s/:token` — reads the snapshot, never the reading |

New tables: `tarot_readings`, `tarot_followups`, `tarot_shares`, `tarot_rate`. They are created
by `SCHEMA` in `src/worker/db.ts` on the next request, like everything else here.

## Testing

```
npm test                      # 206 tests, including a full-flow run through the real Worker
npm run check                 # tsc + vite build + wrangler dry-run
npm run smoke -- <url>        # drives a whole reading against a live deployment
```

`tests/tarot-e2e.test.ts` drives the deployed Hono app end to end — CSRF check, cookie, rate
limiter and real SQL included — against a SQLite database standing in for D1. It is the test
that notices if the flow itself breaks: a card revealed out of order, a stranger reading
someone else's reading, a share link that quietly follows the reading it came from.

`tests/ui/` runs the two pieces of the draw that only exist in the browser, under jsdom: that
the shuffle stops itself exactly once with nothing to press, and that the spread never has a
card id or a card name anywhere in its markup. Everything else stays in the node environment.
