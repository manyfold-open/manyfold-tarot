/**
 * The link preview of a shared reading, and its noindex.
 *
 * HTMLRewriter is a workerd global, so what is tested here is everything
 * decided before it runs: which tags, with what in them, escaped how — and the
 * one thing a preview must never carry, the question.
 */

import { describe, expect, it } from 'vitest';
import type { ShareSnapshot } from '../src/shared/tarot/types';
import {
  SHARE_ROBOTS,
  sharePreview,
  sharePreviewHead,
  withSharePreview,
} from '../src/worker/tarot/sharemeta';

const PAGE = 'https://app.manyfold.ai/tarot/s/tok123';
const absolute = (path: string) => `https://app.manyfold.ai/tarot${path}`;

const snapshot = (overrides: Partial<ShareSnapshot> = {}): ShareSnapshot => ({
  token: 'tok123',
  readingId: 'r1',
  spreadId: 'decision',
  locale: 'zh',
  question: '我该不该接受新公司的 offer？',
  cards: [
    { slot: 'situation', cardId: 'major-00', reversed: false },
    { slot: 'hidden', cardId: 'cups-03', reversed: true },
    { slot: 'guidance', cardId: 'swords-14', reversed: false },
  ],
  conclusion: '先把两边的代价写下来，再决定。',
  signature: 'AI Tarot',
  createdAt: '2026-09-29T00:00:00.000Z',
  mode: 'full',
  ...overrides,
});

describe('sharePreview', () => {
  it('titles the page by its spread, describes it by its conclusion, and shows the first card', () => {
    const preview = sharePreview(snapshot(), PAGE, absolute);
    expect(preview.title).toBe('做一个决定 · 一次塔罗解读 · AI Tarot');
    expect(preview.description).toBe('先把两边的代价写下来，再决定。');
    expect(preview.image).toBe('https://app.manyfold.ai/tarot/cards/major-00.webp');
    expect(preview.url).toBe(PAGE);
    expect(preview.locale).toBe('zh_CN');
  });

  it('never carries the question, even when the page shows it', () => {
    const head = sharePreviewHead(sharePreview(snapshot(), PAGE, absolute));
    expect(head).not.toContain('offer');
    expect(head).not.toContain('新公司');
  });

  it('speaks English for an English reading', () => {
    const preview = sharePreview(
      snapshot({ locale: 'en', spreadId: 'weekly-review', conclusion: 'Make room for rest.' }),
      PAGE,
      absolute,
    );
    expect(preview.title).toBe('Weekly review · A tarot reading · AI Tarot');
    expect(preview.locale).toBe('en_US');
  });

  it('clips a long conclusion to one preview line', () => {
    const preview = sharePreview(snapshot({ conclusion: '长'.repeat(400) }), PAGE, absolute);
    expect(preview.description!.length).toBeLessThanOrEqual(160);
    expect(preview.description!.endsWith('…')).toBe(true);
  });

  it('falls back to the site name for a share that does not exist', () => {
    const preview = sharePreview(null, PAGE, absolute);
    expect(preview).toMatchObject({ title: 'AI Tarot', description: null, image: null });
    const head = sharePreviewHead(preview);
    expect(head).toContain(`<meta name="robots" content="${SHARE_ROBOTS}">`);
    expect(head).not.toContain('og:image');
    expect(head).not.toContain('og:description');
  });
});

describe('sharePreviewHead', () => {
  it('writes noindex and the Open Graph tags', () => {
    const head = sharePreviewHead(sharePreview(snapshot(), PAGE, absolute));
    expect(head).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(head).toContain('<meta property="og:title" content="做一个决定 · 一次塔罗解读 · AI Tarot">');
    expect(head).toContain('<meta property="og:image" content="https://app.manyfold.ai/tarot/cards/major-00.webp">');
    expect(head).toContain(`<meta property="og:url" content="${PAGE}">`);
    expect(head).toContain('<meta name="twitter:card" content="summary">');
  });

  it('escapes what the reader wrote, so a conclusion cannot open a tag', () => {
    const head = sharePreviewHead(
      sharePreview(snapshot({ conclusion: '"><script>alert(1)</script> & \'x\'' }), PAGE, absolute),
    );
    expect(head).not.toContain('<script>');
    expect(head).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; &amp; &#39;x&#39;');
  });
});

describe('withSharePreview', () => {
  it('says noindex in the header even when there is no page to rewrite', () => {
    const response = withSharePreview(
      new Response('gone', { status: 404, headers: { 'content-type': 'text/plain' } }),
      sharePreview(null, PAGE, absolute),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('x-robots-tag')).toBe(SHARE_ROBOTS);
  });
});
