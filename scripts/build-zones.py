#!/usr/bin/env python3
"""
Rebuilds lib/shared/data/elbasan-zones.json: the borders of the 13
administrative units of the Municipality of Elbasan, simplified to ~20 m.

Source: geoBoundaries gbOpen ALB ADM3 (from OpenStreetMap, (c) OpenStreetMap
contributors, ODbL 1.0), downloaded next to this script:
  https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/gbOpen/ALB/ADM3/geoBoundaries-ALB-ADM3.geojson
  https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/gbOpen/ALB/ADM2/geoBoundaries-ALB-ADM2.geojson

Usage: python3 scripts/build-zones.py 0.0002   (tolerance in degrees)
Mollas is NOT included: it belongs to the Municipality of Cërrik.
"""
import json, math, sys
adm3 = json.load(open('alb-ADM3.geojson'))
adm2 = json.load(open('alb-ADM2.geojson'))

def rings_of(geom):
    if geom['type'] == 'Polygon': return [geom['coordinates']]
    return geom['coordinates']  # MultiPolygon: list of polygons (each list of rings)

def pip(pt, ring):
    x, y = pt; inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i][:2]; x2, y2 = ring[(i + 1) % n][:2]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside

def in_polys(pt, polys):
    for poly in polys:
        if pip(pt, poly[0]) and not any(pip(pt, h) for h in poly[1:]): return True
    return False

def centroid(ring):
    a = cx = cy = 0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i][:2]; x2, y2 = ring[i + 1][:2]
        f = x1 * y2 - x2 * y1; a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f
    a *= 0.5
    return (cx / (6 * a), cy / (6 * a))

elb = [f for f in adm2['features'] if f['properties']['shapeName'] == 'Elbasan'][0]
elb_polys = rings_of(elb['geometry'])

chosen = []
for f in adm3['features']:
    polys = rings_of(f['geometry'])
    big = max(polys, key=lambda p: len(p[0]))
    c = centroid(big[0])
    if in_polys(c, elb_polys):
        chosen.append((f['properties']['shapeName'], polys))
print('units inside Elbasan municipality:', sorted(n for n, _ in chosen))

def rdp(points, eps):
    if len(points) < 3: return points
    (x1, y1), (x2, y2) = points[0][:2], points[-1][:2]
    dx, dy = x2 - x1, y2 - y1
    norm = math.hypot(dx, dy) or 1e-12
    dmax, idx = 0, 0
    for i in range(1, len(points) - 1):
        px, py = points[i][:2]
        d = abs(dy * px - dx * py + x2 * y1 - y2 * x1) / norm if (dx or dy) else math.hypot(px - x1, py - y1)
        if d > dmax: dmax, idx = d, i
    if dmax > eps:
        return rdp(points[: idx + 1], eps)[:-1] + rdp(points[idx:], eps)
    return [points[0], points[-1]]

CODE = {'Elbasan': 'elbasan', 'Bradashesh': 'bradashesh', 'Funarë': 'funare', 'Gjergjan': 'gjergjan', 'Gjinar': 'gjinar',
        'Gracen': 'gracen', 'Labinot Fushë': 'labinot_fushe', 'Labinot Mal': 'labinot_mal', 'Papër': 'paper', 'Shirgjan': 'shirgjan',
        'Shushicë': 'shushice', 'Tregan': 'tregan', 'Zavalinë': 'zavaline'}
eps = float(sys.argv[1]) if len(sys.argv) > 1 else 0.0003
out = []
pts_before = pts_after = 0
chosen = [c for c in chosen if c[0] in CODE]
assert len(chosen) == 13, [c[0] for c in chosen]
for name, polys in sorted(chosen, key=lambda x: x[0]):
    code = CODE[name]
    simp = []
    for poly in polys:
        rings = []
        for ring in poly:
            pts_before += len(ring)
            r = rdp([p[:2] for p in ring], eps)
            if len(r) >= 4:
                rings.append([[round(x, 5), round(y, 5)] for x, y in r])
                pts_after += len(r)
        if rings: simp.append(rings)
    out.append({'code': code, 'name': name, 'polygons': simp})
print('points', pts_before, '->', pts_after)
json.dump({'source': 'geoBoundaries ALB ADM3 (gbOpen), from OpenStreetMap: © OpenStreetMap contributors, ODbL 1.0', 'tolerance': eps, 'zones': out},
          open('elbasan-zones.json', 'w'), separators=(',', ':'), ensure_ascii=False)
import os; print('size', os.path.getsize('elbasan-zones.json'))
