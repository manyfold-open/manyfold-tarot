/**
 * A call to action must not opt into `text-wrap: balance` or `pretty`.
 *
 * WebKit splits a shrink-to-fit button into two lines under either, even when
 * one line fits — "聆听解读" came out as "聆听 / 解读" on an iPhone, while Chromium
 * showed one line. jsdom has no layout to catch it, so this reads the rule.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rules = ['src/app/tarot/tarot.css', 'src/app/tarot/features.css']
  .map((file) => new TextDecoder().decode(readFileSync(file)))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('call to action line breaking', () => {
  it('leaves .taro-primary and .taro-secondary on ordinary wrapping', () => {
    const blocks = [...rules.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
      .filter(([, selector]) => /\.taro-(primary|secondary)\b/.test(selector))
      .map(([, , body]) => body);
    expect(blocks.length).toBeGreaterThan(0);
    for (const body of blocks) {
      expect(body).not.toMatch(/text-wrap(-style)?\s*:\s*(balance|pretty)/);
    }
  });
});
