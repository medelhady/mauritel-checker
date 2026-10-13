'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Geo = require('../public/js/geo.js');
const { validateCollection } = require('../lib/validate.js');

const coll = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'coverage.geojson'), 'utf8'));

// نقطة داخلية لمضلع (بحث شبكي) كي لا نعتمد على مركز قد يقع خارج مضلع مقعّر
function interiorPoint(feature) {
  const ring = feature.geometry.coordinates[0];
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  for (let i = 1; i < 60; i++) {
    for (let j = 1; j < 60; j++) {
      const pt = [x0 + ((x1 - x0) * i) / 60, y0 + ((y1 - y0) * j) / 60];
      if (Geo.pointInGeometry(pt, feature.geometry)) return pt;
    }
  }
  throw new Error('لا نقطة داخلية');
}

test('ملف التغطية الحقيقي صالح ويحتوي 121 منطقة', () => {
  assert.strictEqual(validateCollection(coll, 'coverage'), null);
  assert.strictEqual(coll.features.length, 121);
  assert.ok(coll.features.every((f) => f.properties.verified === true));
  assert.strictEqual(coll.properties.complete, true);
});

test('نقطة داخل كل منطقة تُصنَّف داخل التغطية', () => {
  for (const f of coll.features) {
    const [lng, lat] = interiorPoint(f);
    const r = Geo.classify(lat, lng, coll);
    assert.strictEqual(r.status, 'inside', f.properties.name);
  }
});

test('نقطة في البحر غرب نواكشوط => خارج', () => {
  const r = Geo.classify(18.1, -16.6, coll);
  assert.strictEqual(r.status, 'outside');
  const near = Geo.nearestZone(18.1, -16.6, coll);
  assert.ok(near && near.meters > 0);
});

test('CV1Z02 شرق CV2Z01 كما في خريطة موريتل', () => {
  const c = (n) => {
    const f = coll.features.find((x) => x.properties.name === n);
    const r = f.geometry.coordinates[0];
    return r.reduce((a, p) => a + p[0], 0) / r.length;
  };
  assert.ok(c('CV1Z02') > c('CV2Z01'));
});

test('التحقق من المواقع المحفوظة وأسماء البادئات', () => {
  const { cleanPlace, cleanZoneArea } = require('../lib/validate.js');
  const ok = cleanPlace({ code: 'DN2Z01', area: 'دار النعيم', landmark: 'بوتيك جمبو' });
  assert.strictEqual(ok.item.code, 'DN2Z01');
  assert.ok(cleanPlace({ code: '<script>', area: 'x' }).error);
  assert.ok(cleanPlace({ code: 'DN2Z01' }).error);
  assert.ok(cleanPlace(null).error);
  assert.strictEqual(cleanZoneArea({ prefix: 'dn', name: 'دار النعيم' }).item.prefix, 'DN');
  assert.ok(cleanZoneArea({ prefix: 'D1', name: 'x' }).error);
  assert.ok(cleanZoneArea({ prefix: 'DN', name: '' }).error);
});

test('أكواد DN موجودة في بيانات موريتل (DN2Z01)', () => {
  assert.ok(coll.features.some((f) => f.properties.code === 'DN2Z01'));
});

test('تنظيف سجل الموقع المُرسل', () => {
  const { cleanLocation } = require('../lib/validate.js');
  const ok = cleanLocation({ lat: '18.075411', lng: -15.95523, code: ' CA1Z02 ', status: 'inside', area: 'كرفور عرفات', link: 'https://maps.app.goo.gl/x' });
  assert.strictEqual(ok.item.code, 'CA1Z02');
  assert.strictEqual(ok.item.status, 'inside');
  assert.ok(cleanLocation({ lat: 'x', lng: 1 }).error);
  assert.ok(cleanLocation({ lat: 100, lng: 1 }).error);
  assert.strictEqual(cleanLocation({ lat: 1, lng: 1, status: 'hack' }).item.status, 'unknown');
});
