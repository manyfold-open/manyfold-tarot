/**
 * @vitest-environment jsdom
 *
 * Typing the URL is the whole entrance.
 *
 * route.ts is unit-tested next door, but what an operator actually needs is
 * cruder than a predicate: they type /settings, and the page in front of them is
 * the one with the connect flow on it. So this drives the real shell and looks
 * for the connect flow by name. (Which app main.tsx mounts for that path is the
 * other half, and it is the predicate test that covers it — main.tsx boots a
 * React root on import and cannot be asked.)
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState } from '../../src/shared/types';
import App from '../../src/app/App';

/** An unlocked deployment, which is what the tab assertions are about. */
const open: AppState = {
  service: 'manyfold-tarot',
  adminRequired: true,
  adminOk: true,
  adminConfigured: true,
  connect: { session: null },
  agents: [],
};

/** Exactly what the Worker sends a browser that has not given the password. */
const locked: AppState = { ...open, adminOk: false };

/** And what it sends when there is no password to give. */
const unconfigured: AppState = { ...locked, adminConfigured: false };

let state: AppState = open;

const at = async (url: string) => {
  history.replaceState(null, '', url);
  render(<App />);
  // The shell paints "Loading…" until /api/state lands.
  await screen.findByRole('navigation', { name: 'Pages' });
};

const activeTab = (): string | null =>
  document.querySelector('.tab.active')?.textContent?.trim() ?? null;

beforeEach(() => {
  state = open;
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(state), {
    headers: { 'content-type': 'application/json' },
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the operator console', () => {
  it('opens on Settings when reached at /settings', async () => {
    await at('/settings');

    expect(activeTab()).toBe('Settings');
    expect(await screen.findByText('Connected agents')).toBeTruthy();
  });

  it('opens where it always did at /console', async () => {
    await at('/console');

    expect(activeTab()).toBe('Chat');
  });

  it('honours a hash the visitor clicked, whichever path they came in on', async () => {
    await at('/settings#chat');

    expect(activeTab()).toBe('Chat');
  });
});

describe('when the deployment is locked', () => {
  const lockedAt = async (url: string) => {
    state = locked;
    history.replaceState(null, '', url);
    render(<App />);
    await screen.findByLabelText('Admin password');
  };

  it('asks for the password and shows no console behind it', async () => {
    await lockedAt('/settings');

    // Not "renders the gate on top of the console" — there is no console. The
    // tabs are the cheapest proof: if they are in the document, so is whatever
    // the active one rendered.
    expect(document.querySelector('.tabs')).toBeNull();
    expect(screen.queryByText('Connected agents')).toBeNull();
  });

  it('points the visitor who only wanted a reading back at one', async () => {
    await lockedAt('/settings');

    expect(screen.getByRole('link', { name: 'the front page' }).getAttribute('href')).toBe('/');
  });
});

describe('when the deployment never set a password', () => {
  it('gives the operator the fix instead of an input that cannot work', async () => {
    // The fork case. Offering a password box here is a puzzle with no solution:
    // nothing the visitor types can match, because there is nothing to match.
    state = unconfigured;
    history.replaceState(null, '', '/settings');
    render(<App />);

    await screen.findByText('This deployment has no admin password');
    expect(screen.queryByLabelText('Admin password')).toBeNull();
    expect(screen.getAllByText('ADMIN_PASSWORD').length).toBeGreaterThan(0);
    expect(document.querySelector('.tabs')).toBeNull();
  });
});
