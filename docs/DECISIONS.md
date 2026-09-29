# DECISIONS.md — Architecture decision record

Lightweight ADRs. Newest decisions appended at the end. Each records the choice, the
alternatives actually considered, and why. Superseded decisions are marked, never deleted.

---

## D-001 — Frontend-first static application

**Status:** Accepted · 2026-08-12

**Decision.** React + TypeScript + Vite + React Router + Tailwind CSS + MapLibre GL JS +
Recharts + Zod. Deployed as static files. No backend, no database, no authentication.

**Alternatives considered.**
- *Next.js* — buys SSR and file-system routing we do not need. The dataset is static and
  precomputed; there is nothing to render on a server. Rejected as unnecessary weight.
- *Backend API serving districts* — would let us query dynamically, but the entire dataset
  is ~1 MB after simplification. A server adds hosting, deployment and failure modes for
  no user-visible gain. Rejected.

**Consequence.** The whole product is cacheable static assets. Hosting is trivial and free.
Data changes require a pipeline re-run and redeploy — acceptable, since administrative
boundaries change a few times a year, not a few times a second.

---

## D-002 — LGD district layer as the geometry source

**Status:** Accepted · 2026-08-12

**Decision.** Use `LGD_Districts` from the `yashveeeeeeer/india-geodata` release
`admin/districts`, pinned by URL and SHA-256. Treat bharatlas's R2 bucket as a CDN mirror,
not as the source of record.

**Alternatives considered.**

| Candidate | Rows | Verdict |
|---|---:|---|
| **LGD districts** | **785** | **Chosen.** Full LGD code chain on every feature; India-correct extent. |
| geoBoundaries ADM2 | 735 | Rejected — "name-only", no LGD codes, de-facto boundaries. |
| SOI districts | 742 | Rejected as primary ("partial LGD codes"); kept as a cross-check. |
| Bhuvan districts | 663 | Rejected — under-counts, non-LGD codes. |
| datameet Census 2011 | 640 | Rejected — 2011 vintage only. |

**Why this dominates.** The join key problem is the one that kills this class of project.
A layer without LGD codes forces name-based joins, and we have verified name instability
in the live data (`Anupgarh`/`Anoopgarh`, `Sanchore`/`Sanchor`, `Jaipur Rural`/`Jaipur
Gramin`). 783 of 785 features carry unique non-zero `dist_lgd` values. That settles it.

**Consequence.** We inherit this layer's defects — heterogeneous vintage, two overlapping
polygon pairs, 9 dissolved districts. All are documented and individually addressed rather
than being reasons to reject an otherwise clearly superior source.

---

## D-003 — LGD codes are canonical; names are never keys

**Status:** Accepted · 2026-08-12

**Decision.**

```
districtId = String(dist_lgd)               when dist_lgd > 0
           = "unadministered:" + dtcode11   when dist_lgd === 0
stateId    = String(state_lgd)
```

Every lookup, URL segment, map feature id and chart series keys off these. `dtname` /
`stname` are presentation-only.

**Alternatives considered.**
- *Slugified names as ids* — nicer URLs (`/district/udupi`), but names are demonstrably
  unstable and not unique across states. Rejected outright; this is the classic failure mode.
- *Census `dtcode11` as primary* — stable but frozen at 2011, and absent-by-definition for
  districts created since. Rejected as primary; retained as a secondary Census join key.
- *Synthesise LGD codes for the 2 PoK districts* — rejected. Fabricating a government
  identifier is exactly the kind of invention the project forbids.

**Consequence.** The `unadministered:` prefix makes the two PoK districts impossible to
mistake for coded districts. Any code that assumes `districtId` parses as an integer will
fail loudly rather than silently mis-join.

---

## D-004 — India's national outline is LGD-derived

**Status:** Accepted · 2026-08-12

**Decision.** The national outline is the dissolved union of LGD state polygons, with
`india-soi.geojson` (DataMeet / Survey of India lineage) retained as an independent
verification reference.

**Alternatives considered.**
- *Natural Earth / GADM / OSM / geoBoundaries ADM0* — all depict the LoC and LAC rather
  than India's claimed boundary. Rejected: they would place the project on the wrong side
  of Section 2 of the Criminal Law Amendment Act, 1961.
- *Survey of India certified map* — the legally safest option, but obtaining certification
  is a formal process, and no machine-readable certified vector product is openly
  distributed. Not available for V1.

**Verification.** Both the SOI outline and the LGD district layer independently reach
≈37.08°N and ≈97.41°E — the full J&K and Arunachal Pradesh claims. See DATA.md §3.

**Consequence.** The extent is India-correct and verified. SoI certification remains an
open item that must be revisited before any public launch. Recorded as risk R1 rather than
treated as solved.

---

## D-005 — Simplify to TopoJSON with mapshaper

**Status:** Accepted · 2026-08-12

**Decision.** Pipeline stage: mapshaper `-simplify 4% keep-shapes` → TopoJSON.
Measured result: **93 MB GeoJSON → 1.1 MB TopoJSON** (785 features preserved).

**Context.** The brief said to prefer the source's own format and avoid gratuitous
conversion. The source publishes GeoJSON, Parquet, PMTiles, KML and Shapefile — **no
TopoJSON**. But a 93 MB GeoJSON cannot be shipped to a browser, so a simplification step is
mandatory regardless. Given mapshaper must run anyway, TopoJSON costs nothing extra and
buys shared-arc topology.

**Alternatives considered.**
- *Ship the PMTiles (12.7 MB) directly* — genuinely attractive: HTTP range requests mean
  only visible tiles download, and MapLibre supports it via a protocol handler. Rejected
  for V1 because 1.1 MB loads in one request with no extra runtime dependency, and because
  the table/search views need the full attribute set in memory anyway. **Revisit at
  subdistrict scale**, where PMTiles becomes the right answer.
- *Simplified GeoJSON instead of TopoJSON* — roughly 40% larger, and each district's
  border is stored twice. Independent simplification of shared borders produces visible
  cracks and slivers between adjacent districts. TopoJSON simplifies the shared arc once.
  Rejected on geographic-correctness grounds.

**Consequence.** One decode step (`topojson-client`) at load. Adjacent districts share
exact borders by construction.

---

## D-006 — Administrative roster from the OGD API, not scraping

**Status:** Accepted · 2026-08-12

**Decision.** Fetch the LGD district roster from OGD resource
`37231365-78ba-44d5-ac22-3deec40b9197` using a free API key held in `pipeline/.env`.

**Alternatives considered.**
- *Playwright scraping of LGD/IGOD* (the technical reference's approach) — the citizen view
  requires `OWASP_CSRFTOKEN` **and `captchaAnswer`**. It is CAPTCHA-gated. We do not bypass
  CAPTCHAs, and UI scraping is brittle by nature. Rejected.
- *Derive the roster from geometry attributes alone* — zero dependencies, but circular:
  it cannot detect districts missing from the geometry, which is precisely what
  reconciliation is for. Rejected as the primary source; retained as a cross-check.

**Consequence.** The project has exactly one secret. It is pipeline-only, gitignored, and
never enters the frontend bundle. This is the reason `pipeline/` and `src/` are separate
build contexts rather than a convention.

---

## D-007 — Fix overlaps by explicit erase, never by blind `-clean`

**Status:** ~~Accepted~~ **Superseded by D-011** · 2026-08-12

> The "never `-clean`" half of this decision stands and is now enforced by a validation
> invariant. The "erase the child from the parent" half was **wrong** and was reversed
> during implementation — see D-011 for why.

**Decision.** Resolve the two known overlapping pairs with a declarative fix list —
subtract the newer child from its un-recut parent (`Jalore` minus `Sanchor`,
`Jodhpur` minus `Jodhpur Gramin`) — each entry carrying a comment and a source reference.
Assert afterwards that the feature count is still 785.

**Why not just run `-clean`.** We tried it. `mapshaper -clean` reports
`Retained 784 of 785 features` — it **silently deletes `Sanchor`**. A heuristic choosing
which district ceases to exist is not acceptable in a product whose purpose is
administrative geography.

**Alternatives considered.**
- *Ship overlaps as published* — most faithful to source, but overlapping fills render as
  visible artifacts and hit-testing returns two districts for one click. Rejected.
- *Global `-clean`* — rejected, per above.

**Consequence.** The fix list is small, explicit and auditable. If a future data refresh
re-cuts these parents upstream, the fixes become no-ops and the validation stage will say so.

---

## D-008 — Missing and dissolved districts are first-class states, never fabricated

**Status:** Accepted · 2026-08-12

**Decision.** After reconciling geometry against the LGD roster, every district carries:

```
status: "active" | "no_boundary_published" | "dissolved"
```

- `no_boundary_published` — in the roster, no polygon exists (Ladakh's 5 new districts).
  Appears in lists, search and tables; the map shows it as unavailable.
- `dissolved` — polygon exists, no longer in the roster (Rajasthan's 9). Hidden from the
  current-view map, retained as historical context.

**Alternatives considered.**
- *Approximate missing boundaries by splitting the parent* — would produce a complete-looking
  map that is factually wrong. Directly violates the project rule against fabricating data.
  Rejected.
- *Silently omit them* — a user searching "Zanskar" would get nothing, with no explanation.
  Rejected: absence should be visible and explained.

**Consequence.** The product can honestly show that India's district count is contested and
in motion. That is analytical content, not a defect to hide.

---

## D-009 — No basemap, no map tokens

**Status:** Accepted · 2026-08-12

**Decision.** Render district polygons on a plain canvas. No raster or vector basemap.

**Alternatives considered.**
- *Mapbox / MapTiler basemap* — requires an API token, i.e. a secret shipped to the browser,
  plus a paid tier and a third-party dependency. Their basemaps also carry their own
  depiction of India's boundaries, which would contradict D-004 directly beneath our own
  polygons. Rejected on both counts.
- *OSM raster tiles* — free, but same boundary-depiction problem, plus a tile-usage policy.
  Rejected.

**Consequence.** Zero frontend secrets. The map is entirely our own verified geometry, and
nothing underneath it can contradict the boundary we publish.

---

## D-010 — Area is computed, never read from the source

**Status:** Accepted · 2026-08-12

**Decision.** Drop `SHAPE_Area` and `SHAPE_Length`. Compute any area shown in the product
in an Albers equal-area projection (`+proj=aea +lat_1=20 +lat_2=35 +lat_0=27.5 +lon_0=82`)
during the pipeline, and store the result.

**Why.** Summed across all 785 districts, `SHAPE_Area` gives **3,955,733 km²** against a
true equal-area total of **3,274,899 km²** — **20.8% inflated**, consistent with planar
area in a Web Mercator-like projection. Displaying it would put a wrong number next to
every district.

**Consequence.** Areas are computed once, offline, and are internally consistent. The union
check (3,270,066 km² vs India's official 3,287,263 km², −0.52%) doubles as a permanent
regression test on future data refreshes.

---

## D-011 — Preserve the Rajasthan overlaps; do not carve them out

**Status:** Accepted · 2026-08-12 · **supersedes the erase half of D-007**

**Decision.** Publish all 785 source polygons unmodified. Record the two overlapping pairs
declaratively in `geometry-fixes.json` with `"resolution": "none-required"`. Do not erase,
do not clip, do not delete.

**Why D-007 was wrong.** D-007 proposed carving Sanchor out of Jalore and Jodhpur Gramin
out of Jodhpur, reasoning that a parent should not contain its child. Implementing it
surfaced the fact that kills the argument: **Sanchor and Jodhpur Gramin were both dissolved
back into their parents on 28 December 2024.** They are two of the nine districts Rajasthan
abolished. So the un-recut Jalore polygon is *correct* for current administrative reality —
carving Sanchor out of it would have made the current map wrong, in the name of tidiness.

The overlap is not a geometry defect to repair. It is the visible seam between two
administrative snapshots coexisting in one layer, and it disappears the moment the roster
marks those nine districts `dissolved`.

**Alternatives considered.**
- *Erase (D-007 as written)* — rejected: produces a wrong current boundary, as above.
- *Blanket `mapshaper -clean`* — rejected, and now blocked by invariant 8. Measured
  behaviour on this dataset: `Retained 784 of 785 features`, silently deleting Sanchor.
- *Ship overlaps undocumented* — rejected: a future refresh could introduce new stacking
  and nobody would notice.

**Consequence.** Zero geometry is modified, so the published dataset is byte-faithful to a
pinned, checksummed source. Validation tolerates exactly the two documented pairs and fails
on any third. Verified by negative test: removing one entry from `geometry-fixes.json`
makes stage 05 exit 1 naming the exact pair.

**Cost, stated honestly.** Until the roster lands, ~4,833 km² in Rajasthan has two polygons
stacked, so a click there is ambiguous and the fill draws twice. That is the correct
trade against publishing a boundary we know to be wrong.

---

## D-012 — Union area must use `-dissolve2`, never `-dissolve`

**Status:** Accepted · 2026-08-12

**Decision.** `computeUnionAreaKm2()` uses mapshaper `-dissolve2`.

**Why this is worth an ADR.** `-dissolve` merges features without resolving overlapping
area. On this dataset it returns **3,274,899 km²** — identical to the sum of parts — which
makes the overlap metric read **0 km²**. `-dissolve2` performs a true geometric union and
returns **3,270,066 km²**, correctly exposing 4,833 km².

The first implementation used `-dissolve` and cheerfully logged `overlap 0 km² (0.00%)`.
That is a false claim about data integrity, and it passed every check because the check
itself was computing the wrong number. It was caught only by comparing against the
independent interior-point test done during source verification.

**Consequence.** The two overlap detectors are deliberately independent and mutually
checking: an equal-area union difference (aggregate magnitude) and an interior-point scan
(names the exact pairs). A bug in one shows up as disagreement with the other.

---

## D-013 — Stage runner: Node native type stripping

**Status:** Accepted · 2026-08-12

**Decision.** Run pipeline stages as `node NN-stage.ts`, relying on Node 24's built-in
TypeScript type stripping. No `tsx`, no `ts-node`, no build step.

**Alternatives considered.** `tsx` (one more dependency for something the runtime now does)
and compiling to JS (a build artifact to keep in sync). Both rejected as unnecessary.

**Consequence.** The pipeline has three runtime dependencies total. The constraint is that
TS-only runtime constructs — enums, namespaces, parameter properties — are not erasable and
must be avoided. Requires Node ≥ 22.6; `engines` records this.

---

## D-014 — `status: "unreconciled"` rather than assuming "active"

**Status:** Accepted · 2026-08-12

**Decision.** When the OGD roster is unavailable, every district gets
`status: "unreconciled"` and the dataset is marked `mode: "partial"`.

**Alternatives considered.**
- *Default to `"active"`* — convenient, and wrong. Without the roster we do not know which
  districts still exist; we have direct evidence that nine of them do not. Defaulting to
  active would assert something unverified about all 785.
- *Apply the known Rajasthan/Ladakh deltas as a substitute roster* — rejected. Those facts
  are real and cited, but hand-maintained administrative data masquerading as a roster is
  exactly the failure mode the project forbids. `known-admin-deltas.json` therefore feeds
  **reporting and validation only** and never synthesises a district record.

**Consequence.** The partial state is explicit and visible in `manifest.json`,
`hierarchy.json` and the coverage report. The frontend can render it honestly rather than
silently presenting stale administrative claims as current.
