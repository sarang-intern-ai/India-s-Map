# DATASETS.md — sheet-driven dataset architecture

The district information shown in the right-side panels is **data, not code**. It comes from an
external sheet-style source (a demo CSV, a **Google Sheet**, or an **Excel workbook**) through a
small provider abstraction, is normalized into a single long-form record contract, grouped by
district, and rendered by generic components that hard-code no dataset type or subcategory. Adding
a new dataset type or subcategory is a **data edit**, never a code change; switching between Google
Sheets, Excel and the demo source is a **configuration change**, never a UI change.

```
Google Sheets ─┐
Excel (.xlsx) ─┤
demo CSV ──────┤→ DatasetProvider → DatasetRecord[] → loadDatasetRecords() → DistrictPanel
(PostgreSQL) ──┘   (source-specific)   (normalized)     (group + diagnostics)   → dynamic DatasetPanel × N
```

The UI **never** knows whether the source is CSV, Google Sheets, Excel or a database. Replacing
the source is implementing `DatasetProvider` again — nothing above the provider changes. Every
provider funnels its rows through the **same** `normalizeRows` + `DatasetRecord` validation, so
normalization and diagnostics are defined once, not per source.

---

## 1. The normalized record contract

`src/data/datasetRecords.ts` — long-form, one row per `district × datasetType × subType`:

```ts
type DatasetRecord = {
  districtId: string;          // canonical LGD id — the ONLY join key
  datasetType: string;         // "Speech", "Text", "Video", …  (source-defined)
  subType: string;             // "YouTube", "Newspapers", …    (source-defined)
  value: number | string | boolean;  // not every dataset is numeric
  unit: string;                // "hours", "words", "" — DATA, never inferred
  districtName?: string;       // human-readability only; NEVER matched on
  source?: string;
  lastUpdated?: string;
  notes?: string;
};
```

Why long-form and not `{ youtubeHours, newspaperWords, … }`: a wide shape needs a new column — and
new React — for every new metric. A long-form row model absorbs new types and subcategories as
rows, so the UI stays fixed while the data grows.

`value` is a real union. The CSV provider recovers the type from text (below); a future typed
source (the Sheets API can return native numbers/booleans) can hand back the real type directly —
no downstream code assumes a string.

---

## 2. Sheet schema

Any sheet-shaped source uses these columns (header names matter, order does not):

| column         | required | notes                                             |
| -------------- | -------- | ------------------------------------------------- |
| `district_id`  | ✅       | canonical LGD id (`String(dist_lgd)`)             |
| `dataset_type` | ✅       | free-form; the source defines the vocabulary      |
| `sub_type`     | ✅       | free-form                                         |
| `value`        | ✅       | number, text, or `TRUE`/`FALSE`                   |
| `unit`         | ✅       | may be empty (booleans/text)                      |
| `source`       | —        | optional provenance                               |
| `last_updated` | —        | optional                                          |
| `notes`        | —        | optional                                          |
| `district_name`| —        | optional, **display convenience only — ignored for joins** |

Unknown columns are ignored (forward-compatible). Missing trailing optional columns are tolerated.

---

## 3. Provider abstraction and sources

`src/data/datasetProvider.ts`:

```ts
interface DatasetProvider {
  readonly id: string;      // "local-demo-csv" | "google-sheets" | "excel"
  readonly label: string;   // "Demo dataset" | "Google Sheets" | "Excel"
  load(): Promise<{ records: DatasetRecord[]; diagnostics: DatasetDiagnostic[] }>;
}
```

Three implementations, all sharing `normalizeRows` + Zod validation:

| provider | source | notes |
| -------- | ------ | ----- |
| `LocalDatasetProvider` | `public/data/district-datasets.csv` | the safe demo/dev fallback; same-origin |
| `GoogleSheetsDatasetProvider` | a **published CSV export URL** | no credentials; private sheets refused (need a backend) |
| `ExcelDatasetProvider` | a public `.xlsx` URL **or an uploaded file** | worksheet selection; preserves native cell types |

**Source selection** lives in `src/data/datasetSource.ts` — `resolveConfiguredSource()` reads Vite
env, `providerForSource()` builds the provider. The UI never branches on source type.

```
VITE_DATASET_SOURCE          "local" | "google-sheets" | "excel"   (optional; inferred if unset)
VITE_GOOGLE_SHEETS_CSV_URL   published CSV URL (no secrets)
VITE_EXCEL_URL               public .xlsx URL
VITE_EXCEL_SHEET_NAME        worksheet name (needed only for multi-sheet workbooks)
```

If a source is requested but its URL is absent, the app **keeps working** on the demo dataset and
says why. See `.env.example`. Copy it to `.env.local` (gitignored) to configure a real source.

### Value coercion (text sources) vs. native types (Excel)

CSV / Google-Sheets cells arrive as text, so the shared normalizer recovers the type:

- case-insensitive `TRUE` / `FALSE` → **boolean**
- a bare integer or decimal (`^-?\d+(\.\d+)?$`) → **number**
- everything else → **text**
- an **empty** cell is *missing*, not a value → the row is rejected with a diagnostic

**Excel** cells arrive already typed. SheetJS is read with `raw: true` and the normalizer keeps
native numbers/booleans **as-is** — Excel values are not stringified. `district_id` is always
coerced to a string (`490` → `"490"`) because ids are strings, but it is never used as a name.

### Excel worksheet selection

A single-sheet workbook is used automatically. If several sheets exist and none is configured
(`VITE_EXCEL_SHEET_NAME`, or the in-app picker for uploads), the load **fails with a diagnostic
listing the sheet names** — the wrong sheet is never picked silently.

### Refresh

The *External datasets* section has a **Refresh data** control. It re-runs the active provider
(URL sources are cache-busted with `?_=<ts>` and `cache: no-store`), replaces the in-memory bundle,
and re-renders the current district's panels — **preserving** `selectedStateId`, `selectedDistrictId`
and the user's localStorage tree, and **without** reinitializing MapLibre. There is no automatic
polling.

### Unit handling

Unit is **data**. The UI never maps a subType to a unit and V1 **never converts** — `YouTube 120 hours`
and `YouTube 5600 minutes` both render exactly as the source states. Empty unit is valid (booleans/text).

### Value display (formatting only, never conversion)

- number → rendered verbatim (`250000`)
- text → rendered verbatim (`Limited`)
- boolean → `Yes` / `No` (the single readability convention)

---

## 4. Grouping and ordering

`loadDatasetRecords(providers, knownDistrictIds)` merges every provider's records into one array,
then:

- **groups by `districtId`** (first-seen order) → `byDistrict: Map<string, DatasetRecord[]>`
- within a district, the panel **groups by `datasetType`** (first-seen order), and rows within a
  type keep first-seen order.

Ordering is intentionally **not alphabetical** — the source's row order is the display order. An
explicit ordering column can be added to the schema later without touching the UI.

### Aggregation (district & state totals)

The spreadsheet holds **only atomic district rows**. District totals, per-unit totals and state
totals are all **derived** — never read from the sheet — by a pure, source-independent engine
(`src/data/aggregateDatasetRecords.ts`), memoized so it runs only when the bundle changes (a load
or refresh), never per render.

```
records → group by districtId → group by datasetType → group by unit → sum numeric → DatasetAggregate[]
districtAggregates + (districtId→stateId from the hierarchy) → stateAggregates
```

`DatasetAggregate = { datasetType, totalsByUnit: {unit,value}[], records, duplicateSubTypes }`.

**District rules.** Within a datasetType, records are grouped by **unit** and numeric values summed
per unit. `words` and `documents` never combine — a mixed-unit "total" is never produced. Every
subType is preserved as a record.

**Unit-awareness.** Units come entirely from the data (`hours`, `words`, `posts`, …); nothing is
hard-coded and V1 never converts. `Text` yields `{words: 250000}` and `{documents: 120}` as two
separate totals.

**Non-numeric.** text and boolean values are preserved as records and shown (boolean as Yes/No)
but **never summed** — a datasetType with only non-numeric data has no numeric total.

**Duplicates.** A subType repeated within a district+datasetType is an unresolved duplicate: it is
**excluded from the total entirely** (not summed, not counted once — we don't guess which row is
right), while both rows stay visible and flagged `(duplicate — excluded from total)`. This is why a
duplicate never inflates a total. (Chosen behavior; documented here per requirement.)

**State rules.** State totals are the **sum of the district totals** of the districts in that state,
joined by `districtId → stateId` from the **geographic hierarchy** — never a spreadsheet state name.
Building from district totals makes the invariant *state total === sum of district totals* true by
construction (and `verifyStateTotals()` checks it independently); duplicate exclusion is inherited.
State panels are totals-only; the subType breakdown lives in the district view. A district with no
records, or one whose id is unknown, contributes nothing (missing ≠ zero).

Both maps rebuild together on refresh, so no stale aggregate survives a data change.

---

## 5. Diagnostics — nothing is silently dropped

Every problem is reported (console during dev; structured `DatasetDiagnostic[]` on the bundle).
Source-level failures also surface as an **isolated error state with Retry** in the source bar,
and never break the map, search, selection, panels or the user tree:

| code               | level   | behavior                                                        |
| ------------------ | ------- | --------------------------------------------------------------- |
| `source_unavailable` | error | file/URL missing or HTTP error — Retry offered                 |
| `invalid_response` | error   | Google URL returned HTML (not published as CSV) — Retry         |
| `invalid_file`     | error   | not a readable `.xlsx` workbook                                 |
| `multiple_sheets`  | error   | Excel workbook has several sheets and none chosen — names listed / picker shown |
| `missing_worksheet`| error   | configured worksheet name not found — available names listed    |
| `no_worksheet`     | error   | workbook has no worksheets                                       |
| `missing_columns`  | error   | a required column is absent — source rejected                   |
| `malformed_row`    | error   | empty required field, empty value, or too many columns — row skipped |
| `schema_violation` | error   | final Zod guard failed — row skipped                            |
| `unknown_district` | warning | `district_id` not in the current dataset — kept, but unreachable |
| `duplicate`        | warning | same `(district_id, dataset_type, sub_type)` more than once — **both kept, not merged**, flagged in the UI with `(duplicate)` |

Duplicates are **never** auto-summed or overwritten — the model does not define that, so the
collision is surfaced for a human to resolve. On a **failed refresh**, the last good bundle stays
on screen while the error + Retry show — panels never blank out.

---

## 6. External data vs. user data

Two separate systems, by design:

- **External datasets** (this doc) — read-only, sourced from the provider, rendered under
  *External datasets* in the DistrictPanel.
- **User data** — the existing editable recursive tree, stored in `localStorage`, rendered under
  *User data*.

The external source can **never** overwrite the user's localStorage, and the two are visually and
architecturally distinct. A future database sync can replace the external provider without touching
the user tree.

---

## 7. Official district-name mapping

Records join on `district_id` **only**. `district_name` may appear in the sheet for readability but
is never matched — the demo deliberately carries `Aurangabad` for id `469`, and the panel still
displays **Chhatrapati Sambhajinagar** (resolved from the id via the LGD reconciliation). No
name-based matching occurs anywhere.

---

## 8. Security & credentials

- **No secrets in the frontend.** `VITE_*` vars are compiled into the bundle and visible to anyone.
  Only **public, published** URLs belong there — never an API key, OAuth token or service account.
- **Google Sheets** must be *Published to the web as CSV* (or a public `export?format=csv` link).
  A **private** sheet cannot be fetched safely client-side: the provider detects the HTML sign-in
  response and reports that a **server-side provider is required** — it does not attempt a
  credential workaround.
- **Opt-in external fetch.** With no env configured, the app is same-origin only (demo CSV); this
  preserves the spirit of CLAUDE.md #5 by default. External fetching happens only when an operator
  sets a URL or uploads a file.
- **SheetJS advisory.** `xlsx@0.18.5` (npm) carries a known prototype-pollution/ReDoS advisory. It
  parses the operator's own/public workbooks here (not arbitrary third-party input), but for
  production harden by pinning the patched SheetJS CDN build (`0.20.x`) or moving Excel parsing
  server-side.

## 9. Future database / API provider

A `PostgresDatasetProvider` or REST/`API` provider is the same interface again:

```
Google Sheets ─┐
Excel ─────────┤
PostgreSQL ────┤→ DatasetProvider → DatasetRecord[] → existing dynamic UI
API ───────────┘
```

Nothing in `DistrictPanel`, `DatasetPanel`, `DistrictDatasets`, the grouping layer, the record
contract, or the source bar changes. **Not implemented in this phase.** The next decision is whether
the live source stays Google Sheets/Excel or is synchronized into PostgreSQL.

---

## 10. Files

| file | role |
| ---- | ---- |
| `src/data/datasetRecords.ts` | contract (Zod), value union, grouping helpers, diagnostic type |
| `src/data/datasetProvider.ts` | `DatasetProvider`, shared `normalizeRows`, CSV parser, `LocalDatasetProvider`, `GoogleSheetsDatasetProvider` |
| `src/data/excelProvider.ts` | `ExcelDatasetProvider` (SheetJS), worksheet selection, native types |
| `src/data/datasetSource.ts` | source config + env resolution + provider factory |
| `src/data/loadDatasetRecords.ts` | merge providers, duplicate/unknown-id diagnostics, group by district |
| `src/data/aggregateDatasetRecords.ts` | pure engine: district + state aggregates, unit-aware totals, invariant check |
| `src/state/datasetRecords.tsx` | React context — active source, load, refresh, Excel upload, sheet pick, memoized aggregates |
| `src/features/panel/StateDatasets.tsx` | per-state aggregated DatasetPanels (totals-only) |
| `src/features/panel/DatasetSourceBar.tsx` | source status + Refresh + Excel upload + worksheet picker + error/Retry |
| `src/features/panel/DatasetPanel.tsx` | generic renderer for one datasetType |
| `src/features/panel/DistrictDatasets.tsx` | resolves a district's records, groups, renders panels / empty state |
| `public/data/district-datasets.csv` | **demo** CSV source (not official data) |
| `public/data/sample-district-data.xlsx` | **demo** Excel workbook (sheet `DistrictData`) for the upload/URL path |
| `.env.example` | documents the source env vars (no real URLs) |
