import { describe, expect, it } from 'vitest';
import { readTarotHandoff } from '../../src/app/tarot/bridge';

describe('the tester fragment', () => {
  it('reads #tester= and treats it as a fragment to clear from the address bar', () => {
    const handoff = readTarotHandoff('https://app.manyfold.ai/tarot/#tester=abc123');
    expect(handoff.testerToken).toBe('abc123');
    expect(handoff.hasBridgeFragment).toBe(true);
  });

  it('is absent from an ordinary address', () => {
    const handoff = readTarotHandoff('https://app.manyfold.ai/tarot/');
    expect(handoff.testerToken).toBeNull();
    expect(handoff.hasBridgeFragment).toBe(false);
  });

  it('never reads the token from the query string, which servers log', () => {
    expect(readTarotHandoff('https://app.manyfold.ai/tarot/?tester=abc').testerToken).toBeNull();
  });

  it('keeps every character of a base64 token: "+", "/" and a trailing "="', () => {
    expect(readTarotHandoff('https://app.manyfold.ai/tarot/#tester=Vp1V+Ga/Uj1x=').testerToken).toBe('Vp1V+Ga/Uj1x=');
  });

  it('still decodes a percent-encoded token, and reads it beside other fragment keys', () => {
    expect(readTarotHandoff('https://app.manyfold.ai/tarot/#lang=zh&tester=a%2Bb%2Fc%3D').testerToken).toBe('a+b/c=');
  });
});
