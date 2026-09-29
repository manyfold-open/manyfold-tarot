import { describe, expect, it } from 'vitest';
import { streamErrorText } from '../../src/app/tarot/streamError';
import { READER_UNAVAILABLE } from '../../src/shared/tarot/types';

const errors = { generic: '牌一时没有回应。稍后再试一次。', rateLimited: '今天问得有点多了。' };

describe('streamErrorText', () => {
  it('words a failed reader in the visitor’s language, whatever the message says', () => {
    expect(
      streamErrorText({ type: 'error', code: READER_UNAVAILABLE, message: 'quota reached' }, errors),
    ).toBe(errors.generic);
  });

  it('maps the rate limit, and falls back to generic for an empty message', () => {
    expect(streamErrorText({ type: 'error', code: 'rate_limited', message: 'x' }, errors)).toBe(errors.rateLimited);
    expect(streamErrorText({ type: 'error', message: '' }, errors)).toBe(errors.generic);
  });

  it('passes through the message of any other coded error', () => {
    expect(streamErrorText({ type: 'error', code: 'follow_up_limit', message: 'That is all.' }, errors)).toBe('That is all.');
  });
});
