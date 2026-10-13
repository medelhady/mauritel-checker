'use strict';
/*
 * يحوّل ملف zones_ftth.json (من خريطة موريتل الرسمية) إلى data/coverage.geojson
 *
 * الاستخدام:
 *   node scripts/convert-zones.js مسار/zones_ftth.json
 *
 * صيغة الدخل: [ { "name": "CV1Z02", "coordinates": [ {"lat":..,"lng":..}, ... ] }, ... ]
 * الصفحة الرسمية ترسم كل المناطق الموجودة في الملف بنفس التنسيق، أي أن كل منطقة فيه
 * تُعتبر منطقة ألياف (FTTH) في الخريطة الرسمية، لذلك تُحفظ verified=true و complete=true.
 * يُحفظ نسخة احتياطية من الملف القديم في data/backups قبل الاستبدال.
 */
const fs = require('fs');
const path = require('path');

const input = process.argv[2];
if (!input) {
  console.error('الاستخدام: node scripts/convert-zones.js <مسار zones_ftth.json>');
  process.exit(1);
}

const DATA = path.join(__dirname, '..', 'data');
const OUT = path.join(DATA, 'coverage.geojson');
const SOURCE_COPY = path.join(DATA, 'source', 'zones_ftth.json');
const SOURCE_URL = 'https://www.mauritel.mr/ftthZones/zones_ftth.json';

const zones = JSON.parse(fs.readFileSync(input, 'utf8'));
if (!Array.isArray(zones)) throw new Error('الملف يجب أن يكون قائمة مناطق');

const CODE_RE = /^[A-Z]{2,3}\d?Z\d{2}\b/; // مثل CV1Z02 و DBZ01 و AT1Z01 (pilot site)

const features = zones.map((z, i) => {
  const name = String(z.name || '').trim();
  if (!name || !Array.isArray(z.coordinates)) throw new Error('منطقة غير صالحة رقم ' + i);

  const ring = z.coordinates.map((c) => {
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) throw new Error('إحداثيات غير رقمية في ' + name);
    return [c.lng, c.lat]; // GeoJSON = [خط الطول, خط العرض]
  });
  const first = ring[0], last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  if (ring.length < 4) throw new Error('عدد نقاط غير كافٍ في ' + name);

  const m = CODE_RE.exec(name);
  return {
    type: 'Feature',
    properties: { name: name, code: m ? m[0] : null, verified: true, source: SOURCE_URL },
    geometry: { type: 'Polygon', coordinates: [ring] }
  };
});

const names = features.map((f) => f.properties.name);
const dupes = names.filter((n, i) => names.indexOf(n) !== i);
if (dupes.length) console.warn('تنبيه: أسماء مكررة:', dupes.join(', '));

const today = new Date().toISOString().slice(0, 10);
const collection = {
  type: 'FeatureCollection',
  properties: {
    operator: 'Moov Mauritel',
    network: 'FTTH',
    complete: true,
    source: SOURCE_URL,
    exportedAt: today,
    note: 'مناطق الخريطة الرسمية لموريتل كما صُدّرت في exportedAt. «خارج التغطية» تعني خارج هذه المناطق المنشورة، وقد لا تعكس توسعًا حديثًا.'
  },
  features: features
};

fs.mkdirSync(path.join(DATA, 'backups'), { recursive: true });
fs.mkdirSync(path.dirname(SOURCE_COPY), { recursive: true });
if (fs.existsSync(OUT)) {
  fs.copyFileSync(OUT, path.join(DATA, 'backups', 'coverage-before-import-' + Date.now() + '.geojson'));
}
fs.copyFileSync(input, SOURCE_COPY);
fs.writeFileSync(OUT, JSON.stringify(collection));

console.log('تم: ' + features.length + ' منطقة -> ' + path.relative(process.cwd(), OUT));
console.log('بدون كود قياسي: ' + features.filter((f) => !f.properties.code).map((f) => f.properties.name).join(', '));
