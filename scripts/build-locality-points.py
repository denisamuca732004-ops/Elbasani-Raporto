#!/usr/bin/env python3
"""
Builds lib/server/data/locality-points.json: the coordinates of the lagje and
villages of each zone, from an OpenStreetMap export (Overpass Turbo → Export →
GeoJSON) that contains place nodes (place=village|hamlet|suburb|neighbourhood…).

A place counts only if its name matches a lagje/village of the zone whose
border contains it (lib/shared/data/elbasan-zones.json), so a "Polis" in
another zone is never taken. Run:
  python3 scripts/build-locality-points.py export.geojson
then commit the JSON: the next deployment fills the coordinates (only where
none are set) and moves approximate reports to their village.
"""
import json, re, sys, unicodedata, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
zones = json.load(open(ROOT / 'lib/shared/data/elbasan-zones.json'))['zones']
ref = (ROOT / 'lib/server/referenceData.ts').read_text()

def plain(s):
    s = unicodedata.normalize('NFD', s.lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    s = re.sub(r'[^a-z0-9]+', ' ', s).strip()
    # "Lagjja 5 Maji", "Fshati Lleshan" → "5 maji", "lleshan"
    return re.sub(r'^(lagjja|lagja|lagje|lagjia|fshati|fshat)\s+', '', s)

# code → localities, read from ZONES in referenceData.ts
block = ref[ref.index('export const ZONES'):ref.index('];', ref.index('export const ZONES'))]
localities = {}
for m in re.finditer(r"code: '([a-z_]+)', name: '[^']+',\s*localities: \[(.*?)\]", block, re.S):
    localities[m.group(1)] = re.findall(r"'([^']+)'", m.group(2))

def inside(pt, ring):
    x, y = pt; ins = False
    for i in range(len(ring)):
        x1, y1 = ring[i]; x2, y2 = ring[(i + 1) % len(ring)]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: ins = not ins
    return ins

def zone_of(lng, lat):
    for z in zones:
        for poly in z['polygons']:
            if inside((lng, lat), poly[0]) and not any(inside((lng, lat), h) for h in poly[1:]): return z['code']
    return None

out = {}
feats = json.load(open(sys.argv[1]))['features']
for f in feats:
    props = f.get('properties', {}); geom = f.get('geometry') or {}
    if 'place' not in props or geom.get('type') != 'Point': continue
    lng, lat = geom['coordinates']
    code = zone_of(lng, lat)
    if not code: continue
    names = {props.get(k) for k in ('name', 'name:sq', 'alt_name', 'official_name') if props.get(k)}
    for loc in localities.get(code, []):
        if any(plain(n) == plain(loc) for n in names):
            out.setdefault(code, {})[loc] = [round(lat, 6), round(lng, 6)]
found = sum(len(v) for v in out.values()); total = sum(len(v) for v in localities.values())
print(f'{found} of {total} lagje/villages found')
for code, locs in localities.items():
    missing = [l for l in locs if l not in out.get(code, {})]
    if missing: print(f'  {code}: missing {", ".join(missing)}')
data = {'source': 'OpenStreetMap place nodes (© OpenStreetMap contributors, ODbL 1.0), matched by scripts/build-locality-points.py.', 'zones': out}
(ROOT / 'lib/server/data/locality-points.json').write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n')
