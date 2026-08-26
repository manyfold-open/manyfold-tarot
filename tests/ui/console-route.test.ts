/**
 * The console's front door.
 *
 * Worth a test rather than a glance, because both ways this can break are
 * silent. Widen the match and a visitor who mistypes something lands on an
 * operator page instead of the reading — the tarot site is the fallback for
 * every unknown path, so there is no 404 to warn anyone. Narrow it and the only
 * route to the connect flow is gone, on a site that deliberately links to it
 * from nowhere; nobody notices until an agent needs reconnecting.
 *
 * Under tests/ui because that is the half of the test tree tsconfig lets reach
 * into src/app, not because it renders anything — route.ts is pure, so this runs
 * in node with no DOM.
 */

import { describe, expect, it } from 'vitest';
import { isConsolePath, isSharePath, tabFor } from '../../src/app/route';

describe('isConsolePath', () => {
  it('opens the console at /settings', () => {
    expect(isConsolePath('/settings')).toBe(true);
    expect(isConsolePath('/settings/')).toBe(true);
  });

  it('still answers to the older /console', () => {
    expect(isConsolePath('/console')).toBe(true);
    expect(isConsolePath('/console/')).toBe(true);
  });

  it('leaves the reading, shares and near-misses to the tarot site', () => {
    for (const path of ['/', '/s/abc', '/settingsomething', '/consoles', '/cards/back.webp']) {
      expect(isConsolePath(path), path).toBe(false);
    }
  });
});

describe('isSharePath', () => {
  it('claims /s/:token and nothing else', () => {
    expect(isSharePath('/s/abc')).toBe(true);
    expect(isSharePath('/settings')).toBe(false);
  });
});

describe('tabFor', () => {
  it('lands on Settings when the path is the one that was typed', () => {
    expect(tabFor('/settings', '')).toBe('settings');
    expect(tabFor('/console', '')).toBe('chat');
  });

  it('lets an explicit hash overrule the path', () => {
    expect(tabFor('/settings', '#chat')).toBe('chat');
    expect(tabFor('/console', '#settings')).toBe('settings');
  });
});
