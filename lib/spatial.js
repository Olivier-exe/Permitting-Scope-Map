// Distance from point to line segment in meters
export function distToSegment(lat, lng, s) {
  var R = 6371000;
  var ml = (s[0] + s[2]) / 2;
  var cl = Math.cos(ml * Math.PI / 180);
  var x = (lng - s[1]) * cl, y = lat - s[0];
  var x2 = (s[3] - s[1]) * cl, y2 = s[2] - s[0];
  var l = x2 * x2 + y2 * y2;
  var t = l === 0 ? 0 : Math.max(0, Math.min(1, (x * x2 + y * y2) / l));
  return Math.sqrt((x - t * x2) ** 2 + (y - t * y2) ** 2) * (Math.PI / 180) * R;
}

export function pointInPolygon(lat, lng, polygon) {
  var inside = false;
  for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    var yi = polygon[i][0], xi = polygon[i][1];
    var yj = polygon[j][0], xj = polygon[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

export function findContainingPolygon(lat, lng, polygons) {
  for (var i = 0; i < polygons.length; i++) {
    if (polygons[i].c && polygons[i].c.length >= 3 && pointInPolygon(lat, lng, polygons[i].c)) return polygons[i].n || 'Unknown';
  }
  return null;
}

export function findNearby(items, lat, lng, threshold) {
  var out = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i], minDist = Infinity, pts = item.c;
    if (!pts || pts.length < 2) continue;
    for (var j = 0; j < pts.length - 1; j++) {
      var d = distToSegment(lat, lng, [pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1]]);
      if (d < minDist) minDist = d;
    }
    if (minDist < threshold) {
      var entry = {};
      if (item.n) entry.n = item.n;
      if (item.o) entry.o = item.o;
      if (item.t) entry.t = item.t;
      if (item.s) entry.s = item.s;
      if (item.v) entry.v = item.v;
      if (item.p) entry.p = item.p;
      entry.dist = Math.round(minDist);
      out.push(entry);
    }
  }
  return out.sort(function(a, b) { return a.dist - b.dist; });
}

export function findNearbyPoints(items, lat, lng, threshold) {
  var out = [], R = 6371000;
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (!item.lat || !item.lng) continue;
    var dlat = (item.lat - lat) * Math.PI / 180, dlng = (item.lng - lng) * Math.PI / 180;
    var a = Math.sin(dlat / 2) * Math.sin(dlat / 2) + Math.cos(lat * Math.PI / 180) * Math.cos(item.lat * Math.PI / 180) * Math.sin(dlng / 2) * Math.sin(dlng / 2);
    var d = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    if (d < threshold) out.push({ n: item.n || 'Airport', dist: Math.round(d) });
  }
  return out.sort(function(a, b) { return a.dist - b.dist; });
}

export function haversine(lat1, lng1, lat2, lng2) {
  var R = 6371000, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function bearing(lat1, lng1, lat2, lng2) {
  var dL = (lng2 - lng1) * Math.PI / 180, la1 = lat1 * Math.PI / 180, la2 = lat2 * Math.PI / 180;
  var y = Math.sin(dL) * Math.cos(la2);
  var x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dL);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

export function polygonArea(pts) {
  var R = 6371000, n = pts.length; if (n < 3) return 0; var total = 0;
  for (var i = 0; i < n; i++) { var j = (i + 1) % n; total += ((pts[j][1] - pts[i][1]) * Math.PI / 180) * (2 + Math.sin(pts[i][0] * Math.PI / 180) + Math.sin(pts[j][0] * Math.PI / 180)); }
  return Math.abs(total * R * R / 2) * 0.000247105;
}

export function polygonAreaMultiUnit(pts) {
  var R = 6371000, n = pts.length; if (n < 3) return { acres: 0, sqft: 0, sqmi: 0 }; var total = 0;
  for (var i = 0; i < n; i++) { var j = (i + 1) % n; total += ((pts[j][1] - pts[i][1]) * Math.PI / 180) * (2 + Math.sin(pts[i][0] * Math.PI / 180) + Math.sin(pts[j][0] * Math.PI / 180)); }
  var sqm = Math.abs(total * R * R / 2);
  return { acres: sqm * 0.000247105, sqft: sqm * 10.7639, sqmi: sqm / 2589988.11 };
}

export async function reverseGeocode(lat, lng) {
  try { var resp = await fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat + '&lon=' + lng + '&zoom=18&addressdetails=1');
    var data = await resp.json(); return (data && data.display_name) ? data.display_name : null; } catch (e) { return null; }
}

export async function getElevation(lat, lng) {
  try { var resp = await fetch('https://epqs.nationalmap.gov/v1/json?x=' + lng + '&y=' + lat + '&wkid=4326&units=Feet&includeDate=false');
    var data = await resp.json(); return (data && data.value !== undefined) ? { ft: parseFloat(data.value), navd88: true } : null; } catch (e) { return null; }
}

export function parseKML(text) {
  var pts = [], placemarks = text.match(/<Placemark[\s\S]*?<\/Placemark>/gi);
  if (!placemarks) return null;
  for (var i = 0; i < placemarks.length; i++) {
    var pm = placemarks[i];
    var nameMatch = pm.match(/<name>([\s\S]*?)<\/name>/i);
    var name = nameMatch ? nameMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() : 'Point ' + (pts.length + 1);
    var coordMatch = pm.match(/<coordinates>([\s\S]*?)<\/coordinates>/i);
    if (!coordMatch) continue;
    var coordParts = coordMatch[1].trim().split(/\s+/);
    for (var j = 0; j < coordParts.length; j++) {
      var c = coordParts[j].split(',');
      if (c.length >= 2) { var lng = parseFloat(c[0]), lat = parseFloat(c[1]); if (!isNaN(lat) && !isNaN(lng)) { pts.push({ lat: lat, lng: lng, name: name }); break; } }
    }
  }
  return pts.length > 0 ? pts : null;
}

export function runFullAnalysis(lat, lng, layerData, company, manifest) {
  var co = manifest.companies[company]; if (!co) return null;
  var result = { lat: lat, lng: lng, city: null, county: null, state: null, dot: [], rr: [], transmission: [], levee: [], faa: [], parish_roads: [], row: null };
  if (company.indexOf('_la') >= 0) result.state = 'Louisiana';
  else if (company.indexOf('_tx') >= 0) result.state = 'Texas';
  else if (company.indexOf('_nm') >= 0) result.state = 'New Mexico';

  var cityKey = company + '_cities';
  if (layerData[cityKey]) result.city = findContainingPolygon(lat, lng, layerData[cityKey]);
  var parishKey = company + '_parishes', countyKey = company + '_counties';
  if (layerData[parishKey]) result.county = findContainingPolygon(lat, lng, layerData[parishKey]);
  else if (layerData[countyKey]) result.county = findContainingPolygon(lat, lng, layerData[countyKey]);
  var rowKey = company + '_row';
  if (layerData[rowKey]) result.row = findContainingPolygon(lat, lng, layerData[rowKey]);

  var dotKey = company + '_dot';
  if (layerData[dotKey]) result.dot = findNearby(layerData[dotKey], lat, lng, 500).slice(0, 8).map(function(h) { return { n: h.n || 'Road', t: h.t === 'I' ? 'Interstate' : h.t === 'U' ? 'US Highway' : 'State/Local', d: h.dist }; });
  var rrKey = company + '_rr';
  if (layerData[rrKey]) result.rr = findNearby(layerData[rrKey], lat, lng, 800).slice(0, 5).map(function(r) { return { o: r.o || r.n || 'Railroad', d: r.dist }; });
  var txKey = company + '_transmission';
  if (layerData[txKey]) result.transmission = findNearby(layerData[txKey], lat, lng, 800).slice(0, 5).map(function(t) { return { n: t.n || 'Transmission', v: t.v || '', d: t.dist }; });
  var lvKey = company + '_levee';
  if (layerData[lvKey]) result.levee = findNearby(layerData[lvKey], lat, lng, 800).slice(0, 5).map(function(l) { return { n: l.n || 'Levee', s: l.s || '', d: l.dist }; });
  var faaKey = company + '_faa';
  if (layerData[faaKey]) result.faa = findNearbyPoints(layerData[faaKey], lat, lng, 3048).slice(0, 3);
  var prKey = company + '_parish_roads';
  if (layerData[prKey]) result.parish_roads = findNearby(layerData[prKey], lat, lng, 200).slice(0, 5).map(function(r) { return { n: r.n || 'Local Road', p: r.p || '', d: r.dist }; });
  return result;
}

export function generatePermits(r) {
  var pm = [];
  if (r.dot.length) {
    var nearest = r.dot[0], prio = nearest.d < 30 ? 'Critical' : nearest.d < 100 ? 'High' : 'Medium';
    pm.push({ type: 'DOT Utility Permit', jurisdiction: 'State DOT', recommendation: nearest.n + ' (' + nearest.t + ') is ' + nearest.d + 'm away', priority: prio, notes: nearest.d < 30 ? 'Within ROW - permit required' : null });
  }
  if (r.rr.length) {
    var rr = r.rr[0];
    pm.push({ type: 'Railroad Crossing Permit', jurisdiction: rr.o, recommendation: rr.o + ' track ' + rr.d + 'm away', priority: rr.d < 50 ? 'Critical' : 'High', notes: 'Contact railroad company + LPSC notification' });
  }
  if (r.transmission.length) {
    var tx = r.transmission[0];
    pm.push({ type: 'Transmission Easement', jurisdiction: tx.n || 'Utility', recommendation: 'Transmission line ' + tx.d + 'm away' + (tx.v ? ' (' + tx.v + ')' : ''), priority: tx.d < 50 ? 'Critical' : 'High' });
  }
  if (r.levee.length) {
    var lv = r.levee[0];
    pm.push({ type: 'Levee Encroachment', jurisdiction: lv.n, recommendation: lv.n + ' ' + lv.d + 'm away', priority: 'Critical', notes: 'Unauthorized work near levees is a serious offense' });
  }
  if (r.faa.length && r.faa[0].dist < 3048) {
    var apt = r.faa[0], aptFt = Math.round(apt.dist * 3.28084);
    pm.push({ type: 'FAA Notification', jurisdiction: 'FAA', recommendation: apt.n + ' airport ' + aptFt + 'ft away', priority: aptFt < 5000 ? 'Critical' : 'High', notes: 'Within 10,000ft of airport - FAA permit required' });
  }
  // Separate county/parish and city permits
  if (r.county) {
    var cl = r.state === 'Louisiana' ? 'Parish' : 'County';
    pm.push({ type: cl + ' ROW Permit', jurisdiction: r.county + ' ' + cl, recommendation: 'Contact ' + r.county + ' ' + cl + ' for local ROW requirements', priority: 'High', notes: cl + '-level permit required for work in public ROW' });
  }
  if (r.city && r.city !== 'Unincorporated') {
    pm.push({ type: 'Municipal Permit', jurisdiction: 'City of ' + r.city, recommendation: 'Contact City of ' + r.city + ' for municipal permit requirements', priority: 'High', notes: 'City permits are separate from county/parish permits. Check for local ordinances.' });
  }
  return pm;
}
