# DATA.md — Data sources, provenance and known gaps

Every claim in this document was verified by direct inspection on **2026-08-12**.
Nothing here is assumed. Where something is unverified, it says so.

---

## 1. Geometry source (verified)

| Field | Value |
|---|---|
| **Layer** | `LGD_Districts` |
| **Upstream publisher** | [`yashveeeeeeer/india-geodata`](https://github.com/yashveeeeeeer/india-geodata) |
| **Upstream release** | tag `admin/districts`, published 2026-03-08 |
| **Primary authority** | Local Government Directory (LGD), Ministry of Panchayati Raj — <https://lgdirectory.gov.in/> |
| **Mirror used for download** | bharatlas (`pub-0429b8e3b5a946e69ea007df844a6f1c.r2.dev`) |
| **Licence** | CC0-1.0 / CC-BY-4.0 (repo `LICENSE` is CC BY 4.0; district release files declared CC0) |
| **CRS** | WGS 84 (EPSG:4326) — confirmed by coordinate inspection |
| **Feature count** | **785** |
| **Geometry types** | 689 `Polygon`, 96 `MultiPolygon` |

### Download URLs

| Format | URL | Size |
|---|---|---|
| GeoJSON | `https://pub-0429b8e3b5a946e69ea007df844a6f1c.r2.dev/admin/districts/LGD_Districts.geojson` | 93,092,856 B |
| Parquet | `.../LGD_Districts.parquet` | 22,178,335 B |
| PMTiles | `.../LGD_Districts.pmtiles` | 12,690,364 B |
| GeoJSONL (7z) | GitHub release `admin/districts` | 22,195,016 B |

`sha256` of the GeoJSON as downloaded 2026-08-12:
`95829298abdd0e80fc514b8c70787bdeef9aaf0e63b348177493045e8b22bab5`

> **bharatlas is a mirror, not the source.** Its catalogue `fetched_at` (2026-05-19) is
> when bharatlas copied the file, *not* the data vintage. We pin the upstream
> `yashveeeeeeer/india-geodata` release as the citable origin and treat the R2 mirror
> purely as a CDN. If the mirror disappears, the GitHub release is the fallback.

### Verified geometry schema

Exactly these 16 properties are present on all 785 features:

```
OBJECTID  dtname  stname  stcode11  dtcode11  year_stat  dist_lgd  state_lgd
remarks   Dist    InPoly_FID  SimPgnFlag  MaxSimpTol  MinSimpTol
SHAPE_Length  SHAPE_Area
```

Sample feature:

```json
{ "OBJECTID": 348, "dtname": "Udupi", "stname": "KARNATAKA",
  "stcode11": "29", "dtcode11": "569", "year_stat": "2011_c",
  "dist_lgd": 549, "state_lgd": 29, "remarks": " ", "Dist": "Udupi",
  "InPoly_FID": 1116, "SimPgnFlag": 0, "MaxSimpTol": 100, "MinSimpTol": 100,
  "SHAPE_Length": 387234.909985508, "SHAPE_Area": 3811461156.1561337 }
```

**Fields we keep:** `dist_lgd`, `state_lgd`, `dtname`, `stname`, `dtcode11`, `stcode11`, `year_stat`.
**Fields we drop:** `OBJECTID`, `InPoly_FID`, `SimPgnFlag`, `MaxSimpTol`, `MinSimpTol`, `Dist`
(duplicate of `dtname`), `remarks` (blank on inspection), `SHAPE_Length`, `SHAPE_Area`.

> **⚠ `SHAPE_Area` is not a usable area measurement.** Summed across all 785 districts it
> gives **3,955,733 km²** against a true equal-area total of **3,274,899 km²** — inflated
> by **20.8%**. It is a planar artifact of a projected CRS (consistent with Web Mercator).
> Any area figure the product displays must be computed by us in an equal-area projection,
> never read from this field. Same caution applies to `SHAPE_Length`.

---

## 2. Administrative source (verified)

| Field | Value |
|---|---|
| **Dataset** | Local Government Directory (LGD) — Districts |
| **Host** | Open Government Data (OGD) Platform India |
| **Resource ID** | `37231365-78ba-44d5-ac22-3deec40b9197` |
| **Endpoint** | `https://api.data.gov.in/resource/37231365-78ba-44d5-ac22-3deec40b9197` |
| **Auth** | **API key required.** Without one: `{"error": "Authorization field missing"}` |
| **Licence** | GODL-India (Government Open Data Licence) |

Discovered via `https://api.data.gov.in/lists?format=json&filters[title]=Local Government Directory`,
which *does* respond without a key. Sibling resources confirmed available:
States `a71e60f0-…`, Sub-Districts `6be51a29-…`, Villages `c967fe8f-…`, Local Bodies `1a6c26ed-…`.

The key is free to register. It lives in `pipeline/.env` as `DATA_GOV_IN_API_KEY`,
is gitignored, and is used **only** by the offline pipeline. It is never read by the
frontend and never reaches the browser bundle.

### Why we do not scrape LGD directly

`lgdirectory.gov.in/globalviewdistrictforcitizen.do` responds 200, but its form requires
`OWASP_CSRFTOKEN` **and `captchaAnswer`** — it is CAPTCHA-gated. We do not bypass CAPTCHAs.
This is also why the UI-scraping approach used by the technical reference repository is
not a path we follow. The OGD API is the supported, stable route to the same data.

### Status: not yet fetched

The administrative roster has **not** been pulled, because it needs a key the project does
not yet have. Until it is, the reconciliation in §5 is based on geometry attributes plus
individually sourced verification of specific state changes. **This is the single
outstanding data dependency for V1.**

---

## 3. India external boundary (verified)

This is the highest-risk item in the project. Publishing a map with an incorrect external
boundary of India is a cognisable offence under **Section 2 of the Criminal Law Amendment
Act, 1961**. The Geospatial Data Guidelines, 2021 liberalised acquisition and publication
substantially, but did not remove the depiction obligation.

Most international open datasets (geoBoundaries, GADM, Natural Earth, OSM) draw the Line of
Control and Line of Actual Control — de-facto control, **not** India's claimed boundary.
They are unusable for us as a national outline.

### What we verified

`data/administrative/country/india-soi.geojson` in `yashveeeeeeer/india-geodata`
(property: `"Source": "Survey of India State Map, Datameet"`, ultimately from
[datameet/maps](https://github.com/datameet/maps), CC BY 4.0):

```
bbox  lon 68.1862 .. 97.4153   lat 6.7560 .. 37.0783
```

The **LGD district layer itself** independently produces:

```
bbox  lon 68.1775 .. 97.4129   lat 6.7528 .. 37.0883
```

Both reach **≈37.08°N**, which is the full Indian claim over Jammu & Kashmir including
Gilgit-Baltistan. A de-facto/LoC depiction stops near 35.5°N. Both reach **≈97.41°E**,
the full extent of Arunachal Pradesh. South **≈6.75°N** is Indira Point, Great Nicobar;
west **≈68.18°E** is the Gujarat coast.

Corroborating evidence from the district attributes: Jammu & Kashmir carries **22**
districts, including **Mirpur** and **Muzaffarabad** — districts in Pakistan-administered
Kashmir. Their presence is only consistent with an India-correct depiction.

**Conclusion: the LGD district layer is India-correct by construction**, because LGD is
India's own administrative register and the national outline is the dissolved union of its
state polygons. This is the decisive reason to prefer it over geoBoundaries ADM2.

### Residual caveat

"India-correct extent" is established here by bounding box, the PoK district roster, and
source provenance. It is **not** a substitute for Survey of India certification, which is a
separate legal process we have not undertaken. Before any public launch this must be
reviewed. Recorded as an open risk, not a solved problem.

---

## 4. Identifiers

**LGD codes are the canonical join keys. Names are display strings and must never be used
as keys.** Verified reasons, all from live data:

- `Anupgarh` (news/gazette) vs `Anoopgarh` (geometry layer)
- `Sanchore` vs `Sanchor`
- `Jaipur Rural` vs `Jaipur Gramin`; `Jodhpur Rural` vs `Jodhpur Gramin`
- `stname` is uppercase (`KARNATAKA`), unstable in case and punctuation
  (`DADRA,NAGAR HAVELI,DAMAN & DIU`)

### Key integrity (verified)

- `dist_lgd` present on all 785 features
- **783 distinct non-zero values — no duplicates**
- **2 features carry `dist_lgd = 0`:** `Mirpur` (`dtcode11` 991) and `Muzaffarabad`
  (`dtcode11` 992), both `state_lgd = 1`. These are PoK districts; LGD assigns no code to
  territory it does not administer. This is correct upstream behaviour, not a defect.
- `state_lgd` present on all features, **36 distinct values** = 28 states + 8 UTs ✓

### Canonical identifier scheme

```
districtId  = String(dist_lgd)                    when dist_lgd > 0
            = "unadministered:" + dtcode11        when dist_lgd === 0   → "unadministered:991"
stateId     = String(state_lgd)                   always present, 1..38
administered: boolean                             false for the 2 PoK districts
```

We do **not** invent LGD codes for unadministered districts. The `unadministered:` prefix
makes the distinction explicit and unmissable in code.

`dtcode11` / `stcode11` are Census 2011 codes. Retained as secondary identifiers for
future Census joins; **not** used as primary keys.

---

## 5. Vintage and coverage

### Vintage is heterogeneous — this matters

`year_stat` distribution across the 785 features:

| `year_stat` | Count | Meaning |
|---|---:|---|
| `2011_c` | 622 | Census 2011 delineation |
| `2016_c` | 41 | |
| `update2014` | 31 | |
| `2022` | 30 | |
| `2023` | 19 | |
| *(empty)* | 13 | **no vintage recorded** |
| `201920` | 8 | |
| `2018` | 6 | |
| `2015_c` | 6 | |
| `2017_c` | 3 | |
| `2019` | 2 | |
| `2014_c` | 2 | |
| `2020` | 1 | |
| `2012_c` | 1 | |

**79% of district geometry is Census 2011 delineation.** Newer districts were layered on
top as they were created. The dataset is best described as *"a Census 2011 base,
incrementally updated to roughly a 2023–24 LGD snapshot"* — not as "2024 boundaries".
We label it **`lgd-2024`** and state the heterogeneity in the UI rather than implying a
single clean vintage.

### District counts per state as published (785 total)

| Code | State / UT | n | Code | State / UT | n |
|---:|---|---:|---:|---|---:|
| 1 | Jammu & Kashmir | 22 | 21 | Odisha | 30 |
| 2 | Himachal Pradesh | 12 | 22 | Chhattisgarh | 33 |
| 3 | Punjab | 23 | 23 | Madhya Pradesh | 52 |
| 4 | Chandigarh | 1 | 24 | Gujarat | 33 |
| 5 | Uttarakhand | 13 | 27 | Maharashtra | 36 |
| 6 | Haryana | 22 | 28 | Andhra Pradesh | 26 |
| 7 | Delhi | 11 | 29 | Karnataka | 31 |
| 8 | Rajasthan | **50** | 30 | Goa | 2 |
| 9 | Uttar Pradesh | 75 | 31 | Lakshadweep | 1 |
| 10 | Bihar | 38 | 32 | Kerala | 14 |
| 11 | Sikkim | 6 | 33 | Tamil Nadu | 38 |
| 12 | Arunachal Pradesh | 26 | 34 | Puducherry | 4 |
| 13 | Nagaland | 16 | 35 | Andaman & Nicobar | 3 |
| 14 | Manipur | 16 | 36 | Telangana | 33 |
| 15 | Mizoram | 11 | 37 | Ladakh | **2** |
| 16 | Tripura | 8 | 38 | Dadra, Nagar Haveli, Daman & Diu | 3 |
| 17 | Meghalaya | 12 | | | |
| 18 | Assam | 35 | | | |
| 19 | West Bengal | 23 | | | |
| 20 | Jharkhand | 24 | | | |

---

## 6. Known gaps — verified, not estimated

### Gap 1 — Rajasthan: 9 dissolved districts still present

Rajasthan dissolved 9 of the 17 districts created under the previous government, by cabinet
decision of **28 December 2024**, reducing the state to **41 districts and 7 divisions**.
The layer still carries all 50.

All nine dissolved districts are present in the geometry (all `year_stat = 2023`):

| Gazette name | Name in layer | `dist_lgd` |
|---|---|---:|
| Dudu | Dudu | 769 |
| Kekri | Kekri | 781 |
| Shahpura | Shahpura | 780 |
| Neem Ka Thana | Neem Ka Thana | 773 |
| Gangapur City | Gangapurcity | 771 |
| Jaipur Rural | Jaipur Gramin | 783 |
| Jodhpur Rural | Jodhpur Gramin | 778 |
| Anupgarh | Anoopgarh | 776 |
| Sanchore | Sanchor | 779 |

The 8 retained districts (Balotra, Beawar, Deeg, Didwana-Kuchaman, Kotputli-Behror,
Khairthal-Tijara, Phalodi, Salumbar) are all correctly present.

### Gap 2 — Ladakh: 5 districts missing

Ladakh's five new districts — **Nubra, Sham, Changthang, Zanskar, Drass** — take it from 2
to **7**. Approved by MHA in August 2024; notification signed **27 April 2026**. The layer
carries only **Kargil** and **Leh Ladakh**.

Because notification is recent, **no open boundary dataset is expected to have these yet.**
Per project rule, we do **not** fabricate them. They will appear in the administrative
roster with `status: "no_boundary_published"` and be rendered as such.

### Gap 3 — overlapping polygons in Rajasthan

The layer is **not a clean partition of India**. Verified by interior-point test:

- A point at Sanchor town (71.7745°E, 24.7543°N) falls inside **both** `Sanchor`
  (`dist_lgd` 779) and `Jalore` (`dist_lgd` 104)
- The same stacking exists for `Jodhpur Gramin` (778) over `Jodhpur` (107)

New 2023 districts were added **without re-cutting their parent polygons**.

Quantified in an Albers equal-area projection:

| Measure | km² |
|---|---:|
| Sum of all 785 district polygons | 3,274,899 |
| Dissolved union of the same polygons | 3,270,066 |
| **Total overlap** | **4,833 (0.15%)** |

The defect is small and confined to Rajasthan. Running mapshaper `-clean` resolves it but
**silently drops `Sanchor` entirely** (784 of 785 retained) — unacceptable, since that is
data loss chosen by a heuristic.

**We do not fix it, and that is deliberate.** Sanchor and Jodhpur Gramin were both
*dissolved back into their parents* on 28 December 2024 — they are two of the nine
districts Rajasthan abolished. So the un-recut Jalore and Jodhpur polygons are **correct
for current administrative reality**; carving the children out would make the current map
wrong. The overlap is the seam between two administrative snapshots coexisting in one
layer, and it disappears once the roster marks those nine `dissolved`. See
[DECISIONS.md](DECISIONS.md) D-011 (which supersedes D-007).

Both pairs are declared in `pipeline/fixes/geometry-fixes.json`. Validation tolerates
exactly these two and fails on any third — verified by negative test.

> **Measurement caveat, load-bearing.** These figures require mapshaper **`-dissolve2`**.
> Plain `-dissolve` merges without resolving overlap and returns 3,274,899 km² — identical
> to the sum of parts — reporting the overlap as **0 km²**. The first implementation used
> `-dissolve` and logged a false "0.00%". See [DECISIONS.md](DECISIONS.md) D-012.

### Sanity check against official total

Dissolved union **3,270,066 km²** vs India's official **3,287,263 km²** — short by
**17,197 km² (0.52%)**, consistent with coastline generalisation and small-island omission.
No evidence of missing landmass.

### Not a gap — Assam

Assam's 35 districts initially looked stale: Bajali, Biswanath, Hojai and Tamulpur were
merged away in December 2022. But Bajali and Tamulpur were **restored in 2023**. The count
was checked and **no discrepancy is claimed**. Full reconciliation still requires the OGD
roster (§2).

---

## 7. Rejected sources, and why

| Source | Rows | Why rejected |
|---|---:|---|
| **geoBoundaries ADM2** | 735 | Catalogued as **"name-only" — no LGD codes**, so it cannot be joined on stable keys. Draws de-facto boundaries, so it fails §3. |
| **Bhuvan districts** | 663 | Under-counts vs LGD; carries its own codes, not LGD. |
| **SOI districts** | 742 | "Partial LGD codes" — incomplete join keys. Retain as a **cross-check** for geometry precision. |
| **datameet Census 2011** | 640 | 2011 vintage only; predates 15 years of reorganisation. Still the ultimate origin of our national outline. |
| **`india-land-simplified.geojson`** | 1 | bbox lat 21.94–37.09 — **northern India only**, not the whole country. Unsuitable. |
| **IGOD UI scraping** | — | CAPTCHA-gated (§2); brittle. |

---

## 8. Attribution required in the product

- **Local Government Directory**, Ministry of Panchayati Raj — <https://lgdirectory.gov.in/>
- **Survey of India** (national outline lineage) — <https://surveyofindia.gov.in/>
- **DataMeet** community (`datameet/maps`), CC BY 4.0
- **`yashveeeeeeer/india-geodata`** (compilation/publication), CC BY 4.0
- **OGD Platform India** (administrative roster), GODL-India

We use no code, assets or design from either reference project, and must not claim
affiliation with India State Stories or with
`mvdhv/India-district-scraper-and-downloader` — the latter is explicitly
all-rights-reserved and is used **only** as a conceptual reference for the IGOD/LGD
hierarchy.

---

## 9. Open data risks

| # | Risk | Status |
|---|---|---|
| R1 | External boundary legal compliance — SoI certification not obtained | **Open.** Extent verified India-correct; certification is a separate process. |
| R2 | Administrative roster not yet fetched (needs OGD API key) | **Open — blocking full reconciliation.** |
| R3 | Ladakh's 5 districts have no published boundary anywhere | **Open by design.** Never fabricate. |
| R4 | 9 dissolved Rajasthan districts present | **Known & quantified.** Resolve via roster reconciliation. |
| R5 | Overlapping polygons (4,833 km²) | **Known, quantified, deliberately preserved** (D-011). Enforced by validation. |
| R6 | 79% of geometry is Census 2011 vintage | **Documented.** Surface in UI; do not imply currency. |
| R7 | `SHAPE_Area` / `SHAPE_Length` unusable | **Resolved.** Fields dropped; areas computed in equal-area projection. |
| R8 | bharatlas R2 mirror could disappear | **Mitigated.** Upstream GitHub release pinned in `sources.json` with checksum. |
