/* واجهة الأداة: خريطة Leaflet + التحقق من التغطية + تحرير الحدود */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var NOUAKCHOTT = [18.0866, -15.9785];

  // ---------- الخريطة ----------
  var map = L.map('map', { zoomControl: true }).setView(NOUAKCHOTT, 12);
  var street = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© مساهمو OpenStreetMap'
  }).addTo(map);
  var sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: 'Imagery © Esri'
  });

  var zones = L.featureGroup().addTo(map);     // مضلعات التغطية (قابلة للتحرير)
  var posGroup = L.featureGroup().addTo(map);  // نقاط البيع
  var pointMarker = null;                       // نقطة العميل
  var pointLabel = null;
  var current = null;                           // {lat, lng, source}
  var busy = false;                             // أثناء الرسم/التحرير لا نلتقط نقرات الخريطة
  var dirty = false;
  var coverageMeta = {};
  var drawControl = null;

  // ---------- أدوات مساعدة ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtDist(m) { return m < 1000 ? Math.round(m) + ' م' : (m / 1000).toFixed(1) + ' كم'; }
  function setDirty(v) {
    dirty = v;
    $('saveMsg').textContent = v ? 'توجد تغييرات غير محفوظة.' : '';
  }

  function styleFor(layer) {
    var verified = layer.feature && layer.feature.properties && layer.feature.properties.verified === true;
    layer.setStyle(verified
      ? { color: '#157f3b', weight: 2, fillColor: '#2fb35f', fillOpacity: 0.25, dashArray: null }
      : { color: '#d98a00', weight: 2, fillColor: '#f5b83d', fillOpacity: 0.15, dashArray: '6 6' });
    layer.unbindTooltip();
    var name = (layer.feature && layer.feature.properties && layer.feature.properties.name) || 'منطقة بدون اسم';
    layer.bindTooltip(esc(name) + (verified ? ' ✓ موثوق' : ' (مسودة)'), { sticky: true });
  }

  function addZoneLayer(layer) {
    styleFor(layer);
    zones.addLayer(layer);
  }

  function coverageFromMap() {
    var features = [];
    zones.eachLayer(function (l) {
      var f = l.toGeoJSON();
      f.properties = Object.assign({}, l.feature && l.feature.properties);
      features.push(f);
    });
    return {
      type: 'FeatureCollection',
      properties: Object.assign({}, coverageMeta),
      features: features
    };
  }

  function posFromMap() {
    var features = [];
    posGroup.eachLayer(function (l) {
      var ll = l.getLatLng();
      features.push({
        type: 'Feature',
        properties: Object.assign({}, l.feature && l.feature.properties),
        geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] }
      });
    });
    return { type: 'FeatureCollection', features: features };
  }

  // ---------- تحميل البيانات ----------
  function loadData() {
    return Promise.all([
      apiFetch('/api/coverage').then(function (r) { return r.json(); }),
      apiFetch('/api/pos').then(function (r) { return r.json(); })
    ]).then(function (res) {
      var cov = res[0], pos = res[1];
      coverageMeta = cov.properties || {};
      zones.clearLayers();
      L.geoJSON(cov, {
        filter: function (f) { return f.geometry && /Polygon/.test(f.geometry.type); }
      }).eachLayer(addZoneLayer);

      posGroup.clearLayers();
      (pos.features || []).forEach(function (f) {
        if (!f.geometry || f.geometry.type !== 'Point') return;
        addPosMarker(f.geometry.coordinates[1], f.geometry.coordinates[0], f.properties || {});
      });
      $('completeToggle').checked = coverageMeta.complete === true;
      renderDataStatus();
      renderZoneList();
      setDirty(false);
    }).catch(function () {
      $('dataStatus').textContent = 'تعذّر تحميل البيانات. تأكد أن الخادم يعمل.';
    });
  }

  function addPosMarker(lat, lng, props) {
    var m = L.marker([lat, lng], { title: props.name || 'نقطة بيع' });
    m.feature = { type: 'Feature', properties: props };
    m.bindTooltip(esc(props.name || 'نقطة بيع موريتل'));
    posGroup.addLayer(m);
    return m;
  }

  function renderDataStatus() {
    var n = 0, v = 0;
    zones.eachLayer(function (l) { n++; if (l.feature.properties.verified === true) v++; });
    var msg;
    if (n === 0) msg = 'لا توجد حدود تغطية بعد: كل النتائج ستكون «غير مؤكد».';
    else if (v === 0) msg = n + ' مضلع كلها مسودات غير موثوقة: النتائج «غير مؤكد».';
    else msg = v + ' مضلع موثوق من أصل ' + n + (coverageMeta.complete ? ' — البيانات معلنة كاملة.' : ' — البيانات غير معلنة كاملة، فلن يُحكم بـ «خارج التغطية».');
    $('dataStatus').textContent = msg;
  }

  function renderZoneList() {
    var ul = $('zoneList');
    ul.innerHTML = '';
    zones.eachLayer(function (layer) {
      var li = document.createElement('li');
      var name = document.createElement('input');
      name.type = 'text';
      name.value = layer.feature.properties.name || '';
      name.placeholder = 'اسم المنطقة';
      name.addEventListener('change', function () {
        layer.feature.properties.name = name.value;
        styleFor(layer); setDirty(true);
      });
      var vl = document.createElement('label');
      vl.className = 'verified';
      var vc = document.createElement('input');
      vc.type = 'checkbox';
      vc.checked = layer.feature.properties.verified === true;
      vc.addEventListener('change', function () {
        layer.feature.properties.verified = vc.checked;
        styleFor(layer); setDirty(true); renderDataStatus(); reclassify();
      });
      vl.appendChild(vc);
      vl.appendChild(document.createTextNode('موثوق'));
      var zoom = document.createElement('button');
      zoom.textContent = 'عرض';
      zoom.addEventListener('click', function () { map.fitBounds(layer.getBounds()); });
      var del = document.createElement('button');
      del.textContent = 'حذف';
      del.addEventListener('click', function () {
        if (!confirm('حذف هذه المنطقة؟')) return;
        zones.removeLayer(layer); setDirty(true); renderZoneList(); renderDataStatus(); reclassify();
      });
      li.appendChild(name); li.appendChild(vl); li.appendChild(zoom); li.appendChild(del);
      ul.appendChild(li);
    });
  }

  // ---------- نقطة العميل والنتيجة ----------
  function setPoint(lat, lng, source, note, placeName, rawInput) {
    current = { lat: lat, lng: lng, source: source };
    logPending = rawInput ? { link: rawInput } : null; // نسجّل فقط المواقع المُرسلة كرابط/إحداثيات
    $('savedNote').classList.add('hidden');
    var hasPlace = !!placeName;
    $('resPlace').textContent = placeName || '';
    $('resPlace').classList.toggle('hidden', !hasPlace);
    $('resPlaceDt').classList.toggle('hidden', !hasPlace);
    if (pointMarker) map.removeLayer(pointMarker);
    pointMarker = L.circleMarker([lat, lng], {
      radius: 9, color: '#fff', weight: 3, fillColor: '#d6232a', fillOpacity: 1
    }).addTo(map);
    map.flyTo([lat, lng], Math.max(map.getZoom(), 17), { duration: 0.6 });
    renderResult(note);
    scrollToResult();
    reverseGeocode(lat, lng, placeName);
  }

  // ينقل اللوحة إلى صندوق النتيجة مباشرة بدل أن يمرّر المستخدم بنفسه
  function scrollToResult() {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); // إخفاء لوحة المفاتيح على الجوال
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function reclassify() { if (current) renderResult(); }

  var RESULT_TEXT = {
    inside: ['✅ داخل التغطية', 'الموقع داخل مضلع تغطية موثوق.'],
    outside: ['❌ خارج التغطية', 'الموقع خارج كل مناطق الألياف المنشورة في الخريطة الرسمية لموريتل.'],
    unknown: ['❓ غير مؤكد', '']
  };
  var UNKNOWN_REASON = {
    no_data: 'لا توجد بيانات حدود تغطية محفوظة بعد، لذلك لا يمكن تأكيد أي موقع.',
    draft_only: 'الموقع داخل مضلع «مسودة» لم يُوثَّق بعد؛ لا يُعتبر تغطية مؤكدة.',
    incomplete_data: 'الموقع خارج المضلعات الموثوقة الحالية، لكن البيانات غير معلنة كاملة، فقد تكون المنطقة مغطاة ولم تُرسم بعد.'
  };

  function renderResult(note) {
    var c = current;
    var res = Geo.classify(c.lat, c.lng, coverageFromMap());
    lastRes = res;
    // (coverageFromMap تُستدعى أيضًا لاحقًا لأقرب منطقة؛ العدد صغير ولا يؤثر على السرعة)
    var box = $('result');
    box.classList.remove('hidden', 'inside', 'outside', 'unknown');
    box.classList.add(res.status);

    var t = RESULT_TEXT[res.status];
    $('resultBadge').textContent = t[0];
    lastBase = res.status === 'unknown' ? UNKNOWN_REASON[res.reason] : t[1];
    $('resultText').textContent = res.status === 'inside' ? '' : lastBase;
    lastZones = res.status === 'inside'
      ? res.matches.map(function (f) { return f.properties.code || f.properties.name || 'بدون اسم'; })
      : [];
    $('zoneCode').textContent = lastZones.join(' + ');
    $('zoneCode').classList.toggle('hidden', !lastZones.length);

    $('resCoords').textContent = c.lat.toFixed(6) + ', ' + c.lng.toFixed(6);
    var coll = coverageFromMap();
    var near = res.matches.length ? null : Geo.nearestZone(c.lat, c.lng, coll);
    $('resZone').textContent = res.matches.length
      ? res.matches.map(function (f) { return f.properties.code || f.properties.name || 'بدون اسم'; }).join('، ')
      : (near ? 'لا يوجد — أقرب منطقة: ' + near.name + ' (' + fmtDist(near.meters) + ' عن حدّها)' : '—');
    $('gmapsLink').href = 'https://www.google.com/maps?q=' + c.lat + ',' + c.lng;

    // أقرب نقطة بيع (معلومة فقط)
    var best = null;
    posGroup.eachLayer(function (l) {
      var p = l.getLatLng();
      var d = Geo.haversineMeters(c.lat, c.lng, p.lat, p.lng);
      if (!best || d < best.d) best = { d: d, name: (l.feature.properties.name || 'نقطة بيع') };
    });
    $('resPos').textContent = best ? best.name + ' — ' + fmtDist(best.d) + ' (للمعلومة فقط، لا يعني وجود تغطية)' : '—';

    var warns = [];
    if (note) warns.push(note);
    if (c.source === 'viewport') warns.push('الإحداثيات مأخوذة من مركز عرض الخريطة وليس من دبوس دقيق؛ قد تختلف عن موقع العميل الفعلي. اطلب منه مشاركة الموقع بالدبوس.');
    if (!MapParse.inMauritania(c.lat, c.lng)) warns.push('هذا الموقع خارج موريتانيا، تأكد من الرابط.');
    if (res.status === 'outside' && coverageMeta.exportedAt) warns.push('بيانات الخريطة الرسمية بتاريخ ' + coverageMeta.exportedAt + '؛ قد تكون هناك مناطق أُضيفت بعدها.');
    if (res.nearBoundary) warns.push('الموقع على بعد ~' + res.distanceToBoundary + ' م من حد التغطية؛ دقة الحدود المرسومة محدودة، تحقق ميدانيًا.');
    var w = $('resWarn');
    w.textContent = warns.join(' ');
    w.classList.toggle('hidden', !warns.length);
    renderSummary();
  }

  // جملة النتيجة: «الموقع في <الحي>، ضمن منطقة <الكود>»
  var lastZones = [];
  var areaName = null;
  var lastBase = '';
  function renderSummary() {
    if (lastZones.length) {
      // كود المنطقة ظاهر بخط كبير، فالجملة تذكر الموقع فقط
      $('resultText').textContent = areaName ? 'الموقع في ' + areaName : '';
    } else if (lastBase) {
      $('resultText').textContent = lastBase + (areaName ? ' (الموقع: ' + areaName + ')' : '');
    }
  }
  function showArea(parts, sources) {
    areaName = parts.join('، ');
    $('resArea').textContent = parts.join(' · ') + ' — ' + sources.join('، ');
    renderSummary();
  }

  // ---------- سجل المواقع المُرسلة ----------
  var logPending = null;
  var lastRes = null;
  var savedLocations = [];
  apiFetch('/api/locations').then(function (r) { return r.json(); })
    .then(function (j) { savedLocations = Array.isArray(j.items) ? j.items : []; })
    .catch(function () { /* اختياري */ });

  function logCurrent(token, area, landmark) {
    if (token !== geoToken || !logPending || !current || !lastRes) return;
    var payload = {
      lat: current.lat, lng: current.lng,
      code: lastZones[0] || null, status: lastRes.status,
      area: area, landmark: landmark, link: logPending.link
    };
    logPending = null; // مرة واحدة لكل فحص
    apiFetch('/api/locations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        if (!r.ok) return;
        var n = $('savedNote');
        n.textContent = r.existing ? '✓ الموقع محفوظ مسبقًا (المرة ' + r.count + ')' : '✓ تم حفظ الموقع مع كود المنطقة';
        n.classList.remove('hidden');
        // حدّث القائمة المحلية للبحث
        apiFetch('/api/locations').then(function (x) { return x.json(); })
          .then(function (j) { savedLocations = Array.isArray(j.items) ? j.items : savedLocations; });
      })
      .catch(function () { /* لا نزعج المستخدم */ });
  }

  // ---------- اسم الحي ----------
  // المصادر: بادئة كود موريتل (data/zone-areas.json) + Google (إن وُجد مفتاح) أو OpenStreetMap + معلم قريب (OpenStreetMap)
  var zoneAreas = { prefixes: {} };
  apiFetch('/api/zone-areas').then(function (r) { return r.json(); })
    .then(function (z) { if (z && z.prefixes) zoneAreas = z; })
    .catch(function () { /* اختياري */ });

  function zoneAreaFor(label) {
    if (!label) return null;
    var m = /^([A-Z]{2,3}?)\d?Z\d{2}\b/.exec(label);
    if (!m) return label; // منطقة باسم وصفي كامل مثل «Carrefour Arafat 3 Zone 4»
    return zoneAreas.prefixes[m[1]] || null;
  }

  var TYPE_WORDS = {
    pharmacy: 'صيدلية', hospital: 'مستشفى', clinic: 'عيادة', mosque: 'مسجد', school: 'مدرسة',
    bank: 'بنك', fuel: 'محطة وقود', restaurant: 'مطعم', marketplace: 'سوق', university: 'جامعة', supermarket: 'متجر'
  };
  var SKIP_AMENITY = { parking: 1, bench: 1, waste_basket: 1, atm: 1, toilets: 1, shelter: 1, bicycle_parking: 1 };

  function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, ms); })]);
  }

  function fetchGoogle(lat, lng) {
    return withTimeout(apiFetch('/api/geocode?lat=' + lat + '&lng=' + lng).then(function (r) { return r.json(); }), 9000)
      .catch(function () { return { ok: false }; });
  }
  function fetchOsm(lat, lng) {
    return withTimeout(fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&accept-language=ar&lat=' + lat + '&lon=' + lng)
      .then(function (r) { return r.json(); }), 9000).catch(function () { return null; });
  }
  function fetchLandmark(lat, lng) {
    var at = '(around:200,' + lat + ',' + lng + ')';
    var q = '[out:json][timeout:8];(nwr' + at + '[name][amenity];nwr' + at + '[name][shop];nwr' + at + '[name][tourism];nwr' + at + '[name][healthcare];);out center 40;';
    return withTimeout(fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q)
    }).then(function (r) { return r.json(); }), 9000).then(function (j) {
      var best = null;
      (j.elements || []).forEach(function (el) {
        var t = el.tags || {};
        if (SKIP_AMENITY[t.amenity]) return;
        var la = el.lat != null ? el.lat : el.center && el.center.lat;
        var lo = el.lon != null ? el.lon : el.center && el.center.lon;
        if (la == null) return;
        var nm = t['name:ar'] || t.name || t['name:fr'];
        if (!nm) return;
        var d = Geo.haversineMeters(lat, lng, la, lo);
        if (!best || d < best.d) {
          var word = TYPE_WORDS[t.amenity] || TYPE_WORDS[t.shop] || TYPE_WORDS[t.healthcare] || '';
          best = { d: d, text: (word && nm.indexOf(word) < 0 ? word + ' ' : '') + nm };
        }
      });
      return best ? best.text : null;
    }).catch(function () { return null; });
  }

  var geoToken = 0;
  function reverseGeocode(lat, lng) {
    var token = ++geoToken;
    areaName = null;
    $('resArea').textContent = 'جارٍ البحث…';
    Promise.all([fetchGoogle(lat, lng), fetchOsm(lat, lng), fetchLandmark(lat, lng)]).then(function (r) {
      if (token !== geoToken) return;
      var g = r[0], o = r[1], landmark = r[2];
      var a = (o && o.address) || {};
      var parts = [], src = [];
      function addSrc(s) { if (src.indexOf(s) < 0) src.push(s); }

      var za = zoneAreaFor(lastZones[0]);
      if (za) { parts.push(za); addSrc('خريطة موريتل'); }

      var gh = g && g.ok ? (g.neighborhood || g.locality) : null;
      var oh = a.neighbourhood || a.suburb || a.quarter || a.city_district;
      if (!za) {
        if (gh) { parts.push(gh); addSrc('Google Maps'); }
        else if (oh) { parts.push(oh); addSrc('OpenStreetMap'); }
      }

      if (landmark) { parts.push('قرب ' + landmark); addSrc('OpenStreetMap'); }

      if (!parts.length) {
        var street = (g && g.ok && g.street) || a.road;
        if (street) { parts.push(street); addSrc(g && g.ok ? 'Google Maps' : 'OpenStreetMap'); }
      }
      if (!parts.length) { $('resArea').textContent = 'غير متوفر'; logCurrent(token, '', ''); return; }
      showArea(parts, src);
      logCurrent(token, parts.filter(function (x) { return x.indexOf('قرب ') !== 0; }).join('، '), landmark || '');
    });
  }

  // ---------- إدخال الرابط ----------
  function showError(msg) {
    var box = $('result');
    box.classList.remove('hidden', 'inside', 'outside');
    box.classList.add('unknown');
    $('resultBadge').textContent = '⚠️ تعذّر استخراج الموقع';
    lastZones = [];
    $('zoneCode').classList.add('hidden');
    $('resultText').textContent = msg;
    ['resCoords', 'resZone', 'resPos'].forEach(function (id) { $(id).textContent = '—'; });
    $('resArea').textContent = '—';
    $('resWarn').classList.add('hidden');
    scrollToResult();
  }

  function checkInput() {
    var v = $('linkInput').value.trim();
    if (!v) return;
    var local = MapParse.extractCoords(v);
    if (local) return setPoint(local.lat, local.lng, local.source, null, MapParse.extractPlaceName(v), v);

    var btn = $('checkBtn');
    btn.disabled = true; btn.textContent = '...';
    apiFetch('/api/resolve?url=' + encodeURIComponent(v))
      .then(function (r) { return r.json(); })
      .then(function (r) {
        if (!r.ok) return showError(r.error || 'خطأ غير معروف');
        setPoint(r.lat, r.lng, r.source, null, r.placeName, v);
      })
      .catch(function () { showError('تعذّر الاتصال بالخادم المحلي.'); })
      .then(function () { btn.disabled = false; btn.textContent = 'تحقق'; });
  }
  $('checkBtn').addEventListener('click', checkInput);
  $('linkInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') checkInput(); });
  $('linkInput').addEventListener('paste', function () { setTimeout(checkInput, 50); });

  map.on('click', function (e) {
    if (busy) return;
    setPoint(e.latlng.lat, e.latlng.lng, 'click');
  });

  $('copyBtn').addEventListener('click', function () {
    if (!current) return;
    var text = current.lat.toFixed(6) + ', ' + current.lng.toFixed(6);
    if (navigator.clipboard) navigator.clipboard.writeText(text);
    $('copyBtn').textContent = 'تم النسخ ✓';
    setTimeout(function () { $('copyBtn').textContent = 'نسخ الإحداثيات'; }, 1200);
  });

  // ---------- البحث اليدوي ----------
  function doSearch() {
    var q = $('searchInput').value.trim();
    if (!q) return;
    var ul = $('searchResults');
    ul.innerHTML = '<li>جارٍ البحث…</li>';
    var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=mr&accept-language=ar' +
      '&viewbox=-16.1,18.3,-15.8,17.9&q=' + encodeURIComponent(q);
    fetch(url).then(function (r) { return r.json(); }).then(function (list) {
      ul.innerHTML = '';
      if (!list.length) { ul.innerHTML = '<li>لا نتائج</li>'; return; }
      list.forEach(function (p) {
        var li = document.createElement('li');
        li.textContent = p.display_name;
        li.addEventListener('click', function () {
          ul.innerHTML = '';
          setPoint(parseFloat(p.lat), parseFloat(p.lon), 'search', 'الموقع من نتيجة بحث وصفية، وليس موقع العميل بدقة.');
        });
        ul.appendChild(li);
      });
    }).catch(function () { ul.innerHTML = '<li>تعذّر البحث (تحقق من الإنترنت)</li>'; });
  }
  $('searchBtn').addEventListener('click', doSearch);
  $('searchInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });

  // ---------- الطبقات ----------
  $('satToggle').addEventListener('change', function (e) {
    if (e.target.checked) { sat.addTo(map); map.removeLayer(street); }
    else { street.addTo(map); map.removeLayer(sat); }
  });
  $('posToggle').addEventListener('change', function (e) {
    if (e.target.checked) posGroup.addTo(map); else map.removeLayer(posGroup);
  });

  // ---------- وضع التحرير (Leaflet.draw) ----------
  function enableEdit(on) {
    $('editTools').classList.toggle('hidden', !on);
    if (on && !drawControl) {
      drawControl = new L.Control.Draw({
        position: 'topleft',
        draw: { polyline: false, rectangle: false, circle: false, circlemarker: false, marker: true,
          polygon: { allowIntersection: false, showArea: false, shapeOptions: { color: '#d98a00' } } },
        edit: { featureGroup: zones }
      });
      map.addControl(drawControl);
    } else if (!on && drawControl) {
      map.removeControl(drawControl);
      drawControl = null;
    }
  }
  $('editToggle').addEventListener('change', function (e) { enableEdit(e.target.checked); });

  ['draw:drawstart', 'draw:editstart', 'draw:deletestart'].forEach(function (ev) { map.on(ev, function () { busy = true; }); });
  ['draw:drawstop', 'draw:editstop', 'draw:deletestop'].forEach(function (ev) {
    map.on(ev, function () { setTimeout(function () { busy = false; }, 250); });
  });

  map.on('draw:created', function (e) {
    if (e.layerType === 'marker') {
      var name = prompt('اسم نقطة البيع:', '') || 'نقطة بيع';
      var ll = e.layer.getLatLng();
      addPosMarker(ll.lat, ll.lng, { name: name });
      setDirty(true);
      return;
    }
    var zname = prompt('اسم المنطقة / الحي:', '') || 'منطقة جديدة';
    e.layer.feature = { type: 'Feature', properties: { name: zname, verified: false, source: 'manual' } };
    addZoneLayer(e.layer);
    setDirty(true); renderZoneList(); renderDataStatus(); reclassify();
  });
  map.on('draw:edited', function () { setDirty(true); reclassify(); });
  map.on('draw:deleted', function () { setDirty(true); renderZoneList(); renderDataStatus(); reclassify(); });

  $('completeToggle').addEventListener('change', function (e) {
    if (e.target.checked && !confirm('هل أنت متأكد أن المضلعات الموثوقة تغطي كل مناطق ألياف موريتل؟ سيُحكم على أي موقع خارجها بأنه «خارج التغطية».')) {
      e.target.checked = false; return;
    }
    coverageMeta.complete = e.target.checked;
    setDirty(true); renderDataStatus(); reclassify();
  });

  // ---------- الحفظ والتصدير والاستيراد ----------
  function postJson(url, obj) {
    return apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) })
      .then(function (r) { return r.json(); });
  }
  function putJson(url, obj) {
    return apiFetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) })
      .then(function (r) { return r.json(); });
  }
  $('saveBtn').addEventListener('click', function () {
    Promise.all([putJson('/api/coverage', coverageFromMap()), putJson('/api/pos', posFromMap())])
      .then(function (r) {
        if (!r[0].ok || !r[1].ok) { $('saveMsg').textContent = 'فشل الحفظ: ' + (r[0].error || r[1].error); return; }
        setDirty(false);
        $('saveMsg').textContent = 'تم الحفظ ✓ (نسخة احتياطية في data/backups).';
      })
      .catch(function () { $('saveMsg').textContent = 'فشل الحفظ: الخادم لا يستجيب.'; });
  });

  $('exportBtn').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(coverageFromMap(), null, 2)], { type: 'application/geo+json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mauritel-ftth-coverage.geojson';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  function parseKml(text) {
    var doc = new DOMParser().parseFromString(text, 'text/xml');
    var out = [];
    function ring(el) {
      var raw = (el && el.getElementsByTagName('coordinates')[0] || {}).textContent || '';
      return raw.trim().split(/\s+/).map(function (t) {
        var p = t.split(',').map(Number); return [p[0], p[1]];
      }).filter(function (p) { return isFinite(p[0]) && isFinite(p[1]); });
    }
    Array.prototype.forEach.call(doc.getElementsByTagName('Placemark'), function (pm) {
      var nm = pm.getElementsByTagName('name')[0];
      var polys = [];
      Array.prototype.forEach.call(pm.getElementsByTagName('Polygon'), function (pg) {
        var outer = ring(pg.getElementsByTagName('outerBoundaryIs')[0]);
        if (outer.length < 4) return;
        var rings = [outer];
        Array.prototype.forEach.call(pg.getElementsByTagName('innerBoundaryIs'), function (ib) {
          var r = ring(ib); if (r.length >= 4) rings.push(r);
        });
        polys.push(rings);
      });
      if (!polys.length) return;
      out.push({
        type: 'Feature',
        properties: { name: nm ? nm.textContent.trim() : '' },
        geometry: polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys }
      });
    });
    return { type: 'FeatureCollection', features: out };
  }

  $('importFile').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try {
        data = /\.kml$/i.test(file.name) ? parseKml(String(reader.result)) : JSON.parse(String(reader.result));
      } catch (err) { alert('تعذّرت قراءة الملف.'); return; }
      var added = 0;
      L.geoJSON(data, { filter: function (f) { return f.geometry && /Polygon/.test(f.geometry.type); } })
        .eachLayer(function (layer) {
          var p = (layer.feature && layer.feature.properties) || {};
          // المستورد يبقى «مسودة» حتى تؤكده أنت يدويًا
          layer.feature.properties = { name: p.name || p.Name || file.name, verified: false, source: 'import:' + file.name };
          addZoneLayer(layer); added++;
        });
      e.target.value = '';
      if (!added) { alert('لا توجد مضلعات في الملف.'); return; }
      setDirty(true); renderZoneList(); renderDataStatus(); reclassify();
      if (zones.getLayers().length) map.fitBounds(zones.getBounds());
      $('saveMsg').textContent = 'تم استيراد ' + added + ' مضلع كمسودات. راجعها ثم علّم «موثوق» ما تتأكد منه واحفظ.';
    };
    reader.readAsText(file);
  });

  // ---------- المواقع المحفوظة: كود + حي + معلم ----------
  var places = [];
  apiFetch('/api/places').then(function (r) { return r.json(); })
    .then(function (j) { places = Array.isArray(j.items) ? j.items : []; })
    .catch(function () { /* اختياري */ });

  function norm(x) { return String(x || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

  function findZoneLayers(code) {
    var c = norm(code), out = [];
    zones.eachLayer(function (l) {
      var p = l.feature.properties;
      if (norm(p.code) === c || norm(p.name) === c) out.push(l);
    });
    return out;
  }

  // عرض النتيجة انطلاقًا من الكود (بدون موقع دقيق للعميل)
  function showFromCode(code, place) {
    var layers = findZoneLayers(code);
    var box = $('result');
    box.classList.remove('hidden', 'inside', 'outside', 'unknown');
    lastZones = []; lastBase = ''; areaName = null; current = null; logPending = null;
    $('savedNote').classList.add('hidden');
    if (pointMarker) { map.removeLayer(pointMarker); pointMarker = null; }
    ['resPlace', 'resPlaceDt'].forEach(function (id) { $(id).classList.add('hidden'); });
    $('resCoords').textContent = '—';
    $('resPos').textContent = '—';

    if (!layers.length) {
      box.classList.add('unknown');
      $('resultBadge').textContent = '❓ غير مؤكد';
      $('zoneCode').classList.add('hidden');
      $('resultText').textContent = 'الكود «' + code + '» غير موجود في بيانات موريتل.';
      $('resZone').textContent = '—'; $('resArea').textContent = '—';
      $('resWarn').classList.add('hidden');
      scrollToResult();
      return;
    }

    var verified = layers.some(function (l) { return l.feature.properties.verified === true; });
    var fp = layers[0].feature.properties;
    var label = fp.code || fp.name;
    var parts = [];
    var areaTxt = (place && place.area) || zoneAreaFor(label);
    if (areaTxt) parts.push(areaTxt);
    if (place && place.landmark) parts.push('قرب ' + place.landmark);

    box.classList.add(verified ? 'inside' : 'unknown');
    $('resultBadge').textContent = verified ? '✅ داخل التغطية' : '❓ غير مؤكد';
    $('zoneCode').textContent = label;
    $('zoneCode').classList.toggle('hidden', !verified);
    $('resultText').textContent = verified
      ? (parts.length ? 'الموقع في ' + parts.join('، ') : '')
      : 'هذه المنطقة مسودة غير موثوقة.';
    $('resZone').textContent = label;
    $('resArea').textContent = parts.join(' · ') || '—';
    $('gmapsLink').removeAttribute('href');
    var w = $('resWarn');
    w.textContent = 'النتيجة حسب الكود المُدخل فقط، ولم يُتحقق من موقع العميل الدقيق.';
    w.classList.remove('hidden');
    scrollToResult();

    var grp = L.featureGroup(layers);
    map.fitBounds(grp.getBounds(), { maxZoom: 16 });
    layers.forEach(function (l) {
      l.setStyle({ weight: 5 });
      setTimeout(function () { styleFor(l); }, 2500);
    });
  }

  function placeLine(p) {
    return p.code + ' — ' + [p.area, p.landmark ? 'قرب ' + p.landmark : ''].filter(Boolean).join(' · ');
  }

  function lookup() {
    var q = norm($('lookupInput').value);
    var ul = $('lookupResults');
    ul.innerHTML = '';
    var items = [];
    function locLine(l) {
      return (l.code || 'بدون كود') + ' — ' + [l.area, l.landmark ? 'قرب ' + l.landmark : ''].filter(Boolean).join(' · ') +
        ' (موقع محفوظ)';
    }
    function locItem(l) {
      return { text: locLine(l), run: function () { setPoint(l.lat, l.lng, 'saved'); } };
    }
    if (!q) { // بدون نص: آخر المواقع المحفوظة
      savedLocations.slice().sort(function (a, b) { return String(b.lastSeen).localeCompare(String(a.lastSeen)); })
        .slice(0, 10).forEach(function (l) { items.push(locItem(l)); });
      if (!items.length) { ul.innerHTML = '<li>لا توجد مواقع محفوظة بعد.</li>'; return; }
      items.forEach(function (it) {
        var li = document.createElement('li');
        li.textContent = it.text;
        li.addEventListener('click', function () { ul.innerHTML = ''; it.run(); });
        ul.appendChild(li);
      });
      return;
    }
    savedLocations.forEach(function (l) {
      if (norm([l.code, l.area, l.landmark, l.link].join(' ')).indexOf(q) >= 0) items.push(locItem(l));
    });
    places.forEach(function (p) {
      if (norm([p.code, p.area, p.landmark].join(' ')).indexOf(q) >= 0) {
        items.push({ text: placeLine(p), run: function () { showFromCode(p.code, p); } });
      }
    });
    zones.eachLayer(function (l) {
      var pr = l.feature.properties, label = pr.code || pr.name;
      if (norm(label).indexOf(q) >= 0) {
        var za = zoneAreaFor(label);
        items.push({ text: label + ' (منطقة)' + (za ? ' — ' + za : ''), run: function () { showFromCode(label, null); } });
      }
    });
    if (!items.length) { ul.innerHTML = '<li>لا نتائج. تأكد من الكود، أو أضف الموقع من «إضافة موقع جديد».</li>'; return; }
    if (items.length === 1) { items[0].run(); return; }
    items.slice(0, 10).forEach(function (it) {
      var li = document.createElement('li');
      li.textContent = it.text;
      li.addEventListener('click', function () { ul.innerHTML = ''; it.run(); });
      ul.appendChild(li);
    });
  }
  $('lookupBtn').addEventListener('click', lookup);
  $('lookupInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') lookup(); });

  function plMsg(t) { $('plMsg').textContent = t; }
  $('plSave').addEventListener('click', function () {
    var code = $('plCode').value.trim().toUpperCase();
    var area = $('plArea').value.trim();
    var landmark = $('plLandmark').value.trim();
    if (!code) return plMsg('اكتب كود المنطقة.');
    var layers = findZoneLayers(code);
    if (!layers.length) return plMsg('الكود «' + code + '» غير موجود في بيانات موريتل. تأكد من كتابته.');
    if (!area && !landmark) return plMsg('اكتب الحي أو المعلم القريب.');
    var fp = layers[0].feature.properties;
    code = fp.code || fp.name; // الصيغة الرسمية للكود

    var m = /^([A-Z]{2,3}?)\d?Z\d{2}\b/.exec(code);
    var wantPrefix = $('plPrefix').checked && area && m;
    var reqs = [postJson('/api/places', { code: code, area: area, landmark: landmark })];
    if (wantPrefix) reqs.push(postJson('/api/zone-areas', { prefix: m[1], name: area }));
    Promise.all(reqs).then(function (res) {
      if (res.some(function (r) { return !r.ok; })) return plMsg('فشل الحفظ: ' + (res[0].error || (res[1] && res[1].error)));
      var item = res[0].item || { code: code, area: area, landmark: landmark };
      places = places.concat([item]);
      if (wantPrefix) zoneAreas.prefixes[m[1]] = area;
      ['plCode', 'plArea', 'plLandmark'].forEach(function (id) { $(id).value = ''; });
      $('plPrefix').checked = false;
      plMsg('تم الحفظ ✓ يمكنك استدعاؤه الآن بالكود أو الحي أو المعلم.');
      showFromCode(code, item);
    }).catch(function () { plMsg('فشل الحفظ: الخادم لا يستجيب.'); });
  });

  window.addEventListener('beforeunload', function (e) {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  loadData();
})();
