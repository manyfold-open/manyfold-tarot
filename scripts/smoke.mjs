#!/usr/bin/env node
/**
 * Smoke test against a running deployment (or local dev server):
 *   npm run smoke -- https://your-app.workers.dev
 *
 * Retries for a while, because a fresh deploy can take a moment to propagate.
 */

const base = (process.argv[2] ?? 'http://localhost:5173').replace(/\/+$/, '');
const ATTEMPTS = 12;
const DELAY_MS = 5_000;

const checks = [
  {
    name: 'GET /api/health returns ok',
    run: async () => {
      const response = await fetch(`${base}/api/health`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (body.status !== 'ok') throw new Error(`unexpected body: ${JSON.stringify(body)}`);
    },
  },
  {
    name: 'GET /api/state has agents and connect keys',
    run: async () => {
      const response = await fetch(`${base}/api/state`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (!Array.isArray(body.agents) || !('connect' in body)) {
        throw new Error(`unexpected body: ${JSON.stringify(body).slice(0, 200)}`);
      }
    },
  },
  {
    name: 'GET / serves the app shell',
    run: async () => {
      const response = await fetch(`${base}/`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      if (!html.includes('<div id="root">')) throw new Error('no #root element in HTML');
    },
  },
  {
    // What this has always been checking is that /api/* is answered by the
    // Worker and not by the SPA fallback — an unknown API path must come back as
    // a JSON error, never as index.html with a 200 on it.
    //
    // The status is 401 rather than 404 now, and that is the gate doing its job
    // in the right order: a caller who has not given the password is told to
    // give one, not told which routes exist. Smoke runs without the password, so
    // 401 is the expected answer here; 404 is what the same path returns to
    // someone already inside.
    name: 'unknown /api/* routes are answered by the Worker, in JSON',
    run: async () => {
      const response = await fetch(`${base}/api/definitely-not-a-route`);
      if (![401, 404].includes(response.status)) {
        throw new Error(`HTTP ${response.status}, expected 401 or 404`);
      }
      const body = await response.json();
      const expected = response.status === 401 ? 'admin_password_invalid' : 'not_found';
      if (body?.error?.code !== expected) {
        throw new Error(`unexpected body: ${JSON.stringify(body)}`);
      }
    },
  },
  {
    // The half of the split that is easy to lose by accident: lock the console
    // a little too broadly and this is the check that notices.
    name: 'the console is locked and says so without saying more',
    run: async () => {
      const state = await (await fetch(`${base}/api/state`)).json();
      if (state.adminRequired !== true || state.adminOk !== false) {
        throw new Error(`deployment is not locked: ${JSON.stringify(state).slice(0, 120)}`);
      }
      if (state.agents.length > 0 || state.connect.session !== null) {
        throw new Error('a locked deployment served the agent list');
      }
      const agents = await fetch(`${base}/api/agents`);
      if (agents.status !== 401) throw new Error(`GET /api/agents → HTTP ${agents.status}, expected 401`);
    },
  },
  {
    name: 'GET /api/tarot/reader says who is reading',
    run: async () => {
      const response = await fetch(`${base}/api/tarot/reader`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (typeof body.demo !== 'boolean') throw new Error(`unexpected body: ${JSON.stringify(body)}`);
      if (body.demo) console.log('  (demo reader — no agent connected yet)');
    },
  },
  {
    name: 'a whole reading runs: question → draw → three cards → interpretation → share',
    run: async () => {
      // One browser: same cookie throughout, Origin on every mutation.
      let cookie = '';
      const call = async (path, body) => {
        const response = await fetch(`${base}${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            origin: base,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            ...(cookie ? { cookie } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie && !cookie) cookie = setCookie.split(';')[0];
        return response;
      };
      const events = async (response) =>
        (await response.text())
          .split('\n\n')
          .map((frame) => frame.replace(/^data: /, '').trim())
          .filter(Boolean)
          .map((payload) => JSON.parse(payload));
      const firstOf = (list, type) => list.find((event) => event.type === type);

      const started = await call('/api/tarot/readings', { question: '这次部署还顺利吗？', locale: 'zh' });
      if (started.status !== 201) throw new Error(`POST /readings → HTTP ${started.status}`);
      const { reading } = await started.json();
      const id = reading.readingId;

      const greeting = firstOf(await events(await call(`/api/tarot/readings/${id}/greeting`, {})), 'greeting');
      if (!greeting?.text?.trim()) throw new Error('no greeting came back');

      const drawn = await (await call(`/api/tarot/readings/${id}/draw`, {})).json();
      if (drawn.reading.pending !== 3) throw new Error(`expected 3 cards face down, got ${drawn.reading.pending}`);
      if (drawn.reading.cards.length !== 0) throw new Error('face-down cards leaked to the client');

      for (const index of [0, 1, 2]) {
        const turned = await events(await call(`/api/tarot/readings/${id}/reveal`, { index }));
        const card = firstOf(turned, 'card');
        if (!card || card.card.index !== index) throw new Error(`card ${index} did not turn over`);
      }

      const read = firstOf(await events(await call(`/api/tarot/readings/${id}/interpretation`, {})), 'interpretation');
      const parts = read?.interpretation;
      if (!parts) throw new Error('no interpretation came back');
      const missing = ['conclusion', 'overview', 'connections', 'response', 'reflection', 'closing'].filter(
        (key) => !String(parts[key] ?? '').trim(),
      );
      if (missing.length) throw new Error(`interpretation missing sections: ${missing.join(', ')}`);
      if (parts.perCard?.length !== 3) throw new Error('interpretation did not cover all three cards');

      const shared = await call(`/api/tarot/readings/${id}/share`, { includeQuestion: false });
      if (shared.status !== 201) throw new Error(`POST /share → HTTP ${shared.status}`);
      const { share, url } = await shared.json();
      if (share.question !== null) throw new Error('the question leaked into a share that opted out');

      // A share link is public: fetched here with no cookie at all.
      const opened = await fetch(`${base}/api/tarot/share/${share.token}`);
      if (!opened.ok) throw new Error(`GET /share/:token → HTTP ${opened.status}`);
      const page = await fetch(url);
      if (!page.ok) throw new Error(`GET ${url} → HTTP ${page.status}`);
    },
  },
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let ready = false;
for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  try {
    const response = await fetch(`${base}/api/health`);
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {
    /* not up yet */
  }
  console.log(`waiting for ${base} (${attempt}/${ATTEMPTS})…`);
  await wait(DELAY_MS);
}
if (!ready) {
  console.error(`✗ ${base} never became reachable`);
  process.exit(1);
}

let failed = 0;
for (const check of checks) {
  try {
    await check.run();
    console.log(`✓ ${check.name}`);
  } catch (error) {
    failed += 1;
    console.error(`✗ ${check.name}: ${error.message}`);
  }
}
process.exit(failed ? 1 : 0);
