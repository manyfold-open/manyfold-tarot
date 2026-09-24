import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  plugins: [react(), cloudflare()],
  experimental: {
    // URLs inside the stylesheet (the card back) are written relative to the
    // stylesheet itself, so they resolve under app.manyfold.ai/tarot/assets/ as
    // well as /assets/. The HTML keeps root paths — the Worker prefixes those
    // when the page is served under the mount (src/worker/mount.ts).
    renderBuiltUrl: (_filename, { hostType }) => (hostType === 'css' ? { relative: true } : undefined),
  },
});
