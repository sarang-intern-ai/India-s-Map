# CLAUDE.md — India's Map

Working rules for this repository. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/DATA.md](docs/DATA.md) and [docs/DECISIONS.md](docs/DECISIONS.md) before making
structural or data changes.

---

## What this is

A static, frontend-first explorer for India's administrative geography — district-first
navigation, drill-down, and analytical context. Polished V1, expandable later into a
production application.

**Product reference (philosophy only):** India State Stories District Tracker.
**Technical reference (data model only):** `mvdhv/India-district-scraper-and-downloader`.

We copy **no code, assets or design** from either. The scraper repo is explicitly
all-rights-reserved — read it to understand the IGOD/LGD hierarchy, vendor nothing from it,
and never claim affiliation with or use of either project.

---

## Stack

React · TypeScript · Vite · React Router · Tailwind CSS · MapLibre GL JS · Recharts · Zod

No backend, no database, no authentication, no containers. Static hosting.

---

## Non-negotiables

These override convenience, and override a request to "just make it work":

1. **Never fabricate geographic or administrative data.** If a boundary does not exist,
   it is marked `no_boundary_published`. Do not approximate it from a parent polygon.
2. **LGD codes are the only join keys.** Never join, key, index or look up on a name.
   Verified name instability in the live data: `Anupgarh`/`Anoopgarh`,
   `Sanchore`/`Sanchor`, `Jaipur Rural`/`Jaipur Gramin`.
3. **India's external boundary must stay India-correct.** Section 2 of the Criminal Law
   Amendment Act, 1961 makes incorrect depiction a cognisable offence. Do not swap in
   geoBoundaries, GADM, Natural Earth or OSM outlines — they draw the LoC/LAC. Any change
   to boundary data needs the bbox re-verified (must reach ≈37.08°N and ≈97.41°E).
4. **No basemap, no map tokens.** The frontend has zero secrets. Keep it that way.
5. **The frontend never fetches from an external host at runtime.** Not LGD, IGOD, OGD,
   GitHub or bharatlas. Everything is precomputed into `public/data/`.
6. **Never weaken a pipeline invariant to make a build pass.** Fix the data or the fix
   list. The invariants exist because this data has known defects.
7. **Never use `SHAPE_Area` or `SHAPE_Length`.** They are 20.8% inflated projected
   artifacts. Areas are computed in an equal-area projection during the pipeline.
8. **Accessibility is not optional.** The table view is an equal surface, not a fallback.
   Colour is never the sole carrier of meaning.

---

## Layout

```
pipeline/        offline acquisition + transformation. Has its own package.json.
public/data/     versioned static datasets. Written by pipeline/, read by src/.
src/             frontend. Reads public/data/ only.
docs/            architecture, data provenance, decisions.
```

`pipeline/` → `public/data/` → `src/`. The arrow only goes one way. `src/` must never
import from `pipeline/`, and mapshaper must never enter the frontend dependency graph.

---

## Secrets

Exactly one: `DATA_GOV_IN_API_KEY` in `pipeline/.env` (gitignored), for the OGD LGD
roster. Pipeline-only. If you find yourself wanting a key in `src/`, the design is wrong.

---

## The data has known defects — do not be surprised by them

All verified 2026-08-12, all documented in [docs/DATA.md](docs/DATA.md):

- **785 district polygons**, 783 unique LGD codes, 2 with `dist_lgd = 0`
  (Mirpur, Muzaffarabad — PoK, LGD assigns no code to unadministered territory)
- **79% of geometry is Census 2011 delineation**, incrementally updated to ~2023–24
- **9 dissolved Rajasthan districts still present** (dissolved 28 Dec 2024; state is now 41)
- **5 Ladakh districts missing** (Nubra, Sham, Changthang, Zanskar, Drass — notified
  27 Apr 2026; no open dataset has them yet)
- **2 overlapping polygon pairs** in Rajasthan, 4,833 km² total (0.15%)

**Do not "fix" these by running `mapshaper -clean`.** It silently deletes Sanchor
(784 of 785 retained). The overlaps are preserved on purpose — both children were dissolved
back into their parents in Dec 2024, so the un-recut parent polygons are correct for today
(D-011). They are declared in `pipeline/fixes/geometry-fixes.json`; validation fails on any
undocumented third pair.

**Two mapshaper traps.** `-dissolve` does not resolve overlaps and reports 0 km² — union
area must use `-dissolve2` (D-012). `-clean` deletes features silently — never used.

---

## Running the pipeline

```bash
cd pipeline && npm install
npm run all                 # 01→05, needs DATA_GOV_IN_API_KEY
npm run all:geometry-only   # 02→05, works without the key
```

Stages are plain `.ts` run by Node 24's native type stripping — no transpiler. Avoid
enums, namespaces and parameter properties; they are not erasable and will not run.

---

## Conventions

- Identifiers: `districtId = String(dist_lgd)`, or `"unadministered:" + dtcode11` when
  `dist_lgd === 0`. Code that assumes `districtId` parses as an integer is a bug.
- Zod schemas live in `pipeline/src/schema.ts` and are the shared contract. Validate on
  write and on read.
- Zoom-to-district uses **bounding-box fitting, never centroids** — Puducherry and the
  Andamans are multipart, and a centroid can land in the sea.
- New data vintage → new `public/data/<vintage>/` directory. Never overwrite in place.
- Every user-visible area, count or boundary must be traceable to `manifest.json`.

---

## Current status

Data-source verification **complete**. Pipeline stages 01–05 **implemented**.
Stages 02–05 run green; `public/data/lgd-2024/` is published and passes all validation
(785 districts, 36 states/UTs, 981 kB TopoJSON).

**Blocked:** stage 01 needs `DATA_GOV_IN_API_KEY`. Until it runs, the dataset is
`mode: "partial"` and every district is `status: "unreconciled"` — statuses are not
guessed. Set the key, then `npm run fetch:admin && npm run join && npm run simplify`.

Frontend implementation has **not** started.
