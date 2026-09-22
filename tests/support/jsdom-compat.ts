// Node 22+ exposes a global localStorage getter that is unavailable unless the
// process is started with --localstorage-file. UI tests should use jsdom's
// origin-backed storage instead.
const browser = (globalThis as { window?: { localStorage?: unknown } }).window;
if (browser?.localStorage) {
  try {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: browser.localStorage,
    });
  } catch {
    // Non-browser test environments do not have storage to install.
  }
}
