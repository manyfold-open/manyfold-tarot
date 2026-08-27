/**
 * Entry point and the whole router.
 *
 *   /          the reading — this is the product, and it is the first paint
 *   /s/:token  one shared reading, frozen
 *   /privacy   what is kept and who else sees it, and where the consent banner
 *              points; also the only place a stored answer can be changed
 *   /settings  the operator console that ships with the starter: connect a
 *              Manyfold agent, verify it, chat with it. Reachable only by typing
 *              the URL — nothing on the site links to it, by design.
 *   /console   the same console, under the name it moved to when the tarot site
 *              took /. Kept so older links still land.
 *
 * Path-based rather than hash-based because a share link has to look like a
 * link; the Worker serves index.html for unknown paths (single-page-application
 * asset handling in wrangler.jsonc), so these resolve on a cold load too.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { isConsolePath, isPrivacyPath, isSharePath } from './route';
import PrivacyPage from './tarot/PrivacyPage';
import SharePage from './tarot/SharePage';
import TarotApp from './tarot/TarotApp';
import './styles.css';
import './tarot/tarot.css';

const path = location.pathname;
const isConsole = isConsolePath(path);
const isShare = isSharePath(path);
const isPrivacy = isPrivacyPath(path);

// Lets the tarot stylesheet own the page background without touching the
// console's own :root theme.
if (!isConsole) document.documentElement.dataset.app = 'taro';

const page = isConsole ? (
  <App />
) : isPrivacy ? (
  <PrivacyPage />
) : isShare ? (
  <SharePage />
) : (
  <TarotApp />
);

createRoot(document.getElementById('root')!).render(<StrictMode>{page}</StrictMode>);
