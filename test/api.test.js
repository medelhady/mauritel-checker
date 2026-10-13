'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { handleApi } = require('../lib/api');
const { authorize } = require('../lib/auth');
const { createFileStore } = require('../lib/store-file');
const { createSupabaseStore } = require('../lib/store-supabase');

const ctx = (method, pathname, body, extra) => Object.assign({
  method, pathname, query: new URLSearchParams(), headers: {}, sameOrigin: true,
  readBody: async () => JSON.stringify(body || {})
}, extra);

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ftth-'));
  return createFileStore(dir);
}

test('المحلي: حفظ موقع وقراءته وتحديث العدّاد', async () => {
  const st = tmpStore();
  const loc = { lat: 18.0754, lng: -15.9552, code: 'CA1Z02', status: 'inside', area: 'كرفور' };
  let r = await handleApi(ctx('POST', '/api/locations', loc), st, {});
  assert.strictEqual(r.body.existing, false);
  r = await handleApi(ctx('POST', '/api/locations', loc), st, {});
  assert.strictEqual(r.body.count, 2);
  r = await handleApi(ctx('GET', '/api/locations'), st, {});
  assert.strictEqual(r.body.items.length, 1);
});

test('المحلي: أماكن وبادئات', async () => {
  const st = tmpStore();
  let r = await handleApi(ctx('POST', '/api/places', { code: 'DN2Z01', area: 'دار النعيم', landmark: 'بوتيك جمبو' }), st, {});
  assert.ok(r.body.ok && r.body.item.id);
  r = await handleApi(ctx('POST', '/api/places', { code: '<x>', area: 'a' }), st, {});
  assert.strictEqual(r.status, 400);
  await handleApi(ctx('POST', '/api/zone-areas', { prefix: 'dn', name: 'دار النعيم' }), st, {});
  r = await handleApi(ctx('GET', '/api/zone-areas'), st, {});
  assert.strictEqual(r.body.prefixes.DN, 'دار النعيم');
});

test('رفض الكتابة من أصل مختلف عند عدم وجود تسجيل دخول', async () => {
  const r = await handleApi(ctx('POST', '/api/locations', { lat: 1, lng: 1 }, { sameOrigin: false }), tmpStore(), {});
  assert.strictEqual(r.status, 403);
});

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 's', ALLOWED_EMAILS: 'Me@x.com, b@x.com' };
const userFetch = (user, ok = true) => async () => ({ ok, json: async () => user });

test('auth: بدون رمز 401، رمز خاطئ 401، غير مصرّح 403، قائمة فارغة 503، مصرّح ok', async () => {
  assert.strictEqual((await authorize({}, ENV, userFetch({}))).status, 401);
  assert.strictEqual((await authorize({ authorization: 'Bearer t' }, ENV, userFetch({}, false))).status, 401);
  assert.strictEqual((await authorize({ authorization: 'Bearer t' }, ENV, userFetch({ email: 'z@x.com', email_confirmed_at: 'y' }))).status, 403);
  assert.strictEqual((await authorize({ authorization: 'Bearer t' }, ENV, userFetch({ email: 'me@x.com' }))).status, 403); // غير مؤكد
  assert.strictEqual((await authorize({ authorization: 'Bearer t' }, Object.assign({}, ENV, { ALLOWED_EMAILS: '' }), userFetch({}))).status, 503);
  const ok = await authorize({ authorization: 'Bearer t' }, ENV, userFetch({ email: 'ME@x.com', email_confirmed_at: 'y' }));
  assert.ok(ok.ok && ok.bearer);
});

test('api: /config عام، وباقي المسارات تتطلب دخولًا عند ضبط Supabase', async () => {
  const st = tmpStore();
  const c = await handleApi(ctx('GET', '/api/config'), st, ENV);
  assert.strictEqual(c.body.authRequired, true);
  assert.ok(!JSON.stringify(c.body).includes('"s"'));
  const r = await handleApi(ctx('GET', '/api/locations'), st, ENV);
  assert.strictEqual(r.status, 401);
});

// قاعدة PostgREST وهمية في الذاكرة
function fakeRest() {
  const tables = { places: [], zone_areas: [], locations: [] };
  const calls = [];
  const f = async (url, opts) => {
    const u = new URL(url);
    const table = u.pathname.split('/').pop();
    calls.push({ url: String(url), method: opts.method, headers: opts.headers });
    const rows = tables[table];
    const body = opts.body ? JSON.parse(opts.body) : null;
    const res = (status, data) => ({ ok: status < 300, status, text: async () => (data === undefined ? '' : JSON.stringify(data)) });
    if (opts.method === 'GET') {
      const k = u.searchParams.get('key');
      return res(200, k ? rows.filter((r) => r.key === k.replace('eq.', '')) : rows);
    }
    if (opts.method === 'POST') {
      const pk = table === 'zone_areas' ? 'prefix' : 'id';
      const i = rows.findIndex((r) => r[pk] === body[pk]);
      if (i >= 0 && !/merge/.test(opts.headers.Prefer || '')) return res(409, { code: '23505' });
      const row = Object.assign({ created_at: '2026-01-01T00:00:00Z' }, body);
      if (i >= 0) rows[i] = row; else rows.push(row);
      return res(201, /representation/.test(opts.headers.Prefer || '') ? [row] : undefined);
    }
    if (opts.method === 'PATCH') {
      const k = u.searchParams.get('key').replace('eq.', '');
      rows.filter((r) => r.key === k).forEach((r) => Object.assign(r, body));
      return res(204);
    }
    return res(405);
  };
  return { f, tables, calls };
}

test('Supabase: حفظ/تحديث موقع وأماكن وبادئات، وتُستخدم service key', async () => {
  const fk = fakeRest();
  const st = createSupabaseStore(ENV, '/nonexistent', fk.f);
  const loc = { lat: 18.0754, lng: -15.9552, code: 'CA1Z02', status: 'inside', area: 'كرفور', landmark: '', link: '' };
  assert.strictEqual((await st.upsertLocation(loc)).existing, false);
  assert.strictEqual((await st.upsertLocation(loc)).count, 2);
  assert.strictEqual((await st.listLocations()).length, 1);
  const p = await st.addPlace({ code: 'DN2Z01', area: 'دار النعيم', landmark: 'جمبو' });
  assert.strictEqual(p.code, 'DN2Z01');
  assert.strictEqual((await st.listPlaces()).length, 1);
  await st.setZoneArea('DN', 'دار النعيم');
  await st.setZoneArea('DN', 'دار النعيم 2');
  assert.strictEqual((await st.getZoneAreas()).prefixes.DN, 'دار النعيم 2');
  assert.ok(fk.calls.every((c) => c.headers.apikey === 's'));
});

test('Supabase: تعديل الحدود غير مدعوم (501) وقراءتها من الملف', async () => {
  const fk = fakeRest();
  const st = createSupabaseStore(ENV, path.join(__dirname, '..', 'data'), fk.f);
  const env = Object.assign({}, ENV);
  const user = async () => ({ ok: true, json: async () => ({ email: 'me@x.com', email_confirmed_at: 'y' }) });
  const realFetch = global.fetch;
  global.fetch = user; // authorize يستخدم fetch العام
  try {
    const hdr = { authorization: 'Bearer t' };
    const put = await handleApi(ctx('PUT', '/api/coverage', { type: 'FeatureCollection', features: [] }, { headers: hdr }), st, env);
    assert.strictEqual(put.status, 501);
    const get = await handleApi(ctx('GET', '/api/coverage', null, { headers: hdr }), st, env);
    assert.strictEqual(JSON.parse(get.raw).features.length, 121);
  } finally { global.fetch = realFetch; }
});
