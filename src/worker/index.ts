/**
 * The Worker: a Hono app under /api, static assets for everything else.
 *
 * Route map (all responses JSON unless noted):
 *   GET    /api/health                      open   deploy-verification contract
 *   GET    /api/state                       open   bootstrap: agents + handshake + admin flags
 *   POST   /api/connect                     admin  start a Manyfold handshake
 *   POST   /api/connect/:id/poll            admin  poll it (2s cadence from the browser)
 *   DELETE /api/connect/:id                 admin  cancel it
 *   GET    /api/agents                      admin  connected agents (never tokens)
 *   POST   /api/agents/:agentId/verify      admin  re-run the non-billing auth probe
 *   DELETE /api/agents/:agentId             admin  disconnect + drop its conversation
 *   GET    /api/agents/:agentId/messages    admin  chat history
 *   DELETE /api/agents/:agentId/messages    admin  reset the conversation
 *   POST   /api/agents/:agentId/chat        admin  one chat turn (text/event-stream)
 *   *      /api/tarot/*                     open   the tarot site (src/worker/tarot/routes.ts)
 *
 * "admin" routes require the x-admin-password header. This deployment is always
 * locked — see src/worker/admin.ts for which password opens it — because its URL
 * is public and the console behind it can spend the owner's agent budget.
 *
 * The tarot routes are open regardless: they are the product, and they are
 * metered instead. See isPublicPath below.
 */

import { Hono } from 'hono';
import type { AppState } from '../shared/types';
import { HttpError, type Env } from './types';
import { adminPasswordOk, adminRequired } from './admin';
import { ensureSchema } from './db';
import { ConfigError } from './crypto';
import { A2AError } from './a2a';
import {
  cancelConnect,
  disconnectAgent,
  getConnectSession,
  listConnectedAgents,
  pollConnect,
  startConnect,
  verifyAgent,
} from './connect';
import { getConversation, handleChatTurn, resetConversation } from './chat';
import { tarot } from './tarot/routes';

const SERVICE = 'manyfold-tarot';

const app = new Hono<{ Bindings: Env }>();

/* ───────── middleware ───────── */

app.use('/api/*', async (c, next) => {
  await ensureSchema(c.env.DB);
  await next();
});

// Same-origin check on every mutation: browsers always send Origin on cross-site
// POSTs, so this shuts down CSRF without cookies or tokens.
app.use('/api/*', async (c, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) {
    const origin = c.req.header('origin');
    if (!origin) {
      throw new HttpError(403, 'origin_required', 'Mutation requests must include a same-origin Origin header.');
    }
    if (origin !== new URL(c.req.url).origin) {
      throw new HttpError(403, 'invalid_origin', 'Cross-origin requests are not allowed.');
    }
  }
  await next();
});

const adminOk = (c: {
  env: Env;
  req: { header: (name: string) => string | undefined };
}): Promise<boolean> => adminPasswordOk(c.env, c.req.header('x-admin-password') ?? '');

/**
 * Routes a visitor may use without the admin password.
 *
 * /api/health and /api/state are the starter's own two exceptions — and /api/state
 * only in the narrow sense that it answers at all; what it answers to a stranger
 * is nothing (see the handler). /api/tarot/* is the third, and it is the product
 * itself: this deployment is a public tarot site, and nobody can be asked for an
 * operator password before they are allowed to ask a question.
 *
 * The reason the gate exists — that a public URL must not let strangers spend
 * the owner's agent budget — is answered for these routes in
 * src/worker/tarot/ratelimit.ts instead: every path that can cause a billable
 * turn is metered per session and per IP. The operator surface (connecting
 * agents, the verification chat, disconnecting) stays behind the password.
 */
const isPublicPath = (path: string): boolean =>
  path === '/api/health' || path === '/api/state' || path.startsWith('/api/tarot/');

app.use('/api/*', async (c, next) => {
  if (!isPublicPath(new URL(c.req.url).pathname) && !(await adminOk(c))) {
    throw new HttpError(401, 'admin_password_invalid', 'This deployment requires the admin password.');
  }
  await next();
});

/* ───────── error mapping ───────── */

app.onError((error, c) => {
  if (error instanceof HttpError) {
    return c.json({ error: { code: error.code, message: error.message } }, error.status as 400);
  }
  if (error instanceof ConfigError) {
    return c.json({ error: { code: 'misconfigured', message: error.message } }, 400);
  }
  if (error instanceof A2AError) {
    return error.retryable
      ? c.json({ error: { code: 'manyfold_unavailable', message: error.message } }, 502)
      : c.json({ error: { code: 'manyfold_rejected', message: error.message } }, 400);
  }
  console.error('unhandled', error);
  return c.json({ error: { code: 'internal', message: 'Something went wrong.' } }, 500);
});

/* ───────── routes ───────── */

app.get('/api/health', (c) =>
  c.json({ status: 'ok', service: SERVICE, time: new Date().toISOString() }),
);

app.get('/api/state', async (c) => {
  // The one route that answers before the password does, because the browser has
  // to be told that a password is wanted. It says that and nothing else: the
  // agent list carries the operator's agent names and their RPC endpoints, and a
  // caller who has not been let in has no claim on either. The console renders
  // the gate from this and has nothing to render behind it.
  if (!(await adminOk(c))) {
    const locked: AppState = {
      service: SERVICE,
      adminRequired: true,
      adminOk: false,
      connect: { session: null },
      agents: [],
    };
    return c.json(locked);
  }

  const [session, agents] = await Promise.all([
    getConnectSession(c.env),
    listConnectedAgents(c.env),
  ]);
  const state: AppState = {
    service: SERVICE,
    adminRequired: adminRequired(),
    adminOk: true,
    connect: { session },
    agents,
  };
  return c.json(state);
});

app.post('/api/connect', async (c) => {
  const session = await startConnect(c.env, c.req.url);
  return c.json({ connect: session }, 201);
});

app.post('/api/connect/:connectId/poll', async (c) => {
  const outcome = await pollConnect(c.env, c.req.param('connectId'));
  return c.json(outcome);
});

app.delete('/api/connect/:connectId', async (c) => {
  await cancelConnect(c.env, c.req.param('connectId'));
  return c.json({ ok: true });
});

app.get('/api/agents', async (c) => c.json({ agents: await listConnectedAgents(c.env) }));

app.post('/api/agents/:agentId/verify', async (c) =>
  c.json({ agent: await verifyAgent(c.env, c.req.param('agentId')) }),
);

app.delete('/api/agents/:agentId', async (c) => {
  await disconnectAgent(c.env, c.req.param('agentId'));
  return c.json({ ok: true });
});

app.get('/api/agents/:agentId/messages', async (c) =>
  c.json(await getConversation(c.env, c.req.param('agentId'))),
);

app.delete('/api/agents/:agentId/messages', async (c) => {
  await resetConversation(c.env, c.req.param('agentId'));
  return c.json({ ok: true });
});

app.post('/api/agents/:agentId/chat', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { message?: unknown } | null;
  if (!body || typeof body.message !== 'string') {
    throw new HttpError(400, 'bad_request', 'Body must be JSON with a string "message".');
  }
  return handleChatTurn({
    env: c.env,
    agentId: c.req.param('agentId'),
    message: body.message,
    waitUntil: (promise) => c.executionCtx.waitUntil(promise),
  });
});

// The tarot site. Public by design — see isPublicPath above.
app.route('/api/tarot', tarot);

app.all('/api/*', () => {
  throw new HttpError(404, 'not_found', 'No such API route.');
});

// Anything else that reaches the Worker is a static asset (or the SPA fallback).
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
