/**
 * What a shared reading looks like before anyone opens it.
 *
 * A link pasted into a chat is unfurled by a crawler that never runs the page's
 * JavaScript, so the preview (title, one line, one card) is written into the
 * HTML by the Worker. Every share page also says noindex: a link is handed to
 * the people it was handed to, not to search engines.
 *
 * The preview carries the same things the page does, minus one. The original
 * question never goes into it, not even when the user chose to show it on the
 * page: a preview is pasted into rooms the user may not be looking at.
 */

import { SITE_NAME, copyFor } from '../../shared/tarot/i18n';
import { cardArt } from '../../shared/tarot/deck';
import { spreadFor } from '../../shared/tarot/spreads';
import type { ShareSnapshot } from '../../shared/tarot/types';

export const SHARE_ROBOTS = 'noindex, nofollow';

/** Chat apps cut a description at roughly this length anyway. */
const DESCRIPTION_MAX = 160;

export interface SharePreview {
  title: string;
  description: string | null;
  /** Absolute URL of the first card's face, or null for a missing share. */
  image: string | null;
  url: string;
  locale: 'zh_CN' | 'en_US';
}

const escapeAttribute = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const clip = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > DESCRIPTION_MAX ? `${flat.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…` : flat;
};

/**
 * The preview for one share page. `absolute` turns an in-app path into a full
 * URL on the address the visitor used (publicUrl in the Worker).
 */
export function sharePreview(
  snapshot: ShareSnapshot | null,
  pageUrl: string,
  absolute: (path: string) => string,
): SharePreview {
  if (!snapshot) {
    return { title: SITE_NAME, description: null, image: null, url: pageUrl, locale: 'zh_CN' };
  }
  const spread = spreadFor(snapshot.spreadId, snapshot.locale);
  const first = snapshot.cards[0];
  return {
    title: `${spread.title} · ${copyFor(snapshot.locale).share.viewTitle} · ${SITE_NAME}`,
    description: snapshot.conclusion.trim() ? clip(snapshot.conclusion) : null,
    image: first ? absolute(cardArt(first.cardId)) : null,
    url: pageUrl,
    locale: snapshot.locale === 'en' ? 'en_US' : 'zh_CN',
  };
}

/** The tags that go at the end of `<head>`, escaped for an attribute each. */
export function sharePreviewHead(preview: SharePreview): string {
  const tags: [string, string, string][] = [
    ['name', 'robots', SHARE_ROBOTS],
    ['property', 'og:type', 'article'],
    ['property', 'og:site_name', SITE_NAME],
    ['property', 'og:title', preview.title],
    ['property', 'og:url', preview.url],
    ['property', 'og:locale', preview.locale],
    // A card is tall; the large card would crop it to a strip.
    ['name', 'twitter:card', 'summary'],
    ['name', 'twitter:title', preview.title],
  ];
  if (preview.description) {
    tags.push(['property', 'og:description', preview.description]);
    tags.push(['name', 'twitter:description', preview.description]);
  }
  if (preview.image) {
    tags.push(['property', 'og:image', preview.image]);
    tags.push(['property', 'og:image:type', 'image/webp']);
    tags.push(['name', 'twitter:image', preview.image]);
  }
  return tags
    .map(([key, name, content]) => `<meta ${key}="${name}" content="${escapeAttribute(content)}">`)
    .join('\n');
}

/**
 * Writes the preview into a share page: the tags, the `<title>` (setInnerContent
 * escapes it) and a matching X-Robots-Tag header. Anything that is not a 200
 * HTML document is left alone except for the header.
 */
export function withSharePreview(response: Response, preview: SharePreview): Response {
  const headed = new Response(response.body, response);
  headed.headers.set('x-robots-tag', SHARE_ROBOTS);
  const isPage =
    response.status === 200 &&
    (response.headers.get('content-type') ?? '').toLowerCase().includes('text/html');
  if (!isPage) return headed;

  return new HTMLRewriter()
    .on('title', {
      element(element) {
        element.setInnerContent(preview.title);
      },
    })
    .on('head', {
      element(element) {
        element.append(`\n${sharePreviewHead(preview)}\n`, { html: true });
      },
    })
    .transform(headed);
}
