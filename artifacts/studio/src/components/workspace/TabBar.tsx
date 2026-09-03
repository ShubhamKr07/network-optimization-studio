import { X } from "lucide-react";
import type { WorkspaceTab } from "@/lib/workspaceTabs";

interface TabBarProps {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}

// A0.1 — tab bar mechanics only (activate/close). Tab contents render
// elsewhere (Workspace.tsx picks the body based on activeTabId); this
// component owns just the strip of open tabs above that content region.
export function TabBar({ tabs, activeTabId, onActivate, onClose }: TabBarProps) {
  if (tabs.length === 0) {
    return (
      <div
        className="h-9 border-b flex items-center px-3 text-xs text-muted-foreground flex-shrink-0 bg-muted/20"
        data-testid="tab-bar-empty"
      >
        No tabs open — pick an item from the sidebar.
      </div>
    );
  }

  return (
    <div role="tablist" className="h-9 border-b flex items-stretch flex-shrink-0 overflow-x-auto bg-muted/20" data-testid="tab-bar">
      {tabs.map(tab => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            role="tab"
            tabIndex={0}
            aria-selected={isActive}
            data-testid={`tab-${tab.id}`}
            onClick={() => onActivate(tab.id)}
            onKeyDown={e => {
              if (e.key === "Enter" || e.key === " ") onActivate(tab.id);
            }}
            // Active tab gets a TOP green rule (inset box-shadow), matching the
            // reference TabBar.jsx — not a bottom border, which would sit flush
            // against the tab strip's own border-b and be invisible.
            style={{ boxShadow: isActive ? "inset 0 2px 0 var(--green-500)" : "none" }}
            className={`flex items-center gap-1.5 px-3 border-r text-xs cursor-pointer select-none whitespace-nowrap ${
              isActive ? "bg-background font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>{tab.label}</span>
            <button
              type="button"
              aria-label={`Close ${tab.label}`}
              data-testid={`tab-close-${tab.id}`}
              onClick={e => {
                e.stopPropagation();
                onClose(tab.id);
              }}
              className="opacity-60 hover:opacity-100"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
