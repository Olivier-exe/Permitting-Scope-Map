/* Shared point sets ("Share v2") — expiring link + project-number storage.
 *
 * KILL SWITCH: feature is ON only when Redis env vars are set AND
 * SHARE_LINKS is not "off". With no env vars this route reports
 * { enabled:false } and the UI silently falls back to the old URL share.
 * Full removal: `git revert` this feature commit (see docs/share-feature.md)
 * and delete the Upstash database.
 *
 * Storage: Upstash Redis REST (free tier). Keys:
 *   share:<12-char random id>  -> JSON payload, TTL 7/30/90 days
 *   proj:<PROJECT-NUMBER>      -> same payload (last save wins), same TTL
 *   rl:<ip>                    -> hourly create-rate counter
 */
export const dynamic = 'force-dynamic';

var REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
var REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
var ENABLED = !!(REDIS_URL && REDIS_TOKEN) && process.env.SHARE_LINKS !== 'off';

var TTL_DAYS = [7, 30, 90];
var MAX_POINTS = 10000;
var MAX_BODY = 2 * 1024 * 1024; // 2MB
var CREATES_PER_HOUR = 30;
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

function randomId() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  var bytes = crypto.getRandomValues(new Uint8Array(12));
  var out = '';
  for (var i = 0; i < 12; i++) out += chars[bytes[i] % chars.length];
  return out;
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

/* GET  /api/share            -> { enabled }
 * GET  /api/share?id=XXXX    -> stored payload for a link
 * GET  /api/share?project=NN -> stored payload for a project number     */
export async function GET(req) {
  var sp = new URL(req.url).searchParams;
  var id = sp.get('id'), proj = sp.get('project');
  if (!id && !proj) return json({ enabled: ENABLED });
  if (!ENABLED) return json({ error: 'Sharing is not enabled' }, 503);
  try {
    var key = null;
    if (id) { if (!/^[A-Za-z0-9]{12}$/.test(id)) return json({ error: 'Bad link id' }, 400); key = 'share:' + id; }
    else { var p = normProj(proj); if (!p) return json({ error: 'Bad project number' }, 400); key = 'proj:' + p; }
    var raw = await redis(['GET', key]);
    if (!raw) return json({ error: 'Not found — it may have expired' }, 404);
    var ttl = await redis(['TTL', key]);
    var payload = JSON.parse(raw);
    payload.secondsLeft = ttl > 0 ? ttl : null;
    return json(payload);
  } catch (e) {
    return json({ error: 'Share lookup failed' }, 502);
  }
}

/* POST /api/share  { pts, company, ttl, project?, by?, label? }
 *   -> { id, url, project, expires }                                    */
export async function POST(req) {
  if (!ENABLED) return json({ error: 'Sharing is not enabled' }, 503);
  try {
    var text = await req.text();
    if (text.length > MAX_BODY) return json({ error: 'Too large (2MB max)' }, 413);
    var b = JSON.parse(text);

    if (!Array.isArray(b.pts) || !b.pts.length) return json({ error: 'No points' }, 400);
    if (b.pts.length > MAX_POINTS) return json({ error: 'Too many points (' + MAX_POINTS + ' max)' }, 400);
    var ttlDays = TTL_DAYS.indexOf(Number(b.ttl)) >= 0 ? Number(b.ttl) : 30;
    var proj = b.project ? normProj(b.project) : null;
    if (b.project && !proj) return json({ error: 'Project number: letters, numbers, - _ . only (32 max)' }, 400);

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

    // Light per-IP create limit
    var rlKey = 'rl:' + clientIp(req);
    var n = await redis(['INCR', rlKey]);
    if (n === 1) await redis(['EXPIRE', rlKey, 3600]);
    if (n > CREATES_PER_HOUR) return json({ error: 'Rate limit — try again in an hour' }, 429);

    var id = randomId();
    var seconds = ttlDays * 86400;
    var payload = JSON.stringify({
      v: 1,
      pts: pts,
      company: typeof b.company === 'string' ? b.company.slice(0, 40) : '',
      by: String(b.by || '').slice(0, 60),
      label: String(b.label || '').slice(0, 80),
      project: proj,
      created: new Date().toISOString(),
      ttlDays: ttlDays,
    });
    await redis(['SET', 'share:' + id, payload, 'EX', String(seconds)]);
    if (proj) await redis(['SET', 'proj:' + proj, payload, 'EX', String(seconds)]);

    var origin = new URL(req.url).origin;
    return json({
      id: id,
      url: origin + '/?s=' + id,
      project: proj,
      projectUrl: proj ? origin + '/?p=' + encodeURIComponent(proj) : null,
      expires: new Date(Date.now() + seconds * 1000).toISOString(),
    });
  } catch (e) {
    return json({ error: 'Share create failed' }, 502);
  }
}
