// Local target server for the Execute e2e test - echoes back method/query/headers/body
// as JSON so the test can assert the request that actually left the browser.
const http = require('http');
const url = require('url');

const port = process.argv[2] || 8901;

const server = http.createServer((req, res) => {
  let body = [];
  req.on('data', (c) => body.push(c));
  req.on('end', () => {
    const parsed = url.parse(req.url, true);
    const payload = {
      method: req.method,
      path: parsed.pathname,
      query: parsed.query,
      headers: req.headers,
      body: Buffer.concat(body).toString('utf8')
    };
    // CORS is what makes this reachable at all from a *plain page* fetch() in Chromium.
    // In real Firefox, a granted <all_urls> WebExtension host permission is what makes
    // the extension's own fetch() bypass CORS against arbitrary third-party targets -
    // no such privilege exists here, so the test target has to opt in explicitly. And
    // since panel.js's fetch() uses credentials:"include", the wildcard "*" origin is
    // rejected by the credentialed-CORS rules - echo the specific request origin instead.
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'X-Echo-Server': 'hbtest',
      'Access-Control-Allow-Origin': req.headers.origin || '*',
      'Access-Control-Allow-Credentials': 'true',
      // Cross-origin fetch() only exposes safelisted response headers to JS unless the
      // server explicitly opts a custom header in. Real WebExtension host-permission
      // fetches bypass CORS entirely (all headers visible) - this only matters here
      // because the test harness is a plain page going through real browser CORS.
      'Access-Control-Expose-Headers': 'X-Echo-Server'
    });
    res.end(JSON.stringify(payload, null, 2));
  });
});

server.listen(port, () => console.log('echo server on ' + port));
