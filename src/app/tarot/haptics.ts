/**
 * A short tap in the hand for the two moments this site is built around: a card
 * chosen and a card turned over.
 *
 * Only Android browsers implement `vibrate`; iOS Safari does not, so here it is
 * silently nothing. It is also nothing for anyone who asked their device to keep
 * motion down, which is the closest setting there is for "do not move me".
 */

const reducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

export function haptic(ms = 12): void {
  try {
    if (typeof navigator.vibrate === 'function' && !reducedMotion()) navigator.vibrate(ms);
  } catch {
    /* a browser that refuses is a browser that gets no tap */
  }
}
