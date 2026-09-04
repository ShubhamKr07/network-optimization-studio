import React from "react";
import { Button } from "../../components/core/Button.jsx";
import { Badge } from "../../components/core/Badge.jsx";
import { Input } from "../../components/core/Input.jsx";
import { Select } from "../../components/core/Select.jsx";
import { Table } from "../../components/core/Table.jsx";
import { Dialog } from "../../components/core/Dialog.jsx";
import { ObjectiveBar } from "../../components/studio/ObjectiveBar.jsx";
import { ConstraintChips } from "../../components/studio/ConstraintChips.jsx";
import { SidebarTree } from "../../components/studio/SidebarTree.jsx";
import { TabBar } from "../../components/studio/TabBar.jsx";
import { StaleOutputBanner } from "../../components/studio/StaleOutputBanner.jsx";
import { AssistantPanel } from "../../components/studio/AssistantPanel.jsx";
import { NetworkMapMock } from "./NetworkMapMock.jsx";
import { WAREHOUSES, CUSTOMERS, SOLUTION } from "./data.js";

var STATUS_LABEL = { active: "Potential", forced_open: "Fixed-Open", inactive: "Inactive" };
var TAB_DEFS = {
  "in:wh": "Warehouses", "in:cust": "Customers", "in:map": "Input Map", "in:params": "Optimization Parameters",
  "out:map": "Output Map", "out:cost": "Cost Summary"
};

export function Workspace(props) {
  var init = props || {};
  var s = React.useState({ tabs: init.solved ? ["in:map", "in:wh", "out:map"] : ["in:map", "in:wh"], active: init.solved ? "out:map" : "in:map", scenario: init.scenario || "Baseline", solved: !!init.solved, stale: false, solving: false, dialog: false, p: 4, assistant: false });
  var st = s[0], set = s[1];
  function patch(p2) { set(function (prev) { return Object.assign({}, prev, p2); }); }
  function openTab(id) {
    set(function (prev) {
      var tabs = prev.tabs.indexOf(id) === -1 ? prev.tabs.concat([id]) : prev.tabs;
      return Object.assign({}, prev, { tabs: tabs, active: id });
    });
  }
  function closeTab(id) {
    set(function (prev) {
      var tabs = prev.tabs.filter(function (t) { return t !== id; });
      var active = prev.active === id ? (tabs[tabs.length - 1] || null) : prev.active;
      return Object.assign({}, prev, { tabs: tabs, active: active });
    });
  }
  function runSolve() {
    patch({ dialog: false, solving: true });
    setTimeout(function () {
      set(function (prev) { return Object.assign({}, prev, { solving: false, solved: true, stale: false, tabs: prev.tabs.indexOf("out:map") === -1 ? prev.tabs.concat(["out:map"]) : prev.tabs, active: "out:map" }); });
    }, 900);
  }
  var outputsOk = st.solved && !st.stale;
  var whRows = WAREHOUSES.map(function (w) {
    return { id: w.id, name: w.name, state: w.state, status: <Badge variant={w.status === "forced_open" ? "default" : w.status === "inactive" ? "outline" : "secondary"}>{STATUS_LABEL[w.status]}</Badge> };
  });
  var custRows = CUSTOMERS.map(function (c) { return { id: c.id, name: c.name, state: c.state, demand: c.demand.toLocaleString() }; });

  function body() {
    if (!st.active) return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--text-muted)" }}>No tabs open — pick an item from the sidebar.</div>;
    if (st.active === "in:map") return <NetworkMapMock mode="input" />;
    if (st.active === "out:map") return outputsOk ? <NetworkMapMock mode="output" /> : <StaleOutputBanner solved={st.solved} onRunOptimizer={function () { patch({ dialog: true }); }} />;
    if (st.active === "in:wh") return <Pane title="Warehouses" subtitle="8 candidate sites"><Table compact maxHeight="100%" columns={[{ key: "id", label: "ID", mono: true }, { key: "name", label: "Warehouse" }, { key: "state", label: "State" }, { key: "status", label: "Status" }]} rows={whRows} /></Pane>;
    if (st.active === "in:cust") return <Pane title="Customers" subtitle="12 demand points"><Table compact maxHeight="100%" columns={[{ key: "id", label: "ID", mono: true }, { key: "name", label: "Customer" }, { key: "state", label: "State" }, { key: "demand", label: "Demand", align: "right", mono: true }]} rows={custRows} /></Pane>;
    if (st.active === "in:params") return (
      <Pane title="Optimization parameters" subtitle="Changing a parameter marks the last solve stale.">
        <div style={{ display: "flex", gap: 14, maxWidth: 480 }}>
          <div style={{ width: 180 }}><Input label="p (warehouses to open)" mono type="number" value={st.p} onChange={function (e) { patch({ p: e.target.value, stale: st.solved ? true : st.stale }); }} /></div>
          <div style={{ width: 200 }}><Select label="Capacity mode" options={["none", "uniform", "per-warehouse"]} value="none" onChange={function () { patch({ stale: st.solved ? true : st.stale }); }} /></div>
        </div>
      </Pane>
    );
    if (st.active === "out:cost") return outputsOk ? (
      <Pane title="Cost summary" subtitle="Weighted-distance objective by open warehouse">
        <Table compact columns={[{ key: "wh", label: "Warehouse" }, { key: "cust", label: "Customers", align: "right", mono: true }, { key: "dem", label: "Demand", align: "right", mono: true }, { key: "obj", label: "Weighted dist", align: "right", mono: true }]}
          rows={[
            { wh: "Allentown DC", cust: "3", dem: "44,060", obj: "612,404" },
            { wh: "Chicago DC", cust: "2", dem: "24,160", obj: "301,118" },
            { wh: "Denver DC", cust: "4", dem: "50,463", obj: "989,270" },
            { wh: "Atlanta DC", cust: "3", dem: "30,050", obj: "482,119" }
          ]} />
      </Pane>
    ) : <StaleOutputBanner solved={st.solved} onRunOptimizer={function () { patch({ dialog: true }); }} />;
    return null;
  }

  var chips = ["p = " + st.p, "Capacity: none", "1 forced open", "1 inactive"];
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--surface-page)" }}>
      <div style={{ padding: "8px 10px 0" }}>
        <ObjectiveBar kicker="Chapter 3" title="Al's Athletics — P-Median" scenarioName={st.scenario}
          description="Facility-location: choose which warehouses to open to minimize weighted distance to customers."
          stats={st.solved ? SOLUTION.stats.concat(st.stale ? [] : []) : []} />
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0, margin: "8px 10px 10px", border: "1px solid var(--border-default)", borderRadius: "var(--radius-lg)", overflow: "hidden", background: "var(--surface-card)" }}>
        <SidebarTree activeId={st.active} onSelect={openTab} width={190} sections={[
          { title: "Scenarios", onAction: function () {}, items: [{ id: "scn:base", label: "Baseline" }, { id: "scn:cap", label: "Cap 60k" }] },
          { title: "Inputs", items: [{ id: "in:wh", label: "Warehouses" }, { id: "in:cust", label: "Customers" }, { id: "in:params", label: "Optimization Parameters" }, { id: "in:map", label: "Input Map" }] },
          { title: "Outputs", items: [{ id: "out:map", label: "Output Map", disabled: !outputsOk }, { id: "out:cost", label: "Cost Summary", disabled: !outputsOk }] }
        ]} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "stretch", borderBottom: "1px solid var(--border-default)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <TabBar tabs={st.tabs.map(function (t) { return { id: t, label: TAB_DEFS[t] }; })} activeTabId={st.active} onActivate={function (id) { patch({ active: id }); }} onClose={closeTab} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px", background: "var(--surface-sunken)", borderLeft: "1px solid var(--border-default)" }}>
              {st.stale ? <Badge variant="warning">stale</Badge> : st.solved ? <Badge variant="success">solved</Badge> : null}
              <Button variant={st.assistant ? "secondary" : "outline"} size="sm" onClick={function () { patch({ assistant: !st.assistant }); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5z" /></svg>Assistant</Button>
              <Button size="sm" disabled={st.solving} onClick={function () { patch({ dialog: true }); }}>{st.solving ? "Solving…" : "Run Optimizer"}</Button>
            </div>
          </div>
          <ConstraintChips chips={chips} stale={st.stale} />
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>{body()}</div>
        </div>
        {st.assistant ? <AssistantPanel scenario={st.scenario} solved={st.solved} stale={st.stale} p={st.p} onClose={function () { patch({ assistant: false }); }} /> : null}
      </div>
      <Dialog open={st.dialog} title="Run optimizer?" description={"p = " + st.p + ", capacity mode none, 1 forced open, 1 inactive. Solves a capacitated p-median ILP with CBC."}
        onClose={function () { patch({ dialog: false }); }}
        footer={<React.Fragment><Button variant="outline" size="sm" onClick={function () { patch({ dialog: false }); }}>Cancel</Button><Button size="sm" onClick={runSolve}>Run</Button></React.Fragment>} />
    </div>
  );
}

function Pane({ title, subtitle, children }) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "14px 16px", fontFamily: "var(--font-sans)" }}>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "15px", color: "var(--text-body)" }}>{title}</div>
      <div style={{ fontSize: "11.5px", color: "var(--text-muted)", margin: "2px 0 12px" }}>{subtitle}</div>
      {children}
    </div>
  );
}
