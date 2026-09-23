// Local development server. Static files only, no dependencies.
//
// The app needs to be served over http rather than opened from disk, because
// browsers refuse to load ES modules over file://. In production Netlify does
// this job, so nothing here ships.
//
//   node server.js          -> http://127.0.0.1:3000
//   node server.js 8080     -> a different port

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const ROOT = import.meta.dirname;
const PORT = Number(process.argv[2]) || 3000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const path = url === '/' ? '/index.html' : url;

  // Keep requests inside the project directory.
  const file = join(ROOT, normalize(path));
  if (!file.startsWith(ROOT + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      // Always re-read from disk; a cached module while editing is maddening.
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('PocketBase running at http://127.0.0.1:' + PORT);
  console.log('Press Ctrl+C to stop.');
});
