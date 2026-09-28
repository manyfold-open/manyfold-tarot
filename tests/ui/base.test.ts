// @vitest-environment jsdom
/**
 * Where the page thinks it is mounted.
 *
 * The Worker writes <meta name="app-base"> only under app.manyfold.ai/tarot;
 * everywhere else there is no meta and the site is at the root. base.ts reads it
 * once, at import, so each case here loads a fresh copy after arranging the head.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

async function load(meta: string | null) {
  document.head.innerHTML = meta === null ? '' : `<meta name="app-base" content="${meta}">`;
  vi.resetModules();
  return import('../../src/app/base');
}

afterEach(() => {
  document.head.innerHTML = '';
});

describe('at the root', () => {
  it('has no base, and paths pass through as they are', async () => {
    const { BASE, appUrl, appPath } = await load(null);
    expect(BASE).toBe('');
    expect(appUrl('/api/tarot/reader')).toBe('/api/tarot/reader');
    expect(appPath('/s/abc')).toBe('/s/abc');
    expect(appPath('/')).toBe('/');
  });
});

describe('under app.manyfold.ai/tarot', () => {
  it('asks for everything under the mount', async () => {
    const { BASE, appUrl } = await load('/tarot');
    expect(BASE).toBe('/tarot');
    expect(appUrl('/api/tarot/reader')).toBe('/tarot/api/tarot/reader');
    expect(appUrl('/privacy')).toBe('/tarot/privacy');
    expect(appUrl('/')).toBe('/tarot/');
  });

  it('routes on the path with the mount taken off', async () => {
    const { appPath } = await load('/tarot');
    expect(appPath('/tarot/')).toBe('/');
    expect(appPath('/tarot')).toBe('/');
    expect(appPath('/tarot/s/abc')).toBe('/s/abc');
    expect(appPath('/tarot/privacy')).toBe('/privacy');
    expect(appPath('/tarot/settings')).toBe('/settings');
  });
});
