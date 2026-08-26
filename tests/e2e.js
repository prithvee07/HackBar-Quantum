// End-to-end regression test for the Hackbar devtools panel, run against Chromium
// via Playwright. See tests/README.md for what this does and does NOT verify -
// Chromium has no `browser.*` WebExtension namespace at all, so this mocks it
// (tests/mock-browser.js) and drives the real, unmodified panel/*.js against it.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const PANEL_DIR = path.join(__dirname, '..', 'panel');
const STATIC_PORT = process.env.HB_STATIC_PORT || 8900;
const ECHO_PORT = process.env.HB_ECHO_PORT || 8901;

let passed = 0, failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log('OK   ' + label); }
  else { failed++; console.log('FAIL ' + label + (detail ? '  -> ' + detail : '')); }
}

function waitForServer(url, tries) {
  tries = tries || 30;
  return new Promise((resolve, reject) => {
    const http = require('http');
    (function attempt(n) {
      http.get(url, (res) => { res.resume(); resolve(); })
        .on('error', () => {
          if (n <= 0) return reject(new Error('server not up: ' + url));
          setTimeout(() => attempt(n - 1), 100);
        });
    })(tries);
  });
}

(async () => {
  const staticProc = spawn('node', [path.join(__dirname, 'static-server.js'), PANEL_DIR, STATIC_PORT]);
  const echoProc = spawn('node', [path.join(__dirname, 'echo-server.js'), ECHO_PORT]);
  staticProc.stderr.on('data', d => console.error('[static]', d.toString()));
  echoProc.stderr.on('data', d => console.error('[echo]', d.toString()));
  process.on('exit', () => { try { staticProc.kill(); } catch (e) {} try { echoProc.kill(); } catch (e) {} });

  await waitForServer('http://127.0.0.1:' + STATIC_PORT + '/panel.html');
  await waitForServer('http://127.0.0.1:' + ECHO_PORT + '/echo');

  // CHROMIUM_PATH lets this point at a pre-installed browser (e.g. a sandboxed CI
  // image) instead of the one `npx playwright install` would normally manage.
  const launchOptions = { args: ['--no-sandbox'] };
  if (process.env.CHROMIUM_PATH) launchOptions.executablePath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.addInitScript({ path: path.join(__dirname, 'mock-browser.js') });
  await page.goto('http://127.0.0.1:' + STATIC_PORT + '/panel.html');
  await page.waitForTimeout(300); // let waiting.js's windows.getCurrent().then(...) settle

  check('page loads with no console errors', consoleErrors.length === 0, JSON.stringify(consoleErrors));
  check('page loads with no uncaught exceptions', pageErrors.length === 0, JSON.stringify(pageErrors));

  // ---------- LFI ----------
  await page.click('#LFI');
  await page.click('#LFI .menuitem[data-lfi="traversal"][data-file="etc/passwd"]');
  let getVal = await page.inputValue('#GETAREA');
  check('LFI traversal default depth 6', getVal === '../../../../../../etc/passwd', getVal);

  await page.fill('#GETAREA', '');
  await page.click('#LFI');
  await page.click('#lfiDepthUp');
  await page.click('#lfiDepthUp');
  await page.click('#LFI .menuitem[data-lfi="traversal"][data-file="etc/passwd"]');
  getVal = await page.inputValue('#GETAREA');
  check('LFI depth stepper (6->8) applied to next click', getVal === '../../../../../../../../etc/passwd', getVal);

  await page.click('#LFI'); // close menu
  await page.click('#PHP');
  await page.click('#PHP .menuitem >> text=phpinfo');
  getVal = await page.inputValue('#GETAREA');
  check('PHP menuitem inserts payload', getVal.includes('phpinfo()'), getVal);
  await page.click('#PHP');

  // ---------- REPLACE stepper ----------
  await page.fill('#GETAREA', 'id=41&x=1');
  await page.evaluate(() => {
    const el = document.getElementById('GETAREA');
    el.focus();
    el.selectionStart = 3; el.selectionEnd = 5; // selects "41"
  });
  await page.selectOption('#numFormat', 'INT');
  await page.click('#increment');
  getVal = await page.inputValue('#GETAREA');
  check('Replace stepper increments selected INT', getVal === 'id=42&x=1', getVal);

  // ---------- SPLIT URL ----------
  await page.fill('#GETAREA', 'https://target.example/path?id=5&id=6&name=bob#frag');
  await page.click('#spliturl');
  const rowCount = await page.locator('#splitContainer .split-row').count();
  check('Split Url renders 3 param rows (dup keys preserved)', rowCount === 3, rowCount);

  await page.click('#splitAddParam');
  const rows = page.locator('#splitContainer .split-row');
  const newRowIdx = (await rows.count()) - 1;
  await rows.nth(newRowIdx).locator('.split-key').fill('extra');
  await rows.nth(newRowIdx).locator('.split-value').fill('val ue');

  await rows.nth(0).locator('.split-remove').click(); // remove first "id=5" row

  await page.click('#spliturl'); // toggle back to raw
  getVal = await page.inputValue('#GETAREA');
  const rebuiltUrl = (() => { try { return new URL(getVal); } catch (e) { return null; } })();
  check('Split Url rebuild produces a valid URL', rebuiltUrl !== null, getVal);
  if (rebuiltUrl) {
    check('  - fragment preserved at the end', getVal.endsWith('#frag'), getVal);
    check('  - query before fragment (not swallowed into it)', rebuiltUrl.hash === '#frag' && rebuiltUrl.searchParams.get('extra') === 'val ue', getVal);
    check('  - removed row is gone, remaining id=6 kept', rebuiltUrl.searchParams.getAll('id').join(',') === '6', rebuiltUrl.searchParams.getAll('id').join(','));
  }

  // ---------- EXECUTE: plain GET ----------
  await page.fill('#GETAREA', 'http://127.0.0.1:' + ECHO_PORT + '/echo?a=1&a=2');
  // Force "not yet granted" so we can observe ensurePermissions() actually call request(),
  // instead of silently short-circuiting via contains()==true (that path is covered too,
  // implicitly, by every other Execute call below where __mockPermissionGranted stays true).
  await page.evaluate(() => { window.__mockEvents.length = 0; window.__mockPermissionRequests.length = 0; window.__mockPermissionGranted = false; });
  await page.click('#execute');
  await page.waitForSelector('#section6', { state: 'visible', timeout: 5000 });
  let status = await page.textContent('#executeStatus');
  check('Execute GET shows 200 status', status.includes('200'), status);
  let bodyText = await page.textContent('#executeBody');
  let parsed = null;
  try { parsed = JSON.parse(bodyText); } catch (e) {}
  check('Execute GET response body is the echoed JSON', !!parsed && parsed.method === 'GET', bodyText);
  check('  - query params reached the server', parsed && JSON.stringify(parsed.query.a) === JSON.stringify(['1', '2']), parsed && JSON.stringify(parsed.query));
  let headersText = await page.textContent('#executeHeaders');
  check('Execute GET headers include the response header', headersText.toLowerCase().includes('x-echo-server: hbtest'), headersText);

  let events = await page.evaluate(() => window.__mockEvents);
  check('Execute GET (no cookie/referer) never touches webRequest', !events.some(e => e.type.startsWith('webRequest')), JSON.stringify(events));
  let permReqs = await page.evaluate(() => window.__mockPermissionRequests);
  check('Execute GET still requests <all_urls> host permission for CORS', permReqs.length === 1 && JSON.stringify(permReqs[0].origins) === '["<all_urls>"]' && !permReqs[0].permissions, JSON.stringify(permReqs));

  // ---------- EXECUTE: POST ----------
  await page.check('#checkBoxPost');
  await page.fill('#POSTDATA', 'user=alice&pass=hunter2');
  await page.click('#execute');
  await page.waitForTimeout(300);
  bodyText = await page.textContent('#executeBody');
  parsed = JSON.parse(bodyText);
  check('Execute POST sends method+body correctly', parsed.method === 'POST' && parsed.body === 'user=alice&pass=hunter2', bodyText);
  await page.uncheck('#checkBoxPost');

  // ---------- EXECUTE: cookie/referer override registration ----------
  await page.check('#checkBoxCookies');
  await page.fill('#COOKIES', 'session=deadbeef');
  await page.check('#checkBoxReferrer');
  await page.fill('#REFERER', 'https://spoofed.example/');

  // Force "not yet granted" first, so we can observe ensurePermissions() actually call
  // request() with the right shape (mirrors the earlier GET-permission fix).
  await page.evaluate(() => { window.__mockEvents.length = 0; window.__mockPermissionRequests.length = 0; window.__mockPermissionGranted = false; });
  await page.click('#execute');
  await page.waitForTimeout(300);
  permReqs = await page.evaluate(() => window.__mockPermissionRequests);
  check('Cookie+Referer checked -> requests webRequest+webRequestBlocking permission',
    permReqs.length === 1 && JSON.stringify(permReqs[0].permissions) === '["webRequest","webRequestBlocking"]',
    JSON.stringify(permReqs));

  // Now with it granted, verify the actual listener registration/cleanup and no warning.
  await page.evaluate(() => { window.__mockEvents.length = 0; window.__mockPermissionGranted = true; });
  await page.click('#execute');
  await page.waitForTimeout(300);
  events = await page.evaluate(() => window.__mockEvents);
  const addEvt = events.find(e => e.type === 'webRequest.addListener');
  const removeEvt = events.find(e => e.type === 'webRequest.removeListener');
  check('  - registers onBeforeSendHeaders with correct filter/spec when granted',
    !!addEvt && JSON.stringify(addEvt.filter) === JSON.stringify({ urls: ['http://127.0.0.1:' + ECHO_PORT + '/*'] }) && JSON.stringify(addEvt.spec) === '["blocking","requestHeaders"]',
    JSON.stringify(addEvt));
  check('  - listener removed after the request settles', !!removeEvt, JSON.stringify(events));
  let warning = await page.textContent('#executeWarning');
  check('  - no warning shown when permission is granted', warning.trim() === '', warning);

  // ---------- EXECUTE: permission denied path ----------
  await page.evaluate(() => { window.__mockPermissionGranted = false; });
  await page.click('#execute');
  await page.waitForTimeout(300);
  warning = await page.textContent('#executeWarning');
  check('Permission denied -> visible warning shown', warning.includes('Permission denied'), warning);
  status = await page.textContent('#executeStatus');
  check('  - request still completes (degrades, does not silently fail)', status.includes('200'), status);
  await page.evaluate(() => { window.__mockPermissionGranted = true; });
  await page.uncheck('#checkBoxCookies');
  await page.uncheck('#checkBoxReferrer');

  // ---------- EXECUTE: reflected payload cannot execute in the panel ----------
  await page.evaluate(() => { window.__xssFired = false; });
  await page.fill('#GETAREA', 'http://127.0.0.1:' + ECHO_PORT + '/echo?x=' + encodeURIComponent('<img src=x onerror=window.__xssFired=true>'));
  await page.click('#execute');
  await page.waitForTimeout(300);
  const xssFired = await page.evaluate(() => window.__xssFired);
  bodyText = await page.textContent('#executeBody');
  check('Reflected payload in response body does NOT execute in the panel', xssFired === false, xssFired);
  check('  - payload is shown as literal text', bodyText.includes('<img src=x onerror=window.__xssFired=true>'), bodyText);
  const bodyHtml = await page.evaluate(() => document.getElementById('executeBody').innerHTML);
  check('  - rendered via text node, not raw HTML (entities escaped in innerHTML)', bodyHtml.includes('&lt;img'), bodyHtml);

  // ---------- EXECUTE: invalid URL ----------
  await page.fill('#GETAREA', 'not a url at all');
  await page.click('#execute');
  await page.waitForTimeout(200);
  status = await page.textContent('#executeStatus');
  check('Invalid URL shows an Error status instead of throwing', status === 'Error', status);

  // ---------- waiting.js: save on mouseout, restore on tab change, clear ----------
  // POSTDATA/COOKIES/REFERER were left hidden by the earlier uncheck() calls (their
  // sections are display:none until the matching checkbox is on) - re-check them so
  // they're fillable, matching how a real user would have this set up.
  await page.check('#checkBoxPost');
  await page.check('#checkBoxCookies');
  await page.check('#checkBoxReferrer');
  await page.evaluate((mockUrl) => { window.__mockTabUrl = mockUrl; }, 'https://save-test.example/app/');
  await page.fill('#GETAREA', 'https://save-test.example/app/?probe=1');
  await page.fill('#POSTDATA', 'postbody123');
  await page.fill('#COOKIES', 'cookieval');
  await page.fill('#REFERER', 'https://referer.example/');
  await page.dispatchEvent('body', 'mouseout');
  await page.waitForTimeout(200);

  let storageLocal = await page.evaluate(() => window.__storageLocal);
  let storageSession = await page.evaluate(() => window.__storageSession);
  const savedKey = 'https://save-test.example/app/';
  check('waiting.js saves GET/POST to storage.local keyed by origin+pathname',
    storageLocal[savedKey] && storageLocal[savedKey].get === 'https://save-test.example/app/?probe=1' && storageLocal[savedKey].post === 'postbody123',
    JSON.stringify(storageLocal));
  check('waiting.js saves Cookies/Referer to storage.session (not .local)',
    storageSession[savedKey] && storageSession[savedKey].cookies === 'cookieval' && storageSession[savedKey].referer === 'https://referer.example/',
    JSON.stringify(storageSession));
  check('  - secrets not duplicated into storage.local', !('cookies' in (storageLocal[savedKey] || {})), JSON.stringify(storageLocal[savedKey]));

  // clear fields, simulate switching to a fresh URL, then back - should restore
  await page.fill('#GETAREA', '');
  await page.fill('#POSTDATA', '');
  await page.fill('#COOKIES', '');
  await page.fill('#REFERER', '');
  await page.evaluate((mockUrl) => window.__simulateTabChange(mockUrl), 'https://save-test.example/app/');
  await page.waitForTimeout(200);
  getVal = await page.inputValue('#GETAREA');
  const postVal = await page.inputValue('#POSTDATA');
  const cookieVal = await page.inputValue('#COOKIES');
  check('Switching back to the saved URL restores GET/POST/Cookies/Referer',
    getVal === 'https://save-test.example/app/?probe=1' && postVal === 'postbody123' && cookieVal === 'cookieval',
    JSON.stringify({ getVal, postVal, cookieVal }));

  // switching to a URL with no saved data should clear stale fields, not leave old values showing
  await page.evaluate((mockUrl) => window.__simulateTabChange(mockUrl), 'https://never-visited.example/x');
  await page.waitForTimeout(200);
  getVal = await page.inputValue('#GETAREA');
  check('Switching to an unsaved URL clears stale fields instead of leaving old data', getVal === '', getVal);

  // Clear Saved Data button. Native .click() rather than Playwright's simulated mouse
  // click: by this point in the run the page has accumulated a lot of state (open/closed
  // menus, the response panel, split rows), and Playwright's real cursor-movement click
  // isn't reliable here - confirmed via a standalone repro that the handler itself is
  // correct (a native click on a fresh page cleanly empties both stores with exactly the
  // 2 expected storage.clear events, nothing else).
  await page.evaluate(() => document.getElementById('clearSavedData').click());
  await page.waitForTimeout(300);
  storageLocal = await page.evaluate(() => window.__storageLocal);
  storageSession = await page.evaluate(() => window.__storageSession);
  check('Clear Saved Data wipes storage.local', Object.keys(storageLocal).length === 0, JSON.stringify(storageLocal));
  check('Clear Saved Data wipes storage.session', Object.keys(storageSession).length === 0, JSON.stringify(storageSession));

  console.log('---');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (consoleErrors.length) console.log('console errors during run:', JSON.stringify(consoleErrors));
  if (pageErrors.length) console.log('uncaught page errors during run:', JSON.stringify(pageErrors));

  // browser.close() has been observed to hang in some sandboxed/headless environments;
  // don't let that mask an otherwise-complete, already-reported result.
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
  console.error('HARNESS CRASHED:', e);
  process.exit(2);
});
