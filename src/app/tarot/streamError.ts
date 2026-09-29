/**
 * The line for an `error` event inside a diviner stream.
 *
 * The reader failing is worded here, in the visitor's language — never with
 * whatever the agent platform said (an exhausted quota, a plan name, a timeout).
 * Kept out of api.ts so the UI tests that stub that module still get it.
 */

import { READER_UNAVAILABLE, type DivinerEvent } from '../../shared/tarot/types';

export const streamErrorText = (
  event: Extract<DivinerEvent, { type: 'error' }>,
  errors: { generic: string; rateLimited: string },
): string => {
  if (event.code === READER_UNAVAILABLE) return errors.generic;
  if (event.code === 'rate_limited') return errors.rateLimited;
  return event.message || errors.generic;
};
