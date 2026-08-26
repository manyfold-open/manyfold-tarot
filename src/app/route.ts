/**
 * Which page a URL asks for.
 *
 * The operator console — connect a Manyfold agent, verify it, chat with it — is
 * deliberately not on the visitor's path. Nothing on the tarot site links to it,
 * and nothing should: the only person who needs it is whoever deployed the app,
 * and they can be handed a URL. A door that is typed rather than clicked is
 * still a door; it just isn't furniture.
 *
 * Two spellings open it. `/console` is where the console moved when the tarot
 * site took `/`, and links already handed out say that. `/settings` is the word
 * an operator actually reaches for when they want to connect an agent, so it is
 * the one worth documenting — and because the console's own tabs are hashes, it
 * can also mean *which* tab: `/settings` lands on Settings rather than Chat.
 *
 * Kept apart from main.tsx so the rules can be read in a test without booting a
 * React root.
 */

export type Tab = 'chat' | 'settings';

/** `/base`, `/base/` and `/base/anything` — but never `/basement`. */
const under = (path: string, base: string): boolean => path === base || path.startsWith(`${base}/`);

export const isConsolePath = (path: string): boolean =>
  under(path, '/console') || under(path, '/settings');

export const isSharePath = (path: string): boolean => path.startsWith('/s/');

/**
 * The console's tab, from the whole location rather than the hash alone.
 *
 * An explicit hash always wins — it is what the tabs themselves write, and a
 * visitor who clicked Chat on /settings meant Chat. Only when there is no hash
 * to go on does the path get a say, which is what makes /settings open on
 * Settings while /console still opens where it always did.
 */
export const tabFor = (path: string, hash: string): Tab => {
  if (hash === '#settings') return 'settings';
  if (hash === '#chat') return 'chat';
  return under(path, '/settings') ? 'settings' : 'chat';
};
