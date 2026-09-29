import type { DistrictRecord } from '../../data/schema.ts';
import { vintageLabel } from '../../lib/vintage.ts';
import { officialDistrictName } from '../../data/districtNames.ts';

/**
 * The panel's data layer, kept separate from its presentation.
 *
 * A `Field` is a fully-resolved, display-ready descriptor of one datum about a district.
 * Panels render an array of these; a future editable table can consume the same array and
 * swap the presentation without this file changing. That is the "editable-table
 * preparation" from the brief — the shape is stable, the renderer is replaceable.
 *
 * Every value here is derived from the loaded dataset. Nothing is fabricated: fields we do
 * not have are represented with an explicit `unavailable` kind, never a placeholder number.
 */
export type FieldValue =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'measure'; text: string }
  | { kind: 'unavailable'; text: string };

export type Field = {
  key: string;
  label: string;
  value: FieldValue;
  /** Optional one-line clarification shown under the value. */
  hint?: string;
};

const text = (t: string): FieldValue => ({ kind: 'text', text: t });
const code = (t: string): FieldValue => ({ kind: 'code', text: t });
const measure = (t: string): FieldValue => ({ kind: 'measure', text: t });
const unavailable = (t = 'Not available'): FieldValue => ({ kind: 'unavailable', text: t });

export function formatAreaKm2(areaKm2: number | null): FieldValue {
  if (areaKm2 === null || !Number.isFinite(areaKm2)) return unavailable();
  return measure(`${Math.round(areaKm2).toLocaleString('en-IN')} km²`);
}

/**
 * Administrative identifiers and provenance — the facts the dataset is authoritative about.
 *
 * For unadministered (PoK) districts, the LGD code row is explicitly "Not assigned" rather
 * than a fabricated number: LGD issues no code for territory India does not administer, and
 * the canonical id carries the documented `unadministered:` prefix instead.
 */
export function administrativeFields(d: DistrictRecord): Field[] {
  const vintage = vintageLabel(d.sourceVintage);

  const fields: Field[] = [
    { key: 'districtId', label: 'District ID', value: code(d.districtId) },
    {
      key: 'lgdCode',
      label: 'LGD district code',
      value: d.administered
        ? code(d.districtId)
        : unavailable('Not assigned'),
      hint: d.administered ? undefined : 'India claims but does not administer this territory',
    },
    { key: 'stateId', label: 'LGD state code', value: code(d.stateId) },
  ];

  if (d.censusDistrictCode) {
    fields.push({ key: 'censusCode', label: 'Census 2011 code', value: code(d.censusDistrictCode) });
  }

  // Area is source data — computed by the pipeline in an Albers equal-area projection
  // (never the 20.8%-inflated SHAPE_Area). It belongs with the immutable facts, not the
  // editable user tree.
  fields.push({ key: 'area', label: 'Area (equal-area)', value: formatAreaKm2(d.areaKm2) });

  fields.push({
    key: 'vintage',
    label: 'Boundary vintage',
    value: text(vintage.label),
    hint:
      vintage.raw && vintage.label !== vintage.raw ? `source code “${vintage.raw}”` : undefined,
  });

  // When the header shows the official/latest LGD name, surface the map/source name too so the
  // panel stays honest about what the underlying geometry calls this district.
  const official = officialDistrictName(d.districtId, d.districtName);
  if (official !== d.districtName) {
    fields.push({
      key: 'mapName',
      label: 'Name on map (source)',
      value: text(d.districtName),
      hint: 'Official/latest LGD name shown above; source geometry is unchanged',
    });
  }

  // Only shown if the display name and the raw source name actually differ (they do not in
  // the current dataset, but the panel must not assume that).
  if (d.sourceDistrictName && d.sourceDistrictName !== d.districtName) {
    fields.push({ key: 'sourceName', label: 'Name in source', value: text(d.sourceDistrictName) });
  }

  return fields;
}

