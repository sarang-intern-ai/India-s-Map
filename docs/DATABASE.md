# DATABASE.md — PostgreSQL dataset layer (parity phase)

PostgreSQL is added **alongside** the Excel/Google/CSV providers to prove it can reproduce the exact
same normalized records and aggregation before it becomes the frontend source. It stores **only the
external district dataset** — no geometry, no PostGIS. `public/data/lgd-2024/` is untouched.

```
Excel workbook ──(db:import)──▶ PostgreSQL ──(API)──▶ PostgresDatasetProvider ──▶ DatasetRecord[]
                                                                                     │
                                                              same aggregation engine ▼
                                                                        StatePanel + DistrictPanel
```

The frontend never talks to PostgreSQL directly: **React → /api → PostgreSQL**. `DATABASE_URL`
lives server-side only.

---

## 1. Prerequisites & one-time setup

PostgreSQL must be installed and running (this repo was developed against **PostgreSQL 18**). Then,
from a shell where you can authenticate to Postgres:

```bash
# Create a database (any name; the URL just has to match).
createdb indias_map            # or: psql -U postgres -c "CREATE DATABASE indias_map;"
```

Add the connection string to **`.env.local`** (gitignored — never committed):

```
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/indias_map
# optional (defaults shown):
API_PORT=8787
```

`DATABASE_URL` is **not** a `VITE_` variable, so it never ships to the browser. See `.env.example`.

---

## 2. Migrate → sync → status

```bash
npm run db:migrate            # applies db/migrations/*.sql once each (tracked in schema_migrations)
npm run db:sync               # one-shot: reconcile the workbook into PostgreSQL (idempotent)
npm run db:sync -- --dry-run  # show what WOULD change, without touching the DB
npm run db:status             # connection, schema version, record/district/type counts (no credentials)
```

`db:sync` reads `public/data/sample_india_district_dataset.xlsx` (sheet `DistrictData`) using the
**same** normalization the frontend uses (`excelRowsFromBuffer` + `normalizeRowsDetailed`) — there
is no second parser. It also seeds `districts_reference` (districtId → stateId) from
`public/data/lgd-2024/hierarchy.json`. `db:import` is kept as an alias of `db:sync`. For the
*automatic* watcher, see §10.

---

## 3. Schema

`dataset_records` (see `db/migrations/0001_init.sql`):

| column | type | notes |
| --- | --- | --- |
| `id` | bigint identity | PK |
| `district_id` | text NOT NULL | canonical join key; `CHECK` non-empty; **never a name** |
| `dataset_type` | text NOT NULL | `CHECK` non-empty |
| `sub_type` | text NOT NULL | `CHECK` non-empty |
| `value_type` | text NOT NULL | `'number' \| 'text' \| 'boolean'` |
| `value_number` / `value_text` / `value_boolean` | typed | exactly one populated (`CHECK`) — **no untyped blob** |
| `unit` | text NOT NULL | may be `''`; never NULL |
| `source` / `last_updated` / `notes` | text | optional passthrough |
| `source_name` / `source_key` | text NOT NULL | import provenance / idempotency identity |
| `created_at` / `updated_at` | timestamptz | `CHECK (updated_at >= created_at)` |

Indexes: `district_id`, `(district_id, dataset_type)`, `dataset_type`, and a UNIQUE `source_key`.
There is **no** unique constraint on `(district_id, dataset_type, sub_type)` — duplicate observations
are legitimate and must be flag-able by the app, not merged by the DB.

`districts_reference (district_id PK, state_id)` — the minimal identity map for state rollups,
seeded from the hierarchy. No polygons, no names.

---

## 4. Idempotency

Identity is `source_key = "<file>:<sheet>:<line>"` (the source row's position), UNIQUE. `db:import`
runs in one transaction: upsert every current row by `source_key`, then delete rows of this
`source_name` whose key is no longer present. Result:

- **same source row → same DB record** (re-import updates in place, never doubles);
- **legitimate duplicate rows** (same district/type/subType on different lines) get different keys
  and both survive — preserving the app's duplicate-diagnostic behavior.

---

## 5. Backend API

`npm run server` starts `db/server.mts` (plain `node:http`, no framework) on `API_PORT` (8787):

| endpoint | returns |
| --- | --- |
| `GET /api/health` | `{ ok, records, districts, types }` |
| `GET /api/datasets` | `DatasetRecord[]` (whole dataset — used by the provider) |
| `GET /api/datasets/district/:districtId` | `DatasetRecord[]` (one district; `[]` if none) |
| `GET /api/datasets/state/:stateId` | `DatasetRecord[]` (all districts in the state via `districts_reference`) |

Rows are mapped back to `DatasetRecord` by `db/mapping.ts` (`rowToRecord`) — the exact shape the
frontend already understands. No UI-specific DB shape. Unknown ids return `[]`, never fabricated
zeros.

---

## 6. Point the frontend at PostgreSQL

In `.env.local`:

```
VITE_DATASET_SOURCE=postgres      # switch from excel → postgres
# VITE_API_BASE=/api              # default; Vite proxies /api → http://localhost:API_PORT
```

Then run **both** processes:

```bash
npm run server      # terminal 1 — the API
npm run dev         # terminal 2 — Vite (proxies /api to the API)
```

The DistrictPanel/StatePanel and the aggregation engine are unchanged — only the provider differs
(`PostgresDatasetProvider`). Switch back with `VITE_DATASET_SOURCE=excel`. The **Refresh data**
button re-fetches the API and rebuilds both aggregate maps, preserving selection, the user
localStorage tree, and the MapLibre instance.

---

## 7. Parity tests

```bash
npm run db:test     # OFFLINE — DatasetRecord ↔ typed-column round-trip is lossless (no DB needed)
npm run db:parity   # LIVE — needs DB imported + `npm run server` running
```

`db:parity` compares, for districts 490 / 469 / 165 / 52 / 103:
- raw records (district_id, dataset_type, sub_type, value, value type, unit — `district_name`
  excluded as non-semantic),
- district aggregates, and
- state aggregates (Maharashtra Speech = 380 h, etc.)

between the Excel provider and the PostgreSQL API. They must be identical.

---

## 8. Security

- `DATABASE_URL` is server-side only (read by `db/*.mts` + the API); never a `VITE_` var, never in
  the browser bundle (`pg` is not imported by `src/`).
- `.env.local` is gitignored; `.env.example` documents the keys with no real values.
- The API returns generic error messages and never echoes the connection string.

---

## 9. Security note

`DATABASE_URL` is server-side only and never bundled; long-running services attach a
`pool.on('error')` handler so a PostgreSQL restart (dropped idle connections) is logged and
recovered from, not fatal.

---

## 10. Automatic synchronization (spreadsheet → PostgreSQL → API → map)

The product goal: **edit the source spreadsheet, change nothing in React, and the district/state
values update on the map.** That whole path is automated here.

```
source spreadsheet ──▶ sync watcher ──▶ PostgreSQL ──▶ /api/datasets/version ──▶ frontend poll ──▶ auto-refresh
   (human edits)        (db/sync-watch)   (atomic)        (cheap fingerprint)      (every 45s)      (aggregates update)
```

### Two clocks — be precise about "automatic"
- **Excel**: file-change detection (`fs.watch` on the workbook's folder) + a periodic safety poll.
  An edit triggers a sync **within ~1 second**.
- **Google Sheets**: polling the published CSV every `DATASET_SYNC_INTERVAL_MS` (default 5 min). A
  change is picked up **within at most that interval**. This is polling, not real-time — the UI
  says "synced HH:MM", never "real-time".

### Change detection & identity
- The sync computes a **content fingerprint** of the normalized records (order-independent). If it
  equals the stored fingerprint → `No changes detected`, zero DB writes.
- **Stable identity** (`db/identity.ts`): a `record_id` column if the sheet provides one, else a
  content hash of `(district_id, dataset_type, sub_type)` + occurrence index. Value/unit are **not**
  in the identity, so editing a value is an `UPDATE`, and reordering rows is a no-op. Limitation
  without `record_id`: two identical `(district,type,subType)` rows are told apart only by order —
  add a `record_id` column for a fully position-independent business key.

### Reconcile = insert / update / delete, atomically
One transaction per change: upsert desired rows by identity, delete this source's rows that are
gone. Deletions are **scoped to `source_id`**, so multiple sources never cross-delete. Counts are
recorded in `dataset_sync_runs` (status `success | no_changes | failed`, plus
inserted/updated/deleted/unchanged/warning/error + fingerprint).

### Validation gate & last-good guarantee
The **entire** source is parsed, normalized and validated **before** any write. A fatal problem
(missing required column, unreadable file, empty result, …) → **no DB change**, a `failed` run is
recorded, and PostgreSQL keeps serving the last good data. Row-level problems are non-fatal
warnings; the valid rows still sync. A malformed spreadsheet can never destroy the working database.

### Frontend auto-refresh
`GET /api/datasets/version` returns `{ version, lastUpdated, status, lastSyncedAt }` where `version`
changes **iff** the served data changed. The frontend polls it every `VITE_DATASET_POLL_MS`
(default 45 s); on a version change it calls the existing **Refresh** — reloading records and
rebuilding district + state aggregates while **preserving selection and the user tree, and never
reinitializing MapLibre**. The source bar shows *Data updated … · synced …*, or *Sync issue —
serving last successful data* on a failed sync.

**Sync vs Refresh:** *Sync* = spreadsheet → PostgreSQL (server-side). *Refresh* = PostgreSQL →
React (client-side). React never touches the spreadsheet.

### Commands
```bash
npm run db:sync              # manual one-shot sync (admin/debug)
npm run db:sync -- --dry-run # preview only
npm run db:sync:watch        # the automatic watcher (initial sync + monitor)
```

### Development workflow (three terminals)
```bash
# 1. PostgreSQL (dev container)      2. keep DB in step with the sheet   3. serve + view
docker start indias_map_pg           npm run db:sync:watch                npm run server   # API
                                                                          npm run dev      # Vite (proxies /api)
```
Set `VITE_DATASET_SOURCE=postgres` to view the live DB path (default is `excel`, which works with no
running services). Configurable env: `DATASET_SYNC_INTERVAL_MS`, `VITE_DATASET_POLL_MS`,
`DATASET_SOURCE_ID`, `SYNC_SOURCE`, `SYNC_EXCEL_FILE` (see `.env.example`).

### Google Sheets activation (still required)
No real Google Sheet is configured. The provider and sync path are ready: set
`VITE_GOOGLE_SHEETS_CSV_URL` to a **published** CSV URL and `SYNC_SOURCE=google`, then run the
watcher — it polls every `DATASET_SYNC_INTERVAL_MS`. A **private** sheet needs a server-side
authenticated provider (not built here); do not put credentials in `VITE_` vars.

---

## 11. Word / DOCX sources

Datasets also arrive as **Word tables** (the Community Radio station list). Word is a first-class
source through the same abstraction — parsed server-side, reconciled to canonical districtIds,
reduced to the same `DatasetRecord`s, and fed through the same sync (its own `source_id`, so it
never touches the Excel data).

```
DOCX ─▶ wordParser (fflate+sax, real Word tables — no OCR) ─▶ raw StationRecord[] (all attributes)
     ─▶ district reconciliation (LGD names + official-name registry + explicit aliases; unmatched reported)
     ─▶ DatasetRecord[] (the ONE safe metric: station COUNT per district)  ─▶ sync ─▶ PostgreSQL
```

- **Structure (this document):** 140 tables (one logical list chunked across pages, 18 trailing
  empty tables), no merged cells, header once, **540 stations, S.No 1–540 continuous**, one station
  per row, variable trailing contact columns (8/9/10). Parser keys off the integer S.No and fixed
  leading columns, so the variable tail is harmless.
- **Reconciliation:** `db/districtReconcile.ts` — exact normalized name, then space-insensitive
  (fixes DOCX spacing artifacts), then an explicit alias table (`Bangalore→Bengaluru`, etc.). **No
  fuzzy matching.** 509/540 rows (94%) → 286 districts; the rest are **reported, never invented**.
- **Safe metric only:** the count of stations per district (`Speech / Community Radio`, unit
  `stations`). Numeric-looking fields that are **not** metrics — Frequency of Operation (MHz),
  Contact Number — are preserved on the raw record but never aggregated. Unit-aware aggregation
  keeps `stations` separate from the Excel `hours`.
- **Run its watcher** (a second process, separate source id):
  ```bash
  SYNC_SOURCE=word DATASET_SOURCE_ID=community-radio npm run db:sync:watch
  ```
  It file-watches `public/data/community-radio-stations.docx`; edits sync within ~1 s, with the
  same last-good protection (a malformed/corrupt DOCX fails the sync and keeps the working data).
- The API `?source=<id>` filter isolates a source (used by the Excel regression test);
  omitted → all sources merged, which is what the frontend reads (Excel + Word coexist).

---

## 12. Detailed Community Radio (CRS Excel) — raw records + coexistence

A second Community Radio source, `CRS(data).xlsx` (sheet `Sheet1`), provides ONE row per station
(with organization/location/language/hours), so it is the **authoritative detailed** Community
Radio source. It powers both the aggregate and the new **CRS DATA** expandable list.

- **Structure:** a title row, then the header (`S.No, CRS State, CRS DISTRICT, Name of Organization,
  Location of CRS, Name of CRS, Language, No. of Hours`), then ~620 rows. Language and No. of Hours
  are currently blank. Parsed by `db/crsDataset.ts` (reuses `excelRowsFromBuffer` + the shared
  district reconciler); **509 rows reconcile → 287 districts**, 31 reported unmatched.
- **Storage:** raw stations in a new `crs_records` table (`source_id = community-radio-crs`),
  isolated like every source. Stable identity = content hash of `(districtId, crsName, organization,
  location)` — excludes Language/Hours so editing them is an **UPDATE**, and excludes position so
  reordering is a no-op. Synced by `syncCrsOnce` (same fingerprint/validation/last-good/version
  machinery): `SYNC_SOURCE=crs DATASET_SOURCE_ID=community-radio-crs npm run db:sync:watch`.
- **Aggregate is DERIVED, never stored:** the API synthesizes `Speech / Community Radio / N
  stations` from `COUNT(*)` over `crs_records` (`/api/datasets*`), so the count is always consistent
  with the raw rows. Raw records for the CRS DATA UI come from `GET /api/crs/district/:districtId`.
- **Avoiding double-count with the Word source (documented decision):** the Word DOCX and this Excel
  are the **same real dataset, different vintages** (540 vs 561 stations). Counting both would
  double-count. So the **CRS Excel is designated authoritative**; the Word `community-radio` count
  rows were removed with a **source-scoped delete** (which left main-dataset untouched — proving
  isolation). The Word ingestion code/pipeline remains intact and tested (`db:test:word` 24/24) and
  can be re-enabled, but only one source contributes the Community Radio count at a time.
- **CRS DATA UI** (`CRSDataList.tsx` + `CRSRecordCard.tsx`): district-scoped, multi-open accordion
  (several stations open at once), search over name/organization/location, blanks shown as
  "Not available", re-fetches on the backend version change so an Excel edit appears automatically
  while open cards stay open. Frontend components never parse Excel — they read the API.

---

## 13. This is a DEVELOPMENT setup, not production

The local **Docker PostgreSQL + local sync watcher + `npm run server` + Vite** is for development.
It is not a deployment. A production version would move to: a **managed/cloud PostgreSQL**, the API
as a **hosted backend service**, the sync as a **scheduled worker** (cron/queue) rather than a local
`fs.watch`, and the frontend as a **static site** hitting the hosted API — with real secrets in a
secret manager, TLS, and migrations run in CI/CD. None of that infrastructure is built in this phase.

**Not** changed anywhere in this phase: `public/data/lgd-2024/`, geometry, pipeline, TopoJSON, LGD
name reconciliation, search, selection, zoom, panel/resizer structure, aggregation rules, the
`DatasetRecord` contract, and the user localStorage tree.
