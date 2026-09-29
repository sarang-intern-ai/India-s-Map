/**
 * Generic, recursive district user-data model.
 *
 * A district's user data is a forest of {@link DistrictDataNode}s with no fixed schema and
 * no maximum depth. The app never hard-codes attribute names like "Population" or
 * "Demographics" — those are data the user creates. Source/administrative facts (name,
 * codes, area, vintage) are NOT part of this tree; they stay immutable in their own section.
 *
 * Two representations exist:
 *  - {@link DistrictDataNode} — the PERSISTED shape, with typed values (number/boolean/…).
 *  - {@link DraftNode}        — the EDITING shape, with values held as input strings (and
 *                               booleans as booleans), because that is what form controls
 *                               produce. Validation converts a draft back into typed nodes.
 */

export const VALUE_TYPES = [
  'text',
  'number',
  'percentage',
  'currency',
  'boolean',
  'date',
  'url',
] as const;
export type ValueType = (typeof VALUE_TYPES)[number];

export const VALUE_TYPE_LABELS: Record<ValueType, string> = {
  text: 'Text',
  number: 'Number',
  percentage: 'Percentage',
  currency: 'Currency (₹)',
  boolean: 'Yes / No',
  date: 'Date',
  url: 'Link',
};

/** Persisted, typed value. */
export type NodeValue = string | number | boolean | null;

export type DistrictDataNode = {
  id: string;
  name: string;
  type: 'group' | 'value';
  value?: NodeValue;
  valueType?: ValueType;
  children?: DistrictDataNode[];
};

/** Editing representation: value nodes hold a string (or boolean for the boolean type). */
export type DraftNode = {
  id: string;
  name: string;
  type: 'group' | 'value';
  value?: string | boolean;
  valueType?: ValueType;
  children?: DraftNode[];
};

export const NODE_NAME_MAX = 60;
export const TEXT_VALUE_MAX = 1000;

export function makeNodeId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

export function makeGroupDraft(name = ''): DraftNode {
  return { id: makeNodeId(), name, type: 'group', children: [] };
}

export function makeValueDraft(name = '', valueType: ValueType = 'text'): DraftNode {
  return { id: makeNodeId(), name, type: 'value', valueType, value: valueType === 'boolean' ? false : '' };
}

// ---- immutable draft-tree operations ----------------------------------------------------

/** Append a child to the group with `parentId`, or to the root when `parentId` is null. */
export function addChild(nodes: DraftNode[], parentId: string | null, child: DraftNode): DraftNode[] {
  if (parentId === null) return [...nodes, child];
  return nodes.map((n) => {
    if (n.id === parentId && n.type === 'group') {
      return { ...n, children: [...(n.children ?? []), child] };
    }
    if (n.children) return { ...n, children: addChild(n.children, parentId, child) };
    return n;
  });
}

export function updateNode(nodes: DraftNode[], id: string, patch: Partial<DraftNode>): DraftNode[] {
  return nodes.map((n) => {
    if (n.id === id) return { ...n, ...patch };
    if (n.children) return { ...n, children: updateNode(n.children, id, patch) };
    return n;
  });
}

export function removeNode(nodes: DraftNode[], id: string): DraftNode[] {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => (n.children ? { ...n, children: removeNode(n.children, id) } : n));
}

export function findNode(nodes: DraftNode[], id: string): DraftNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const found = findNode(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** Total node count, for summaries. */
export function countNodes(nodes: Array<DistrictDataNode | DraftNode>): number {
  let total = 0;
  for (const n of nodes) {
    total += 1;
    if (n.children) total += countNodes(n.children);
  }
  return total;
}

// ---- conversions ------------------------------------------------------------------------

export function nodesToDraft(nodes: DistrictDataNode[]): DraftNode[] {
  return nodes.map((n) => {
    if (n.type === 'group') {
      return { id: n.id, name: n.name, type: 'group', children: nodesToDraft(n.children ?? []) };
    }
    const valueType: ValueType = n.valueType ?? 'text';
    const value =
      valueType === 'boolean'
        ? Boolean(n.value)
        : n.value === null || n.value === undefined
          ? ''
          : String(n.value);
    return { id: n.id, name: n.name, type: 'value', valueType, value };
  });
}

export function draftsEqual(a: DraftNode[], b: DraftNode[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---- validation -------------------------------------------------------------------------

export type NodeError = { name?: string; value?: string };
export type TreeErrors = Record<string, NodeError>;

export type TreeValidation = {
  ok: boolean;
  errors: TreeErrors;
  /** Clean, typed nodes to persist. Meaningful only when ok. */
  nodes: DistrictDataNode[];
};

function coerceValue(
  valueType: ValueType,
  raw: string | boolean | undefined,
): { error?: string; value: NodeValue } {
  if (valueType === 'boolean') return { value: Boolean(raw) };

  const s = typeof raw === 'string' ? raw.trim() : '';
  if (s === '') return { value: null }; // an empty value node is allowed

  switch (valueType) {
    case 'number':
      if (!/^-?\d+(\.\d+)?$/.test(s) || !Number.isFinite(Number(s))) {
        return { error: 'Enter a number', value: null };
      }
      return { value: Number(s) };
    case 'percentage': {
      const n = Number(s);
      if (!/^-?\d+(\.\d+)?$/.test(s) || !Number.isFinite(n) || n < 0 || n > 100) {
        return { error: 'Number between 0 and 100', value: null };
      }
      return { value: n };
    }
    case 'currency': {
      const n = Number(s);
      if (!/^\d+(\.\d+)?$/.test(s) || !Number.isFinite(n) || n < 0) {
        return { error: 'Amount of 0 or more', value: null };
      }
      return { value: n };
    }
    case 'date':
      // <input type="date"> yields YYYY-MM-DD; guard anyway.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { error: 'Use a valid date', value: null };
      return { value: s };
    case 'url':
      try {
        const u = new URL(s);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('scheme');
        return { value: s };
      } catch {
        return { error: 'Enter a valid http(s) link', value: null };
      }
    case 'text':
    default:
      if (s.length > TEXT_VALUE_MAX) return { error: `Under ${TEXT_VALUE_MAX} characters`, value: null };
      return { value: typeof raw === 'string' ? raw : s };
  }
}

/**
 * Validates a draft forest and, when clean, returns typed persisted nodes. Names must be
 * present, within length, and unique among their direct siblings (case-insensitive).
 */
export function validateDraftTree(draft: DraftNode[]): TreeValidation {
  const errors: TreeErrors = {};

  function walk(list: DraftNode[]): DistrictDataNode[] {
    const seen = new Set<string>();
    const clean: DistrictDataNode[] = [];

    for (const node of list) {
      const err: NodeError = {};
      const name = node.name.trim();

      if (name === '') err.name = 'Name is required';
      else if (name.length > NODE_NAME_MAX) err.name = `Under ${NODE_NAME_MAX} characters`;
      else if (seen.has(name.toLowerCase())) err.name = 'Duplicate name at this level';
      if (!err.name) seen.add(name.toLowerCase());

      if (node.type === 'group') {
        const children = walk(node.children ?? []);
        if (err.name) errors[node.id] = err;
        clean.push({ id: node.id, name, type: 'group', children });
      } else {
        const valueType: ValueType = node.valueType ?? 'text';
        const coerced = coerceValue(valueType, node.value);
        if (coerced.error) err.value = coerced.error;
        if (err.name || err.value) errors[node.id] = err;
        clean.push({ id: node.id, name, type: 'value', valueType, value: coerced.value });
      }
    }
    return clean;
  }

  const nodes = walk(draft);
  return { ok: Object.keys(errors).length === 0, errors, nodes };
}

// ---- untrusted-input sanitising (persistence) -------------------------------------------

function sanitizeNode(raw: unknown): DistrictDataNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id : makeNodeId();
  const name = typeof r.name === 'string' ? r.name : '';

  if (r.type === 'group') {
    return { id, name, type: 'group', children: sanitizeNodes(r.children) };
  }
  const valueType: ValueType = VALUE_TYPES.includes(r.valueType as ValueType)
    ? (r.valueType as ValueType)
    : 'text';
  let value: NodeValue = null;
  if (
    typeof r.value === 'string' ||
    typeof r.value === 'number' ||
    typeof r.value === 'boolean'
  ) {
    value = r.value;
  }
  return { id, name, type: 'value', valueType, value };
}

export function sanitizeNodes(raw: unknown): DistrictDataNode[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(sanitizeNode).filter((n): n is DistrictDataNode => n !== null);
}

// ---- display helper (for accessible labels / summaries) ---------------------------------

const inr = new Intl.NumberFormat('en-IN');
const inrCurrency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

export function formatNodeValue(node: DistrictDataNode): string {
  if (node.type !== 'value') return '';
  const { value, valueType } = node;
  if (value === null || value === undefined || value === '') return '—';
  switch (valueType) {
    case 'number':
      return typeof value === 'number' ? inr.format(value) : String(value);
    case 'percentage':
      return `${value}%`;
    case 'currency':
      return typeof value === 'number' ? inrCurrency.format(value) : String(value);
    case 'boolean':
      return value ? 'Yes' : 'No';
    default:
      return String(value);
  }
}
