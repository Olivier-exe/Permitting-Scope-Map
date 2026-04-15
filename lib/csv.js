export function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return null;

  const headers = lines[0].split(',').map(s => s.trim().toLowerCase().replace(/['"]/g, ''));
  const latIdx = headers.findIndex(h => ['lat', 'latitude', 'y'].includes(h));
  const lngIdx = headers.findIndex(h => ['lng', 'lon', 'long', 'longitude', 'x'].includes(h));
  const nameIdx = headers.findIndex(h => ['name', 'label', 'id', 'station', 'site', 'location', 'description', 'station_id'].includes(h));

  if (latIdx < 0 || lngIdx < 0) return null;

  const points = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(s => s.trim().replace(/['"]/g, ''));
    const lat = parseFloat(cols[latIdx]);
    const lng = parseFloat(cols[lngIdx]);
    if (!isNaN(lat) && !isNaN(lng)) {
      points.push({
        lat, lng,
        name: nameIdx >= 0 && cols[nameIdx] ? cols[nameIdx] : 'Point ' + (points.length + 1)
      });
    }
  }
  return points.length > 0 ? points : null;
}
