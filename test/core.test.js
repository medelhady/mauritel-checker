'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { extractCoords, extractFromHtml, isShortLink } = require('../public/js/parse.js');
const Geo = require('../public/js/geo.js');
const { validateCollection } = require('../lib/validate.js');

// ---------- استخراج الإحداثيات ----------
test('رابط طويل مع @lat,lng', () => {
  const c = extractCoords('https://www.google.com/maps/place/X/@18.0858,-15.9785,17z/data=!3m1');
  assert.deepStrictEqual([c.lat, c.lng, c.source], [18.0858, -15.9785, 'viewport']);
});

test('دبوس !3d!4d له الأولوية على @', () => {
  const c = extractCoords('https://www.google.com/maps/place/X/@18.1,-15.9,17z/data=!4m2!3d18.0912!4d-15.9701');
  assert.deepStrictEqual([c.lat, c.lng, c.source], [18.0912, -15.9701, 'pin']);
});

test('q= و ll= وإحداثيات مجردة', () => {
  assert.strictEqual(extractCoords('https://maps.google.com/?q=18.0866,-15.9785').lat, 18.0866);
  assert.strictEqual(extractCoords('https://maps.google.com/?q=18.0866%2C-15.9785').lng, -15.9785);
  assert.strictEqual(extractCoords('https://maps.google.com/?ll=18.05,-15.95&z=15').lat, 18.05);
  const p = extractCoords('18.0858, -15.9785');
  assert.deepStrictEqual([p.lat, p.lng, p.source], [18.0858, -15.9785, 'plain']);
});

test('روابط مختصرة بلا إحداثيات تُرجع null (تُحل عبر الخادم)', () => {
  assert.strictEqual(extractCoords('https://maps.app.goo.gl/ZSTAyGuksCKpvznq6'), null);
  assert.ok(isShortLink('https://maps.app.goo.gl/ZSTAyGuksCKpvznq6'));
});

test('قيم غير صالحة مرفوضة', () => {
  assert.strictEqual(extractCoords('200, 300'), null);
  assert.strictEqual(extractCoords('0,0'), null);
  assert.strictEqual(extractCoords(''), null);
});

test('استخراج من meta في HTML', () => {
  const html = '<meta property="og:image" content="https://maps.google.com/maps/api/staticmap?center=18.07%2C-15.96&amp;zoom=15">';
  const c = extractFromHtml(html);
  assert.deepStrictEqual([c.lat, c.lng], [18.07, -15.96]);
});

// ---------- منطق التغطية ----------
const square = (verified, extra) => ({
  type: 'Feature',
  properties: Object.assign({ name: 'Z', verified }, extra),
  geometry: { type: 'Polygon', coordinates: [[[-16.0, 18.0], [-15.9, 18.0], [-15.9, 18.1], [-16.0, 18.1], [-16.0, 18.0]]] }
});
const coll = (features, complete) => ({ type: 'FeatureCollection', properties: { complete: !!complete }, features });

test('بدون بيانات => غير مؤكد', () => {
  assert.strictEqual(Geo.classify(18.05, -15.95, coll([])).status, 'unknown');
  assert.strictEqual(Geo.classify(18.05, -15.95, coll([])).reason, 'no_data');
});

test('داخل مضلع موثوق => داخل', () => {
  assert.strictEqual(Geo.classify(18.05, -15.95, coll([square(true)])).status, 'inside');
});

test('داخل مسودة فقط => غير مؤكد', () => {
  const r = Geo.classify(18.05, -15.95, coll([square(false)], true));
  assert.deepStrictEqual([r.status, r.reason], ['unknown', 'draft_only']);
});

test('خارج المضلع والبيانات غير كاملة => غير مؤكد (لا يُخمَّن "خارج")', () => {
  const r = Geo.classify(18.2, -15.95, coll([square(true)], false));
  assert.deepStrictEqual([r.status, r.reason], ['unknown', 'incomplete_data']);
});

test('خارج المضلع والبيانات كاملة وموثوقة => خارج', () => {
  assert.strictEqual(Geo.classify(18.2, -15.95, coll([square(true)], true)).status, 'outside');
});

test('complete=true بدون أي مضلع موثوق لا يكفي للحكم بـ خارج', () => {
  assert.strictEqual(Geo.classify(18.2, -15.95, coll([square(false)], true)).status, 'unknown');
});

test('الثقوب في المضلع', () => {
  const f = square(true);
  f.geometry.coordinates.push([[-15.97, 18.04], [-15.93, 18.04], [-15.93, 18.06], [-15.97, 18.06], [-15.97, 18.04]]);
  assert.strictEqual(Geo.classify(18.05, -15.95, coll([f], true)).status, 'outside'); // داخل الثقب
  assert.strictEqual(Geo.classify(18.02, -15.95, coll([f], true)).status, 'inside');
});

test('تنبيه القرب من الحد (~11م)', () => {
  const r = Geo.classify(18.05, -15.9001, coll([square(true)]));
  assert.strictEqual(r.status, 'inside');
  assert.strictEqual(r.nearBoundary, true);
});

test('MultiPolygon', () => {
  const f = { type: 'Feature', properties: { verified: true }, geometry: { type: 'MultiPolygon', coordinates: [square(true).geometry.coordinates] } };
  assert.strictEqual(Geo.classify(18.05, -15.95, coll([f])).status, 'inside');
});

// ---------- التحقق قبل الحفظ ----------
test('validateCollection', () => {
  assert.strictEqual(validateCollection(coll([square(true)]), 'coverage'), null);
  assert.ok(validateCollection({ type: 'x' }, 'coverage'));
  assert.ok(validateCollection({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] } }] }, 'coverage'));
  assert.strictEqual(validateCollection({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-15.9, 18] } }] }, 'pos'), null);
});

test('اسم المكان من رابط Google Maps', () => {
  const { extractPlaceName } = require('../public/js/parse.js');
  assert.strictEqual(extractPlaceName('https://www.google.com/maps/place/Carrefour+Arafat/@18.08,-15.96,17z'), 'Carrefour Arafat');
  assert.strictEqual(extractPlaceName('https://www.google.com/maps/place/18.0858,-15.9785/@18.08,-15.97,17z'), null);
  assert.strictEqual(extractPlaceName('https://www.google.com/maps/@18.0858,-15.9785,17z'), null);
});

test('إحداثيات بالدرجات ليست اسم مكان', () => {
  const { extractPlaceName } = require('../public/js/parse.js');
  assert.strictEqual(extractPlaceName('https://www.google.com/maps/place/18%C2%B004\'31.5%22N+15%C2%B057\'18.8%22W/@18.0754,-15.9552,17z'), null);
  assert.strictEqual(extractPlaceName('https://www.google.com/maps/place/Pharmacie+Al+Birr/@18.07,-15.95,17z'), 'Pharmacie Al Birr');
});
