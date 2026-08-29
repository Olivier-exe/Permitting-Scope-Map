# Permitting Scope Map — project brief for Claude

Web app for utility construction permitting: visualizes GIS layers (DOT roads,
railroads, transmission, levees, FAA airports, cities, counties) and generates
permit recommendations per work location. Next.js 14 + Leaflet, deployed on
Vercel (auto-deploys from `main`). Live: https://permitting-scope-map.vercel.app

## Working rules (non-negotiable)
1. **Verify `npx next build` passes before every push.** No exceptions.
2. **Push directly to `main`** after Olivier approves — no branches or PRs
   unless he explicitly asks. Vercel deploys main automatically.
3. **Checkpoint tags before risky features**: tag `pre-<feature>-checkpoint`
   on the last good commit, push the tag, then ship the feature as ONE commit
   so `git revert` restores the checkpoint state. Precedents:
   `pre-share-checkpoint`, `pre-project-checkpoint`.
4. **Kill-switch pattern**: server-side features must be dormant without their
   env vars and disabled by `SHARE_LINKS=off`. UI falls back gracefully.
5. **Layout is intentional.** Single left sidebar (company/basemap pills,
   search, Layers|Locations|Results tabs, footer with project bar + 6
   controls). Do not restructure, add panels, or move regions without an
   explicit request. Small contained additions (modals, floating elements) OK.
6. **Never break the layer set.** All layer JSON files in `public/layers/`
   plus `manifest.json` ship in every build; never delete or regenerate them
   wholesale.
7. **Never commit secrets.** GitHub tokens are pasted per session; Upstash
   creds live only in Vercel env vars.

## Architecture
- `components/App.js` — entire UI (single component, ~700 lines, inline styles
  using CSS vars --accent/--surface/--muted/etc). Session persists to
  localStorage `psm_session`; user name in `psm_name`.
- `lib/spatial.js` — analysis engine. `runFullAnalysis` reads FIXED layer keys
  (dot, rr, rr_crossings, transmission, levee, faa, cities, counties/parishes,
  row, parish_roads). Any other layer key is display-only automatically.
- `app/api/share/route.js` — frozen snapshot links (`?s=`), 7/30/90-day TTL.
- `app/api/project/route.js` — live projects (`?p=`, project bar), rev-tracked,
  409 conflicts, 180-day rolling TTL. Storage: Upstash Redis REST
  (`UPSTASH_REDIS_REST_URL/TOKEN` or `KV_REST_API_*`). Keys: `share:<id>`,
  `proj:<NUM>`, rate limits `rl:`/`rlp:`.
- `public/layers/` — compact JSON. Lines `{n,t?,c:[[lat,lng]…]}` (5 decimals),
  points `{lat,lng,n}`, city polygons = one entry per ring `{n,c:[…]}`.
  `manifest.json` defines companies -> layers (file, label, type, color,
  colorKey, weight, minZoom, icon).

## Hard-won GIS knowledge (read before any import)
- **Lake County (gis.lakecountyfl.gov)**: WAF rejects GET query strings AND
  any `OR` in POST where-clauses (500s). Use POST, AND-only clauses, split
  OR-logic into multiple pulls, dedupe on `SegID`.
- **FRA (fragis.fra.dot.gov)**: REST endpoint unreliable/down. Use the USDOT
  BTS NTAD mirrors on services.arcgis.com/xOi1kZaI0eWDREZv (schema differs:
  `SUBDIV` not `RAILROAD`).
- **FAA airports**: Esri USA_Airports_by_scale bands 1-3 = commercial only.
  Supplement GA with NTAD_Aviation_Facilities filtered
  `SITE_TYPE_CODE='A' AND FACILITY_USE_CODE='PU' AND ARPT_STATUS='O'`
  (OWNER is ownership, NOT public-use — X04 is private-owned public-use).
- **Vercel env vars need a redeploy** to take effect; an empty commit
  (`git commit --allow-empty`) is the reliable trigger.
- Import workflow details: `.claude/skills/gis-layer-import/SKILL.md`.

## Feature docs
- `docs/share-feature.md` — expiring share links, capacity, kill switch
- `docs/projects-feature.md` — live projects, polling/conflict model, removal
