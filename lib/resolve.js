'use strict';
/* فك روابط Google Maps المختصرة + اسم الحي من Google (اختياري) */
const { extractCoords, extractFromHtml, extractPlaceName, inNouakchottBox } = require('../public/js/parse.js');

// نسمح فقط بمضيفات Google Maps عند فك الروابط (حماية من إساءة استخدام الخادم)
const ALLOWED_HOSTS = [
  /^maps\.app\.goo\.gl$/i,
  /^goo\.gl$/i,
  /^g\.co$/i,
  /^(www\.)?google\.[a-z.]+$/i,
  /^maps\.google\.[a-z.]+$/i
];
const hostAllowed = (hostname) => ALLOWED_HOSTS.some((re) => re.test(hostname));

async function resolveLink(input) {
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : 'https://' + input);
  } catch (e) {
    return { ok: false, error: 'الرابط غير صالح' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, error: 'الرابط غير صالح' };
  if (!hostAllowed(url.hostname)) return { ok: false, error: 'يُقبل فقط رابط من Google Maps' };

  const done = (c, finalUrl) => ({
    ok: true,
    lat: c.lat,
    lng: c.lng,
    source: c.source, // pin = دبوس دقيق، viewport = مركز العرض (قد لا يكون موقع العميل بدقة)
    finalUrl,
    placeName: extractPlaceName(finalUrl),
    inNouakchott: inNouakchottBox(c.lat, c.lng)
  });

  const direct = extractCoords(url.href);
  if (direct) return done(direct, url.href);

  const headers = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
    'Accept-Language': 'en'
  };

  for (let hop = 0; hop < 8; hop++) {
    let r;
    try {
      r = await fetch(url, { redirect: 'manual', headers, signal: AbortSignal.timeout(10000) });
    } catch (e) {
      return { ok: false, error: 'تعذّر فتح الرابط (تحقق من اتصال الإنترنت): ' + (e.cause && e.cause.code ? e.cause.code : e.message) };
    }

    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc) {
      let next;
      try { next = new URL(loc, url); } catch (e) { return { ok: false, error: 'تحويل غير صالح' }; }
      // صفحة موافقة Google: الرابط الحقيقي في المعامل continue
      if (/^consent\./i.test(next.hostname) && next.searchParams.get('continue')) {
        try { next = new URL(next.searchParams.get('continue')); } catch (e) { /* يبقى كما هو */ }
      }
      if (!hostAllowed(next.hostname)) return { ok: false, error: 'التحويل ذهب إلى موقع غير مسموح' };
      const c = extractCoords(next.href);
      if (c) return done(c, next.href);
      url = next;
      continue;
    }

    const html = (await r.text()).slice(0, 1024 * 1024);
    const c = extractFromHtml(html);
    if (c) return done(c, url.href);
    return { ok: false, error: 'لم أجد إحداثيات في هذا الرابط. افتحه وانسخ الرابط الطويل أو الإحداثيات يدويًا.' };
  }
  return { ok: false, error: 'تحويلات كثيرة جدًا' };
}

// اسم الحي من Google (يحتاج مفتاح Geocoding API؛ المفتاح يبقى على الخادم ولا يصل للمتصفح)
async function googleReverse(lat, lng, env) {
  const key = (env || process.env).GOOGLE_MAPS_API_KEY;
  if (!key) return { ok: false, error: 'no_key' };
  const u = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  u.searchParams.set('latlng', lat + ',' + lng);
  u.searchParams.set('language', 'ar');
  u.searchParams.set('key', key);
  let j;
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
    j = await r.json();
  } catch (e) {
    return { ok: false, error: 'network' };
  }
  if (j.status !== 'OK') return { ok: false, error: 'google_' + j.status };
  const comps = {};
  (j.results || []).forEach((res) =>
    (res.address_components || []).forEach((c) =>
      (c.types || []).forEach((t) => { if (!comps[t]) comps[t] = c.long_name; })));
  return {
    ok: true,
    source: 'google',
    neighborhood: comps.neighborhood || comps.sublocality_level_1 || comps.sublocality || null,
    locality: comps.locality || null,
    street: comps.route || null,
    formatted: j.results[0] ? j.results[0].formatted_address : null
  };
}

module.exports = { resolveLink, googleReverse, hostAllowed };
