# Shared point sets (expiring links + project numbers)

Added Aug 28, 2026. Checkpoint tag for removal: **`pre-share-checkpoint`**.

## What it does
- **Share** (with points loaded) opens a dialog: pick a shelf life (7 / 30 / 90
  days), optionally a **project number** and your name. Creates a short link
  (`/?s=Ab3xK9v2Wq4L`) copied to your clipboard.
- Anyone opening the link (or `/?p=PROJECT-NUM`, or the **Proj #** footer
  button) gets that point set loaded into *their own* session — a one-way
  snapshot. Their edits never write back; nothing changes for anyone else.
- Saving with a project number stores the set under that number too
  (last save wins, sender name + date shown on open).
- Every record **auto-deletes at its shelf life** (Redis TTL — no cleanup job).
  Expired links show "Not found — it may have expired."

## Storage
Upstash Redis REST (free tier: 256 MB, 500K commands/mo — thousands of live
shares). Keys: `share:<id>`, `proj:<NUMBER>`, `rl:<ip>` (rate limit).
Guardrails: 10,000 points / 2 MB per share, 30 creates per IP per hour,
unguessable 12-char link ids, no listing endpoint of any kind.

## Activation / kill switch (no code changes)
The feature is **dormant unless** these Vercel env vars exist
(Settings → Environment Variables → all environments → redeploy):

- `UPSTASH_REDIS_REST_URL` (or `KV_REST_API_URL`)
- `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_TOKEN`)

Kill switch: set `SHARE_LINKS=off` (or delete the two vars) and redeploy →
Share falls back to the pre-existing tiny-URL behavior everywhere.

## Full removal
1. `git revert <this feature commit>` — the codebase returns to the
   `pre-share-checkpoint` state (feature = 1 commit: this file,
   `app/api/share/route.js`, one block in `components/App.js`).
2. Delete the Upstash database (console) — all shared data and links die
   instantly.

## Notes / trade-offs
- First feature that stores any user data server-side (expiring, unguessable,
  but stored). Point coords, names, status, notes only — no analysis results.
- Project numbers are guessable in a way random links are not; anyone who
  knows the site + a job number can open that set. Acceptable for
  street-visible pole locations; revisit if data sensitivity changes.
