import { useSyncExternalStore } from 'react';
import {
  makeNodeId,
  sanitizeNodes,
  type DistrictDataNode,
  type ValueType,
} from './districtDataTree.ts';

/**
 * User overrides for district data, persisted locally.
 *
 * This is the ONLY place that touches localStorage. Source data under public/data/lgd-2024/
 * is immutable and never written here — user edits live entirely in this separate store,
 * keyed by the canonical districtId (including "unadministered:…" ids). The merged view is
 * assembled in the UI; the source is always recoverable by removing an override.
 *
 * A district's user data is a recursive tree of {@link DistrictDataNode}s (schema v2). The
 * previous flat shape (population/literacy/notes/customFields, schema v1) is migrated into
 * the tree on load so earlier edits are preserved.
 *
 * The store is defensive: a browser with localStorage disabled or full, or a corrupted
 * payload, degrades to an in-memory-only session with a reported status rather than throwing.
 */

export type UserDistrictData = {
  nodes: DistrictDataNode[];
};

export type StorageStatus = 'ok' | 'unavailable' | 'corrupt';

const STORAGE_KEY = 'indias-map.userDistrictData.v2';
const LEGACY_KEY_V1 = 'indias-map.userDistrictData.v1';
const SCHEMA_VERSION = 2;

type Persisted = { version: number; districts: Record<string, UserDistrictData> };

export function emptyUserData(): UserDistrictData {
  return { nodes: [] };
}

/** An override with no nodes is equivalent to no override at all. */
export function isUserDataEmpty(d: UserDistrictData): boolean {
  return d.nodes.length === 0;
}

// ---- module state -----------------------------------------------------------------------

let memory: Record<string, UserDistrictData> = {};
let storageStatus: StorageStatus = 'ok';
let loaded = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function safeGetItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    storageStatus = 'unavailable';
    return null;
  }
}

function safeSetItem(value: string): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
    if (storageStatus === 'unavailable') storageStatus = 'ok';
    return true;
  } catch {
    storageStatus = 'unavailable';
    return false;
  }
}

function safeRemoveLegacy(): void {
  try {
    window.localStorage.removeItem(LEGACY_KEY_V1);
  } catch {
    /* ignore */
  }
}

function sanitizeDistrict(raw: unknown): UserDistrictData {
  if (!raw || typeof raw !== 'object') return emptyUserData();
  const nodes = sanitizeNodes((raw as { nodes?: unknown }).nodes);
  return { nodes };
}

// ---- v1 → v2 migration ------------------------------------------------------------------

type LegacyCustomField = { name?: unknown; value?: unknown; numeric?: unknown };
type LegacyDistrict = {
  population?: unknown;
  literacy?: unknown;
  notes?: unknown;
  customFields?: unknown;
};

/** Convert one flat v1 district into tree nodes, preserving what the user had entered. */
function migrateLegacyDistrict(raw: LegacyDistrict): UserDistrictData {
  const nodes: DistrictDataNode[] = [];
  const push = (name: string, valueType: ValueType, value: DistrictDataNode['value']) =>
    nodes.push({ id: makeNodeId(), name, type: 'value', valueType, value });

  if (typeof raw.population === 'number') push('Population', 'number', raw.population);
  if (typeof raw.literacy === 'number') push('Literacy', 'percentage', raw.literacy);
  if (typeof raw.notes === 'string' && raw.notes.trim() !== '') push('Notes', 'text', raw.notes);

  if (Array.isArray(raw.customFields)) {
    for (const c of raw.customFields as LegacyCustomField[]) {
      if (!c || typeof c.name !== 'string' || c.name.trim() === '') continue;
      const numeric = Boolean(c.numeric);
      const rawValue = typeof c.value === 'string' ? c.value : String(c.value ?? '');
      const value = numeric && Number.isFinite(Number(rawValue)) ? Number(rawValue) : rawValue;
      push(c.name, numeric ? 'number' : 'text', value);
    }
  }
  return { nodes };
}

function migrateFromV1(): Record<string, UserDistrictData> | null {
  const raw = safeGetItem(LEGACY_KEY_V1);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as { version?: number; districts?: Record<string, unknown> };
    if (!parsed || typeof parsed.districts !== 'object' || !parsed.districts) return null;
    const out: Record<string, UserDistrictData> = {};
    for (const [id, entry] of Object.entries(parsed.districts)) {
      const migrated = migrateLegacyDistrict(entry as LegacyDistrict);
      if (!isUserDataEmpty(migrated)) out[id] = migrated;
    }
    return out;
  } catch {
    return null;
  }
}

// ---- load / persist ---------------------------------------------------------------------

function load(): void {
  if (loaded) return;
  loaded = true;

  const raw = safeGetItem(STORAGE_KEY);

  if (raw === null) {
    // No v2 data. Try to migrate v1, if any.
    const migrated = migrateFromV1();
    if (migrated) {
      memory = migrated;
      if (persist()) safeRemoveLegacy();
    } else {
      memory = {};
    }
    return;
  }

  try {
    const parsed = JSON.parse(raw) as Persisted;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.districts !== 'object') {
      throw new Error('unexpected shape');
    }
    const next: Record<string, UserDistrictData> = {};
    for (const [id, entry] of Object.entries(parsed.districts)) {
      const clean = sanitizeDistrict(entry);
      if (!isUserDataEmpty(clean)) next[id] = clean;
    }
    memory = next;
  } catch {
    storageStatus = 'corrupt';
    memory = {};
  }
}

function persist(): boolean {
  const payload: Persisted = { version: SCHEMA_VERSION, districts: memory };
  return safeSetItem(JSON.stringify(payload));
}

// ---- public API -------------------------------------------------------------------------

export function subscribe(listener: () => void): () => void {
  load();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): Record<string, UserDistrictData> {
  load();
  return memory;
}

export function getStorageStatus(): StorageStatus {
  load();
  return storageStatus;
}

export function getDistrictData(id: string): UserDistrictData | null {
  load();
  return memory[id] ?? null;
}

export function saveDistrictData(id: string, data: UserDistrictData): { persisted: boolean } {
  load();
  if (isUserDataEmpty(data)) return removeDistrictData(id);
  memory = { ...memory, [id]: data };
  const persisted = persist();
  notify();
  return { persisted };
}

export function removeDistrictData(id: string): { persisted: boolean } {
  load();
  if (!(id in memory)) {
    notify();
    return { persisted: storageStatus !== 'unavailable' };
  }
  const next = { ...memory };
  delete next[id];
  memory = next;
  const persisted = persist();
  notify();
  return { persisted };
}

export function clearAllDistrictData(): { persisted: boolean } {
  load();
  memory = {};
  const persisted = persist();
  notify();
  return { persisted };
}

export function getOverrideCount(): number {
  load();
  return Object.keys(memory).length;
}

// ---- React binding ----------------------------------------------------------------------

export function useUserDistrictData(id: string | null): UserDistrictData | null {
  const all = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return id ? (all[id] ?? null) : null;
}
