import { describe, it, expect } from "vitest";
import {
  workspaceTabsReducer,
  workspaceTabId,
  initialWorkspaceTabState,
  type WorkspaceTab,
  type WorkspaceTabState,
} from "@/lib/workspaceTabs";

function tab(id: string, kind: WorkspaceTab["kind"] = "input", label = id): WorkspaceTab {
  return { id, kind, entity: id, label };
}

describe("workspaceTabId", () => {
  it("derives a deterministic id from kind + entity", () => {
    expect(workspaceTabId("input", "warehouses")).toBe("input:warehouses");
    expect(workspaceTabId("output", "flows")).toBe("output:flows");
  });
});

describe("workspaceTabsReducer — open", () => {
  it("opens a new tab and activates it", () => {
    const next = workspaceTabsReducer(initialWorkspaceTabState, { type: "open", tab: tab("input:warehouses") });
    expect(next.tabs).toEqual([tab("input:warehouses")]);
    expect(next.activeTabId).toBe("input:warehouses");
  });

  it("appends subsequent opens without disturbing earlier tabs", () => {
    let state = initialWorkspaceTabState;
    state = workspaceTabsReducer(state, { type: "open", tab: tab("input:warehouses") });
    state = workspaceTabsReducer(state, { type: "open", tab: tab("input:customers") });
    expect(state.tabs.map(t => t.id)).toEqual(["input:warehouses", "input:customers"]);
    expect(state.activeTabId).toBe("input:customers");
  });

  it("re-opening an already-open tab activates it instead of duplicating", () => {
    let state = initialWorkspaceTabState;
    state = workspaceTabsReducer(state, { type: "open", tab: tab("input:warehouses") });
    state = workspaceTabsReducer(state, { type: "open", tab: tab("input:customers") });
    state = workspaceTabsReducer(state, { type: "open", tab: tab("input:warehouses") });
    expect(state.tabs.map(t => t.id)).toEqual(["input:warehouses", "input:customers"]);
    expect(state.activeTabId).toBe("input:warehouses");
  });
});

describe("workspaceTabsReducer — activate", () => {
  it("activates an already-open tab", () => {
    let state: WorkspaceTabState = { tabs: [tab("a"), tab("b")], activeTabId: "a" };
    state = workspaceTabsReducer(state, { type: "activate", id: "b" });
    expect(state.activeTabId).toBe("b");
  });

  it("is a no-op for an id that isn't open", () => {
    const state: WorkspaceTabState = { tabs: [tab("a")], activeTabId: "a" };
    const next = workspaceTabsReducer(state, { type: "activate", id: "nope" });
    expect(next).toBe(state);
  });
});

describe("workspaceTabsReducer — close", () => {
  it("closes a non-active tab and keeps the active one active", () => {
    let state: WorkspaceTabState = { tabs: [tab("a"), tab("b")], activeTabId: "b" };
    state = workspaceTabsReducer(state, { type: "close", id: "a" });
    expect(state.tabs.map(t => t.id)).toEqual(["b"]);
    expect(state.activeTabId).toBe("b");
  });

  it("closing the active tab activates its right neighbor", () => {
    let state: WorkspaceTabState = { tabs: [tab("a"), tab("b"), tab("c")], activeTabId: "b" };
    state = workspaceTabsReducer(state, { type: "close", id: "b" });
    expect(state.tabs.map(t => t.id)).toEqual(["a", "c"]);
    expect(state.activeTabId).toBe("c");
  });

  it("closing the last (rightmost) active tab falls back to its left neighbor", () => {
    let state: WorkspaceTabState = { tabs: [tab("a"), tab("b"), tab("c")], activeTabId: "c" };
    state = workspaceTabsReducer(state, { type: "close", id: "c" });
    expect(state.tabs.map(t => t.id)).toEqual(["a", "b"]);
    expect(state.activeTabId).toBe("b");
  });

  it("closing the only open tab leaves no tab active", () => {
    let state: WorkspaceTabState = { tabs: [tab("a")], activeTabId: "a" };
    state = workspaceTabsReducer(state, { type: "close", id: "a" });
    expect(state.tabs).toEqual([]);
    expect(state.activeTabId).toBeNull();
  });

  it("is a no-op for an id that isn't open", () => {
    const state: WorkspaceTabState = { tabs: [tab("a")], activeTabId: "a" };
    const next = workspaceTabsReducer(state, { type: "close", id: "nope" });
    expect(next).toBe(state);
  });
});
