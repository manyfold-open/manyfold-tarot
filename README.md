# 牌面 · Facing the Cards

English · [中文](README_CN.md)

An AI tarot site on a single Cloudflare Worker, read by **your** Manyfold agent.
One question, three cards, one reading.

**[Live site](https://manyfold-tarot.galichlorian.workers.dev)** ·
[How the reading works](TAROT.md) ·
[Invariants for contributors](AGENTS.md)

```
 1 提问   →   2 接住   →   3 洗牌   →   4 抽牌   →   5 解读   →   6 收尾
 one       the reader   the deck    the visitor  one reading  share ·
 question, answers it   settles and turns three  of all three ask again ·
 one       before any   the server  backs over   in eight     keep reading
 button    card exists  commits 3   one by one   sections     these three
```

Everything is server-authoritative: the three cards are sealed by the Worker before a single
back is on screen, the browser never picks a card or an orientation, and the agent that writes
the reading is never in a position to choose what it is reading. [TAROT.md](TAROT.md) is the
long version.

## Two surfaces, one Worker

Understand this before deploying, because the rest of the setup follows from it:

| Path | Who it is for | Password |
| --- | --- | --- |
| `/` — the reading | anyone with the link | **no** |
| `/s/:token` — a frozen shared reading | anyone with the link | **no** |
| `/settings` — the operator console | you | **yes** |

The reading is the product. It is public by design and protected by a meter rather than a lock
(`src/worker/tarot/ratelimit.ts`), because a visitor cannot be asked for an operator password
before they are allowed to ask a question.

The console is the other side: connecting agents, disconnecting them, listing them, chatting
with one. That is your Manyfold account and your agent budget, so it is behind a password —
and **nothing on the tarot site links to it.** You get there by typing the URL. That is
deliberate: someone who came for a reading should not be shown a door they cannot open.

## Deploy your own

You need a Cloudflare account and a [Manyfold](https://manyfold.ai) agent. You do not need the
agent first — the site ships with its own demo reader and is completely usable before anything
is connected, so get the URL working, then point it at your agent.

### 1 · Get it running

<details open>
<summary><b>Path A — the Deploy button</b> (recommended)</summary>

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/manyfold-open/manyfold-tarot)

Cloudflare will copy this repository into your GitHub account, provision the D1 database
declared in `wrangler.jsonc`, write your own `database_id` into your copy, and wire the repo to
**Workers Builds** so every push to `main` builds (`npm run build`) and deploys
(`npx wrangler deploy`) on its own.

> [!IMPORTANT]
> **Expand "Advanced settings" once before clicking Deploy.** As of August 2026 the Cloudflare
> dashboard leaves hidden fields in that section (build API token, non-production deploy
> command) uninitialized while it is collapsed, and the flow then stalls silently after creating
> the repository with no error shown. Expanding it fills them in and the deploy completes. This
> is a dashboard bug, not something this repo can fix.

</details>

<details>
<summary><b>Path B — fork it and wire Workers Builds yourself</b></summary>

```bash
git clone https://github.com/<you>/manyfold-tarot && cd manyfold-tarot
npm install
npx wrangler d1 create manyfold-app-db      # paste the returned id into wrangler.jsonc
```

Two fields in `wrangler.jsonc` are this deployment's and not yours:

- `d1_databases[0].database_id` — **replace it** with the id you just created. Left alone, your
  Worker will fail to bind a database it does not own.
- `name` — the Worker's name, and therefore your `*.workers.dev` subdomain. Change it unless
  you want to argue with Cloudflare about `manyfold-tarot`.

Then **Workers & Pages → Create → Connect to Git**, pick your fork, build command
`npm run build`, deploy command `npx wrangler deploy`, and push to `main`.

</details>

There is no migration step in either path. The schema in `src/worker/db.ts` is applied on the
first request, locally and in production.

### 2 · Set the console password

> [!IMPORTANT]
> **Do this before anything else — you cannot open your own console until you do.**

A default lock ships in `src/worker/admin.ts`, so a fresh deployment is never briefly open to
the internet while you get around to locking it. But this repository is public and only the
*salted digest* of that default is committed: its plaintext is not in the repo, not in the git
history, and not in this file. Which means the default is a lock you do not have the key to.
Replace it with one of your own:

```bash
npx wrangler secret put ADMIN_PASSWORD
```

Or, if you deployed with the button and have no clone: **Workers & Pages → your Worker →
Settings → Variables and Secrets → Add → Secret**.

The secret **replaces** the shipped default rather than joining it, and it is compared as
plaintext in constant time. Because it lives only in Cloudflare's secret store where nobody can
read it, it can be short and memorable — that is the whole reason this path exists. It takes
effect immediately; no redeploy needed.

### 3 · Open the console — by typing the URL

```
https://your-worker.your-subdomain.workers.dev/settings
```

Nothing links there. `/console` still works, for anyone who bookmarked the starter's original
URL. The page asks for the password from step 2 and renders nothing behind it until you get it
right — no tab bar, no agent list, and the Worker does not send the agent list either, so there
is nothing to find in devtools. The password is kept in `sessionStorage`; closing the tab
forgets it.

### 4 · Connect your agent

In **Settings → Connect an agent**, a popup opens Manyfold's consent page. Compare the
confirmation code shown in your page against the one on the consent page — that comparison is
the flow's anti-phishing check, so do not skip it — then pick which agents to share.

The bearer tokens land AES-GCM-encrypted in your D1 database and never reach the browser.
Re-approving an agent later rotates its token in place.

### 5 · Confirm your agent is the one reading

The most recently connected agent becomes the reader, immediately — no redeploy, no
configuration. Ask the site who is talking:

```bash
curl https://your-worker.workers.dev/api/tarot/reader
# {"demo":false}   ← your agent is reading
# {"demo":true}    ← still the built-in demo reader
```

If several agents are connected, pin one with `TAROT_AGENT_ID`. If you want the demo reader
back for a while, set `TAROT_DEMO=1`. Then run a whole reading against the deployment, start to
finish, in one command:

```bash
npm run smoke -- https://your-worker.workers.dev
```

It asks a question, draws, turns all three cards, takes the interpretation, shares it, and
checks along the way that the console is still locked and the reading still open.

## Configuration

| Name | Kind | Set it in | What it does |
| --- | --- | --- | --- |
| `ADMIN_PASSWORD` | secret | Cloudflare | **The console password.** Replaces the shipped default lock. See step 2. |
| `CONFIG_ENCRYPTION_KEY` | secret | Cloudflare | ≥32 chars. Encrypts device codes and agent tokens in D1. Without it a random key is generated on first use and stored in the same database — see [Security](#security). |
| `TAROT_AGENT_ID` | var | `wrangler.jsonc` | Pins which connected agent reads. Default: the most recently connected. |
| `TAROT_DEMO` | var | `wrangler.jsonc` | `1` forces the built-in demo reader even when an agent is connected. |
| `MANYFOLD_API_BASE_URL` | var | `wrangler.jsonc` | Manyfold API base. Defaults to `https://api.manyfold.ai`. |
| `ENVIRONMENT` | var | `wrangler.jsonc` | `production` enforces https-only and rejects private/loopback agent URLs. |

Secrets are never committed. `.dev.vars.example` documents the same set for local use — copy it
to `.dev.vars`, which is git-ignored.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars    # uncomment what you need
npm run dev
```

One command runs everything: Vite serves the React app with HMR while the Worker runs in workerd
against an automatically emulated local D1.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server (app + worker + local D1) |
| `npm run check` | Typecheck, build, `wrangler deploy --dry-run` |
| `npm test` | 206 tests, including a full reading driven through the real Worker |
| `npm run deploy` | Manual deploy (Workers Builds normally does this) |
| `npm run smoke -- <url>` | Drive a whole reading against a live deployment |

## How it is put together

```
Browser (React SPA, dist/client)
   │  /api/* (run_worker_first)            everything else → static assets
   ▼
Hono app (src/worker/index.ts)
   │ ensureSchema → origin check → admin gate
   ├─ /api/tarot/*    src/worker/tarot/    public: the reading, the draw, shares
   ├─ /api/connect*   src/worker/connect.ts   Manyfold device-code handshake
   ├─ /api/agents*    src/worker/connect.ts   list / verify / disconnect
   ▼
D1 — no migrations, the schema applies itself on the next request
Manyfold A2A (message/stream, tasks/get)  ← per-agent token, decrypted per call
```

| File | Purpose |
| --- | --- |
| `src/worker/admin.ts` | Who gets into the console, and why the default is shaped that way |
| `src/worker/tarot/draw.ts` | The draw: CSPRNG, distinct, server-side, committed once |
| `src/worker/tarot/prompt.ts` | Prompts out, prose back, injection hardening |
| `src/worker/tarot/diviner.ts` | The adapter: your A2A agent, or the built-in demo reader |
| `src/app/tarot/` | The six states, the spread, the shared page |
| `src/app/App.tsx` | The operator console — chat and settings tabs |

The tarot site grew out of [`manyfold-open/cloudflare-worker-starter`](https://github.com/manyfold-open/cloudflare-worker-starter),
which is still in here intact: the starter's console is what `/settings` is. If you want the
starter without the tarot, take it from there rather than deleting things out of this.

[TAROT.md](TAROT.md) covers the design decisions — where the cards come from, what the reader
structurally cannot do, how sharing freezes a reading. [AGENTS.md](AGENTS.md) lists the
invariants to preserve when changing any of it.

## Security

- **The console is locked; the reading is not.** Every route except `/api/health`, `/api/state`
  and `/api/tarot/*` requires the admin password, sent as a header and compared in constant
  time. To a caller without it `/api/state` answers only "a password is wanted" — it does not
  leak the agent list.
- **Credentials never touch the browser.** The device code, the only thing that can redeem agent
  tokens, is encrypted in D1 and redeemable exactly once; the browser sees an opaque
  `connectId`. Agent tokens are AES-GCM encrypted at rest.
- **The generated-key trade-off is deliberate and worth knowing.** Without
  `CONFIG_ENCRYPTION_KEY`, the encryption key is generated on first use and stored in the same
  database it protects. That defends against partial exposure — a log line, a single-table query
  — but not against a full database dump. Setting the secret removes the caveat, and one-click
  deploys work either way.
- **Public routes are metered per session and per IP.** Anything that can cost you an agent turn
  is rate-limited, because those routes have to stay open.
- Agent RPC URLs are validated (https-only, private and loopback addresses rejected in
  production), connectivity checks use a non-billing `tasks/get` probe instead of a real turn,
  and every error string is stripped of anything token-shaped before it reaches a log or a
  browser.

## License

[MIT](LICENSE)
