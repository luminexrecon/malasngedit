// Serves the plugin UI in a normal browser, with dev/mock-host.js standing in
// for Photoshop. Run with `npm run dev`.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 5177;
const ROOT = path.resolve(__dirname, '..');
const UI = path.join(ROOT, 'plugin', 'ui');
const PRESETS = path.join(ROOT, 'plugin', 'presets');
const TESTS = path.join(ROOT, 'tests');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const MOCK_TAG = '<script src="/__dev/mock-host.js"></script>';
const WIRE_TAG = '<script src="./js/wire.js"></script>';

function resolveFile(urlPath) {
  const mounts = [
    ['/__dev/', __dirname],
    ['/__presets/', PRESETS],
    // Lets the browser tests read their recorded reference pictures.
    ['/__tests/', TESTS],
    ['/', UI],
  ];
  for (const [prefix, base] of mounts) {
    if (urlPath.startsWith(prefix)) {
      const file = path.resolve(base, urlPath.slice(prefix.length) || 'index.html');
      return file.startsWith(base) ? file : null;
    }
  }
  return null;
}

http
  .createServer((request, response) => {
    const { pathname } = new URL(request.url, 'http://localhost');
    const file = resolveFile(decodeURIComponent(pathname));
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404).end('Not found');
      return;
    }
    let body = fs.readFileSync(file);
    if (file === path.join(UI, 'index.html')) {
      body = body.toString().replace(WIRE_TAG, `${WIRE_TAG}\n    ${MOCK_TAG}`);
    }
    response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    response.end(body);
  })
  .listen(PORT, '127.0.0.1', () => console.log(`malasngedit dev: http://127.0.0.1:${PORT}/`));
