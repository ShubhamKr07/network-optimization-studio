import { useEffect, useRef, useState } from "react";
import type { MapEntity } from "./types";

// Same fixed-size heuristic as MapDetailsCard — see its own comment for why
// this isn't a measured DOM rect.
const MENU_WIDTH = 170;
const MENU_HEIGHT = 210;
const OFFSET = 6;

export interface MapActionMenuProps {
  entity: MapEntity;
  containerPoint: { x: number; y: number };
  containerSize?: { width: number; height: number };
  // Captured synchronously by the caller at the moment the menu was opened
  // (before any state updates), not re-derived here via `document.activeElement`
  // inside an effect — see the mount-effect comment below for why.
  restoreFocusTo?: HTMLElement | null;
  onEdit: () => void;
  onMove: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onClose: () => void;
  /** SM2-2 — default true (today's two-step "Confirm delete?"). false: the first click calls onDelete because the
   *  caller shows its own confirmation (Super's D3 cascade dialog states the referencing-row count). */
  confirmDelete?: boolean;
  /** View rules (fixed geography / read-only) applied via actionsInContext. */
  ctx?: { fixedGeography?: boolean; readOnly?: boolean };
}

export type EntityActionKey = "edit" | "move" | "copy" | "delete";
export interface EntityAction {
  key: EntityActionKey;
  label: string;
  danger?: boolean;
}

/** Master §A — the ONE action list for an entity: added -> edit, move, copy, delete; base -> edit, copy. */
export function entityActionsFor(entity: MapEntity): EntityAction[] {
  const edit: EntityAction = { key: "edit", label: "Edit…" };
  const copy: EntityAction = { key: "copy", label: "Copy" };
  return entity.entity.isAdded
    ? [edit, { key: "move", label: "Move" }, copy, { key: "delete", label: "Delete", danger: true }]
    : [edit, copy];
}

/** View rules on top of entityActionsFor (PR3-1): readOnly -> []; fixedGeography -> [edit]; else entityActionsFor. */
export function actionsInContext(
  entity: MapEntity,
  ctx: { fixedGeography?: boolean; readOnly?: boolean },
): EntityAction[] {
  if (ctx.readOnly) return [];
  const all = entityActionsFor(entity);
  return ctx.fixedGeography ? all.filter((a) => a.key === "edit") : all;
}

// Right-click action menu, rendered as the same kind of plain overlay as
// MapDetailsCard (never a Leaflet `<Popup>`/`<ContextMenu>`). A BASE entity
// (isAdded === false — one of the textbook dataset's own rows) can only be
// Edited or Copied: it can't be Moved (its coordinates are the textbook's,
// not this scenario's to relocate) or Deleted (it's not this scenario's row
// to remove — excluding/deactivating it is done from the override tables,
// not this menu). An ADDED entity owns its own coordinates and row, so all
// four actions apply.
export function MapActionMenu({
  entity,
  containerPoint,
  containerSize,
  restoreFocusTo,
  onEdit,
  onMove,
  onCopy,
  onDelete,
  onClose,
  confirmDelete = true,
  ctx,
}: MapActionMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const run: Record<EntityActionKey, () => void> = {
    edit: onEdit,
    move: onMove,
    copy: onCopy,
    delete: () => {
      if (!confirmDelete || confirmingDelete) onDelete();
      else setConfirmingDelete(true);
    },
  };
  const actions = actionsInContext(entity, ctx ?? {}).map((a) =>
    a.key === "delete" && confirmingDelete ? { ...a, label: "Confirm delete?" } : a,
  );

  useEffect(() => {
    // `restoreFocusTo` must come from the prop (captured by the caller
    // synchronously at open time), not `document.activeElement` read here:
    // when this menu re-opens for a fresh right-click while a PREVIOUS
    // instance is still mounted, React batches that instance's "close"
    // (from its own outside-mousedown handler) together with this one's
    // "open" into a single commit — the old instance's unmount cleanup
    // (which restores focus to *its* previouslyFocused element) can run
    // before this mount effect fires, so reading `document.activeElement`
    // here would capture that transient, already-stale focus instead of
    // whatever was truly focused right before the click that opened us.
    itemRefs.current[0]?.focus();
    return () => {
      restoreFocusTo?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    const focusable = itemRefs.current.filter((el): el is HTMLButtonElement => el != null);
    const currentIndex = focusable.findIndex((el) => el === document.activeElement);
    if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      const next = focusable[(currentIndex + 1 + focusable.length) % focusable.length];
      next?.focus();
    } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      const prev = focusable[(currentIndex - 1 + focusable.length) % focusable.length];
      prev?.focus();
    }
  }

  let left = containerPoint.x + OFFSET;
  let top = containerPoint.y + OFFSET;
  if (containerSize) {
    left = Math.min(left, containerSize.width - MENU_WIDTH - 4);
    top = Math.min(top, containerSize.height - MENU_HEIGHT - 4);
    left = Math.max(4, left);
    top = Math.max(4, top);
  }

  const { entity: e, kind } = entity;
  const subtitle = kind === "cs" ? (
    <span className="font-mono"> · {e.demand.toLocaleString()} u</span>
  ) : null;

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label={`${e.displayCode} actions`}
      data-testid="map-action-menu"
      className="absolute bg-card border border-border shadow-md text-xs min-w-[150px] z-40"
      style={{ left, top }}
      onKeyDown={handleKeyDown}
    >
      <div className="px-3 py-1.5 border-b border-border font-semibold" data-testid="map-action-menu-header">
        {e.displayCode}
        {subtitle}
      </div>
      {actions.map((action, i) => (
        <button
          key={action.key}
          ref={(el) => {
            itemRefs.current[i] = el;
          }}
          type="button"
          role="menuitem"
          data-testid={`map-action-${action.key}`}
          className={`w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-accent-100 ${
            action.danger ? "text-accent-900" : ""
          } ${action.key === "delete" && confirmingDelete ? "bg-accent-100 font-semibold" : ""}`}
          onClick={() => run[action.key]()}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
