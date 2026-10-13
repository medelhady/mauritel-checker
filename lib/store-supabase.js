'use strict';
/*
 * التخزين في Supabase (PostgREST) للنشر على Vercel.
 * يستخدم SUPABASE_SERVICE_ROLE_KEY على الخادم فقط (لا يصل للمتصفح أبدًا).
 * حدود التغطية ونقاط البيع تبقى ملفات للقراءة فقط ضمن النشر.
 */
const fs = require('fs');
const path = require('path');
const { newId, locationKey } = require('./validate');

function readOnlyError() {
  const e = new Error('READONLY');
  e.code = 'READONLY';
  return e;
}

function createSupabaseStore(env, dataDir, fetchImpl) {
  const doFetch = fetchImpl || fetch;
  const base = env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
  const KEY = env.SUPABASE_SERVICE_ROLE_KEY;

  async function rest(method, table, { query = '', body, prefer } = {}) {
    const headers = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
    if (prefer) headers.Prefer = prefer;
    const r = await doFetch(base + '/' + table + (query ? '?' + query : ''), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    });
    const text = await r.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
    return { ok: r.ok, status: r.status, data };
  }
  function must(r, what) {
    if (!r.ok) {
      const e = new Error('Supabase ' + what + ' فشل (' + r.status + ')');
      e.status = r.status;
      throw e;
    }
    return r.data;
  }

  const placeOut = (r) => ({ id: r.id, code: r.code, area: r.area, landmark: r.landmark, createdAt: String(r.created_at || '').slice(0, 10) });
  const locOut = (r) => ({
    id: r.id, lat: r.lat, lng: r.lng, code: r.code, status: r.status, area: r.area, landmark: r.landmark,
    link: r.link, count: r.count, firstSeen: r.first_seen, lastSeen: r.last_seen
  });

  return {
    mode: 'supabase',

    async readStatic(kind) {
      const file = { coverage: 'coverage.geojson', pos: 'pos.geojson' }[kind];
      try { return fs.readFileSync(path.join(dataDir, file), 'utf8'); } catch (e) { return null; }
    },
    async writeStatic() { throw readOnlyError(); },

    async listPlaces() {
      const rows = must(await rest('GET', 'places', { query: 'select=*&order=created_at.desc&limit=5000' }), 'places');
      return rows.map(placeOut);
    },
    async addPlace(item) {
      const row = { id: newId('p'), code: item.code, area: item.area || '', landmark: item.landmark || '' };
      const out = must(await rest('POST', 'places', { body: row, prefer: 'return=representation' }), 'places');
      return placeOut(out[0] || row);
    },

    async getZoneAreas() {
      const rows = must(await rest('GET', 'zone_areas', { query: 'select=*' }), 'zone_areas');
      const prefixes = {};
      rows.forEach((r) => { prefixes[r.prefix] = r.name; });
      return { prefixes };
    },
    async setZoneArea(prefix, name) {
      must(await rest('POST', 'zone_areas', {
        body: { prefix, name }, prefer: 'resolution=merge-duplicates,return=minimal'
      }), 'zone_areas');
    },

    async listLocations() {
      const rows = must(await rest('GET', 'locations', { query: 'select=*&order=last_seen.desc&limit=2000' }), 'locations');
      return rows.map(locOut);
    },
    async upsertLocation(item) {
      const key = locationKey(item);
      const now = new Date().toISOString();
      const find = async () => {
        const rows = must(await rest('GET', 'locations', { query: 'select=id,count,area,landmark,link&key=eq.' + encodeURIComponent(key) }), 'locations');
        return rows[0] || null;
      };
      const update = async (ex) => {
        const count = (ex.count || 1) + 1;
        must(await rest('PATCH', 'locations', {
          query: 'key=eq.' + encodeURIComponent(key),
          body: {
            code: item.code, status: item.status,
            area: item.area || ex.area || '', landmark: item.landmark || ex.landmark || '', link: item.link || ex.link || '',
            last_seen: now, count
          },
          prefer: 'return=minimal'
        }), 'locations');
        return { ok: true, existing: true, count };
      };

      const ex = await find();
      if (ex) return update(ex);

      const ins = await rest('POST', 'locations', {
        body: {
          id: newId('l'), key, lat: item.lat, lng: item.lng, code: item.code, status: item.status,
          area: item.area, landmark: item.landmark, link: item.link, count: 1, first_seen: now, last_seen: now
        },
        prefer: 'return=minimal'
      });
      if (ins.ok) return { ok: true, existing: false, count: 1 };
      if (ins.status === 409) { // طلب متزامن أدخل نفس النقطة قبلنا
        const again = await find();
        if (again) return update(again);
      }
      must(ins, 'locations');
      return { ok: false, error: 'تعذّر الحفظ' };
    }
  };
}

module.exports = { createSupabaseStore };
