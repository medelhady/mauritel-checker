'use strict';
/* التحقق من المدخلات (مشترك بين الخادم المحلي ودوال Vercel) */

function str(v, n) { return typeof v === 'string' ? v.trim().slice(0, n) : ''; }
function newId(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ---------- GeoJSON ----------
function validNumberPair(p) {
  return Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) &&
    Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
}
function validRing(r) { return Array.isArray(r) && r.length >= 4 && r.every(validNumberPair); }
function validPolygon(c) { return Array.isArray(c) && c.length >= 1 && c.every(validRing); }

function validateCollection(obj, kind) {
  if (!obj || obj.type !== 'FeatureCollection' || !Array.isArray(obj.features)) return 'يجب أن يكون FeatureCollection';
  for (const f of obj.features) {
    if (!f || f.type !== 'Feature' || !f.geometry) return 'عنصر غير صالح';
    const g = f.geometry;
    if (kind === 'coverage') {
      if (g.type === 'Polygon' && validPolygon(g.coordinates)) continue;
      if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates) && g.coordinates.every(validPolygon)) continue;
      return 'هندسة غير صالحة في التغطية (المسموح: Polygon أو MultiPolygon)';
    }
    if (g.type === 'Point' && validNumberPair(g.coordinates)) continue;
    return 'هندسة غير صالحة في نقاط البيع (المسموح: Point)';
  }
  return null;
}

// ---------- المواقع المحفوظة يدويًا (كود + حي + معلم) ----------
function cleanPlace(b) {
  const code = str(b && b.code, 60);
  if (!/^[A-Za-z0-9 ()\-]{2,60}$/.test(code)) return { error: 'كود غير صالح' };
  const area = str(b.area, 120), landmark = str(b.landmark, 120);
  if (!area && !landmark) return { error: 'اكتب الحي أو المعلم القريب' };
  return { item: { code, area, landmark } };
}

// ---------- أسماء الأحياء حسب بادئة الكود ----------
function cleanZoneArea(b) {
  const prefix = str(b && b.prefix, 3).toUpperCase();
  const name = str(b && b.name, 80);
  if (!/^[A-Z]{2,3}$/.test(prefix) || !name) return { error: 'بادئة أو اسم غير صالح' };
  return { item: { prefix, name } };
}

// ---------- سجل المواقع المُرسلة ----------
const STATUSES = ['inside', 'outside', 'unknown'];

function cleanLocation(b) {
  const lat = Number(b && b.lat), lng = Number(b && b.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { error: 'إحداثيات غير صالحة' };
  }
  return {
    item: {
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      code: str(b.code, 60) || null,
      status: STATUSES.includes(b.status) ? b.status : 'unknown',
      area: str(b.area, 200),
      landmark: str(b.landmark, 200),
      link: str(b.link, 500)
    }
  };
}

function locationKey(item) { return item.lat.toFixed(5) + ',' + item.lng.toFixed(5); }

module.exports = { str, newId, validateCollection, cleanPlace, cleanZoneArea, cleanLocation, locationKey };
