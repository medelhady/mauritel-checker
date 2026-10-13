'use strict';
/*
 * منطق واجهة /api (مشترك بين الخادم المحلي ودالة Vercel).
 * ctx = { method, pathname, query (URLSearchParams), headers (بحروف صغيرة), sameOrigin (bool), readBody() }
 * يرجع { status, body } أو { status, raw, type } للملفات.
 */
const { resolveLink, googleReverse } = require('./resolve');
const V = require('./validate');
const { authorize, authConfig } = require('./auth');

const json = (status, body) => ({ status, body });
const RO_MSG = 'تعديل الحدود غير مدعوم على النسخة المنشورة. عدّلها محليًا ثم ارفع التحديث.';

async function readJson(ctx) {
  try { return { value: JSON.parse(await ctx.readBody()) }; } catch (e) { return { error: json(400, { ok: false, error: 'JSON غير صالح' }) }; }
}

async function handleApi(ctx, store, env) {
  const { method, pathname, query } = ctx;

  if (pathname === '/api/config' && method === 'GET') return json(200, authConfig(env));

  const auth = await authorize(ctx.headers || {}, env);
  if (!auth.ok) return json(auth.status, { ok: false, error: auth.error });
  // بدون تسجيل دخول (محلي) نحمي الكتابة من طلبات المواقع الأخرى (CSRF)
  if (method !== 'GET' && !auth.bearer && !ctx.sameOrigin) return json(403, { ok: false, error: 'مرفوض' });

  if (pathname === '/api/resolve' && method === 'GET') {
    const target = query.get('url') || '';
    if (!target || target.length > 2000) return json(400, { ok: false, error: 'الرابط مفقود' });
    return json(200, await resolveLink(target.trim()));
  }

  if (pathname === '/api/geocode' && method === 'GET') {
    const lat = Number(query.get('lat')), lng = Number(query.get('lng'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return json(400, { ok: false, error: 'إحداثيات غير صالحة' });
    }
    return json(200, await googleReverse(lat, lng, env));
  }

  if (pathname === '/api/locations') {
    if (method === 'GET') return json(200, { items: await store.listLocations() });
    if (method === 'POST') {
      const b = await readJson(ctx); if (b.error) return b.error;
      const c = V.cleanLocation(b.value);
      if (c.error) return json(400, { ok: false, error: c.error });
      return json(200, await store.upsertLocation(c.item));
    }
  }

  if (pathname === '/api/places') {
    if (method === 'GET') return json(200, { items: await store.listPlaces() });
    if (method === 'POST') {
      const b = await readJson(ctx); if (b.error) return b.error;
      const c = V.cleanPlace(b.value);
      if (c.error) return json(400, { ok: false, error: c.error });
      return json(200, { ok: true, item: await store.addPlace(c.item) });
    }
  }

  if (pathname === '/api/zone-areas') {
    if (method === 'GET') return json(200, await store.getZoneAreas());
    if (method === 'POST') {
      const b = await readJson(ctx); if (b.error) return b.error;
      const c = V.cleanZoneArea(b.value);
      if (c.error) return json(400, { ok: false, error: c.error });
      await store.setZoneArea(c.item.prefix, c.item.name);
      return json(200, { ok: true });
    }
  }

  const m = /^\/api\/(coverage|pos)$/.exec(pathname);
  if (m) {
    const kind = m[1];
    if (method === 'GET') {
      const text = await store.readStatic(kind);
      return { status: 200, raw: text || JSON.stringify({ type: 'FeatureCollection', features: [] }), type: 'application/geo+json; charset=utf-8' };
    }
    if (method === 'PUT') {
      let text;
      try { text = await ctx.readBody(); } catch (e) { return json(413, { ok: false, error: e.message }); }
      let obj;
      try { obj = JSON.parse(text); } catch (e) { return json(400, { ok: false, error: 'JSON غير صالح' }); }
      const err = V.validateCollection(obj, kind);
      if (err) return json(400, { ok: false, error: err });
      try {
        await store.writeStatic(kind, JSON.stringify(obj, null, 2));
      } catch (e) {
        if (e.code === 'READONLY') return json(501, { ok: false, error: RO_MSG });
        throw e;
      }
      return json(200, { ok: true, features: obj.features.length });
    }
  }

  return json(404, { ok: false, error: 'غير موجود' });
}

module.exports = { handleApi };
