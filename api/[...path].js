'use strict';
/* دالة Vercel: تمرّر كل طلبات /api/* إلى نفس المنطق المستخدم محليًا (lib/api.js) */
const path = require('path');
const { createStore } = require('../lib/store');
const { handleApi } = require('../lib/api');

const DATA = path.join(__dirname, '..', 'data');
let store;

function getBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return Promise.resolve(req.body);
    if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body.toString('utf8'));
    return Promise.resolve(JSON.stringify(req.body));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 4 * 1024 * 1024) { reject(new Error('الملف كبير جدًا')); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const env = process.env;
  // على Vercel لا نسمح أبدًا بالعمل بدون قاعدة بيانات + تسجيل دخول
  if (env.VERCEL && !(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_ANON_KEY)) {
    res.status(503).json({ ok: false, error: 'لم تُضبط متغيرات Supabase على الخادم' });
    return;
  }
  try {
    if (!store) store = createStore(env, DATA);
    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    const out = await handleApi({
      method: req.method, pathname: url.pathname, query: url.searchParams,
      headers: req.headers, sameOrigin: true, readBody: () => getBody(req)
    }, store, env);
    if (out.raw !== undefined) {
      res.status(out.status).setHeader('Content-Type', out.type).send(out.raw);
    } else {
      res.status(out.status).json(out.body);
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'خطأ في الخادم' });
  }
};
