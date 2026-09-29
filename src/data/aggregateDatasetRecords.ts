import type { DatasetRecord } from './datasetRecords.ts';

/**
 * The aggregation engine. Pure, deterministic, source-independent — it turns atomic
 * {@link DatasetRecord}s into district and state aggregates. No React, no I/O; the same functions
 * would serve a PostgreSQL provider unchanged.
 *
 *   records → group by datasetType → group by unit → sum numeric (unit-aware) → DatasetAggregate[]
 *   district aggregates + (districtId→stateId) → state aggregates
 *
 * The spreadsheet is the source of truth: it carries ONLY atomic district rows. District totals,
 * per-unit totals and state totals are all derived here, never read from the sheet.
 */

export type UnitTotal = { unit: string; value: number };

export type DatasetAggregate = {
  datasetType: string;
  /**
   * Numeric totals per unit, in first-seen unit order. **Unit-aware**: values are summed only
   * within the same unit, so `words` and `documents` never combine into a meaningless number.
   * Non-numeric values and duplicated subTypes never contribute here.
   */
  totalsByUnit: UnitTotal[];
  /**
   * The atomic records for this datasetType, first-seen order — every subType, including
   * non-numeric and duplicated ones (kept visible, flagged). Empty for state-level aggregates,
   * which are totals-only.
   */
  records: DatasetRecord[];
  /** subTypes excluded from `totalsByUnit` because they appear more than once (see §Duplicates). */
  duplicateSubTypes: string[];
};

/**
 * Aggregate a flat set of records that all belong to ONE district (or any set where a repeated
 * subType within a datasetType means a duplicate). Groups by datasetType, then sums numeric
 * values per unit.
 *
 * **Duplicates.** A subType appearing more than once within a datasetType is treated as an
 * unresolved duplicate: it is EXCLUDED from `totalsByUnit` entirely (never summed, never
 * counted once — we don't guess which row is right), but kept in `records` and reported by
 * `duplicateSubTypes` so the UI can still show and flag it. This prevents a duplicate row from
 * silently inflating a total.
 *
 * **Non-numeric.** text and boolean values are preserved as records but never summed.
 */
export function aggregateByDatasetType(records: DatasetRecord[]): DatasetAggregate[] {
  const groups = new Map<string, DatasetRecord[]>();
  for (const r of records) {
    const g = groups.get(r.datasetType);
    if (g) g.push(r);
    else groups.set(r.datasetType, [r]);
  }

  const out: DatasetAggregate[] = [];
  for (const [datasetType, recs] of groups) {
    // Find subTypes that occur more than once — these are excluded from totals.
    const subCounts = new Map<string, number>();
    for (const r of recs) subCounts.set(r.subType, (subCounts.get(r.subType) ?? 0) + 1);
    const duplicateSubTypes = [...subCounts.entries()].filter(([, c]) => c > 1).map(([s]) => s);
    const dupSet = new Set(duplicateSubTypes);

    // Sum numeric values per unit, in first-seen unit order.
    const unitOrder: string[] = [];
    const unitSums = new Map<string, number>();
    for (const r of recs) {
      if (typeof r.value !== 'number') continue; // only numbers sum
      if (dupSet.has(r.subType)) continue; // exclude duplicated subTypes from totals
      const prev = unitSums.get(r.unit);
      if (prev === undefined) {
        unitSums.set(r.unit, r.value);
        unitOrder.push(r.unit);
      } else {
        unitSums.set(r.unit, prev + r.value);
      }
    }
    const totalsByUnit = unitOrder.map((unit) => ({ unit, value: unitSums.get(unit) ?? 0 }));

    out.push({ datasetType, totalsByUnit, records: recs, duplicateSubTypes });
  }
  return out;
}

/** districtId → its {@link DatasetAggregate}s. Districts absent from the data are simply absent. */
export function buildDistrictAggregates(
  records: DatasetRecord[],
): Map<string, DatasetAggregate[]> {
  const byDistrict = new Map<string, DatasetRecord[]>();
  for (const r of records) {
    const g = byDistrict.get(r.districtId);
    if (g) g.push(r);
    else byDistrict.set(r.districtId, [r]);
  }
  const result = new Map<string, DatasetAggregate[]>();
  for (const [districtId, recs] of byDistrict) {
    result.set(districtId, aggregateByDatasetType(recs));
  }
  return result;
}

/**
 * stateId → aggregated {@link DatasetAggregate}s, built by summing the DISTRICT aggregates of the
 * districts in each state. Building from district totals (not from raw records) makes the
 * invariant *state total === sum of district totals* true by construction, and inherits the
 * district-level duplicate exclusion automatically.
 *
 * The join is `districtId → stateId` from the **verified geographic hierarchy** — never a state
 * name from the spreadsheet. A district whose id is not in `districtToState` (unknown/typo)
 * contributes nothing. State aggregates are totals-only (`records: []`); the per-district subType
 * breakdown lives in the district aggregates.
 */
export function buildStateAggregates(
  districtAggregates: ReadonlyMap<string, DatasetAggregate[]>,
  districtToState: ReadonlyMap<string, string>,
): Map<string, DatasetAggregate[]> {
  type TypeAcc = { unitOrder: string[]; sums: Map<string, number> };
  type StateAcc = { typeOrder: string[]; byType: Map<string, TypeAcc> };
  const states = new Map<string, StateAcc>();

  for (const [districtId, aggs] of districtAggregates) {
    const stateId = districtToState.get(districtId);
    if (stateId === undefined) continue; // unknown district: contributes nothing to any state

    let acc = states.get(stateId);
    if (!acc) {
      acc = { typeOrder: [], byType: new Map() };
      states.set(stateId, acc);
    }
    for (const agg of aggs) {
      let t = acc.byType.get(agg.datasetType);
      if (!t) {
        t = { unitOrder: [], sums: new Map() };
        acc.byType.set(agg.datasetType, t);
        acc.typeOrder.push(agg.datasetType);
      }
      for (const { unit, value } of agg.totalsByUnit) {
        const prev = t.sums.get(unit);
        if (prev === undefined) {
          t.sums.set(unit, value);
          t.unitOrder.push(unit);
        } else {
          t.sums.set(unit, prev + value);
        }
      }
    }
  }

  const result = new Map<string, DatasetAggregate[]>();
  for (const [stateId, acc] of states) {
    const aggs: DatasetAggregate[] = acc.typeOrder.map((datasetType) => {
      const t = acc.byType.get(datasetType);
      const totalsByUnit = (t?.unitOrder ?? []).map((unit) => ({
        unit,
        value: t?.sums.get(unit) ?? 0,
      }));
      return { datasetType, totalsByUnit, records: [], duplicateSubTypes: [] };
    });
    result.set(stateId, aggs);
  }
  return result;
}

export type InvariantMismatch = {
  stateId: string;
  datasetType: string;
  unit: string;
  expected: number;
  got: number;
};

/**
 * Verify *state total === sum of district totals* for every (state, datasetType, unit). Recomputes
 * the expected state totals independently from the district aggregates and compares them to the
 * built state aggregates, so a regression in {@link buildStateAggregates} would surface here.
 */
export function verifyStateTotals(
  stateAggregates: ReadonlyMap<string, DatasetAggregate[]>,
  districtAggregates: ReadonlyMap<string, DatasetAggregate[]>,
  districtToState: ReadonlyMap<string, string>,
): { ok: boolean; mismatches: InvariantMismatch[] } {
  // Independently recompute expected[stateId][datasetType][unit] from district totals.
  const expected = new Map<string, Map<string, Map<string, number>>>();
  for (const [districtId, aggs] of districtAggregates) {
    const stateId = districtToState.get(districtId);
    if (stateId === undefined) continue;
    let byType = expected.get(stateId);
    if (!byType) {
      byType = new Map();
      expected.set(stateId, byType);
    }
    for (const agg of aggs) {
      let byUnit = byType.get(agg.datasetType);
      if (!byUnit) {
        byUnit = new Map();
        byType.set(agg.datasetType, byUnit);
      }
      for (const { unit, value } of agg.totalsByUnit) {
        byUnit.set(unit, (byUnit.get(unit) ?? 0) + value);
      }
    }
  }

  const mismatches: InvariantMismatch[] = [];
  for (const [stateId, aggs] of stateAggregates) {
    const byType = expected.get(stateId) ?? new Map<string, Map<string, number>>();
    for (const agg of aggs) {
      const byUnit = byType.get(agg.datasetType) ?? new Map<string, number>();
      for (const { unit, value } of agg.totalsByUnit) {
        const exp = byUnit.get(unit) ?? 0;
        if (exp !== value) {
          mismatches.push({ stateId, datasetType: agg.datasetType, unit, expected: exp, got: value });
        }
      }
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}
