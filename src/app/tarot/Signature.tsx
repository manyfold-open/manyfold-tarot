/**
 * The mark at the foot of the page.
 *
 * Two lines, and their order is the whole argument: who built this, and then
 * that you can have it. The first is a brand and reads as one — a wordmark, set
 * at the size and the brightness the rest of the page's chrome already uses. The
 * second is a sentence, because "open source" is a claim about the code and a
 * claim needs words.
 *
 * What stood here before was a signature: the words "AI 塔罗" at --ink-4, a hair
 * over invisible, and that was right for what it was. Decoration may whisper. A
 * door may not — both of these lines are ways out of the page, and a way out
 * that cannot be seen is not one. So both rest at --ink-2, the ink the language
 * switch and the quiet links are already on, and the hierarchy between them is
 * carried by size and by the weight of a drawn shape against tracked-out text,
 * never by dimming one below the point where it can be read.
 */

import type { Locale } from '../../shared/tarot/deck';
import { copyFor } from '../../shared/tarot/i18n';

type From = 'footer' | 'share';

/**
 * Where the wordmark goes. The tag says which surface sent the visitor: someone
 * who reached the app's own footer came here on purpose, and someone reading a
 * shared spread was handed the link by a friend. They are different audiences
 * arriving for different reasons, and they are worth counting apart.
 */
const manyfoldUrl = (from: From): string =>
  `https://manyfold.ai/?utm_source=tarot&utm_medium=${from}`;

/**
 * The open-source repository, and it is the org one on purpose. Development
 * happens in a personal fork, so the obvious URL to paste here is the fork's —
 * but this link is the page making a public claim about itself, and it should
 * land on the repo that is actually published: the one the README's deploy
 * button copies, the one issues belong in, the one that outlives any one
 * account. The bare repo URL rather than /tree/main, which is the same page
 * with a branch name that will read as stale the day the default branch moves.
 */
const sourceUrl = 'https://github.com/manyfold-open/manyfold-tarot';

/**
 * The Manyfold lockup, dark-mode variant, inline rather than an `<img>` for two
 * reasons: it is on every screen the site has, so a second request for it is a
 * request too many; and it has to dim and lift with the link around it, which an
 * image can be made to do only by fighting it with filters.
 *
 * Its two inks are left exactly as they were shipped. Folding them into
 * currentColor would flatten four folds into one grey shape, and the alternation
 * *is* the mark — so brightness is carried by opacity instead, which holds the
 * ratio between the two inks and moves both at once.
 *
 * Hidden from the accessibility tree: the anchor around it is already named, and
 * a mark that announced itself a second time would read as two links.
 */
function Mark() {
  return (
    <svg
      className="taro-by-mark"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 118.789 19.4"
      width="118.789"
      height="19.4"
      aria-hidden="true"
      focusable="false"
    >
      <polygon points="0,18.2 7,0 10.5,0 3.5,18.2" fill="#e4e7ec" />
      <polygon points="7,0 14,18.2 10.5,0 17.5,18.2" fill="#b9bec6" />
      <polygon points="14,18.2 21,0 17.5,18.2 24.5,0" fill="#e4e7ec" />
      <polygon points="21,0 28,18.2 24.5,0 31.5,18.2" fill="#b9bec6" />
      <path
        d="M40.63 16.55L40.63 3.06L43.44 3.06L47.46 14.14L51.46 3.06L54.27 3.06L54.27 16.55L52.22 16.55L52.22 6.67L48.59 16.54L46.31 16.54L42.69 6.67L42.69 16.55ZM59.68 16.78Q58.11 16.78 57.16 16.05Q56.22 15.33 56.22 14.03Q56.22 12.72 57.01 11.98Q57.79 11.24 59.45 10.93L62.92 10.26Q62.92 9.09 62.38 8.5Q61.83 7.92 60.75 7.92Q59.79 7.92 59.23 8.35Q58.67 8.79 58.47 9.61L56.39 9.48Q56.68 7.97 57.81 7.09Q58.95 6.21 60.75 6.21Q62.8 6.21 63.87 7.3Q64.94 8.4 64.94 10.37L64.94 14.3Q64.94 14.67 65.07 14.82Q65.2 14.96 65.49 14.96L65.85 14.96L65.85 16.55Q65.75 16.58 65.54 16.59Q65.33 16.61 65.1 16.61Q64.44 16.61 63.99 16.4Q63.53 16.19 63.29 15.7Q63.06 15.22 63.06 14.41L63.27 14.5Q63.12 15.16 62.61 15.68Q62.11 16.2 61.35 16.49Q60.58 16.78 59.68 16.78ZM60.01 15.19Q60.91 15.19 61.57 14.84Q62.22 14.48 62.57 13.86Q62.92 13.23 62.92 12.43L62.92 11.78L59.98 12.35Q59.06 12.53 58.69 12.89Q58.31 13.26 58.31 13.84Q58.31 14.48 58.76 14.83Q59.21 15.19 60.01 15.19ZM67.26 16.55L67.26 6.44L69.09 6.44L69.17 9.15L68.93 9Q69.1 8.03 69.57 7.41Q70.05 6.8 70.73 6.51Q71.41 6.21 72.21 6.21Q73.35 6.21 74.11 6.72Q74.86 7.22 75.25 8.08Q75.63 8.95 75.63 10.05L75.63 16.55L73.62 16.55L73.62 10.67Q73.62 9.77 73.43 9.16Q73.23 8.55 72.8 8.23Q72.37 7.91 71.66 7.91Q70.6 7.91 69.94 8.61Q69.27 9.32 69.27 10.67L69.27 16.55ZM78.15 19.4L78.15 17.75L79.37 17.75Q79.89 17.75 80.14 17.6Q80.39 17.44 80.52 17.08L80.83 16.25L80.21 16.25L76.56 6.44L78.69 6.44L81.47 14.38L84.11 6.44L86.25 6.44L82.22 17.72Q81.91 18.6 81.32 19Q80.72 19.4 79.67 19.4ZM88.64 16.55L88.64 5.79Q88.64 4.54 89.34 3.8Q90.05 3.06 91.53 3.06L93.32 3.06L93.32 4.71L91.82 4.71Q91.23 4.71 90.94 5.02Q90.66 5.33 90.66 5.91L90.66 16.55ZM87.23 8.09L87.23 6.44L93.19 6.44L93.19 8.09ZM98.53 16.78Q97.08 16.78 96 16.13Q94.91 15.48 94.32 14.29Q93.72 13.1 93.72 11.5Q93.72 9.88 94.32 8.7Q94.91 7.52 96 6.87Q97.08 6.21 98.53 6.21Q99.97 6.21 101.05 6.87Q102.13 7.52 102.72 8.7Q103.32 9.88 103.32 11.5Q103.32 13.1 102.72 14.29Q102.13 15.48 101.05 16.13Q99.97 16.78 98.53 16.78ZM98.53 15.03Q99.81 15.03 100.51 14.1Q101.22 13.16 101.22 11.5Q101.22 9.84 100.51 8.9Q99.81 7.96 98.53 7.96Q97.25 7.96 96.53 8.9Q95.82 9.84 95.82 11.5Q95.82 13.16 96.53 14.1Q97.25 15.03 98.53 15.03ZM107.36 16.55Q106.36 16.55 105.76 16.04Q105.15 15.52 105.15 14.4L105.15 3.06L107.17 3.06L107.17 14.21Q107.17 14.56 107.35 14.73Q107.53 14.9 107.86 14.9L108.67 14.9L108.67 16.55ZM113.69 16.78Q112.38 16.78 111.43 16.13Q110.48 15.48 109.97 14.3Q109.46 13.11 109.46 11.5Q109.46 9.88 109.97 8.69Q110.48 7.51 111.44 6.86Q112.39 6.21 113.69 6.21Q114.72 6.21 115.54 6.65Q116.36 7.08 116.77 7.86L116.77 3.06L118.79 3.06L118.79 16.55L116.92 16.55L116.86 15.04Q116.44 15.85 115.59 16.32Q114.75 16.78 113.69 16.78ZM114.21 15.03Q115.04 15.03 115.61 14.61Q116.18 14.19 116.48 13.39Q116.77 12.6 116.77 11.5Q116.77 10.36 116.48 9.58Q116.18 8.79 115.61 8.37Q115.04 7.96 114.21 7.96Q112.99 7.96 112.27 8.9Q111.55 9.85 111.55 11.5Q111.55 13.12 112.27 14.08Q113 15.03 114.21 15.03Z"
        fill="#e4e7ec"
      />
    </svg>
  );
}

export default function Signature({ locale, from = 'footer' }: { locale: Locale; from?: From }) {
  const copy = copyFor(locale);

  return (
    <div className="taro-signature">
      {/* The label and the mark are one link, not a label beside one. Eighty-six
          pixels of wordmark is a small thing to hit with a thumb, and a phrase
          that introduces a name but does not go where the name goes is a piece
          of text that has to be explained. */}
      <a
        className="taro-by"
        href={manyfoldUrl(from)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={copy.footer.manyfold}
      >
        {/* Not in i18n, and this is the reason: it is part of the lockup rather
            than a sentence about it. Set against an English wordmark, in either
            language, it reads as the mark's own first two words — translated, it
            would come apart into a Chinese phrase pointing at an English name. */}
        <span className="taro-by-label">powered by</span>
        <Mark />
      </a>
      <a
        className="taro-oss"
        href={sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={copy.footer.openSourceLabel}
      >
        {copy.footer.openSource}
      </a>
    </div>
  );
}
