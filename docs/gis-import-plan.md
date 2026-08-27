# FL GIS Import — DONE (executed Aug 27, 2026)

All five datasets imported per the Aug 27 handoff spec. Deviations from spec, for the record:

1. **Lake County WAF also blocks `OR` in POST where-clauses** (500s, same SQLi filter
   that blocks GET). Worked around by splitting each `LeftCity OR RightCity` pull into
   two AND-only pulls, deduped on SegID. Junk filter applied as written.
2. **fragis.fra.dot.gov `/arcgis/rest` was hard-down** (ASP.NET runtime error on every
   path, GET and POST). Pulled the same FRA mileposts from the official USDOT BTS NTAD
   mirror instead: `services.arcgis.com/xOi1kZaI0eWDREZv/.../NTAD_Rail_Mileposts`.
   NTAD schema has `SUBDIV` (subdivision) instead of `RAILROAD`, so milepost labels are
   "<Subdivision> MP <n>" (e.g. "Auburndale MP 836").
3. **FAA source gap:** by_scale bands 1–3 only contain 32 commercial-service airports —
   no GA. That would have missed Orlando Apopka (X04) in the new work area. Kept the
   spec'd bands and supplemented with NTAD Aviation Facilities filtered to
   `SITE_TYPE='A' AND FACILITY_USE='PU' AND STATUS='O'` (FAA 5010 public-use,
   operational) → 129 total. Heliports/seaplane bases intentionally excluded; easy
   follow-up if wanted.
4. **County data quirk:** two "Hooks St" segments in Clermont are mistagged
   RightCity=EUSTIS in Lake County's data; dropped via a >16 km cross-city outlier check.
5. Apopka city limits: replaced 103 stale fl_cities entries with 178 authoritative
   rings (exteriors; source has no holes). Main ring DP-simplified ~1 m to match file norm.
