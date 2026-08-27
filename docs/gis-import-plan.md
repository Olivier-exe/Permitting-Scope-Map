# FL GIS Import Plan — Aug 27, 2026 (handoff spec)

Requested via team email (Jeremy's counterpart). All research done; execution
needs a container with network access to the four hosts below (user has updated
the Claude domain allowlist). Verify egress first: `curl -sI <host>` — a 403
with `x-deny-reason: host_not_allowed` means the allowlist still isn't active.

Hosts: services.arcgis.com, services2.arcgis.com, gis.lakecountyfl.gov, fragis.fra.dot.gov

**Use POST to /query endpoints** (form-encoded params). Lake County's WAF blocks
GET query strings as SQLi (verified — browser attempts got "Attack ID" block
pages). Paginate with resultOffset until returned features < page size.

## Datasets

### 1. Apopka city limits
- `https://services.arcgis.com/syn8rfJ2eTAK0T6k/arcgis/rest/services/Apopka_City_Limits1/FeatureServer`
- Discover layer id from service root (assume 0). where=1=1, outFields=*, outSR=4326, f=geojson.
- Check `fl_cities.json` for an existing Apopka polygon: if present keep the better
  (this source is authoritative); append/replace inside fl_cities rather than
  adding a new layer. Compact polygon format: match fl_cities entries exactly.

### 2. Apopka city-owned streets/ROW → `fl_apopka_roads.json`
- `https://services.arcgis.com/syn8rfJ2eTAK0T6k/arcgis/rest/services/City_Owned_Streets_and_ROW/FeatureServer`
- Discover layers; pull polyline layer(s). Name field unknown — inspect fields
  (likely STREET/FULLNAME-ish). If a ROW polygon layer exists, note it but skip
  (email asked for roads).

### 3. Lake County streets → `fl_lake_roads.json`, `fl_eustis_roads.json`, `fl_mountdora_roads.json`
- `https://gis.lakecountyfl.gov/lakegis/rest/services/OpenData/OpenData1/MapServer/7/query`
  (layer 7 "Streets", MaxRecordCount 2500, SR 2881 → always outSR=4326,
  geometryPrecision=6, POST only).
- outFields: BaseStreetName,FullStreetName,AliasName,StreetClass,PrefixType,PrefixDirection,SuffixType,LeftCity,RightCity
- Junk filter on every pull: `StreetClass NOT IN ('PRIVATE','PAPER','FOREST','MEDIAN CUT','TURN LANE')`
- Four pulls:
  a. `LeftCity='EUSTIS' OR RightCity='EUSTIS'`
  b. `LeftCity='MOUNT DORA' OR RightCity='MOUNT DORA'`
  c. `LeftCity='UNINCORPORATED' AND RightCity='UNINCORPORATED'`
  d. `PrefixType='CR'` countywide (verify 'CR' is an actual PrefixType value via
     returnDistinctValues on PrefixType first; adjust if e.g. 'CR-' or in BaseStreetName)
- Ownership derivation:
  - eustis / mountdora = pulls (a)/(b) minus SR/US/interstate/CR segments
    (PrefixType in SR,US,I,CR or name-pattern fallback) — cities don't own the
    state or county systems running through them.
  - lake_county = pull (d) CR backbone (countywide, includes segments inside all
    14 cities) + pull (c) locals minus SR/US. Dedupe by SegID/OBJECTID.
  - Sanity: SR/US removals should correlate with existing `fl_dot` names.

### 4. FRA rail mileposts (FL) → `fl_rr_mileposts.json`
- `https://fragis.fra.dot.gov/arcgis/rest/services/FRA/Mileposts/MapServer/0/query`
  (MaxRecordCount 1000, native 4326)
- where=`STATEAB='FL'`, outFields=RAILROAD,MILEPOST
- Point entries: `{n:"<RAILROAD> <MILEPOST>", c:[lat,lng]}` — match the point
  schema used by `fl_rr_crossings.json` (inspect it first; mirror keys/rounding).
- Manifest: new layer id `rr_mileposts`, label "RR Mileposts (MP)", point,
  minZoom ~12 (dense), color distinct from rr_crossings. Display-only (mirror
  how orange_roads/osceola_roads sit outside spatial analysis — verify in
  lib/spatial.js / App.js which layer ids join analysis).

### 5. Airports (FL) → `fl_faa.json`  ← activates FAA permit logic for FL
- `https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/USA_Airports_by_scale/FeatureServer`
  layers 1, 2, 3 (capacity bands — union all three), MaxRecordCount 1000 each.
- where=`STATE='FL'`, outFields=FAA_ID,NAME,FACILITY,CITY,COUNTY,OWNER,ELEV_FEET,TOWER,INTL
- Dedupe on FAA_ID across layers. **Match `entergy_la_faa.json` schema exactly**
  (inspect it first) so the existing 10,000 ft FAA threshold + permit generation
  work unchanged. Manifest: copy the entergy_la `faa` entry pattern into
  `companies.florida.layers.faa` (file fl_faa.json).

## Conversion format (all layers)
Repo compact format, verified from fl_dot.json: JSON array of
`{n:<name>, t?:<type-letter>, c:[[lat,lng],...]}` — **[lat,lng] order, 5 decimal
places**. MultiLineString → one entry per part. Points: single `c` pair (verify
against fl_rr_crossings).

## Manifest + colors
Add to `companies.florida.layers`: apopka_roads, eustis_roads, mountdora_roads,
lake_roads (line; style consistent with orange_roads/osceola_roads entries —
copy their weight/minZoom, distinct colors), rr_mileposts (point), faa (copy
entergy_la pattern). Labels: "Apopka City Roads", "Eustis City Roads",
"Mount Dora City Roads", "Lake County Roads", "RR Mileposts", "FAA Airports".

## Ship
Local `next build` must pass → commit → push directly to main (established
workflow; Vercel auto-deploys). Single commit is fine. Delete this file in the
same commit that completes the import (or update it to "done" status).
