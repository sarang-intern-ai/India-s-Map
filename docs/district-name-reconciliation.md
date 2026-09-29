# District-name reconciliation — official/latest LGD

Reconciles the map's 785 district features against the official/latest **Local Government
Directory** reference *"All Districts of India"*, exported **2026-08-14**
(`allDistrictofIndia2026_08_14_04_36_15_568.htm`).

**Reconciliation key: District Code (LGD).** No name matching, no fuzzy matching. A match is
accepted only when the map's canonical `districtId` (which equals `String(dist_lgd)` for
administered districts) equals the LGD **District Code** *and* the map's `stateId` equals the
LGD **State Code**. The second guard is what rejects a same-code / different-state collision
(see §5). The geometry/source dataset and `public/data/lgd-2024/` are **not** modified; the
official names sit in a frontend-only layer: [`src/data/districtNames.ts`](../src/data/districtNames.ts).

Generated deterministically from the HTML + `hierarchy.json`; re-running reproduces it exactly.

## 1. Totals

| Measure | Count |
|---|---:|
| LGD HTML records parsed (excludes header, top spacer, blank trailing row, footer timestamp) | **784** |
| LGD unique District Codes | **784** |
| Map district features | **785** |
| — administered (carry an LGD code) | 783 |
| — unadministered (PoK; no LGD code by design) | 2 |
| **Matched by District Code + State Code** | **770** |
| — names identical (no override needed) | 705 |
| — names differ (**official name applied**) | 65 |
| Cross-state code collisions (excluded) | 1 |
| Unmatched map districts (no LGD code) | 12 |
| Unmatched LGD records (code absent from map geometry) | 14 |
| Duplicate District Codes in HTML | 0 |
| Records with missing/non-numeric District Code | 0 |

> **Note on the record count.** The brief anticipated *785* HTML district rows; the file
> actually contains **784** genuine district records (plus one `<th>` header row, a
> one-cell top spacer, one fully-blank trailing row, and a footer timestamp cell — all ignored).
> This is reported, not worked around.

## 2. Name differences applied (65)

Each row is a confirmed District-Code + State-Code match whose official/latest LGD name differs
from the source/map name. The official name becomes the display name; the source name is retained.

| Code | Source / map name | Official / latest LGD name | State |
|---:|---|---|---|
| 21 | Lahul And Spiti | **Lahaul And Spiti** | Himachal Pradesh |
| 54 | Rudra Prayag | **Rudraprayag** | Uttarakhand |
| 56 | Udam Singh Nagar | **Udham Singh Nagar** | Uttarakhand |
| 57 | Uttar Kashi | **Uttarkashi** | Uttarakhand |
| 129 | Barabanki | **Bara Banki** | Uttar Pradesh |
| 160 | Kushi Nagar | **Kushinagar** | Uttar Pradesh |
| 164 | Maharajganj | **Mahrajganj** | Uttar Pradesh |
| 178 | Sant Kabeer Nagar | **Sant Kabir Nagar** | Uttar Pradesh |
| 181 | Shravasti | **Shrawasti** | Uttar Pradesh |
| 182 | Siddharth Nagar | **Siddharthnagar** | Uttar Pradesh |
| 267 | Saiha | **Siaha** | Mizoram |
| 293 | Karimganj | **Sribhumi** | Assam |
| 303 | 24 Paraganas North | **North 24 Parganas** | West Bengal |
| 304 | 24 Paraganas South | **South 24 Parganas** | West Bengal |
| 308 | Coochbehar | **Cooch Behar** | West Bengal |
| 310 | Dinajpur Dakshin | **Dakshin Dinajpur** | West Bengal |
| 311 | Dinajpur Uttar | **Uttar Dinajpur** | West Bengal |
| 316 | Maldah | **Malda** | West Bengal |
| 317 | Medinipur East | **Purba Medinipur** | West Bengal |
| 318 | Medinipur West | **Paschim Medinipur** | West Bengal |
| 344 | Anugul | **Anugola** | Odisha |
| 347 | Bargarh | **Baragada** | Odisha |
| 350 | Cuttack | **Kataka** | Odisha |
| 351 | Deogarh | **Debagada** | Odisha |
| 356 | Jajapur | **Jajpur** | Odisha |
| 359 | Kandhamal | **Kandhamala** | Odisha |
| 360 | Kendrapara | **Kendrapada** | Odisha |
| 367 | Nayagarh | **Nayagada** | Odisha |
| 372 | Sonepur | **Subarnapur** | Odisha |
| 373 | Sundargarh | **Sundaragada** | Odisha |
| 376 | Dantewada | **Dakshin Bastar Dantewada** | Chhattisgarh |
| 381 | Kanker | **Uttar Bastar Kanker** | Chhattisgarh |
| 382 | Kabirdham | **Kabeerdham** | Chhattisgarh |
| 405 | East Nimar | **Khandwa (East Nimar)** | Madhya Pradesh |
| 414 | Khargone | **Khargone (West Nimar)** | Madhya Pradesh |
| 418 | Narsinghpur | **Narsimhapur** | Madhya Pradesh |
| 438 | Ahmadabad | **Ahmedabad** | Gujarat |
| 444 | Dang | **Dangs** | Gujarat |
| 445 | Dohad | **Dahod** | Gujarat |
| 466 | Ahmednagar | **Ahilyanagar** | Maharashtra |
| 469 | Aurangabad | **Chhatrapati Sambhajinagar** | Maharashtra |
| 488 | Osmanabad | **Dharashiv** | Maharashtra |
| 502 | Anantapur | **Ananthapuramu** | Andhra Pradesh |
| 504 | Y.S.R. | **Y.S.R. Kadapa** | Andhra Pradesh |
| 515 | Spsr Nellore | **Sri Potti Sriramulu Nellore** | Andhra Pradesh |
| 520 | Visakhapatanam | **Visakhapatnam** | Andhra Pradesh |
| 531 | Chamarajanagara | **Chamarajanagar** | Karnataka |
| 535 | Davangere | **Davanagere** | Karnataka |
| 574 | Kanchipuram | **Kancheepuram** | Tamil Nadu |
| 594 | Tuticorin | **Thoothukkudi** | Tamil Nadu |
| 596 | Villupuram | **Viluppuram** | Tamil Nadu |
| 600 | Pondicherry | **Puducherry** | Puducherry |
| 631 | Ramanagara | **Bengaluru South** | Karnataka |
| 644 | Baloda Bazar | **Balodabazar-Bhatapara** | Chhattisgarh |
| 649 | Balrampur | **Balrampur-Ramanujganj** | Chhattisgarh |
| 667 | Agar Malwa | **Agar-Malwa** | Madhya Pradesh |
| 701 | Charki Dadri | **Charkhi Dadri** | Haryana |
| 734 | Gaurella Pendra Marwahi | **Gaurela-Pendra-Marwahi** | Chhattisgarh |
| 738 | Vijayanagar | **Vijayanagara** | Karnataka |
| 747 | Konaseema | **Dr. B.R. Ambedkar Konaseema** | Andhra Pradesh |
| 759 | Khairgarh Chhuikhadan Gandai | **Khairagarh-Chhuikhadan-Gandai** | Chhattisgarh |
| 760 | Manendragarh Chirimiri Bharatpur | **Manendragarh-Chirmiri-Bharatpur(M C B)** | Chhattisgarh |
| 761 | Mohla Manpur Ambagarh Chouki | **Mohla-Manpur-Ambagarh Chouki** | Chhattisgarh |
| 763 | Sarangarh Bilaigarh | **Sarangarh-Bilaigarh** | Chhattisgarh |
| 768 | Didwana Kuchaman | **Didwana-Kuchaman** | Rajasthan |

## 3. Unmatched map districts — no LGD code (12)

These map districts have no District Code in the LGD reference, so **no official name is applied**
and they keep their source name. None is guessed.

### 3a. Dissolved Rajasthan districts (9) — expected

Dissolved 28 Dec 2024 (DATA.md Gap 1); correctly absent from the current LGD register.

| Code | Name |
|---:|---|
| 776 | Anoopgarh |
| 769 | Dudu |
| 771 | Gangapurcity |
| 783 | Jaipur Gramin |
| 778 | Jodhpur Gramin |
| 781 | Kekri |
| 773 | Neem Ka Thana |
| 779 | Sanchor |
| 780 | Shahpura |

### 3b. Other unmatched map districts (3) — flagged

Present in the map geometry but absent from this LGD export (the export instead lists newer
districts for these States/UTs — see §4). Left with their source name pending investigation.

| Code | Name | State |
|---:|---|---|
| 671 | Shahdara | Delhi |
| 599 | Mahe | Puducherry |
| 601 | Yanam | Puducherry |

## 4. Unmatched LGD records (14)

District Codes present in the LGD reference but absent from the map's Census-2011-based geometry
— predominantly newly created districts (codes ≥ 784). No geometry is fabricated for these.

| Code | Official LGD name | State |
|---:|---|---|
| 790 | Markapuram | Andhra Pradesh |
| 791 | Polavaram | Andhra Pradesh |
| 787 | Bichom | Arunachal Pradesh |
| 786 | Keyi Panyor | Arunachal Pradesh |
| 796 | Central North | Delhi |
| 795 | Old Delhi | Delhi |
| 794 | Outer North | Delhi |
| 793 | Kushavati | Goa |
| 789 | Vav-Tharad | Gujarat |
| 792 | Hansi | Haryana |
| 784 | Maihar | Madhya Pradesh |
| 766 | MAUGANJ | Madhya Pradesh |
| 785 | Pandhurna | Madhya Pradesh |
| 788 | Meluri | Nagaland |

## 5. Cross-state code collisions — excluded (1)

**Stop condition triggered.** Same District Code, different State — these are *different*
districts, not renames. No official name is applied; the map district keeps its source name.

- **Code 766:** map = "Itanagar capital complex" [Arunachal Pradesh, state 12] vs LGD = "MAUGANJ" [Madhya Pradesh, state 23]. The LGD code 766 belongs to a Madhya Pradesh district, while the map assigns it to an Arunachal Pradesh district. Not reconciled; "Itanagar capital complex" is retained. The LGD "MAUGANJ" appears in §4 as unmatched.

## 6. Unadministered territory (2) — by design

LGD issues no District Code for territory India claims but does not administer, so these never
appear in the reference and are never given a fabricated code or official name.

| Canonical ID | Name | State |
|---|---|---|
| unadministered:991 | Mirpur | Jammu and Kashmir |
| unadministered:992 | Muzaffarabad | Jammu and Kashmir |

## 7. Guarantees

- Deterministic: keyed only on District Code + State Code; no fuzzy/name matching anywhere.
- Non-destructive: source names retained in `DISTRICT_NAME_OVERRIDES[*].sourceName`; geometry
  and `public/data/lgd-2024/` untouched (byte-identical).
- Honest: every unmatched, collided, or ambiguous case is reported here and left with its source
  name rather than guessed.
