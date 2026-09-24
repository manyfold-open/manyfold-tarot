# AI Tarot

English · [中文](README_CN.md)

An AI tarot reading built on Cloudflare Workers and Manyfold.

**Official site:** [app.manyfold.ai/tarot](https://app.manyfold.ai/tarot/)

One question. Three cards. One reading.

## What it is

Facing the Cards is a quiet, guided tarot experience. Ask one question, let the deck settle, choose three card backs, and receive a reading that connects the cards to your situation.

The site can use a connected Manyfold agent as its reader and includes a built-in demo reader, so the experience works before an agent is connected.

## How a reading works

1. Ask a question.
2. The reader acknowledges what you are asking.
3. The Worker shuffles and commits three cards.
4. Choose three cards from the spread; the browser does not decide which cards they are.
5. Turn the cards over one by one.
6. Receive one reading of the complete spread.
7. Share the reading, ask a follow-up, or start a new round.

The spread is fixed:

- **This moment** — 此刻的处境
- **Hidden influence** — 隐藏的影响
- **The guidance ahead** — 接下来的指引

## Server-authoritative by design

The Worker decides the cards and their orientations before the first card back appears. The browser never draws or re-rolls cards, and the reader only interprets cards that have already been chosen.

Questions are treated as user-provided material, not instructions. Reader responses are cleaned and parsed before they reach the interface.

## Sharing and privacy

A shared reading is a frozen snapshot of the round at the time it was shared. Later follow-ups do not change an existing share link.

The public reading is separate from the password-protected operator console at `/settings`.

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

Useful checks:

```bash
npm run check
npm test
npm run smoke -- <url>
```

## Architecture

- React + TypeScript frontend
- Hono on a Cloudflare Worker
- Cloudflare D1 for readings, follow-ups, shares, and configuration
- Manyfold A2A for connected readers
- [MIT License](LICENSE)
