# Hackbar panel e2e tests

Runs the real, unmodified `panel/panel.html` + `panel.js` + `waiting.js` in Chromium
via Playwright, with the WebExtension `browser.*` namespace mocked (`mock-browser.js`)
since Chromium has no such global at all - only Firefox does, and this extension
uses no polyfill. `panel.html` is served as-is by a local static server; `Execute`
requests hit a local echo server (`echo-server.js`) so the real `fetch()` +
response-rendering code runs for real.

## Running

```sh
npm install
npx playwright install chromium   # skip if Chromium is already available; see below
npm test
```

If a Chromium binary is already available at a fixed path (e.g. a CI image that
doesn't want another download), point at it instead of installing one:

```sh
CHROMIUM_PATH=/path/to/chrome npm test
```

## What this proves, and what it doesn't

This catches real DOM/logic regressions - it isn't just smoke-testing that the page
loads. It found and helped fix a real bug during development (Split Url building a
malformed URL when the source had a `#fragment`) and confirmed a Clear Saved Data
test failure was a Playwright click-targeting quirk in the test itself, not a bug in
`waiting.js` (see the comment above that step in `e2e.js`).

What it cannot prove, because these are genuine Firefox/WebExtension-runtime
privileges no page-level JS mock can fake:

- Whether `browser.permissions.request()` still counts as "within the user gesture"
  after the async `.contains()` check ahead of it, in real Firefox.
- Whether `browser.webRequest.onBeforeSendHeaders` actually intercepts a `fetch()`
  fired from a real devtools panel page and rewrites the Cookie/Referer headers that
  reach the wire.
- Anything about the extension embedded inside the actual DevTools UI chrome (this
  loads `panel.html` as a plain page instead).

Those need a manual pass in real Firefox - see the checklist in the project's PR/
commit history (or ask for it again) for the manual steps.
