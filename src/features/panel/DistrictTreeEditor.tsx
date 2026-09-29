import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DistrictRecord } from '../../data/schema.ts';
import {
  emptyUserData,
  getDistrictData,
  getStorageStatus,
  removeDistrictData,
  saveDistrictData,
  useUserDistrictData,
} from '../../data/userDistrictData.ts';
import { useSelection } from '../../state/selection.tsx';
import {
  addChild,
  countNodes,
  draftsEqual,
  makeGroupDraft,
  makeValueDraft,
  nodesToDraft,
  removeNode,
  updateNode,
  validateDraftTree,
  type DraftNode,
  type TreeErrors,
} from '../../data/districtDataTree.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { TreeNodeRow } from './TreeNodeRow.tsx';

/**
 * Editable, recursive tree of a district's user data.
 *
 * The frontend hard-codes no attribute names — the whole tree is data the user creates.
 * Source facts (name, codes, area, vintage) are NOT here; they live read-only in the panel's
 * administrative section. Nothing here is written to public/data/lgd-2024/.
 *
 * Mounted with a `key` of districtId by the panel, so switching districts remounts it and
 * resets all draft/error/expansion state cleanly.
 */
export function DistrictTreeEditor({ district }: { district: DistrictRecord }) {
  const id = district.districtId;
  const saved = useUserDistrictData(id);
  const savedDraft = useMemo(() => nodesToDraft((saved ?? emptyUserData()).nodes), [saved]);

  const [draft, setDraft] = useState<DraftNode[]>(() =>
    nodesToDraft(getDistrictData(id)?.nodes ?? []),
  );
  const [errors, setErrors] = useState<TreeErrors>({});
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'not-persisted'>('idle');
  const [confirmReset, setConfirmReset] = useState(false);
  const [autoFocusId, setAutoFocusId] = useState<string | null>(null);

  // Groups default to expanded; collapse state is UI-only and not persisted.
  const [expanded, setExpanded] = useState<Set<string>>(() => collectGroupIds(nodesToDraft(getDistrictData(id)?.nodes ?? [])));

  const dirty = useMemo(() => !draftsEqual(draft, savedDraft), [draft, savedDraft]);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const { registerNavigationGuard, clearNavigationGuard } = useSelection();
  useEffect(() => {
    registerNavigationGuard(() => !dirtyRef.current);
    return () => clearNavigationGuard();
  }, [registerNavigationGuard, clearNavigationGuard]);

  const clearNodeError = useCallback((nodeId: string) => {
    setErrors((e) => {
      if (!e[nodeId]) return e;
      const next = { ...e };
      delete next[nodeId];
      return next;
    });
  }, []);

  const onToggle = useCallback((nodeId: string) => {
    setExpanded((set) => {
      const next = new Set(set);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const onPatch = useCallback(
    (nodeId: string, patch: Partial<DraftNode>) => {
      setDraft((d) => updateNode(d, nodeId, patch));
      setSaveState('idle');
      clearNodeError(nodeId);
    },
    [clearNodeError],
  );

  const onDelete = useCallback((nodeId: string) => {
    setDraft((d) => removeNode(d, nodeId));
    setErrors((e) => {
      if (!e[nodeId]) return e;
      const next = { ...e };
      delete next[nodeId];
      return next;
    });
    setSaveState('idle');
  }, []);

  const addNode = useCallback((parentId: string | null, kind: 'group' | 'value') => {
    const node = kind === 'group' ? makeGroupDraft() : makeValueDraft();
    setDraft((d) => addChild(d, parentId, node));
    if (kind === 'group') setExpanded((set) => new Set(set).add(node.id));
    setAutoFocusId(node.id);
    setSaveState('idle');
  }, []);

  const onAddChild = useCallback(
    (parentId: string, kind: 'group' | 'value') => addNode(parentId, kind),
    [addNode],
  );

  const handleSave = useCallback(() => {
    const result = validateDraftTree(draft);
    setErrors(result.errors);
    if (!result.ok) return;
    const { persisted } = saveDistrictData(id, { nodes: result.nodes });
    // Reflect cleaned/typed values back into the draft so dirty resets to false.
    setDraft(nodesToDraft(result.nodes));
    setSaveState(persisted ? 'saved' : 'not-persisted');
  }, [draft, id]);

  const handleCancel = useCallback(() => {
    setDraft(savedDraft);
    setErrors({});
    setSaveState('idle');
  }, [savedDraft]);

  const handleResetClick = useCallback(() => {
    if (saved) setConfirmReset(true);
    else handleCancel();
  }, [saved, handleCancel]);

  const doReset = useCallback(() => {
    removeDistrictData(id);
    setDraft([]);
    setErrors({});
    setSaveState('idle');
    setConfirmReset(false);
  }, [id]);

  const storageStatus = getStorageStatus();
  const hasErrors = Object.keys(errors).length > 0;
  const nodeCount = countNodes(draft);

  return (
    <div>
      {(storageStatus === 'unavailable' || storageStatus === 'corrupt') && (
        <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
          {storageStatus === 'unavailable'
            ? 'This browser is blocking local storage, so edits stay only for this session.'
            : 'Saved edits could not be read (storage was corrupted). Starting fresh; your next save will repair it.'}
        </p>
      )}

      {draft.length === 0 ? (
        <p className="rounded-md border border-dashed border-ink-200 px-3 py-4 text-center text-xs text-ink-400">
          No data yet. Add a group (e.g. “Demographics”) or a single value to begin.
        </p>
      ) : (
        <ul className="space-y-2">
          {draft.map((node) => (
            <TreeNodeRow
              key={node.id}
              node={node}
              depth={0}
              errors={errors}
              expanded={expanded}
              autoFocusId={autoFocusId}
              onToggle={onToggle}
              onPatch={onPatch}
              onDelete={onDelete}
              onAddChild={onAddChild}
            />
          ))}
        </ul>
      )}

      {/* Root-level add controls — create top-level nodes. Solid border distinguishes them
          from the dashed "+ Group / + Value" controls that add children inside a group. */}
      <div className="mt-3 flex gap-1.5">
        <button
          type="button"
          onClick={() => addNode(null, 'group')}
          aria-label="Add group at the top level"
          className="rounded-md border border-ink-300 bg-white px-2.5 py-1 text-xs font-medium text-ink-700 hover:border-accent-400 hover:text-accent-700 focus:ring-2 focus:ring-accent-200 focus:outline-none"
        >
          + Add group
        </button>
        <button
          type="button"
          onClick={() => addNode(null, 'value')}
          aria-label="Add value at the top level"
          className="rounded-md border border-ink-300 bg-white px-2.5 py-1 text-xs font-medium text-ink-700 hover:border-accent-400 hover:text-accent-700 focus:ring-2 focus:ring-accent-200 focus:outline-none"
        >
          + Add value
        </button>
      </div>

      {/* Actions */}
      <div className="mt-4 border-t border-ink-100 pt-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px]" aria-live="polite">
            {dirty ? (
              <span className="font-medium text-amber-700">Unsaved changes</span>
            ) : saveState === 'saved' ? (
              <span className="font-medium text-emerald-700">Saved</span>
            ) : saveState === 'not-persisted' ? (
              <span className="font-medium text-amber-700">Saved for this session only</span>
            ) : nodeCount > 0 ? (
              <span className="text-ink-400">
                {nodeCount} {nodeCount === 1 ? 'item' : 'items'}
              </span>
            ) : (
              <span className="text-ink-400">Empty</span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={!dirty}
              className="rounded-md border border-ink-300 bg-white px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50 focus:ring-2 focus:ring-accent-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || hasErrors}
              className="rounded-md bg-accent-600 px-3 py-1 text-xs font-semibold text-white hover:bg-accent-700 focus:ring-2 focus:ring-accent-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save changes
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={handleResetClick}
          disabled={!saved && !dirty}
          className="mt-2 text-[11px] font-medium text-rose-600 hover:text-rose-700 hover:underline focus:outline-none disabled:cursor-not-allowed disabled:text-ink-300 disabled:no-underline"
        >
          Reset this district’s data
        </button>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Reset this district’s data?"
        message="This removes your entire saved data tree for this district. Source data is unaffected."
        confirmLabel="Reset"
        destructive
        onConfirm={doReset}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}

function collectGroupIds(nodes: DraftNode[]): Set<string> {
  const ids = new Set<string>();
  const walk = (list: DraftNode[]) => {
    for (const n of list) {
      if (n.type === 'group') {
        ids.add(n.id);
        if (n.children) walk(n.children);
      }
    }
  };
  walk(nodes);
  return ids;
}
