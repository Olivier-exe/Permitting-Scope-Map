# Live projects (footer redesign + shared job workspaces)

Added Aug 29, 2026. Checkpoint tag for removal: **`pre-project-checkpoint`**.
Rides the same storage + kill switch as the share feature (see share-feature.md):
no env vars or SHARE_LINKS=off -> project bar disappears, consolidated footer
remains, everything else behaves as before.

## Model (per Olivier)
- Share links stay frozen snapshots. A **project** is the living copy of a
  point set, stored under a job number.
- **Ask before updating:** the app polls every 30s (visible tab only). A
  teammate's save shows an amber banner — "<name> saved 2m ago · Load / x" —
  and never auto-applies.
- **Last save wins, never silently:** saving over a newer revision returns a
  conflict dialog (Load theirs / Overwrite / Cancel). Revision counter `rev`
  in the payload backs this.
- **180-day rolling expiry** — resets on every save.
- Session remembers your project across reloads and rejoins it (dirty edits
  preserved; a newer server rev shows the ask-first banner).
- `/?p=NUMBER` links join the project live (share `/?s=` links stay frozen).

## Footer redesign
11 buttons -> project bar + 6 controls. Import CSV/KML/Open merged into one
**Import** (routes by extension, incl. .json project files); Export CSV/KML/
Save merged into **Export ▾**; **Share** is the accent button; **Proj #**
replaced by the project bar (Open / Start, Save, ⋮ menu: copy link / switch /
leave). Drag-and-drop import unchanged.

## API — app/api/project/route.js
- GET ?id=NUM            -> full payload {rev, pts, by, savedAt, secondsLeft}
- GET ?id=NUM&rev=N      -> {unchanged:true} when current (cheap poll)
- POST {id, pts, by, baseRev, force?} -> saved | 409 {conflict, rev, by, savedAt}
- Guardrails: 10k pts / 2MB, 60 saves per IP per hour, same key namespace
  (`proj:<NUM>`) the share feature's ?p= lookups used.
- Known limit: revision check is read-then-write, not atomic — two saves in the
  same instant could both land. Fine at team scale; revisit if usage grows.

## Removal
`git revert` the projects commit -> back to `pre-project-checkpoint` state
(share links keep working). Project keys expire on their own.
