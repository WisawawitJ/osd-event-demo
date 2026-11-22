// Settings for tests and rehearsals (speed, start time, a stop to open on, debug hooks…). They never come from the
// address bar: the booth just opens the page. The test driver sets `window.__demoOptions` before the page loads
// (test/browser.mjs turns a check's `?name=value` into it). Values are strings, as they were in the address.
export const options = globalThis.__demoOptions ?? {};
