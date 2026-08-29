/* Live projects — a point set stored under a project number that a small team
 * can save to and poll. Snapshot share links (/api/share) stay separate.
 *
 * Same storage + kill switch as the share feature: dormant without Redis env
 * vars, disabled by SHARE_LINKS=off. Removal: revert the projects commit
 * (tag pre-project-checkpoint) — keys expire on their own.
 *
 * Keys: proj:<NUMBER> (shared with /api/share's ?p= lookups; payloads are
 * compatible — this route adds a `rev` counter for conflict detection).
 *
 * Model (per Olivier): last save wins, but never silently — a save against a
 * stale rev returns 409 and the client asks. Rolling 180-day TTL on save.
 */
export const dynamic = 'force-dynamic';

var REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
var REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
var ENABLED = !!(REDIS_URL && REDIS_TOKEN) && process.env.SHARE_LINKS !== 'off';

var TTL_SECONDS = 180 * 86400;
var MAX_POINTS = 10000;
var MAX_BODY = 2 * 1024 * 1024;
var SAVES_PER_HOUR = 60;
var PIN_COLORS = ['review', 'approved', 'complete', 'issue'];
var PROJ_RE = /^[A-Za-z0-9][A-Za-z0-9\-_.]{0,31}$/;

async function redis(cmd) {
  var r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
    cache: 'no-store',
  });
  var d = await r.json();
  if (d.error) throw new Error('redis: ' + d.error);
  return d.result;
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function normProj(p) {
  var s = String(p || '').trim().toUpperCase();
  return PROJ_RE.test(s) ? s : null;
}

function clientIp(req) {
  var xf = req.headers.get('x-forwarded-for') || '';
  return (xf.split(',')[0] || req.headers.get('x-real-ip') || 'unknown').trim();
}

/* GET /api/project?id=NUM[&rev=N]
 *   no rev, or rev differs -> full payload {found, id, rev, pts, company, by,
 *                             savedAt, secondsLeft}
 *   rev matches server     -> {unchanged:true, rev}   (cheap poll)
 *   missing                -> {found:false}            (client may offer create) */
export async function GET(req) {
  if (!ENABLED) return json({ error: 'Projects are not enabled' }, 503);
  var sp = new URL(req.url).searchParams;
  var id = normProj(sp.get('id'));
  if (!id) return json({ error: 'Bad project number' }, 400);
  try {
    var raw = await redis(['GET', 'proj:' + id]);
    if (!raw) return json({ found: false, id: id });
    var d = JSON.parse(raw);
    var rev = Number(d.rev || 0);
    var revParam = sp.get('rev');
    if (revParam !== null && Number(revParam) === rev) return json({ unchanged: true, rev: rev });
    var ttl = await redis(['TTL', 'proj:' + id]);
    return json({
      found: true, id: id, rev: rev,
      pts: Array.isArray(d.pts) ? d.pts : [],
      company: d.company || '',
      by: d.by || '', savedAt: d.savedAt || d.created || null,
      secondsLeft: ttl > 0 ? ttl : null,
    });
  } catch (e) {
    return json({ error: 'Project lookup failed' }, 502);
  }
}

/* POST /api/project  { id, pts, company, by, baseRev, force? }
 *   baseRev matches server rev (or project new, or force) -> saved {rev,...}
 *   stale baseRev without force -> 409 {conflict:true, rev, by, savedAt}      */
export async function POST(req) {
  if (!ENABLED) return json({ error: 'Projects are not enabled' }, 503);
  try {
    var text = await req.text();
    if (text.length > MAX_BODY) return json({ error: 'Too large (2MB max)' }, 413);
    var b = JSON.parse(text);
    var id = normProj(b.id);
    if (!id) return json({ error: 'Project number: letters, numbers, - _ . only (32 max)' }, 400);
    if (!Array.isArray(b.pts)) return json({ error: 'No points array' }, 400);
    if (b.pts.length > MAX_POINTS) return json({ error: 'Too many points (' + MAX_POINTS + ' max)' }, 400);

    var pts = [];
    for (var i = 0; i < b.pts.length; i++) {
      var p = b.pts[i];
      var lat = Number(p.lat), lng = Number(p.lng);
      if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180)
        return json({ error: 'Bad coordinates at point ' + (i + 1) }, 400);
      pts.push({
        lat: Math.round(lat * 1e6) / 1e6,
        lng: Math.round(lng * 1e6) / 1e6,
        name: String(p.name || 'Pin').slice(0, 120),
        color: PIN_COLORS.indexOf(p.color) >= 0 ? p.color : 'review',
        notes: String(p.notes || '').slice(0, 500),
      });
    }

    var rlKey = 'rlp:' + clientIp(req);
    var n = await redis(['INCR', rlKey]);
    if (n === 1) await redis(['EXPIRE', rlKey, 3600]);
    if (n > SAVES_PER_HOUR) return json({ error: 'Rate limit — try again in an hour' }, 429);

    var key = 'proj:' + id;
    var currentRaw = await redis(['GET', key]);
    var current = null, curRev = 0;
    if (currentRaw) { try { current = JSON.parse(currentRaw); curRev = Number(current.rev || 0); } catch (e) {} }

    var baseRev = Number(b.baseRev);
    if (current && !b.force && (!isFinite(baseRev) || baseRev !== curRev)) {
      return json({
        conflict: true, rev: curRev,
        by: current.by || '', savedAt: current.savedAt || null,
      }, 409);
    }

    var newRev = curRev + 1;
    var payload = JSON.stringify({
      v: 2, rev: newRev, pts: pts,
      company: typeof b.company === 'string' ? b.company.slice(0, 40) : '',
      by: String(b.by || '').slice(0, 60),
      savedAt: new Date().toISOString(),
      created: current ? (current.created || null) : new Date().toISOString(),
      ttlDays: 180,
    });
    await redis(['SET', key, payload, 'EX', String(TTL_SECONDS)]);
    return json({
      ok: true, id: id, rev: newRev,
      savedAt: new Date().toISOString(),
      expires: new Date(Date.now() + TTL_SECONDS * 1000).toISOString(),
    });
  } catch (e) {
    return json({ error: 'Project save failed' }, 502);
  }
}
