# agstya.energy — Live Site Finder (Node backend + frontend)

A working web app that scores EV charging-site suitability from **live open data**. A small
zero-dependency Node server proxies the data sources, computes the scores, caches results, and
serves the frontend.

## Run it

Requires **Node 18+** (uses the built-in `fetch`). No `npm install` needed — there are no dependencies.

```bash
cd agstya-backend
node server.js
# → http://localhost:3000
```

Optional environment variables:

- `PORT` — port to listen on (default `3000`)
- `AGSTYA_UA` — User-Agent string sent to the open data APIs (Nominatim/Overpass ask for an identifying UA)

```bash
PORT=8080 AGSTYA_UA="agstya.energy (you@example.com)" node server.js
```

## What's live vs. manual

| Criterion | Source | How it's scored |
|---|---|---|
| **Terrain** | Open-Meteo Elevation | Samples elevation at the point + 4 neighbours (~167 m), derives slope %, scores flatter as better |
| **Foot traffic** | OpenStreetMap Overpass | Counts shops / transit / offices / amenities within 500 m (log-scaled proxy for footfall) |
| **ROI index** | computed | Blends the demand proxy with nearby competition (existing chargers within 1.5 km) |
| **Land legal / clear title** | manual | No public live feed for disputed-land status — set from due diligence |
| **Grid load headroom** | manual | Per-substation capacity is utility-private — set from DISCOM consultation |

Overall score is a weighted blend: ROI 30, foot 25, grid 20, terrain 15, legal 10.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | liveness check |
| `GET /api/geocode?q=<text>` | place name → `{lat,lng,label}` (cached 1 day) |
| `GET /api/reverse?lat=&lng=` | coords → `{label}` |
| `GET /api/analyze?lat=&lng=` | full scoring `{terrain,foot,roi,competition,errors,cached}` (cached 30 min) |

If an upstream source is unreachable, `analyze` still returns `200` with that metric `null` and a message
in `errors` — the frontend shows the remaining metrics and reweights the overall score.

## Architecture notes

- **Why a backend:** it sets the polite `User-Agent` the OSM services expect, caches responses to
  respect rate limits, keeps any future API keys server-side, and gives the frontend one clean origin
  to call (no CORS juggling).
- **Caching:** in-memory TTL map. For multi-instance production, swap this for Redis.
- **Scaling:** the public OSM endpoints are fine for demos and light traffic. For production volume,
  run your own Nominatim/Overpass, or move to commercial feeds (e.g. Placer.ai footfall) — only
  `server.js` changes; the frontend is untouched.

## Deploy

Any Node host works (Render, Railway, Fly.io, a VM). Example (Render):

1. Push this folder to a Git repo.
2. New Web Service → Build command: *(none)* → Start command: `node server.js`.
3. Set `AGSTYA_UA` to an address you control.

The frontend is served by the same process, so there's nothing separate to deploy.
