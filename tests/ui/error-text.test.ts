// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ApiError, errorText } from '../../src/app/tarot/api';

const generic = 'The cards did not answer just now.';
const tunnel = 'API Error: 530 {"title":"Error 1033: Cloudflare Tunnel error"}';

describe('errorText', () => {
  it('never reads aloud what the agent platform said about its own failure', () => {
    for (const code of ['manyfold_unavailable', 'manyfold_rejected', 'internal', 'reader_unavailable']) {
      expect(errorText(new ApiError(502, code, tunnel), generic)).toBe(generic);
    }
  });

  it('still shows the Worker’s own message for any other coded error', () => {
    expect(errorText(new ApiError(400, 'question_required', 'Write a question first.'), generic)).toBe(
      'Write a question first.',
    );
  });

  it('uses the fallback for anything that is not the Worker talking', () => {
    expect(errorText(new Error('Failed to fetch'), generic)).toBe(generic);
  });
});
