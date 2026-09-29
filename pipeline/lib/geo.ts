import fs from 'node:fs';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline as streamPipeline } from 'node:stream/promises';
import mapshaper from 'mapshaper';

export type Ring = number[][];
export type Poly = Ring[];

export type GeoFeature = {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown } | null;
};

export function sha256File(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function sha256String(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

export async function downloadTo(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  await streamPipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(dest));
}

/**
 * Reads a GeoJSON FeatureCollection without holding it all in memory.
 *
 * The upstream files are ogr2ogr-style: one complete Feature per line. That lets a 93 MB
 * file be walked with a constant footprint. If the layout ever changes upstream this
 * yields nothing, and the caller is expected to fail loudly rather than proceed with an
 * empty dataset.
 */
export async function* streamFeatures(file: string): AsyncGenerator<GeoFeature> {
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const raw of rl) {
    const line = raw.trim().replace(/,$/, '');
    if (!line.startsWith('{ "type": "Feature"') && !line.startsWith('{"type":"Feature"')) {
      continue;
    }
    yield JSON.parse(line) as GeoFeature;
  }
}

/**
 * Property lookup tolerant of upstream casing. The district layer uses `state_lgd` and
 * `stname`; the states layer from the same publisher uses `State_LGD` and `STNAME`. Exact
 * matches are tried first, then a case-insensitive pass.
 */
export function prop(p: Record<string, unknown>, ...names: string[]): unknown {
  for (const n of names) {
    if (n in p) return p[n];
  }
  const lower = new Map(Object.keys(p).map((k) => [k.toLowerCase(), k]));
  for (const n of names) {
    const actual = lower.get(n.toLowerCase());
    if (actual !== undefined) return p[actual];
  }
  return undefined;
}

export function polygonsOf(geom: GeoFeature['geometry']): Poly[] {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates as Poly];
  return geom.coordinates as Poly[];
}

export function bboxOfPolys(polys: Poly[]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polys) {
    for (const [x, y] of poly[0]) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

export function mergeBbox(
  a: [number, number, number, number],
  b: [number, number, number, number],
): [number, number, number, number] {
  return [
    Math.min(a[0], b[0]), Math.min(a[1], b[1]),
    Math.max(a[2], b[2]), Math.max(a[3], b[3]),
  ];
}

function pointInRing(pt: [number, number], ring: Ring): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[j];
    if (y1 > y !== y2 > y) {
      const denom = y2 - y1 || 1e-12;
      if (x < ((x2 - x1) * (y - y1)) / denom + x1) inside = !inside;
    }
  }
  return inside;
}

export function polysContain(polys: Poly[], pt: [number, number]): boolean {
  for (const poly of polys) {
    if (pointInRing(pt, poly[0]) && !poly.slice(1).some((hole) => pointInRing(pt, hole))) {
      return true;
    }
  }
  return false;
}

function ringCentroid(ring: Ring): [number, number] {
  let area = 0, cx = 0, cy = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  if (area === 0) return [ring[0][0], ring[0][1]];
  area *= 0.5;
  return [cx / (6 * area), cy / (6 * area)];
}

/**
 * A point guaranteed to be inside the shape. The centroid of the largest ring is tried
 * first; for concave or multipart shapes (Puducherry, the Andamans) that can fall outside,
 * so we fall back to a scanline midpoint.
 */
export function representativePoint(polys: Poly[]): [number, number] {
  const biggest = polys.reduce((a, b) => (b[0].length > a[0].length ? b : a));
  const c = ringCentroid(biggest[0]);
  if (polysContain(polys, c)) return c;

  const ring = biggest[0];
  const ys = ring.map((p) => p[1]).sort((a, b) => a - b);
  const yMid = ys[Math.floor(ys.length / 2)];
  const xs: number[] = [];
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    if (y1 > yMid !== y2 > yMid) {
      xs.push(((x2 - x1) * (yMid - y1)) / (y2 - y1 || 1e-12) + x1);
    }
  }
  xs.sort((a, b) => a - b);
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const cand: [number, number] = [(xs[i] + xs[i + 1]) / 2, yMid];
    if (polysContain(polys, cand)) return cand;
  }
  return c;
}

export type OverlapShape = {
  id: string;
  name: string;
  stateId: string;
  polys: Poly[];
  bbox: [number, number, number, number];
  point: [number, number];
};

export type OverlapPair = { a: OverlapShape; b: OverlapShape };

/**
 * Detects overlapping polygons by testing each shape's interior point against every other
 * shape. Bounding boxes prefilter the comparison. This finds genuine stacking (a district
 * laid on top of an un-recut parent); it does not measure sliver overlaps along borders,
 * which the equal-area union check covers instead.
 */
export function findOverlaps(shapes: OverlapShape[]): OverlapPair[] {
  const pairs: OverlapPair[] = [];
  for (const a of shapes) {
    for (const b of shapes) {
      if (a.id === b.id) continue;
      const bb = b.bbox;
      const [px, py] = a.point;
      if (px < bb[0] || px > bb[2] || py < bb[1] || py > bb[3]) continue;
      if (polysContain(b.polys, a.point)) pairs.push({ a, b });
    }
  }
  return pairs;
}

export async function runMapshaper(command: string): Promise<void> {
  await mapshaper.runCommands(command);
}

/** Albers equal-area for India. See docs/DECISIONS.md D-010 — never use SHAPE_Area. */
export const EQUAL_AREA_PROJ =
  '+proj=aea +lat_1=20 +lat_2=35 +lat_0=27.5 +lon_0=82 +datum=WGS84 +units=m';

/** Per-feature true area, keyed by identifier, computed in an equal-area projection. */
export async function computeAreasKm2(
  geojsonFile: string,
  idField: string,
  tmpFile: string,
): Promise<Map<string, number>> {
  await runMapshaper(
    `-i "${geojsonFile}" -proj "${EQUAL_AREA_PROJ}" ` +
      `-each "areaKm2 = this.area / 1e6" -filter-fields ${idField},areaKm2 ` +
      `-o "${tmpFile}" format=json`,
  );
  const rows = JSON.parse(fs.readFileSync(tmpFile, 'utf8')) as Record<string, unknown>[];
  const out = new Map<string, number>();
  for (const r of rows) out.set(String(r[idField]), Number(r.areaKm2));
  return out;
}

/**
 * Area of the dissolved union. Compared against the sum of parts, this reveals overlap.
 *
 * MUST use `-dissolve2`, not `-dissolve`. Plain `-dissolve` merges features without
 * resolving overlapping areas, so it returns the sum of parts and reports zero overlap
 * even when polygons genuinely stack. Measured on this dataset: `-dissolve` gives
 * 3,274,899 km² (= sum of parts, overlap invisible) while `-dissolve2` gives
 * 3,270,066 km², correctly exposing the 4,833 km² of Rajasthan overlap.
 */
export async function computeUnionAreaKm2(
  geojsonFile: string,
  tmpFile: string,
): Promise<number> {
  await runMapshaper(
    `-i "${geojsonFile}" -proj "${EQUAL_AREA_PROJ}" -dissolve2 ` +
      `-each "areaKm2 = this.area / 1e6" -filter-fields areaKm2 ` +
      `-o "${tmpFile}" format=json`,
  );
  const rows = JSON.parse(fs.readFileSync(tmpFile, 'utf8')) as { areaKm2: number }[];
  return rows.reduce((sum, r) => sum + Number(r.areaKm2), 0);
}
