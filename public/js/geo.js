/*
 * منطق التحقق: هل النقطة داخل مضلعات التغطية؟
 * لا يخمّن أبدًا: بدون بيانات موثوقة تكون النتيجة "unknown".
 *
 * صيغة البيانات (GeoJSON FeatureCollection):
 *  - collection.properties.complete = true  -> أؤكد أن المضلعات تغطي كل مناطق الألياف (وإلا لا يُحكم بـ "خارج")
 *  - feature.properties.verified   = true  -> المضلع من مصدر موثوق (رسمي أو مؤكد يدويًا)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Geo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var NEAR_BOUNDARY_METERS = 30;

  // نقطة [lng, lat] داخل حلقة؟ (Ray casting)
  function pointInRing(pt, ring) {
    var x = pt[0], y = pt[1], inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1];
      var xj = ring[j][0], yj = ring[j][1];
      var hit = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (hit) inside = !inside;
    }
    return inside;
  }

  // coords = [outer, hole1, hole2...]
  function pointInPolygonCoords(pt, coords) {
    if (!coords || !coords.length || !pointInRing(pt, coords[0])) return false;
    for (var h = 1; h < coords.length; h++) {
      if (pointInRing(pt, coords[h])) return false;
    }
    return true;
  }

  function pointInGeometry(pt, geom) {
    if (!geom) return false;
    if (geom.type === 'Polygon') return pointInPolygonCoords(pt, geom.coordinates);
    if (geom.type === 'MultiPolygon') {
      return geom.coordinates.some(function (p) { return pointInPolygonCoords(pt, p); });
    }
    return false;
  }

  // مسافة تقريبية (متر) من نقطة إلى قطعة مستقيمة، بإسقاط محلي مسطح
  function distToSegmentMeters(pt, a, b) {
    var lat0 = (pt[1] * Math.PI) / 180;
    var kx = 111320 * Math.cos(lat0);
    var ky = 110540;
    var px = 0, py = 0;
    var ax = (a[0] - pt[0]) * kx, ay = (a[1] - pt[1]) * ky;
    var bx = (b[0] - pt[0]) * kx, by = (b[1] - pt[1]) * ky;
    var dx = bx - ax, dy = by - ay;
    var len2 = dx * dx + dy * dy;
    var t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    var cx = ax + t * dx, cy = ay + t * dy;
    return Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
  }

  function ringsOf(geom) {
    if (!geom) return [];
    if (geom.type === 'Polygon') return geom.coordinates;
    if (geom.type === 'MultiPolygon') return [].concat.apply([], geom.coordinates);
    return [];
  }

  function distanceToBoundaryMeters(pt, geom) {
    var best = Infinity;
    ringsOf(geom).forEach(function (ring) {
      for (var i = 0; i < ring.length - 1; i++) {
        var d = distToSegmentMeters(pt, ring[i], ring[i + 1]);
        if (d < best) best = d;
      }
    });
    return best;
  }

  function polygonFeatures(collection) {
    var feats = (collection && collection.features) || [];
    return feats.filter(function (f) {
      return f && f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon');
    });
  }

  /**
   * status:
   *   inside   : داخل مضلع موثوق
   *   outside  : خارج كل المضلعات، والبيانات معلنة كاملة وموثوقة
   *   unknown  : غير مؤكد (reason يوضح السبب)
   */
  function classify(lat, lng, collection) {
    var pt = [lng, lat];
    var feats = polygonFeatures(collection);
    var meta = (collection && collection.properties) || {};

    if (!feats.length) {
      return { status: 'unknown', reason: 'no_data', matches: [], nearBoundary: false, distanceToBoundary: null };
    }

    var hits = feats.filter(function (f) { return pointInGeometry(pt, f.geometry); });
    var verifiedHits = hits.filter(function (f) { return f.properties && f.properties.verified === true; });

    var minDist = Infinity;
    feats.forEach(function (f) {
      if (f.properties && f.properties.verified === true) {
        var d = distanceToBoundaryMeters(pt, f.geometry);
        if (d < minDist) minDist = d;
      }
    });
    var near = isFinite(minDist) && minDist <= NEAR_BOUNDARY_METERS;
    var dist = isFinite(minDist) ? Math.round(minDist) : null;

    if (verifiedHits.length) {
      return { status: 'inside', reason: 'verified_polygon', matches: verifiedHits, nearBoundary: near, distanceToBoundary: dist };
    }
    if (hits.length) {
      return { status: 'unknown', reason: 'draft_only', matches: hits, nearBoundary: false, distanceToBoundary: dist };
    }

    var verifiedCount = feats.filter(function (f) { return f.properties && f.properties.verified === true; }).length;
    if (meta.complete === true && verifiedCount > 0) {
      return { status: 'outside', reason: 'outside_complete_data', matches: [], nearBoundary: near, distanceToBoundary: dist };
    }
    return { status: 'unknown', reason: 'incomplete_data', matches: [], nearBoundary: false, distanceToBoundary: dist };
  }

  // أقرب منطقة موثوقة (معلومة فقط): {name, meters} أو null
  function nearestZone(lat, lng, collection) {
    var pt = [lng, lat], best = null;
    polygonFeatures(collection).forEach(function (f) {
      if (!(f.properties && f.properties.verified === true)) return;
      var d = distanceToBoundaryMeters(pt, f.geometry);
      if (!best || d < best.meters) best = { name: f.properties.name || f.properties.code || 'بدون اسم', meters: d };
    });
    return best;
  }

  function haversineMeters(lat1, lng1, lat2, lng2) {
    var R = 6371000, toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad, dLng = (lng2 - lng1) * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  return {
    NEAR_BOUNDARY_METERS: NEAR_BOUNDARY_METERS,
    pointInRing: pointInRing,
    pointInGeometry: pointInGeometry,
    distanceToBoundaryMeters: distanceToBoundaryMeters,
    classify: classify,
    nearestZone: nearestZone,
    haversineMeters: haversineMeters
  };
});
