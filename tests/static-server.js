// Serves the real panel/ directory unmodified, so the e2e test loads the actual
// panel.html/panel.js/panel.css/waiting.js shipped in the extension.
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
const port = process.argv[3] || 8900;

const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const reqPath = decodeURIComponent(req.url.split('?')[0]);
  if (reqPath === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  const filePath = path.join(root, reqPath === '/' ? '/panel.html' : reqPath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found: ' + filePath); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(port, () => console.log('static server on ' + port + ' serving ' + root));
