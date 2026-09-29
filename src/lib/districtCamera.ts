import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';

/** [[west, south], [east, north]] — MapLibre's `LngLatBoundsLike` tuple form. */
export type Bounds = [[number, number], [number, number]];

/**
 * Camera limits for framing a single district.
 *
 * `maxZoom` is the important one: without it, `fitBounds` on a tiny geometry (a Lakshadweep
 * island, a small urban district) zooms to street level where the district fills the screen
 * and all context is lost. Capping at 11 keeps a small district clearly readable while
 * still showing where it sits. The map's own maxZoom is 12, so this stays inside it.
 */
export const DISTRICT_MAX_ZOOM = 11;
/**
 * States are far larger than districts, so they need a lower ceiling — without it, framing
 * a small UT (Chandigarh, Lakshadweep) would zoom past the point where surrounding context
 * is visible, which defeats the purpose of scoping to it.
 */
export const STATE_MAX_ZOOM = 9;
export const DISTRICT_FIT_DURATION_MS = 900;
const BASE_PADDING = 56;

/**
 * Padding scaled to the container. A fixed 56px would exceed half the viewport on a small
 * map pane, which makes `fitBounds` throw or produce a nonsense camera.
 */
export function fitPaddingFor(width: number, height: number): number {
  const smallest = Math.min(width, height);
  if (!Number.isFinite(smallest) || smallest <= 0) return 0;
  return Math.max(8, Math.min(BASE_PADDING, Math.floor(smallest / 6)));
}

function isFinitePosition(p: Position): p is [number, number] {
  return (
    Array.isArray(p) &&
    p.length >= 2 &&
    typeof p[0] === 'number' &&
    typeof p[1] === 'number' &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1])
  );
}

/**
 * Bounding box of a Polygon or MultiPolygon, computed from the feature's own coordinates.
 * No coordinates are hard-coded anywhere.
 *
 * Returns `null` rather than throwing when the geometry is missing, empty or non-numeric,
 * so callers can simply leave the camera alone.
 *
 * Multipart districts are framed across ALL their parts, so island and exclave districts
 * zoom out far enough to show the whole thing rather than one fragment. Measured extremes:
 * Lakshadweep District spans 282 km across 3 parts and Nicobars 275 km across 11. This is
 * also why the app never frames a district by centroid — for those shapes the centroid
 * falls in open sea.
 */
export function featureBounds(
  feature: Feature<Polygon | MultiPolygon> | undefined | null,
): Bounds | null {
  const geometry = feature?.geometry;
  if (!geometry) return null;

  const polygons: Position[][][] =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : [];
  if (polygons.length === 0) return null;

  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  let seen = 0;

  for (const polygon of polygons) {
    // Only the outer ring is needed — holes are inside it by definition.
    const outer = polygon[0];
    if (!outer) continue;
    for (const position of outer) {
      if (!isFinitePosition(position)) continue;
      const [lng, lat] = position;
      if (lng < west) west = lng;
      if (lat < south) south = lat;
      if (lng > east) east = lng;
      if (lat > north) north = lat;
      seen += 1;
    }
  }

  if (seen === 0 || west > east || south > north) return null;
  return [
    [west, south],
    [east, north],
  ];
}
