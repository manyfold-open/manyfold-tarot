/** Paths for the Tarot app when it is mounted on the shared app.manyfold.ai host. */
export const TAROT_MOUNT_PATH = '/tarot';

const isMountedPath = (path: string): boolean =>
  path === TAROT_MOUNT_PATH || path.startsWith(`${TAROT_MOUNT_PATH}/`);

/** Remove the deployment prefix before matching the app's own page routes. */
export const appPath = (path: string): string =>
  isMountedPath(path) ? path.slice(TAROT_MOUNT_PATH.length) || '/' : path;

/** Prefix internal links and requests only when the browser is inside the mount. */
export const appUrl = (path: string): string => {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${isMountedPath(location.pathname) ? TAROT_MOUNT_PATH : ''}${normalized}`;
};

/** Public files need the same mount prefix as app routes. */
export const appAssetUrl = (path: string): string => appUrl(path);
