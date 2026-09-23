/**
 * Visitor sessions for the public tarot routes.
 *
 * The site has no accounts and asks for nothing — but a reading still has to
 * belong to somebody, or one visitor could read, continue and share another's
 * readings by guessing an id. So each browser gets one opaque, HttpOnly cookie
 * whose only meaning is "the same browser as before". It identifies nothing
 * about the person, and never leaves the server as anything but a cookie.
 */

const COOKIE_NAME = 'taro_sid';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
/** Length of the base64url id; 24 bytes of entropy is far past guessable. */
const ID_BYTES = 24;

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export function newSessionId(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(ID_BYTES)));
}

/** Reads our cookie out of a Cookie header. Tolerates any other cookies present. */
export function readSessionCookie(header: string | undefined | null): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) {
      const value = rest.join('=').trim();
      // Anything that is not our own alphabet is treated as absent rather than
      // trusted: the value is used as a database key.
      return /^[A-Za-z0-9_-]{16,64}$/.test(value) ? value : null;
    }
  }
  return null;
}

/**
 * Set-Cookie for a new session.
 *
 * HttpOnly because no script needs it; SameSite=Lax because the share links are
 * ordinary top-level navigations and nothing here is a cross-site POST; Secure
 * on https only, so local http dev still works. Path is `/` at the root of the
 * site's own host and the mount (`/tarot`) on a shared one.
 */
export function sessionCookieHeader(sessionId: string, secure: boolean, path = '/'): string {
  return [
    `${COOKIE_NAME}=${sessionId}`,
    `Path=${path}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${MAX_AGE_SECONDS}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export const isSecureRequest = (url: string): boolean => new URL(url).protocol === 'https:';
