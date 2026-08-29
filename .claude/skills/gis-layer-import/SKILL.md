---
name: gis-layer-import
description: Import GIS data (ArcGIS REST services, KMZ/KML) into the Permitting Scope Map as compact layer JSON + manifest entries. Use whenever adding roads, rail, airports, boundaries, or any new map layer for any state/company.
---

# GIS layer import workflow

1. **Discover before pulling.** Fetch the FeatureServer/MapServer root
   (`?f=json` or POST `f=json`) to get real layer ids, fields, maxRecordCount,
   and coded-value domains. Never trust assumed layer numbers.
2. **Pull paginated.** POST to `/query` with `outSR=4326`, `f=geojson`,
   `geometryPrecision=6`, `resultOffset` pagination at maxRecordCount. Fall
   back to GET only if the server rejects POST (old ASP.NET servers do).
   Check distinct values of filter fields before filtering.
3. **Convert to repo format** (match existing files exactly):
   - Lines: `{n:name, t:'M'|'L', c:[[lat,lng],…]}` rounded to 5 decimals,
     consecutive duplicates dropped, one entry per MultiLineString part.
   - Points: `{lat, lng, n}` (5-6 decimals; match the sibling file).
   - City polygons: one entry per exterior ring `{n, c:[…]}`; DP-simplify
     rings >1500 pts at ~1e-5 tolerance to match file norms.
   - Title-case names but preserve digit tokens (19A) and CR/SR/US/N/S/E/W.
4. **Ownership filtering for road layers**: state system (SR/US/HWY prefixes
   or name pattern `^(SR|US|STATE ROAD|HWY|I)[- ]?\d`) is already covered by
   the DOT layer — remove it from city/county layers. CRs belong to county
   layers, not cities. Drop cross-city mistagged outlier segments (>0.15 deg
   from the layer's median with a different city on either side).
5. **Manifest**: add entries under the company with a distinct color, the
   M/L color+weight scheme for roads, `minZoom:12` for dense local layers.
   Layer keys outside spatial.js's fixed list are display-only automatically;
   adding a `faa` key activates the 10,000 ft FAA permit logic for free.
6. **Sanity-check before pushing**: entry counts, bbox within expected region,
   spot-check names, `npx next build`, then single descriptive commit to main.
7. Record any new server quirks in CLAUDE.md's GIS knowledge section and put
   handoff specs for unfinished imports in `docs/`.
