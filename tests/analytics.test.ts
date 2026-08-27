/**
 * The Google tag: who gets it, what it says before it says anything else, and
 * the several ways it is not supposed to appear.
 *
 * The interesting assertions here are the negative ones. A measurement id that
 * is not a measurement id must never reach a `<script>`; a card image must never
 * be rewritten; the operator's own console must not be measured at all; and a
 * deployment that set no id — which is every fork, and every checkout of this
 * repo — must serve nothing from Google whatsoever.
 */

import { describe, expect, it } from 'vitest';
import {
  CONSENT_REGIONS,
  analyticsHead,
  consentRequiredFor,
  isMeasurementId,
  isMeasuredPath,
  measurementIdFor,
  shouldInject,
  type InjectionContext,
} from '../src/worker/analytics';
import type { Env } from '../src/worker/types';

/** A made-up id in the shape Google issues. Deliberately not any deployment's
 *  own: nothing about this file should depend on who is measuring. */
const ID = 'G-TESTID0000';
const html = (body = '<html><head><title>t</title></head><body></body></html>') =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

/** The decision, which is all of the logic. The rewrite it guards is one call to
 *  a workerd global that Node does not have; it is checked against the live
 *  deployment instead (`curl -s <url> | grep gtag`). */
const injects = (response: Response, context: Partial<InjectionContext> = {}): boolean =>
  shouldInject(response, { measurementId: ID, pathname: '/', method: 'GET', ...context });

describe('the measurement id', () => {
  it('accepts the shape Google issues and nothing else', () => {
    expect(isMeasurementId('G-TESTID0000')).toBe(true);
    expect(isMeasurementId('G-ABCD1234')).toBe(true);
    expect(isMeasurementId('')).toBe(false);
    expect(isMeasurementId(undefined)).toBe(false);
    expect(isMeasurementId('UA-12345-1')).toBe(false);
    expect(isMeasurementId('AW-123456')).toBe(false);
    // The reason the check exists: this value is interpolated into a script.
    expect(isMeasurementId("G-X'});</script><script>alert(1)//")).toBe(false);
    expect(isMeasurementId('G-')).toBe(false);
  });

  it('reads it off the env, trimmed, or reports that there is none', () => {
    expect(measurementIdFor({ GA_MEASUREMENT_ID: ' g-testid0000 ' })).toBe(ID);
    expect(measurementIdFor({})).toBeNull();
    expect(measurementIdFor({ GA_MEASUREMENT_ID: '' })).toBeNull();
    expect(measurementIdFor({ GA_MEASUREMENT_ID: 'nope' })).toBeNull();
    // The var is declared on Env, so this is the same call the Worker makes.
    expect(measurementIdFor({ GA_MEASUREMENT_ID: ID } as Env)).toBe(ID);
  });
});

describe('who is asked', () => {
  it('asks across the EEA, the UK and Switzerland', () => {
    for (const country of ['DE', 'FR', 'IE', 'GB', 'CH', 'NO', 'IS', 'LI']) {
      expect(consentRequiredFor(country)).toBe(true);
    }
    expect(CONSENT_REGIONS).toHaveLength(new Set(CONSENT_REGIONS).size);
  });

  it('does not ask where it does not have to', () => {
    for (const country of ['US', 'CN', 'SG', 'JP', 'BR', 'AU']) {
      expect(consentRequiredFor(country)).toBe(false);
    }
    expect(consentRequiredFor('us')).toBe(false);
  });

  it('asks when it cannot tell', () => {
    // No cf-ipcountry header: local dev, a test, an odd proxy. Asking someone
    // who did not need asking is the cheap way to be wrong.
    expect(consentRequiredFor(undefined)).toBe(true);
    expect(consentRequiredFor(null)).toBe(true);
    expect(consentRequiredFor('')).toBe(true);
  });

  it('leaves the operator console unmeasured', () => {
    expect(isMeasuredPath('/')).toBe(true);
    expect(isMeasuredPath('/s/abc')).toBe(true);
    expect(isMeasuredPath('/privacy')).toBe(true);
    expect(isMeasuredPath('/settings')).toBe(false);
    expect(isMeasuredPath('/console')).toBe(false);
    expect(isMeasuredPath('/settings#chat')).toBe(false);
  });
});

describe('the tag itself', () => {
  const head = analyticsHead(ID);

  it('denies everything in the consent regions, and says so before it loads', () => {
    const defaults = head.indexOf("gtag('consent','default'");
    const library = head.indexOf('googletagmanager.com/gtag/js');
    const config = head.indexOf("gtag('config'");
    expect(defaults).toBeGreaterThan(-1);
    // Consent is declared before the library is even asked for, and before the
    // first hit. A default that arrives after the hit is not a default.
    expect(defaults).toBeLessThan(config);
    expect(config).toBeLessThan(library);
    expect(head).toContain("'ad_storage':'denied'");
    expect(head).toContain("'ad_user_data':'denied'");
    expect(head).toContain("'ad_personalization':'denied'");
    expect(head).toContain("'analytics_storage':'denied'");
    for (const country of CONSENT_REGIONS) expect(head).toContain(`'${country}'`);
  });

  it('grants elsewhere, in a second default with no region', () => {
    const granted = head.slice(head.indexOf("'region'"));
    expect(granted).toContain("'ad_storage':'granted'");
  });

  it('replays a stored answer ahead of the first hit', () => {
    expect(head).toContain('taro.consent');
    expect(head.indexOf('taro.consent')).toBeLessThan(head.indexOf("gtag('config'"));
  });

  it('carries the id in both places, and nothing else', () => {
    expect(head).toContain(`gtag('config','${ID}')`);
    expect(head).toContain(`gtag/js?id=${ID}`);
  });
});

describe('injection', () => {
  it('tags an HTML page', () => {
    expect(injects(html())).toBe(true);
    expect(injects(html(), { pathname: '/s/abc' })).toBe(true);
    expect(injects(html(), { pathname: '/privacy' })).toBe(true);
  });

  it('serves nothing at all when no id is configured', () => {
    expect(injects(html(), { measurementId: null })).toBe(false);
  });

  it('leaves everything that is not an HTML page exactly as it was', () => {
    expect(injects(new Response('binary', { status: 200, headers: { 'content-type': 'image/webp' } }))).toBe(false);
    expect(
      injects(new Response('{"a":1}', { status: 200, headers: { 'content-type': 'application/json' } })),
    ).toBe(false);
    // The e2e suite's assets stub answers with a bare body and no type at all.
    expect(injects(new Response('asset', { status: 200 }))).toBe(false);
  });

  it('leaves a 404 alone', () => {
    expect(injects(new Response('<html><head></head></html>', {
      status: 404,
      headers: { 'content-type': 'text/html' },
    }))).toBe(false);
  });

  it('does not measure the console', () => {
    expect(injects(html(), { pathname: '/settings' })).toBe(false);
    expect(injects(html(), { pathname: '/console' })).toBe(false);
  });

  it('does not rewrite a mutation', () => {
    expect(injects(html(), { method: 'POST' })).toBe(false);
  });
});
