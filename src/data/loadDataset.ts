import { feature, merge } from 'topojson-client';
import type {
  Topology,
  GeometryCollection,
  Polygon as TopoPolygon,
  MultiPolygon as TopoMultiPolygon,
} from 'topojson-specification';
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import { Hierarchy, Manifest, type DistrictFeatureProperties, type DistrictRecord } from './schema.ts';
import type { StateOption } from '../lib/search.ts';

/**
 * All four files come from the pipeline output directory and nowhere else. The frontend
 * never contacts LGD, IGOD, OGD, GitHub or any other host at runtime.
 */
export const DATA_ROOT = '/data/lgd-2024';

export type DistrictFeature = Feature<Polygon | MultiPolygon, DistrictFeatureProperties>;
export type DistrictFeatureCollection = FeatureCollection<
  Polygon | MultiPolygon,
  DistrictFeatureProperties
>;
export type StateFeature = Feature<Polygon | MultiPolygon, { stateId: string; stateName: string }>;
export type StateFeatureCollection = FeatureCollection<
  Polygon | MultiPolygon,
  { stateId: string; stateName: string }
>;

export type Dataset = {
  manifest: Manifest;
  hierarchy: Hierarchy;
  districts: DistrictFeatureCollection;
  states: StateFeatureCollection;
  /**
   * Dissolved union of all 36 state/UT polygons — India's outer boundary.
   * Computed via topojson-client `merge`, which eliminates shared interior arcs and keeps
   * only the exterior. DATA.md §3 documents this as the correct authoritative source.
   */
  indiaOutline: Feature<MultiPolygon>;
  /** districtId → record. The canonical lookup for everything outside the map. */
  districtsById: Map<string, DistrictRecord>;
  /**
   * districtId → the same feature object already inside `districts.features`. This is an
   * index of references, not a second copy of the geometry — needed so camera work can
   * reach a district's coordinates in O(1) without walking 785 features.
   */
  districtFeaturesById: Map<string, DistrictFeature>;
  /** stateId → the same feature object already inside `states.features`. References only. */
  stateFeaturesById: Map<string, StateFeature>;
  /** Sorted for the State/UT filter and search. */
  stateOptions: StateOption[];
};

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Could not load ${path} — HTTP ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * Decodes a TopoJSON object into GeoJSON. MapLibre cannot consume TopoJSON directly, so
 * this runs once at load; the source dataset on disk is never modified.
 *
 * The object name is asserted rather than guessed — the pipeline pins it (validation
 * invariant 7), so a rename should fail loudly here instead of rendering an empty map.
 */
function decodeTopology<P>(topology: unknown, objectName: string): FeatureCollection<Polygon | MultiPolygon, P> {
  const topo = topology as Topology;
  if (!topo || topo.type !== 'Topology' || !topo.objects) {
    throw new Error(`${objectName}: not a TopoJSON Topology`);
  }
  const obj = topo.objects[objectName];
  if (!obj) {
    throw new Error(
      `TopoJSON object "${objectName}" not found. Present: ${Object.keys(topo.objects).join(', ')}`,
    );
  }
  const fc = feature(topo, obj as GeometryCollection) as unknown as FeatureCollection<
    Polygon | MultiPolygon,
    P
  >;
  if (!fc.features?.length) {
    throw new Error(`TopoJSON object "${objectName}" decoded to zero features`);
  }
  return fc;
}

export async function loadDataset(): Promise<Dataset> {
  const [manifestRaw, hierarchyRaw, districtsRaw, statesRaw] = await Promise.all([
    getJson(`${DATA_ROOT}/manifest.json`),
    getJson(`${DATA_ROOT}/hierarchy.json`),
    getJson(`${DATA_ROOT}/districts.topo.json`),
    getJson(`${DATA_ROOT}/states.topo.json`),
  ]);

  const manifest = Manifest.parse(manifestRaw);
  const hierarchy = Hierarchy.parse(hierarchyRaw);

  const districts = decodeTopology<DistrictFeatureProperties>(districtsRaw, 'districts');
  const states = decodeTopology<{ stateId: string; stateName: string }>(statesRaw, 'states');

  // Dissolve all 36 state polygons into India's outer boundary. `merge` eliminates shared
  // arcs between adjacent states, keeping only the exterior coastline/land boundary.
  // v3.1.0's merge iterates its second argument as an array (it calls `objects.forEach`).
  // @types/topojson-client also lists a bare GeometryCollection, but the runtime requires
  // an array — so pass the collection's geometries, which are all Polygon/MultiPolygon.
  const statesTopo = statesRaw as Topology;
  const statesGeoColl = statesTopo.objects.states as GeometryCollection;
  const indiaOutline: Feature<MultiPolygon> = {
    type: 'Feature',
    geometry: merge(
      statesTopo,
      statesGeoColl.geometries as Array<TopoPolygon | TopoMultiPolygon>,
    ),
    properties: {},
  };

  // Cross-check the two files agree. They are generated together, so disagreement means a
  // stale or partially-written dataset — better to fail than to render a half-truth.
  if (districts.features.length !== manifest.counts.districtFeatures) {
    throw new Error(
      `Dataset inconsistent: districts.topo.json has ${districts.features.length} features ` +
        `but manifest reports ${manifest.counts.districtFeatures}.`,
    );
  }

  const districtsById = new Map<string, DistrictRecord>();
  for (const group of hierarchy.states) {
    for (const d of group.districts) districtsById.set(d.districtId, d);
  }

  const districtFeaturesById = new Map<string, DistrictFeature>();
  for (const f of districts.features) {
    districtFeaturesById.set(f.properties.districtId, f);
  }

  const stateFeaturesById = new Map<string, StateFeature>();
  for (const f of states.features) {
    stateFeaturesById.set(f.properties.stateId, f);
  }

  const stateOptions: StateOption[] = hierarchy.states
    .map((s) => ({
      stateId: s.stateId,
      stateName: s.stateName,
      districtCount: s.districtCount,
      isUnionTerritory: s.isUnionTerritory,
    }))
    .sort((a, b) => a.stateName.localeCompare(b.stateName, 'en-IN'));

  return {
    manifest, hierarchy, districts, states, indiaOutline,
    districtsById, districtFeaturesById, stateFeaturesById, stateOptions,
  };
}
