'use strict';

// Local development server: serves the website and the same /api/** routes as
// the Cloud Function, backed by the in-memory store seeded from
// data/wits-west-map.json. Run: npm run dev   (from functions/)
//
// Reads secrets from functions/.secret.local (git-ignored, never deployed -
// unlike functions/.env, which Firebase uploads with the function) and
// non-secret settings from functions/.env. Routing defaults to the
// PLACEHOLDER fixture mode here; production defaults to 'unavailable'.

const http = require('http');
const fs = require('fs');
const path = require('path');

for (const file of ['.secret.local', '.env']) {
  if (fs.existsSync(path.join(__dirname, file))) process.loadEnvFile(path.join(__dirname, file));
}
process.env.ROUTING_MODE = process.env.ROUTING_MODE || 'fixture';

const Anthropic = require('@anthropic-ai/sdk');
const config = require('./src/config');
const { createApi } = require('./src/api');
const { MemoryStore } = require('./src/store/memoryStore');
const { loadSeedData } = require('./src/store/seedData');
const { createRoutingService } = require('./src/routing/routingService');
const { CompanionError } = require('./src/companion/companion');

const PORT = Number(process.env.PORT || 5173);
const SITE_ROOT = path.resolve(__dirname, '..');
// Only these paths are public - mirrors the hosting config, so functions/,
// .env and scripts are never served.
const PUBLIC_FILES = new Set(['/index.html', '/share.html', '/trip.html', '/track.html']);
const PUBLIC_DIRS = ['/app/', '/css/', '/data/', '/companion/', '/tracking/', '/vendor/', '/admin/'];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const seed = loadSeedData();
const store = new MemoryStore(seed);

// Team-pinned places are real work, so in dev they survive restarts: they're
// saved to functions/.dev-data/campus-places.json (git-ignored). Import them
// into Firestore with: node scripts/seed-firestore.js --campus-places <file>
const PLACES_FILE = path.join(__dirname, '.dev-data', 'campus-places.json');
if (fs.existsSync(PLACES_FILE)) {
  for (const { id, ...place } of JSON.parse(fs.readFileSync(PLACES_FILE, 'utf8'))) {
    store.campusPlaces.set(id, place);
  }
}
async function persistPlaces() {
  fs.mkdirSync(path.dirname(PLACES_FILE), { recursive: true });
  fs.writeFileSync(PLACES_FILE, JSON.stringify(await store.listCampusPlaces(), null, 2));
}
const saveCampusPlace = store.saveCampusPlace.bind(store);
const deleteCampusPlace = store.deleteCampusPlace.bind(store);
store.saveCampusPlace = async (id, place) => {
  const savedId = await saveCampusPlace(id, place);
  await persistPlaces();
  return savedId;
};
store.deleteCampusPlace = async (id) => {
  const deleted = await deleteCampusPlace(id);
  await persistPlaces();
  return deleted;
};
const routing = createRoutingService({
  mode: config.ROUTING_MODE,
  url: config.ROUTING_SERVICE_URL,
  timeoutMs: config.ROUTING_TIMEOUT_MS,
  store
});

let anthropic = null;
const api = createApi({
  store,
  routing,
  log: (event, data) => console.log(`[companion] ${event}`, JSON.stringify(data)),
  getAnthropic: () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new CompanionError('not_configured', 'ANTHROPIC_API_KEY is not set in functions/.secret.local.', 503);
    }
    anthropic = anthropic || new Anthropic();
    return anthropic;
  },
  getVulavulaKey: () => process.env.VULAVULA_API_KEY || '',
  getAdminToken: () => process.env.ADMIN_API_TOKEN || '',
  verifyUser: async () => null
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > config.MAX_AUDIO_BYTES + 1024) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function serveStatic(urlPath, res) {
  let filePath = urlPath === '/' ? '/index.html' : urlPath;
  if (/^\/share\/[^/]+$/.test(filePath)) filePath = '/share.html';
  if (/^\/track\/[^/]+$/.test(filePath)) filePath = '/track.html';
  if (filePath === '/admin' || filePath === '/admin/') filePath = '/admin/places.html';

  const allowed = PUBLIC_FILES.has(filePath) || PUBLIC_DIRS.some((dir) => filePath.startsWith(dir));
  const absolute = path.resolve(SITE_ROOT, `.${filePath}`);
  if (!allowed || !absolute.startsWith(SITE_ROOT + path.sep) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(absolute)] || 'application/octet-stream' });
  fs.createReadStream(absolute).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const urlPath = decodeURIComponent(url.pathname);

  if (!urlPath.startsWith('/api/')) {
    serveStatic(urlPath, res);
    return;
  }

  let rawBody;
  try {
    rawBody = await readBody(req);
  } catch {
    res.writeHead(413).end();
    return;
  }
  let body = null;
  if ((req.headers['content-type'] || '').startsWith('application/json') && rawBody.length) {
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"invalid_json"}');
      return;
    }
  }

  const result = await api({
    method: req.method,
    path: urlPath,
    query: Object.fromEntries(url.searchParams),
    headers: req.headers,
    body,
    rawBody
  });
  const headers = { 'cache-control': 'no-store' };
  if (result.json !== undefined) {
    res.writeHead(result.status, { ...headers, 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result.json));
  } else if (result.text !== undefined) {
    res.writeHead(result.status, { ...headers, 'content-type': result.contentType });
    res.end(result.text);
  } else {
    res.writeHead(result.status, headers).end();
  }
});

server.listen(PORT, () => {
  console.log(`WitsPath dev server: http://localhost:${PORT}`);
  console.log(`Routing mode: ${config.ROUTING_MODE} (${routing.source})`);
  if (!process.env.ANTHROPIC_API_KEY) console.log('ANTHROPIC_API_KEY not set - companion replies will return 503.');
  console.log(
    process.env.ADMIN_API_TOKEN
      ? `Campus places admin: http://localhost:${PORT}/admin/`
      : 'ADMIN_API_TOKEN not set - the campus places admin page is disabled.'
  );
});
