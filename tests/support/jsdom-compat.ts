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

// jsdom has no layout, so it cannot scroll: its scrollTo only prints "not
// implemented". The page scrolls between stages; nothing here asserts on it.
const scrolling = (globalThis as { window?: { scrollTo?: unknown } }).window;
if (scrolling && typeof scrolling.scrollTo === 'function') {
  Object.defineProperty(scrolling, 'scrollTo', { configurable: true, writable: true, value: () => undefined });
}
