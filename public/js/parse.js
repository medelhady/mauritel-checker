/*
 * استخراج الإحداثيات من نص أو رابط Google Maps.
 * يعمل في المتصفح وفي Node (نفس الملف).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MapParse = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';

  // مستطيل تقريبي يغطي نواكشوط (للتنبيه فقط، وليس لتحديد التغطية)
  var NOUAKCHOTT_BBOX = { south: 17.9, west: -16.1, north: 18.3, east: -15.8 };

  // مستطيل تقريبي لموريتانيا (للتنبيه من رابط خاطئ فقط)
  var MAURITANIA_BBOX = { south: 14.7, west: -17.2, north: 27.4, east: -4.7 };

  function inMauritania(lat, lng) {
    var b = MAURITANIA_BBOX;
    return lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
  }

  function valid(lat, lng) {
    return (
      isFinite(lat) && isFinite(lng) &&
      Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
      !(lat === 0 && lng === 0)
    );
  }

  function inNouakchottBox(lat, lng) {
    var b = NOUAKCHOTT_BBOX;
    return lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
  }

  /**
   * يحاول استخراج {lat, lng, source} من نص.
   * الأولوية: دبوس المكان (!3d!4d) ثم q=/ll=/center= ثم @lat,lng ثم "lat,lng" مجردة.
   */
  function extractCoords(text) {
    if (!text) return null;
    var s = String(text).trim();
    try { s = decodeURIComponent(s); } catch (e) { /* تجاهل */ }

    var rules = [
      { name: 'pin', re: new RegExp('!3d' + NUM + '!4d' + NUM) },
      { name: 'query', re: new RegExp('[?&](?:q|query|ll|center|destination|daddr|sll)=\\+?' + NUM + '\\s*,\\s*\\+?' + NUM) },
      { name: 'viewport', re: new RegExp('@' + NUM + ',' + NUM) },
      { name: 'plain', re: new RegExp('^\\s*' + NUM + '\\s*[,;\\s]\\s*' + NUM + '\\s*$') }
    ];

    for (var i = 0; i < rules.length; i++) {
      var m = rules[i].re.exec(s);
      if (!m) continue;
      var lat = parseFloat(m[1]);
      var lng = parseFloat(m[2]);
      if (valid(lat, lng)) return { lat: lat, lng: lng, source: rules[i].name };
    }
    return null;
  }

  /** استخراج إحداثيات من وسوم meta في صفحة HTML (og:image / canonical). */
  function extractFromHtml(html) {
    if (!html) return null;
    var metas = html.match(/<meta[^>]+(?:og:image|og:url|twitter:image)[^>]*>/gi) || [];
    var links = html.match(/<link[^>]+canonical[^>]*>/gi) || [];
    var all = metas.concat(links);
    for (var i = 0; i < all.length; i++) {
      var c = /content=["']([^"']+)["']/i.exec(all[i]) || /href=["']([^"']+)["']/i.exec(all[i]);
      if (!c) continue;
      var found = extractCoords(c[1].replace(/&amp;/g, '&'));
      if (found && found.source !== 'plain') return found;
    }
    return null;
  }

  /** اسم المكان من رابط Google Maps الطويل (/maps/place/NAME/@...) إن وُجد. */
  function extractPlaceName(url) {
    var m = /\/maps\/place\/([^\/@?]+)/.exec(String(url || ''));
    if (!m) return null;
    var n;
    try { n = decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { n = m[1].replace(/\+/g, ' '); }
    n = n.trim();
    if (!n || /^-?\d+(\.\d+)?\s*,\s*-?\d+/.test(n)) return null; // إحداثيات وليست اسمًا
    if (/\d\s*[°′″'"]/.test(n)) return null;                    // إحداثيات بالدرجات (DMS)
    if (/^[\d\s.,+\-°′″'"NSEWnsew]+$/.test(n)) return null;     // أرقام ورموز فقط
    return n;
  }

  function isShortLink(text) {
    return /^(https?:\/\/)?(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)\b/i.test(String(text || '').trim());
  }

  return {
    NOUAKCHOTT_BBOX: NOUAKCHOTT_BBOX,
    extractCoords: extractCoords,
    extractFromHtml: extractFromHtml,
    extractPlaceName: extractPlaceName,
    isShortLink: isShortLink,
    inNouakchottBox: inNouakchottBox,
    inMauritania: inMauritania,
    valid: valid
  };
});
