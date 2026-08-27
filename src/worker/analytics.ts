/**
 * Google Analytics 4, injected into the page instead of built into it.
 *
 * The tag is written into `<head>` by the Worker rather than committed to
 * index.html, for the same reason the D1 id is a binding rather than a constant:
 * a measurement id belongs to one deployment. This is a public template, and a
 * fork that quietly reported to somebody else's property would be a bug nobody
 * could see. Unset `GA_MEASUREMENT_ID` and not one byte of Google is served —
 * that is the default, and it is what a fresh clone does.
 *
 * Two things this file is careful about.
 *
 * **Consent comes before the tag, not after it.** The consent defaults are
 * pushed onto dataLayer in an inline script that runs before gtag.js has even
 * been fetched, because a default that arrives after the first hit is not a
 * default. In the EEA, the UK and Switzerland everything starts `denied`;
 * everywhere else it starts `granted`. That split is Google's own `region`
 * parameter rather than anything this Worker decides, which matters: the HTML is
 * then identical for every visitor and stays cacheable, and the correctness of
 * the consent state never depends on a geo lookup being right.
 *
 * What the Worker *does* decide is whether to put a banner on screen, and that
 * rides on /api/tarot/reader (see consentRequiredFor) — a wrong guess there
 * shows or hides a banner, it does not leak a cookie.
 *
 * **The id is validated before it is interpolated.** It comes from a var an
 * operator sets, which is not a stranger, but it lands inside a `<script>` and
 * the rule for that position is the same either way: match the documented shape
 * or be dropped.
 */

/**
 * Where a visitor has to opt in before anything is stored: the EEA (EU 27 plus
 * Iceland, Liechtenstein and Norway), the UK, and Switzerland.
 *
 * The same list Google publishes for Consent Mode. It is deliberately a little
 * wider than the letter of the law — Switzerland's FADP is not the GDPR — since
 * the cost of asking someone who did not have to be asked is one click, and the
 * cost of the reverse is the kind of thing that ends an ad account.
 */
export const CONSENT_REGIONS = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'IS', 'LI', 'NO',
  'GB', 'CH',
] as const;

/** GA4 measurement ids look like `G-XXXXXXXXXX`, and nothing else goes in. */
const MEASUREMENT_ID = /^G-[A-Z0-9]{4,24}$/;

export const isMeasurementId = (value: string | undefined | null): value is string =>
  typeof value === 'string' && MEASUREMENT_ID.test(value.trim().toUpperCase());

/** The id this deployment measures with, or null if it measures nothing. */
export const measurementIdFor = (env: { GA_MEASUREMENT_ID?: string }): string | null => {
  const raw = env.GA_MEASUREMENT_ID?.trim().toUpperCase();
  return isMeasurementId(raw) ? raw : null;
};

/**
 * Whether this visitor is owed a banner before anything is stored.
 *
 * Unknown country means yes. `request.cf` is absent in tests and on a local
 * `wrangler dev`, and the safe way to be wrong is to ask someone who did not
 * need asking.
 */
export const consentRequiredFor = (country: string | null | undefined): boolean => {
  if (!country) return true;
  return (CONSENT_REGIONS as readonly string[]).includes(country.trim().toUpperCase());
};

/** The console is the operator's own room. It is not measured. */
export const isMeasuredPath = (pathname: string): boolean =>
  !pathname.startsWith('/settings') && !pathname.startsWith('/console');

/** Where the visitor's own choice is kept. Read by the tag before its first hit,
 *  written by the banner. Storing a consent decision needs no consent. */
export const CONSENT_KEY = 'taro.consent';

const GRANTED = "{'ad_storage':'granted','ad_user_data':'granted','ad_personalization':'granted','analytics_storage':'granted'}";
const DENIED = "{'ad_storage':'denied','ad_user_data':'denied','ad_personalization':'denied','analytics_storage':'denied'}";

/**
 * The two script tags that go into `<head>`, in this order:
 *
 *   1. an inline block — consent defaults, then the visitor's stored choice if
 *      they have one, then `config`;
 *   2. gtag.js itself, async.
 *
 * The inline block runs first and synchronously, so by the time the library
 * loads, dataLayer already says what it is allowed to do.
 */
export function analyticsHead(measurementId: string): string {
  const id = measurementId.toUpperCase();
  const regions = CONSENT_REGIONS.map((code) => `'${code}'`).join(',');

  const inline = [
    "window.dataLayer=window.dataLayer||[];",
    "function gtag(){dataLayer.push(arguments);}",
    // Ask first in the regions that require asking. Google resolves the more
    // specific region entry over the catch-all below, whatever the order.
    `gtag('consent','default',{'ad_storage':'denied','ad_user_data':'denied','ad_personalization':'denied','analytics_storage':'denied','functionality_storage':'granted','security_storage':'granted','wait_for_update':500,'region':[${regions}]});`,
    "gtag('consent','default',{'ad_storage':'granted','ad_user_data':'granted','ad_personalization':'granted','analytics_storage':'granted','functionality_storage':'granted','security_storage':'granted'});",
    // A choice already made outranks both defaults, and has to be replayed
    // before `config` fires the first page_view — otherwise a visitor who
    // accepted last week is measured cookielessly until they click again.
    `try{var c=localStorage.getItem('${CONSENT_KEY}');if(c==='granted')gtag('consent','update',${GRANTED});else if(c==='denied')gtag('consent','update',${DENIED});}catch(e){}`,
    "gtag('js',new Date());",
    `gtag('config','${id}');`,
  ].join('\n');

  return (
    `\n<!-- Google tag (gtag.js) — injected by the Worker, see src/worker/analytics.ts -->\n` +
    `<script>\n${inline}\n</script>\n` +
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>\n`
  );
}

export interface InjectionContext {
  measurementId: string | null;
  pathname: string;
  method: string;
}

/**
 * Whether this particular response is a page that gets a tag.
 *
 * Split out from the rewrite below so it can be tested in Node: HTMLRewriter is
 * a workerd global and does not exist under vitest, but every decision worth
 * getting right is in here rather than in it.
 *
 * Everything that is not a 200 HTML document — every card image, every hashed
 * bundle, every redirect, every 404 — is left exactly as the assets binding
 * produced it.
 */
export function shouldInject(response: Response, context: InjectionContext): boolean {
  const { measurementId, pathname, method } = context;
  if (!measurementId) return false;
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (response.status !== 200) return false;
  if (!isMeasuredPath(pathname)) return false;
  return (response.headers.get('content-type') ?? '').toLowerCase().includes('text/html');
}

/** Puts the tag in the page, if there is a tag and this is a page. */
export function withAnalytics(response: Response, context: InjectionContext): Response {
  if (!shouldInject(response, context)) return response;

  return new HTMLRewriter()
    .on('head', {
      element(element) {
        element.append(analyticsHead(context.measurementId as string), { html: true });
      },
    })
    .transform(response);
}
