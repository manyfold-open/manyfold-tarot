/**
 * Browser side of /api/tarot.
 *
 * Two shapes only: plain JSON calls, and one SSE reader for the turns where the
 * diviner speaks. The session cookie rides along automatically (same-origin
 * fetch), so nothing here knows about identity — the Worker decides what this
 * browser is allowed to see.
 *
 * Note what is NOT here: no way to name a card, no way to set an orientation.
 * The browser can ask for a draw and ask to turn the next card over; what lands
 * is the Worker's answer.
 */

import type {
  CreateReadingBody,
  DivinerEvent,
  ReadingView,
  ShareSnapshot,
} from '../../shared/tarot/types';
import type { ApiErrorBody } from '../../shared/types';
import { ApiError, api } from '../api';

const base = '/api/tarot';
const readingPath = (id: string, suffix = ''): string =>
  `${base}/readings/${encodeURIComponent(id)}${suffix}`;

/**
 * Who is reading, and whether this visitor is owed a consent banner.
 *
 * The second one is not the reader's business, but it is the same question at
 * the same moment — the page asks this on load either way, and a separate
 * request to learn one boolean would be a request for nothing.
 */
export const fetchReader = (): Promise<{ demo: boolean; consentRequired: boolean }> =>
  api(`${base}/reader`);

export const startReading = (body: CreateReadingBody): Promise<{ reading: ReadingView }> =>
  api(`${base}/readings`, { method: 'POST', body: JSON.stringify(body) });

export const fetchReading = (id: string): Promise<{ reading: ReadingView }> =>
  api(readingPath(id));

/** Stops the shuffle. This is the request that makes the Worker choose three cards. */
export const stopShuffle = (id: string): Promise<{ reading: ReadingView }> =>
  api(readingPath(id, '/draw'), { method: 'POST', body: '{}' });

export const createShare = (
  id: string,
  includeQuestion: boolean,
): Promise<{ share: ShareSnapshot; url: string }> =>
  api(readingPath(id, '/share'), {
    method: 'POST',
    body: JSON.stringify({ includeQuestion }),
  });

export const fetchShare = (token: string): Promise<{ share: ShareSnapshot }> =>
  api(`${base}/share/${encodeURIComponent(token)}`);

/**
 * Reads one diviner turn as SSE: frames separated by a blank line, JSON on the
 * `data:` line. Mirrors src/app/sse.ts — EventSource cannot POST, so this is a
 * plain fetch whose body is parsed by hand. Resolves when the stream closes.
 */
export async function streamDiviner(
  path: string,
  body: unknown,
  onEvent: (event: DivinerEvent) => void,
): Promise<void> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

  if (!response.ok) {
    let payload: ApiErrorBody | null = null;
    try {
      payload = (await response.json()) as ApiErrorBody;
    } catch {
      /* not JSON */
    }
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'request_failed',
      payload?.error?.message ?? `Request failed with HTTP ${response.status}.`,
    );
  }
  if (!response.body) throw new ApiError(502, 'no_stream', 'The reader sent no stream.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = block
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data) {
          try {
            onEvent(JSON.parse(data) as DivinerEvent);
          } catch {
            /* skip a malformed frame rather than losing the rest of the turn */
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Turns any thrown value into a line the visitor can read. */
export const errorText = (error: unknown, fallback: string): string => {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error && error.message ? error.message : fallback;
};

export { ApiError };
