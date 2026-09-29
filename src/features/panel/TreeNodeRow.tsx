import { useEffect, useId, useRef } from 'react';
import {
  VALUE_TYPES,
  VALUE_TYPE_LABELS,
  type DraftNode,
  type TreeErrors,
  type ValueType,
} from '../../data/districtDataTree.ts';
import { ValueEditor } from './ValueEditor.tsx';

/**
 * One node in the recursive district-data tree, rendering itself for its children.
 *
 * Visual language:
 *  - A GROUP is a header (caret + bold name) whose children sit in an indented column drawn
 *    with a vertical guide line. The group's "+ Group / + Value" controls live INSIDE that
 *    guide, so it is unambiguous which group they add to.
 *  - A VALUE is a bordered card holding its name, type and value together, so a value is
 *    always visually tied to its name.
 *
 * There is no depth limit — the component simply recurses, and each group adds one indent.
 */
export function TreeNodeRow({
  node,
  depth,
  errors,
  expanded,
  autoFocusId,
  onToggle,
  onPatch,
  onDelete,
  onAddChild,
}: {
  node: DraftNode;
  depth: number;
  errors: TreeErrors;
  expanded: Set<string>;
  autoFocusId: string | null;
  onToggle: (id: string) => void;
  onPatch: (id: string, patch: Partial<DraftNode>) => void;
  onDelete: (id: string) => void;
  onAddChild: (parentId: string, kind: 'group' | 'value') => void;
}) {
  const nameId = useId();
  const valueId = useId();
  const nameRef = useRef<HTMLInputElement | null>(null);
  const err = errors[node.id];

  useEffect(() => {
    if (autoFocusId === node.id) nameRef.current?.focus();
  }, [autoFocusId, node.id]);

  const isGroup = node.type === 'group';
  const isOpen = expanded.has(node.id);
  const displayName = node.name.trim() || (isGroup ? 'this group' : 'this value');

  const nameInput = (
    <input
      ref={nameRef}
      id={nameId}
      value={node.name}
      onChange={(e) => onPatch(node.id, { name: e.target.value })}
      placeholder={isGroup ? 'Group name' : 'Value name'}
      aria-label={isGroup ? 'Group name' : 'Value name'}
      aria-invalid={err?.name ? true : undefined}
      aria-describedby={err?.name ? `${nameId}-err` : undefined}
      className={`min-w-0 flex-1 rounded border bg-white px-2 py-1 text-sm focus:ring-2 focus:outline-none ${
        isGroup ? 'font-semibold text-ink-900' : 'font-medium text-ink-900'
      } ${
        err?.name
          ? 'border-rose-400 focus:ring-rose-200'
          : 'border-ink-300 focus:border-accent-600 focus:ring-accent-200'
      }`}
    />
  );

  const deleteButton = (
    <button
      type="button"
      onClick={() => onDelete(node.id)}
      aria-label={`Delete ${displayName}`}
      title={`Delete ${displayName}`}
      className="grid h-7 w-7 shrink-0 place-items-center rounded text-ink-400 hover:bg-rose-50 hover:text-rose-600 focus:ring-2 focus:ring-rose-200 focus:outline-none"
    >
      <span aria-hidden="true">🗑</span>
    </button>
  );

  const nameError = err?.name && (
    <p id={`${nameId}-err`} role="alert" className="mt-0.5 text-[11px] text-rose-600">
      {err.name}
    </p>
  );

  if (isGroup) {
    return (
      <li>
        {/* Group header — visually distinct from value cards. */}
        <div className="flex items-center gap-1 rounded-md bg-ink-100/70 px-1 py-1">
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${displayName}`}
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-ink-500 hover:bg-ink-200 focus:ring-2 focus:ring-accent-200 focus:outline-none"
          >
            <span aria-hidden="true" className="text-[10px]">
              {isOpen ? '▾' : '▸'}
            </span>
          </button>
          {nameInput}
          {deleteButton}
        </div>
        <div className="ml-3">{nameError}</div>

        {isOpen && (
          // Indented child column with a vertical guide line so ownership is obvious.
          <div className="mt-1.5 ml-3 space-y-2 border-l-2 border-ink-200 pl-3">
            {(node.children?.length ?? 0) > 0 && (
              <ul className="space-y-2">
                {node.children!.map((child) => (
                  <TreeNodeRow
                    key={child.id}
                    node={child}
                    depth={depth + 1}
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
            {/* These controls add CHILDREN of this group. */}
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => onAddChild(node.id, 'group')}
                aria-label={`Add group to ${displayName}`}
                className="rounded border border-dashed border-ink-300 px-2 py-0.5 text-[11px] font-medium text-ink-600 hover:border-accent-400 hover:text-accent-700 focus:ring-2 focus:ring-accent-200 focus:outline-none"
              >
                + Group
              </button>
              <button
                type="button"
                onClick={() => onAddChild(node.id, 'value')}
                aria-label={`Add value to ${displayName}`}
                className="rounded border border-dashed border-ink-300 px-2 py-0.5 text-[11px] font-medium text-ink-600 hover:border-accent-400 hover:text-accent-700 focus:ring-2 focus:ring-accent-200 focus:outline-none"
              >
                + Value
              </button>
            </div>
          </div>
        )}
      </li>
    );
  }

  // Value node — a self-contained card tying name, type and value together.
  return (
    <li>
      <div className="rounded-md border border-ink-200 bg-white p-2">
        <div className="flex items-center gap-1">
          {nameInput}
          {deleteButton}
        </div>
        {nameError}
        <div className="mt-1.5 flex items-center gap-1.5">
          <select
            value={node.valueType ?? 'text'}
            onChange={(e) => onPatch(node.id, { valueType: e.target.value as ValueType })}
            aria-label={`Type of ${displayName}`}
            className="shrink-0 rounded border border-ink-300 bg-ink-50 px-1.5 py-1 text-xs text-ink-700 focus:border-accent-600 focus:ring-2 focus:ring-accent-200 focus:outline-none"
          >
            {VALUE_TYPES.map((t) => (
              <option key={t} value={t}>
                {VALUE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <div className="min-w-0 flex-1">
            <ValueEditor
              inputId={valueId}
              valueType={node.valueType ?? 'text'}
              value={node.value}
              onChange={(v) => onPatch(node.id, { value: v })}
              invalid={Boolean(err?.value)}
              describedBy={err?.value ? `${valueId}-err` : undefined}
            />
          </div>
        </div>
        {err?.value && (
          <p id={`${valueId}-err`} role="alert" className="mt-0.5 text-[11px] text-rose-600">
            {err.value}
          </p>
        )}
      </div>
    </li>
  );
}
