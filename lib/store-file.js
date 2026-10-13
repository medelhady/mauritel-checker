'use strict';
/* التخزين المحلي في ملفات data/ (للتشغيل على جهازك) */
const fs = require('fs');
const path = require('path');
const { newId, locationKey } = require('./validate');

const MAX_LOCATIONS = 20000;

function createFileStore(dataDir) {
  const FILES = {
    coverage: path.join(dataDir, 'coverage.geojson'),
    pos: path.join(dataDir, 'pos.geojson'),
    places: path.join(dataDir, 'places.json'),
    zoneAreas: path.join(dataDir, 'zone-areas.json'),
    locations: path.join(dataDir, 'locations.json')
  };
  const BACKUPS = path.join(dataDir, 'backups');

  function readJson(file, empty) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return empty; }
  }
  function atomicWrite(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  }
  function saveWithBackup(kind, text) {
    const file = FILES[kind];
    fs.mkdirSync(BACKUPS, { recursive: true });
    if (fs.existsSync(file)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(file, path.join(BACKUPS, kind + '-' + stamp + path.extname(file)));
    }
    atomicWrite(file, text);
  }

  return {
    mode: 'file',

    // حدود التغطية ونقاط البيع (ملفات GeoJSON)
    async readStatic(kind) {
      try { return fs.readFileSync(FILES[kind], 'utf8'); } catch (e) { return null; }
    },
    async writeStatic(kind, text) { saveWithBackup(kind, text); },

    async listPlaces() {
      const j = readJson(FILES.places, { items: [] });
      return Array.isArray(j.items) ? j.items : [];
    },
    async addPlace(item) {
      const items = await this.listPlaces();
      const full = Object.assign({ id: newId('p') }, item, { createdAt: new Date().toISOString().slice(0, 10) });
      items.push(full);
      saveWithBackup('places', JSON.stringify({ items }, null, 2));
      return full;
    },

    async getZoneAreas() {
      const j = readJson(FILES.zoneAreas, { prefixes: {} });
      return j && j.prefixes && typeof j.prefixes === 'object' ? j : { prefixes: {} };
    },
    async setZoneArea(prefix, name) {
      const j = await this.getZoneAreas();
      j.prefixes[prefix] = name;
      saveWithBackup('zoneAreas', JSON.stringify(j, null, 2));
    },

    async listLocations() {
      const j = readJson(FILES.locations, { items: [] });
      return Array.isArray(j.items) ? j.items : [];
    },
    // يحفظ الموقع أو يحدّث سجلًا موجودًا لنفس النقطة (تقريبًا 1 متر) بدل التكرار
    async upsertLocation(item) {
      const items = await this.listLocations();
      const now = new Date().toISOString();
      const key = locationKey(item);
      const ex = items.find((x) => locationKey(x) === key);
      let out;
      if (ex) {
        ex.code = item.code; ex.status = item.status;
        ex.area = item.area || ex.area; ex.landmark = item.landmark || ex.landmark; ex.link = item.link || ex.link;
        ex.lastSeen = now; ex.count = (ex.count || 1) + 1;
        out = { ok: true, existing: true, count: ex.count };
      } else {
        if (items.length >= MAX_LOCATIONS) return { ok: false, error: 'السجل ممتلئ' };
        items.push(Object.assign({ id: newId('l') }, item, { count: 1, firstSeen: now, lastSeen: now }));
        out = { ok: true, existing: false, count: 1 };
      }
      atomicWrite(FILES.locations, JSON.stringify({ items }, null, 2));
      return out;
    }
  };
}

module.exports = { createFileStore };
