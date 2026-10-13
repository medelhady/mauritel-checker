'use strict';
/*
 * خادم محلي بدون مكتبات خارجية. المنطق كله في lib/ (مشترك مع نسخة Vercel):
 *  - يقدّم ملفات الواجهة من public/
 *  - يمرّر طلبات /api إلى lib/api.js
 *  - التخزين: ملفات data/ محليًا، أو Supabase إن ضُبطت متغيراته في .env
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createStore } = require('./lib/store');
const { handleApi } = require('./lib/api');
const { resolveLink } = require('./lib/resolve');
const { validateCollection, cleanLocation } = require('./lib/validate');

// قراءة ملف .env (اختياري) دون أي مكتبة
(function loadEnv() {
  try {
    fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach((line) => {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  } catch (e) { /* لا يوجد .env */ }
})();

const PORT = Number(process.env.PORT) || 3000;
const HOST = '127.0.0.1'; // محلي فقط
const PUBLIC = path.join(__dirname, 'public');
const DATA = path.join(__dirname, 'data');
const MAX_BODY = 5 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon'
};

function send(res, status, body, type) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': type || (isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8'),
    'Cache-Control': 'no-store'
  });
  res.end(isObj ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('الملف كبير جدًا')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch (e) { return false; }
}

const store = createStore(process.env, DATA);

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream');
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    if (url.pathname.startsWith('/api/')) {
      const out = await handleApi({
        method: req.method, pathname: url.pathname, query: url.searchParams,
        headers: req.headers, sameOrigin: sameOrigin(req), readBody: () => readBody(req)
      }, store, process.env);
      return out.raw !== undefined ? send(res, out.status, out.raw, out.type) : send(res, out.status, out.body);
    }
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    send(res, 500, { ok: false, error: 'خطأ في الخادم' });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log('الأداة تعمل الآن. افتح هذا الرابط في المتصفح:\n  http://localhost:' + PORT);
  });
}

module.exports = { server, resolveLink, validateCollection, cleanLocation };
