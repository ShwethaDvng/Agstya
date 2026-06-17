/* agstya.energy — Site Finder backend
 * Zero-dependency Node server (built-in http + native fetch, Node >= 18).
 * Proxies open data sources, computes suitability scores, caches results,
 * and serves the frontend in /public.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
// Nominatim/Overpass usage policy asks for an identifying User-Agent.
const UA = process.env.AGSTYA_UA || 'agstya.energy-site-finder/1.0 (contact@agstya.energy)';

// ---------- tiny TTL cache (respects upstream rate limits) ----------
const cache = new Map();
const cacheGet = k => { const e = cache.get(k); if (e && e.exp > Date.now()) return e.v; cache.delete(k); return null; };
const cacheSet = (k, v, ttlMs) => cache.set(k, { v, exp: Date.now() + ttlMs });

// ---------- helpers ----------
const clamp = (n, a = 0, b = 100) => Math.max(a, Math.min(b, n));
const round = Math.round;

async function jfetch(url, opts = {}, ms = 25000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) }, signal: ctrl.signal });
    if (!r.ok) throw new Error('upstream ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

const OVERPASS = 'https://overpass-api.de/api/interpreter';
async function overpassCount(query) {
  const d = await jfetch(OVERPASS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query)
  });
  const el = (d.elements || []).find(e => e.type === 'count');
  return el ? parseInt(el.tags.total || el.tags.nodes || '0', 10) : 0;
}

// ---------- live metrics ----------
async function getTerrain(lat, lng) {
  const d = 0.0015, dl = d / Math.cos(lat * Math.PI / 180);
  const lats = [lat, lat + d, lat - d, lat, lat].join(',');
  const lngs = [lng, lng, lng, lng + dl, lng - dl].join(',');
  const j = await jfetch(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`);
  const el = j.elevation;
  const ctr = el[0];
  const maxDiff = Math.max(...el.slice(1).map(v => Math.abs(v - ctr)));
  const slope = maxDiff / 167 * 100; // % grade over ~167 m
  return { score: round(clamp(100 - slope * 8)), elevation: round(ctr), slope: +slope.toFixed(1),
           fact: `Elevation ${round(ctr)} m · slope ≈ ${slope.toFixed(1)}% over 167 m` };
}

async function getFoot(lat, lng) {
  const q = `[out:json][timeout:25];(node(around:500,${lat},${lng})[shop];node(around:500,${lat},${lng})[amenity];node(around:500,${lat},${lng})[office];node(around:500,${lat},${lng})[public_transport];);out count;`;
  const n = await overpassCount(q);
  return { score: round(clamp(Math.log10(n + 1) / Math.log10(300) * 100)), count: n,
           fact: `${n} POIs (shops, transit, offices, amenities) within 500 m` };
}

async function getCompetition(lat, lng) {
  const q = `[out:json][timeout:25];(node(around:1500,${lat},${lng})[amenity=charging_station];);out count;`;
  const n = await overpassCount(q);
  return { score: round(clamp(100 - n * 12)), count: n };
}

// ---------- analyze (combined, cached) ----------
async function analyze(lat, lng) {
  const key = `a:${lat.toFixed(4)},${lng.toFixed(4)}`;
  const hit = cacheGet(key);
  if (hit) return { ...hit, cached: true };

  const [tr, ft, cp] = await Promise.allSettled([getTerrain(lat, lng), getFoot(lat, lng), getCompetition(lat, lng)]);
  const terrain = tr.status === 'fulfilled' ? tr.value : null;
  const foot = ft.status === 'fulfilled' ? ft.value : null;
  const comp = cp.status === 'fulfilled' ? cp.value : null;

  let roi = null;
  if (foot) {
    const c = comp ? comp.score : 70;
    const roiScore = round(clamp(0.55 * foot.score + 0.45 * c));
    const compTxt = comp ? `${comp.count} existing charger${comp.count === 1 ? '' : 's'} within 1.5 km` : 'competition unknown';
    roi = { score: roiScore, fact: `Demand proxy ${foot.score} + ${compTxt} → ROI index ${roiScore}.` };
  }

  const result = {
    lat, lng,
    terrain, foot, roi,
    competition: comp,
    errors: {
      terrain: tr.status === 'rejected' ? String(tr.reason && tr.reason.message || tr.reason) : null,
      foot: ft.status === 'rejected' ? String(ft.reason && ft.reason.message || ft.reason) : null,
      competition: cp.status === 'rejected' ? String(cp.reason && cp.reason.message || cp.reason) : null
    },
    cached: false
  };
  // cache only if at least one live metric succeeded
  if (terrain || foot) cacheSet(key, result, 1000 * 60 * 30); // 30 min
  return result;
}

async function geocode(q) {
  const key = 'g:' + q.toLowerCase();
  const hit = cacheGet(key); if (hit) return hit;
  const j = await jfetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`);
  const out = (j && j[0]) ? { lat: +j[0].lat, lng: +j[0].lon, label: j[0].display_name } : null;
  if (out) cacheSet(key, out, 1000 * 60 * 60 * 24); // 1 day
  return out;
}

async function reverse(lat, lng) {
  const key = `r:${lat.toFixed(4)},${lng.toFixed(4)}`;
  const hit = cacheGet(key); if (hit) return hit;
  const j = await jfetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`);
  const out = { label: j && j.display_name ? j.display_name : null };
  if (out.label) cacheSet(key, out, 1000 * 60 * 60 * 24);
  return out;
}

// ---------- static file serving ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };
function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

// ---------- router ----------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const p = u.pathname;
  try {
    if (p === '/api/health') return sendJSON(res, 200, { ok: true, ts: Date.now() });

    if (p === '/api/geocode') {
      const q = u.searchParams.get('q');
      if (!q) return sendJSON(res, 400, { error: 'missing q' });
      const r = await geocode(q);
      return r ? sendJSON(res, 200, r) : sendJSON(res, 404, { error: 'no match' });
    }

    if (p === '/api/reverse') {
      const lat = parseFloat(u.searchParams.get('lat')), lng = parseFloat(u.searchParams.get('lng'));
      if (Number.isNaN(lat) || Number.isNaN(lng)) return sendJSON(res, 400, { error: 'bad coords' });
      return sendJSON(res, 200, await reverse(lat, lng));
    }

    if (p === '/api/analyze') {
      const lat = parseFloat(u.searchParams.get('lat')), lng = parseFloat(u.searchParams.get('lng'));
      if (Number.isNaN(lat) || Number.isNaN(lng)) return sendJSON(res, 400, { error: 'bad coords' });
      return sendJSON(res, 200, await analyze(lat, lng));
    }

    if (p.startsWith('/api/')) return sendJSON(res, 404, { error: 'unknown endpoint' });

    return serveStatic(req, res);
  } catch (e) {
    return sendJSON(res, 502, { error: 'upstream/server error', detail: String(e && e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`agstya.energy Site Finder running → http://localhost:${PORT}`);
});
