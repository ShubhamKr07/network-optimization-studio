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
  onEdit: () => void;
  onMove: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onClose: () => void;
}

interface MenuAction {
  key: "edit" | "move" | "copy" | "delete";
  label: string;
  danger?: boolean;
  run: () => void;
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
  onEdit,
  onMove,
  onCopy,
  onDelete,
  onClose,
}: MapActionMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isAdded = entity.entity.isAdded;
  const actions: MenuAction[] = isAdded
    ? [
        { key: "edit", label: "Edit…", run: onEdit },
        { key: "move", label: "Move", run: onMove },
        { key: "copy", label: "Copy", run: onCopy },
        {
          key: "delete",
          label: confirmingDelete ? "Confirm delete?" : "Delete",
          danger: true,
          run: () => {
            if (confirmingDelete) {
              onDelete();
            } else {
              setConfirmingDelete(true);
            }
          },
        },
      ]
    : [
        { key: "edit", label: "Edit…", run: onEdit },
        { key: "copy", label: "Copy", run: onCopy },
      ];

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    itemRefs.current[0]?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
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
  const subtitle = kind === "cs" ? ` · ${e.demand.toLocaleString()} u` : "";

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
          onClick={() => action.run()}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
