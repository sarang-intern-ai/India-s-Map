import { setWorkerUrl } from 'maplibre-gl';
// `?worker&url` makes Vite bundle the worker (resolving its own imports into the shared
// chunk) and hand back the emitted asset URL. A plain `?url` would copy the file verbatim
// and its imports would 404.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

/**
 * MapLibre v6 loads its tiling worker from a sibling file it resolves at runtime
 * (`new Worker('…/maplibre-gl-worker.mjs', { type: 'module' })`). Because that reference is
 * a computed string rather than `new URL(…, import.meta.url)`, Vite cannot see it, never
 * emits the chunk, and the request falls through to the SPA's index.html. The worker then
 * fails on a `text/html` MIME type, GeoJSON is never tiled, and the map renders empty with
 * no error thrown.
 *
 * Pointing MapLibre at the URL Vite actually emitted fixes it in both dev and production.
 * Import this module once before constructing a Map.
 */
setWorkerUrl(maplibreWorkerUrl);
