import { useState, useEffect, useCallback, useRef } from "react";
import { useSearch, useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListScenarios,
  useGetDataset,
  useGetScenario,
  useUpdateScenario,
  useSolveScenario,
  useCloneScenario,
  useCreateScenario,
  useDeleteScenario,
  getListScenariosQueryKey,
  getGetScenarioQueryKey,
} from "@workspace/api-client-react";
import type { WarehouseStatusEntry, Scenario, ScenarioUpdateProblemType, ScenarioUpdateSolver, ScenarioUpdateCapacityMode } from "@workspace/api-client-react";
import { NetworkMap } from "@/components/NetworkMap";
import { ObjectiveBar } from "@/components/ObjectiveBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ChevronDown, Plus, X, Check, AlertTriangle, AlertCircle, PlayCircle, Copy, BarChart2, ChevronRight, Pencil, Trash2, Save } from "lucide-react";

const PROBLEM_TYPES: Record<string, string> = {
  p_median: "P-Median Facility Location",
  capacitated_flp: "Capacitated FLP",
  max_coverage: "Max Coverage",
  p_center: "P-Center",
  set_cover: "Set Cover",
};

const CONSTRAINTS: Record<string, string[]> = {
  p_median: ["C1 Serve every customer", "C2 Open exactly P facilities", "C3 Respect capacity", "C4 Honor warehouse status", "C5 Route only to open facility"],
  capacitated_flp: ["C1 Serve every customer", "C2 Capacity constraint per facility", "C3 Honor warehouse status", "C4 Route only to open facility", "C5 Minimize fixed + transport cost"],
  max_coverage: ["C1 Open exactly P facilities", "C2 Coverage distance threshold", "C3 Honor warehouse status", "C4 Maximize demand within threshold", "C5 Binary assignment"],
  p_center: ["C1 Open exactly P facilities", "C2 Minimize maximum distance", "C3 Honor warehouse status", "C4 Route only to open facility", "C5 Minimax objective"],
  set_cover: ["C1 Cover all demand nodes", "C2 Coverage radius defined", "C3 Minimize number of facilities", "C4 Honor warehouse status", "C5 Binary covering"],
};

const BAND_COLORS = ["#16A34A", "#84CC16", "#F59E0B", "#EF4444"];
const getBandColor = (i: number) => BAND_COLORS[Math.min(i, BAND_COLORS.length - 1)];

interface LocalConfig {
  name: string;
  problemType: ScenarioUpdateProblemType;
  pValue: number;
  distanceBands: number[];
  solver: ScenarioUpdateSolver;
  gap: number;
  timeLimitSec: number;
  capacityMode: ScenarioUpdateCapacityMode;
  uniformCapacity: number | null;
  warehouseStatuses: WarehouseStatusEntry[];
}

function configFromScenario(s: Scenario): LocalConfig {
  return {
    name: s.name,
    problemType: s.problemType,
    pValue: s.pValue,
    distanceBands: [...s.distanceBands],
    solver: s.solver,
    gap: s.gap,
    timeLimitSec: s.timeLimitSec,
    capacityMode: s.capacityMode,
    uniformCapacity: s.uniformCapacity ?? null,
    warehouseStatuses: [...s.warehouseStatuses],
  };
}

export function Studio() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const params = new URLSearchParams(search);
  const scenarioIdStr = params.get("scenario");
  const scenarioId = scenarioIdStr ? parseInt(scenarioIdStr, 10) : undefined;

  const { data: scenarios, isLoading: scenariosLoading } = useListScenarios();
  const { data: dataset, isLoading: datasetLoading } = useGetDataset();
  const { data: scenarioFromApi } = useGetScenario(scenarioId!, {
    query: { enabled: !!scenarioId, queryKey: getGetScenarioQueryKey(scenarioId!) },
  });

  const updateScenario = useUpdateScenario();
  const solveScenario = useSolveScenario();
  const cloneScenario = useCloneScenario();
  const createScenario = useCreateScenario();

  const [localConfig, setLocalConfig] = useState<LocalConfig | null>(null);
  const [savedConfig, setSavedConfig] = useState<LocalConfig | null>(null);
  const [isSolving, setIsSolving] = useState(false);
  const [activeTab, setActiveTab] = useState<"input" | "output">("input");
  const [showRoutes, setShowRoutes] = useState(false);
  const [showScenarioDropdown, setShowScenarioDropdown] = useState(false);
  const [addingBand, setAddingBand] = useState(false);
  const [newBandValue, setNewBandValue] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newScenarioName, setNewScenarioName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const deleteScenario = useDeleteScenario();

  useEffect(() => {
    if (!scenarios || scenarios.length === 0) return;
    // No scenario selected → pick the first one
    if (!scenarioId) {
      navigate(`/?scenario=${scenarios[0].id}`, { replace: true });
      return;
    }
    // Scenario ID in URL doesn't exist in the list → fall back to first
    const exists = scenarios.some(s => s.id === scenarioId);
    if (!exists) {
      navigate(`/?scenario=${scenarios[0].id}`, { replace: true });
    }
  }, [scenarios, scenarioId, navigate]);

  useEffect(() => {
    if (scenarioFromApi) {
      const cfg = configFromScenario(scenarioFromApi);
      setLocalConfig(cfg);
      setSavedConfig(cfg);
      if (scenarioFromApi.result) setActiveTab("output");
    }
  }, [scenarioFromApi?.id]);

  const isDirty = localConfig && savedConfig
    ? JSON.stringify(localConfig) !== JSON.stringify(savedConfig)
    : false;

  const handleSave = useCallback(() => {
    if (!localConfig || !scenarioId || !isDirty) return;
    updateScenario.mutate(
      { scenarioId, data: localConfig },
      {
        onSuccess: () => {
          setSavedConfig(localConfig);
          queryClient.invalidateQueries({ queryKey: getListScenariosQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetScenarioQueryKey(scenarioId) });
        },
      }
    );
  }, [localConfig, scenarioId, isDirty, updateScenario, queryClient]);

  const update = useCallback(<K extends keyof LocalConfig>(key: K, value: LocalConfig[K]) => {
    setLocalConfig(prev => prev ? { ...prev, [key]: value } : prev);
  }, []);

  const getWarehouseStatus = (whId: string): "potential" | "forced_open" | "inactive" => {
    if (!localConfig) return "potential";
    const e = localConfig.warehouseStatuses.find(s => s.warehouseId === whId);
    return (e?.status as "potential" | "forced_open" | "inactive") ?? "potential";
  };

  const setWarehouseStatus = (whId: string, status: "potential" | "forced_open" | "inactive") => {
    setLocalConfig(prev => {
      if (!prev) return prev;
      const filtered = prev.warehouseStatuses.filter(e => e.warehouseId !== whId);
      const next = status === "potential" ? filtered : [...filtered, { warehouseId: whId, status }];
      return { ...prev, warehouseStatuses: next };
    });
  };

  const forcedOpenCount = localConfig?.warehouseStatuses.filter(e => e.status === "forced_open").length ?? 0;
  const inactiveCount = localConfig?.warehouseStatuses.filter(e => e.status === "inactive").length ?? 0;
  const pValue = localConfig?.pValue ?? 3;
  const maxBand = localConfig?.distanceBands.length ? Math.max(...localConfig.distanceBands) : 1600;

  const blockingErrors: Array<{ title: string; desc: string }> = [];
  if (forcedOpenCount > pValue) {
    blockingErrors.push({
      title: `Forced Open (${forcedOpenCount}) exceeds P (${pValue})`,
      desc: `You have ${forcedOpenCount} warehouses set to Forced Open, but P = ${pValue}. Increase P to at least ${forcedOpenCount} or reduce Forced Open count.`,
    });
  }
  const availablePotential = 26 - forcedOpenCount - inactiveCount;
  if (pValue - forcedOpenCount > availablePotential) {
    blockingErrors.push({
      title: `Not enough potential sites`,
      desc: `P requires ${pValue - forcedOpenCount} additional sites but only ${availablePotential} are Potential.`,
    });
  }

  const warnings: Array<{ title: string }> = [
    { title: `12 customers lie beyond the largest band (${maxBand.toLocaleString()} mi) — expected with sparse coverage.` },
  ];
  if ((localConfig?.uniformCapacity ?? 50000000) >= 50000000) {
    warnings.push({ title: "Capacity 50,000,000 is non-binding — C3 will be inactive." });
  }

  const hasErrors = blockingErrors.length > 0;
  const result = scenarioFromApi?.result ?? null;

  const handleSolve = () => {
    if (!scenarioId || hasErrors) return;
    setIsSolving(true);
    solveScenario.mutate(
      { scenarioId },
      {
        onSuccess: (updated) => {
          setIsSolving(false);
          setActiveTab("output");
          queryClient.invalidateQueries({ queryKey: getListScenariosQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetScenarioQueryKey(scenarioId) });
        },
        onError: () => setIsSolving(false),
      }
    );
  };

  const handleClone = () => {
    if (!scenarioId) return;
    cloneScenario.mutate(
      { scenarioId },
      {
        onSuccess: (cloned) => {
          queryClient.invalidateQueries({ queryKey: getListScenariosQueryKey() });
          navigate(`/?scenario=${cloned.id}`);
        },
      }
    );
  };

  const handleDelete = (id: number) => {
    deleteScenario.mutate(
      { scenarioId: id },
      {
        onSuccess: () => {
          setConfirmDeleteId(null);
          queryClient.invalidateQueries({ queryKey: getListScenariosQueryKey() });
          if (id === scenarioId) {
            const remaining = (scenarios ?? []).filter(s => s.id !== id);
            if (remaining.length > 0) {
              navigate(`/?scenario=${remaining[0].id}`);
            } else {
              navigate("/");
            }
          }
        },
      }
    );
  };

  const handleCreateNew = () => {
    setNewScenarioName(`Scenario ${(scenarios?.length ?? 0) + 1}`);
    setShowCreateDialog(true);
  };

  const handleCreateConfirm = () => {
    const name = newScenarioName.trim() || `Scenario ${(scenarios?.length ?? 0) + 1}`;
    createScenario.mutate(
      {
        data: {
          name,
          problemType: "p_median",
          pValue: 3,
          distanceBands: [200, 400, 800, 1600],
          solver: "cbc",
          gap: 0,
          timeLimitSec: 120,
          capacityMode: "uniform",
          uniformCapacity: 50000000,
          warehouseStatuses: [],
        },
      },
      {
        onSuccess: (s) => {
          setShowCreateDialog(false);
          queryClient.invalidateQueries({ queryKey: getListScenariosQueryKey() });
          navigate(`/?scenario=${s.id}`);
        },
      }
    );
  };

  const addBand = () => {
    const val = parseInt(newBandValue, 10);
    if (!isNaN(val) && val > 0 && localConfig && !localConfig.distanceBands.includes(val)) {
      const next = [...localConfig.distanceBands, val].sort((a, b) => a - b);
      update("distanceBands", next);
    }
    setNewBandValue("");
    setAddingBand(false);
  };

  const removeBand = (band: number) => {
    setLocalConfig(prev => prev ? { ...prev, distanceBands: prev.distanceBands.filter(b => b !== band) } : prev);
  };

  const statusLabel = (() => {
    if (isSolving) return { text: "Solving...", color: "text-amber-600 bg-amber-50 border-amber-200" };
    if (result && !isDirty) return { text: "Solved · validated", color: "text-green-700 bg-green-50 border-green-200" };
    if (hasErrors) return { text: `${blockingErrors.length} error · ${warnings.length} warning`, color: "text-red-600 bg-red-50 border-red-200" };
    if (isDirty) return { text: "draft", color: "text-muted-foreground bg-muted border-border" };
    return { text: `${warnings.length} warning`, color: "text-amber-600 bg-amber-50 border-amber-200" };
  })();

  if (scenariosLoading || datasetLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="space-y-3 w-64">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    );
  }

  if (!scenarios?.length) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-muted-foreground">No scenarios yet.</p>
        <Button onClick={handleCreateNew} data-testid="button-create-scenario">
          <Plus className="w-4 h-4 mr-2" /> Create first scenario
        </Button>
      </div>
    );
  }

  const currentScenario = scenarioFromApi ?? scenarios.find(s => s.id === scenarioId) ?? scenarios[0];

  return (
    <div className="arcadia-lab flex flex-col h-full overflow-hidden bg-background">
      {/* HEADER */}
      <header className="h-14 border-b bg-white flex items-center px-4 gap-3 flex-shrink-0 z-50 relative">
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0" style={{ background: "rgba(87,208,201,.15)", color: "var(--arc-cyan)", border: "1px solid rgba(87,208,201,.3)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 3v6l-5 9a2 2 0 002 3h12a2 2 0 002-3l-5-9V3M8 3h8M7 15h10"/></svg>
          </div>
          <div>
            <div className="font-semibold text-sm leading-tight text-foreground" style={{ fontFamily: "var(--arc-display)" }}>Al's Athletics · Model Lab</div>
            <div className="text-xs text-muted-foreground leading-tight" style={{ fontFamily: "var(--arc-mono)", fontSize: "10px", letterSpacing: "0.05em" }}>Ch 3 · p-median · facility location</div>
          </div>
        </div>

        <div className="h-5 border-l border-border mx-1" />

        <div className="relative flex-1 min-w-0">
          <button
            data-testid="button-scenario-dropdown"
            onClick={() => setShowScenarioDropdown(v => !v)}
            className="flex items-center gap-1 text-sm font-medium hover:text-primary transition-colors max-w-full"
          >
            <span className="text-muted-foreground text-xs mr-1">Scenario:</span>
            <span className="truncate max-w-[200px]">{currentScenario?.name ?? "—"}</span>
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          </button>

          {showScenarioDropdown && (
            <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-border rounded-md shadow-lg z-50 py-1">
              {scenarios.map(s => (
                <div key={s.id} className="flex items-center group">
                  {confirmDeleteId === s.id ? (
                    <div className="flex-1 flex items-center gap-1 px-3 py-2 bg-red-50">
                      <span className="text-xs text-red-700 flex-1">Delete "{s.name}"?</span>
                      <button
                        onClick={() => handleDelete(s.id)}
                        disabled={deleteScenario.isPending}
                        className="text-xs font-semibold text-white bg-red-600 hover:bg-red-700 px-2 py-0.5 rounded"
                      >
                        {deleteScenario.isPending && confirmDeleteId === s.id ? "…" : "Delete"}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-xs text-muted-foreground hover:text-foreground px-1 py-0.5"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        data-testid={`button-scenario-${s.id}`}
                        onClick={() => { navigate(`/?scenario=${s.id}`); setShowScenarioDropdown(false); setConfirmDeleteId(null); }}
                        className={`flex-1 text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2 min-w-0 ${s.id === scenarioId ? "text-primary font-medium" : "text-foreground"}`}
                      >
                        {s.id === scenarioId && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                        <span className={`truncate ${s.id !== scenarioId ? "ml-5" : ""}`}>{s.name}</span>
                        {s.result && <span className="ml-auto text-xs text-green-600 flex-shrink-0">Solved</span>}
                      </button>
                      <button
                        data-testid={`button-delete-scenario-${s.id}`}
                        onClick={e => { e.stopPropagation(); setConfirmDeleteId(s.id); }}
                        className="px-2 py-2 text-muted-foreground hover:text-destructive opacity-40 hover:opacity-100 transition-opacity flex-shrink-0"
                        title="Delete scenario"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              ))}
              <div className="border-t border-border mt-1 pt-1">
                <button
                  data-testid="button-new-scenario"
                  onClick={() => { handleCreateNew(); setShowScenarioDropdown(false); }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors text-primary flex items-center gap-2"
                >
                  <Plus className="w-3.5 h-3.5" /> New scenario
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-xs font-medium px-2 py-0.5 rounded border ${statusLabel.color}`} data-testid="status-badge">
            {statusLabel.text}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCreateNew}
            disabled={createScenario.isPending}
            data-testid="button-create-scenario"
            className="h-8 text-xs"
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> New
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClone}
            disabled={!scenarioId || cloneScenario.isPending}
            data-testid="button-clone"
            className="h-8 text-xs"
          >
            <Copy className="w-3.5 h-3.5 mr-1" /> Clone
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSave}
            disabled={!isDirty || updateScenario.isPending}
            data-testid="button-save"
            className={`h-8 text-xs ${isDirty ? "border-primary text-primary hover:bg-primary/10" : ""}`}
          >
            <Save className="w-3.5 h-3.5 mr-1" />
            {updateScenario.isPending ? "Saving…" : "Save"}
          </Button>
          <Link href={`/compare?scenario=${scenarioId}`}>
            <Button variant="outline" size="sm" className="h-8 text-xs" data-testid="button-compare">
              <BarChart2 className="w-3.5 h-3.5 mr-1" /> Compare
            </Button>
          </Link>
          <Button
            size="sm"
            onClick={handleSolve}
            disabled={hasErrors || isSolving || !scenarioId}
            data-testid="button-solve"
            className={`h-8 text-xs ${hasErrors || isSolving ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-green-600 hover:bg-green-700 text-white"}`}
          >
            <PlayCircle className="w-3.5 h-3.5 mr-1" />
            {isSolving ? "Solving..." : (result && isDirty) ? "Re-solve" : "Solve"}
          </Button>
        </div>
      </header>

      {/* OBJECTIVE BAR */}
      <ObjectiveBar pValue={pValue} result={result} scenarioId={scenarioId} />

      {/* THREE PANELS */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT PANEL — CONFIGURE */}
        <aside className="w-[220px] flex-shrink-0 border-r bg-white overflow-y-auto flex flex-col">
          <div className="px-3 py-2 bg-white border-b">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-primary">Configure · Step 1</span>
          </div>

          {localConfig ? (
            <>
              {/* Scenario name */}
              <div className="px-3 py-3 border-b space-y-1">
                <p className="text-xs font-semibold text-foreground">Scenario name</p>
                {editingName ? (
                  <Input
                    ref={nameInputRef}
                    value={localConfig.name}
                    onChange={e => update("name", e.target.value)}
                    onBlur={() => setEditingName(false)}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") setEditingName(false); }}
                    className="h-7 text-xs"
                    data-testid="input-scenario-name"
                    autoFocus
                  />
                ) : (
                  <button
                    onClick={() => { setEditingName(true); setTimeout(() => nameInputRef.current?.focus(), 0); }}
                    className="w-full text-left text-xs px-2 py-1.5 rounded border border-border bg-muted/40 hover:bg-muted hover:border-primary/40 transition-colors flex items-center justify-between gap-1 group"
                    data-testid="button-edit-name"
                  >
                    <span className="truncate text-foreground">{localConfig.name}</span>
                    <Pencil className="w-3 h-3 text-muted-foreground group-hover:text-primary flex-shrink-0" />
                  </button>
                )}
              </div>

              {/* Problem type */}
              <div className="px-3 py-3 border-b space-y-2">
                <p className="text-xs font-semibold text-foreground">Problem type</p>
                <Select value={localConfig.problemType} onValueChange={v => update("problemType", v as ScenarioUpdateProblemType)}>
                  <SelectTrigger className="h-8 text-xs" data-testid="select-problem-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PROBLEM_TYPES).map(([k, v]) => (
                      <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground italic">Also: Capacitated FLP · Max Coverage · P-Center · Set Cover</p>
              </div>

              {/* P value */}
              <div className="px-3 py-3 border-b space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-foreground">Warehouses to open (P)</p>
                  <span className="text-sm font-bold text-primary" data-testid="text-p-value">{localConfig.pValue}</span>
                </div>
                <Slider
                  min={1} max={50} step={1}
                  value={[localConfig.pValue]}
                  onValueChange={([v]) => update("pValue", v)}
                  data-testid="slider-p-value"
                  className="my-1"
                />
                <div className="flex gap-1 flex-wrap">
                  {[2, 3, 4, 10, 25].map(n => (
                    <button
                      key={n}
                      data-testid={`button-p-quick-${n}`}
                      onClick={() => update("pValue", n)}
                      className={`text-xs px-2 py-0.5 rounded border transition-colors ${localConfig.pValue === n ? "bg-primary text-white border-primary" : "bg-white text-foreground border-border hover:border-primary"}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground">Max 50 – capped at {26 - inactiveCount} available sites.</p>
              </div>

              {/* Distance bands */}
              <div className="px-3 py-3 border-b space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-foreground">Distance bands (miles)</p>
                  <div className="flex items-center gap-1">
                    <button
                      data-testid="button-bands-minus"
                      onClick={() => {
                        if (localConfig.distanceBands.length > 1) {
                          update("distanceBands", localConfig.distanceBands.slice(0, -1));
                        }
                      }}
                      className="w-5 h-5 rounded border border-border text-xs flex items-center justify-center hover:bg-muted"
                    >−</button>
                    <span className="text-xs w-4 text-center">{localConfig.distanceBands.length}</span>
                    <button
                      data-testid="button-bands-plus"
                      onClick={() => setAddingBand(true)}
                      className="w-5 h-5 rounded border border-border text-xs flex items-center justify-center hover:bg-muted"
                    >+</button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {localConfig.distanceBands.map(b => (
                    <span key={b} className="inline-flex items-center gap-0.5 text-xs bg-muted border border-border rounded px-1.5 py-0.5">
                      {b.toLocaleString()}
                      <button
                        data-testid={`button-remove-band-${b}`}
                        onClick={() => removeBand(b)}
                        className="text-muted-foreground hover:text-foreground ml-0.5"
                      ><X className="w-2.5 h-2.5" /></button>
                    </span>
                  ))}
                </div>
                {addingBand && (
                  <div className="flex gap-1">
                    <Input
                      type="number"
                      value={newBandValue}
                      onChange={e => setNewBandValue(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") addBand(); if (e.key === "Escape") setAddingBand(false); }}
                      placeholder="miles"
                      className="h-7 text-xs"
                      autoFocus
                      data-testid="input-new-band"
                    />
                    <Button size="sm" onClick={addBand} className="h-7 px-2 text-xs" data-testid="button-add-band-confirm">Add</Button>
                  </div>
                )}
                {!addingBand && (
                  <button
                    data-testid="button-add-band"
                    onClick={() => setAddingBand(true)}
                    className="text-xs text-primary hover:underline"
                  >+ Add</button>
                )}
              </div>

              {/* Solver */}
              <div className="px-3 py-3 border-b space-y-2">
                <p className="text-xs font-semibold text-foreground">Solver</p>
                <Select value={localConfig.solver} onValueChange={v => update("solver", v as ScenarioUpdateSolver)}>
                  <SelectTrigger className="h-8 text-xs" data-testid="select-solver">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cbc" className="text-xs">CBC (PuLP)</SelectItem>
                    <SelectItem value="highs" disabled className="text-xs text-muted-foreground">HiGHS (not available)</SelectItem>
                    <SelectItem value="glpk" disabled className="text-xs text-muted-foreground">GLPK (not available)</SelectItem>
                    <SelectItem value="gurobi" disabled className="text-xs text-muted-foreground">Gurobi (not available)</SelectItem>
                    <SelectItem value="scip" disabled className="text-xs text-muted-foreground">SCIP (not available)</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Label className="text-[10px] text-muted-foreground">Gap</Label>
                    <Input
                      type="number"
                      value={localConfig.gap}
                      onChange={e => update("gap", parseFloat(e.target.value) || 0)}
                      className="h-7 text-xs mt-0.5"
                      step="0.01"
                      data-testid="input-gap"
                    />
                  </div>
                  <div className="flex-1">
                    <Label className="text-[10px] text-muted-foreground">Time (s)</Label>
                    <Input
                      type="number"
                      value={localConfig.timeLimitSec}
                      onChange={e => update("timeLimitSec", parseInt(e.target.value, 10) || 120)}
                      className="h-7 text-xs mt-0.5"
                      data-testid="input-time-limit"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">Also: HiGHS · GLPK · Gurobi · SCIP</p>
              </div>

              {/* Warehouse capacity */}
              <div className="px-3 py-3 border-b space-y-2">
                <p className="text-xs font-semibold text-foreground">Warehouse capacity</p>
                <Input
                  type="number"
                  value={localConfig.uniformCapacity ?? ""}
                  onChange={e => update("uniformCapacity", parseInt(e.target.value, 10) || null)}
                  className="h-7 text-xs"
                  placeholder="50,000,000"
                  data-testid="input-capacity"
                />
                <div className="flex rounded border border-border overflow-hidden text-xs">
                  <button
                    data-testid="button-capacity-uniform"
                    onClick={() => update("capacityMode", "uniform")}
                    className={`flex-1 py-1 text-center transition-colors ${localConfig.capacityMode === "uniform" ? "bg-primary text-white" : "bg-white text-foreground hover:bg-muted"}`}
                  >Uniform</button>
                  <button
                    data-testid="button-capacity-per-wh"
                    onClick={() => update("capacityMode", "per_wh")}
                    className={`flex-1 py-1 text-center transition-colors ${localConfig.capacityMode === "per_wh" ? "bg-primary text-white" : "bg-white text-foreground hover:bg-muted"}`}
                  >Per-WH</button>
                </div>
              </div>

              {/* Constraints */}
              <div className="px-3 py-3 border-b space-y-2">
                <div className="flex items-center gap-1">
                  <p className="text-xs font-semibold text-foreground">Constraints · model-defined</p>
                  <Badge variant="outline" className="text-[9px] text-primary border-primary/30 bg-primary/5 px-1 py-0">· read-only</Badge>
                </div>
                <ul className="space-y-1">
                  {(CONSTRAINTS[localConfig.problemType] ?? CONSTRAINTS.p_median).map(c => (
                    <li key={c} className="text-[10px] text-muted-foreground flex items-start gap-1">
                      <ChevronRight className="w-2.5 h-2.5 mt-0.5 flex-shrink-0 text-border" />
                      {c}
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] text-muted-foreground italic">Defined by the selected problem type.</p>
              </div>

              {/* Warehouse status */}
              <div className="px-3 py-3 space-y-2">
                <p className="text-xs font-semibold text-foreground">Warehouse status</p>
                {dataset?.warehouses.map(wh => {
                  const status = getWarehouseStatus(wh.id);
                  return (
                    <div key={wh.id} className="flex items-center justify-between gap-1">
                      <span className="text-[10px] text-foreground truncate max-w-[70px]" title={`${wh.city}, ${wh.state}`}>{wh.city}</span>
                      <div className="flex rounded border border-border overflow-hidden text-[9px] flex-shrink-0">
                        {(["potential", "forced_open", "inactive"] as const).map(s => (
                          <button
                            key={s}
                            data-testid={`button-wh-${wh.id}-${s}`}
                            onClick={() => setWarehouseStatus(wh.id, s)}
                            className={`px-1.5 py-0.5 transition-colors whitespace-nowrap ${
                              status === s
                                ? s === "forced_open" ? "bg-primary text-white" : s === "inactive" ? "bg-destructive text-white" : "bg-slate-200 text-foreground"
                                : "bg-white text-muted-foreground hover:bg-muted"
                            }`}
                          >
                            {s === "potential" ? "Pot" : s === "forced_open" ? "Open" : "Off"}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="p-3 space-y-2">
              {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-6 w-full" />)}
            </div>
          )}
        </aside>

        {/* CENTER MAP PANEL */}
        <main className="flex-1 overflow-hidden p-2 flex flex-col min-h-0">
          <div className="flex-1 bg-white border rounded-lg flex flex-col overflow-hidden shadow-sm min-h-0">
            <div className="px-3 py-2 border-b flex items-center justify-between flex-shrink-0">
              <div>
                <p className="text-sm font-semibold text-foreground">{activeTab === "output" && result ? "Optimized network" : "Input network"}</p>
                <p className="text-xs text-muted-foreground">{activeTab === "output" && result ? `${result.openWarehouseIds.length} open sites · ${result.assignments.length} customers` : `26 warehouse candidates · ${dataset?.customers.length ?? 0} customers`}</p>
              </div>
              <div className="flex items-center gap-3">
                {result && (
                  <div className="flex items-center gap-1.5">
                    <Switch
                      id="show-routes"
                      checked={showRoutes}
                      onCheckedChange={setShowRoutes}
                      disabled={activeTab !== "output"}
                      data-testid="switch-show-routes"
                    />
                    <Label htmlFor="show-routes" className="text-xs text-muted-foreground">Show routes</Label>
                  </div>
                )}
                <div className="flex rounded border border-border overflow-hidden text-xs">
                  <button
                    data-testid="button-tab-input"
                    onClick={() => setActiveTab("input")}
                    className={`px-3 py-1 transition-colors ${activeTab === "input" ? "bg-primary text-white" : "bg-white text-foreground hover:bg-muted"}`}
                  >Input</button>
                  <button
                    data-testid="button-tab-output"
                    onClick={() => { if (result) setActiveTab("output"); }}
                    disabled={!result}
                    className={`px-3 py-1 transition-colors ${activeTab === "output" ? "bg-primary text-white" : result ? "bg-white text-foreground hover:bg-muted" : "bg-muted text-muted-foreground cursor-not-allowed"}`}
                  >Output</button>
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-0 relative">
              {dataset ? (
                <NetworkMap
                  dataset={dataset}
                  warehouseStatuses={localConfig?.warehouseStatuses ?? []}
                  result={activeTab === "output" ? result : null}
                  showRoutes={activeTab === "output" && showRoutes}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading map...</div>
              )}
            </div>
          </div>
        </main>

        {/* RIGHT PANEL — VALIDATE / RESULTS */}
        <aside className="w-[280px] flex-shrink-0 border-l bg-white overflow-y-auto flex flex-col">
          {result && activeTab === "output" ? (
            <>
              <div className="px-3 py-2 border-b flex-shrink-0">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-primary">Results · Steps 3-4</span>
              </div>

              {/* Status pill */}
              <div className="px-3 py-3 border-b">
                <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-full border ${
                  result.status === "optimal" ? "text-green-700 bg-green-50 border-green-200" :
                  result.status === "infeasible" ? "text-red-600 bg-red-50 border-red-200" :
                  "text-amber-600 bg-amber-50 border-amber-200"
                }`} data-testid="result-status">
                  <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: result.status === "optimal" ? "#16A34A" : result.status === "infeasible" ? "#DC2626" : "#F59E0B" }} />
                  {result.status === "optimal" ? "Optimal" : result.status === "infeasible" ? "Infeasible" : "Error"}
                </span>
              </div>

              {result.status === "infeasible" ? (
                <div className="px-3 py-3 border-b">
                  <div className="bg-red-50 border border-red-200 rounded p-3">
                    <p className="text-xs font-semibold text-red-700 mb-1">Cannot solve</p>
                    <p className="text-xs text-red-600">{result.infeasibilityReason}</p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Headline metric */}
                  <div className="px-3 py-4 border-b">
                    <div className="flex items-end gap-1" data-testid="result-weighted-avg-distance">
                      <span className="text-3xl font-bold text-foreground">{result.weightedAvgDistanceMi.toFixed(1)}</span>
                      <span className="text-base text-muted-foreground mb-0.5">miles</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">Weighted-average distance</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      Objective {result.objective.toExponential(2)} · Run {result.runTimeSec.toFixed(2)}s · {result.solverUsed}
                    </p>
                  </div>

                  {/* Band coverage */}
                  <div className="px-3 py-3 border-b space-y-2">
                    <p className="text-xs font-semibold text-foreground">Demand served within band</p>
                    {result.bandCoverage.map((bc, i) => (
                      <div key={bc.band} className="space-y-0.5" data-testid={`result-band-${bc.band}`}>
                        <div className="flex justify-between">
                          <span className="text-[10px] text-muted-foreground">&lt; {bc.band.toLocaleString()} mi</span>
                          <span className="text-[10px] font-semibold" style={{ color: getBandColor(i) }}>{bc.percent}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${bc.percent}%`, backgroundColor: getBandColor(i) }} />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Utilization */}
                  <div className="px-3 py-3 space-y-2">
                    <div className="flex items-center gap-1">
                      <p className="text-xs font-semibold text-foreground">Open warehouses · utilization</p>
                      <Badge variant="outline" className="text-[9px] border-[#7C3AED]/30 bg-[#7C3AED]/5 text-[#7C3AED] px-1 py-0">violet</Badge>
                    </div>
                    {result.utilization.map(u => (
                      <div key={u.warehouseId} className="space-y-0.5" data-testid={`result-util-${u.warehouseId}`}>
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-1">
                            <svg width="10" height="10" viewBox="0 0 24 24"><polygon points="12,2 22,20 2,20" fill="#16A34A" stroke="#16A34A" strokeWidth="2" /></svg>
                            <span className="text-[10px] text-foreground">{u.city}</span>
                          </div>
                          <span className="text-[10px] font-semibold text-[#7C3AED]">{u.utilization}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(u.utilization, 100)}%`, backgroundColor: "#7C3AED" }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div className="px-3 py-2 border-b flex-shrink-0">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-primary">Validate · Pre-Solve</span>
              </div>

              {/* Data integrity */}
              <div className="px-3 py-3 border-b space-y-2">
                <div className="flex items-center gap-1">
                  <p className="text-xs font-semibold text-foreground">Data integrity</p>
                  <Badge variant="outline" className="text-[9px] text-primary border-primary/30 bg-primary/5 px-1 py-0">tiddat</Badge>
                </div>
                {[
                  "Schema & types valid",
                  "Foreign keys: demand→customer, distance→(w,c)",
                  "Demand ≥ 0 (200 / 200 rows)",
                  "Distance ≥ 0 (5,200 / 5,200 pairs)",
                  "No duplicate keys",
                  "Distance bands strictly ascending",
                ].map(item => (
                  <div key={item} className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
                    <Check className="w-3 h-3 text-green-600 flex-shrink-0 mt-0.5" />
                    {item}
                  </div>
                ))}
              </div>

              {/* Blocking errors */}
              {blockingErrors.length > 0 && (
                <div className="px-3 py-3 border-b space-y-2">
                  <div className="flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 text-destructive" />
                    <p className="text-xs font-semibold text-destructive">Errors · must fix</p>
                  </div>
                  {blockingErrors.map((err, i) => (
                    <div key={i} className="bg-red-50 border border-red-200 rounded p-2" data-testid={`error-${i}`}>
                      <p className="text-xs font-semibold text-red-700">{err.title}</p>
                      <p className="text-[10px] text-red-600 mt-0.5">{err.desc}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Warnings */}
              {warnings.length > 0 && (
                <div className="px-3 py-3 border-b space-y-2">
                  <div className="flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                    <p className="text-xs font-semibold text-amber-700">Warnings · solve allowed</p>
                  </div>
                  {warnings.map((w, i) => (
                    <div key={i} className="bg-amber-50 border border-amber-200 rounded p-2" data-testid={`warning-${i}`}>
                      <p className="text-[10px] text-amber-700">{w.title}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Footer */}
              <div className="px-3 py-3 mt-auto">
                {hasErrors ? (
                  <p className="text-xs text-destructive font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Fix {blockingErrors.length} error{blockingErrors.length !== 1 ? "s" : ""} to enable Solve
                  </p>
                ) : (
                  <p className="text-xs text-green-700 flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" />
                    Ready to solve
                  </p>
                )}
              </div>
            </>
          )}
        </aside>
      </div>

      {/* Close dropdown on outside click */}
      {showScenarioDropdown && (
        <div className="fixed inset-0 z-40" onClick={() => setShowScenarioDropdown(false)} />
      )}

      {/* Create scenario dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New scenario</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Scenario name</Label>
              <Input
                value={newScenarioName}
                onChange={e => setNewScenarioName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleCreateConfirm(); }}
                placeholder="e.g. 5 Warehouses – West Coast"
                className="text-sm"
                autoFocus
                data-testid="input-new-scenario-name"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Starts with P = 3, CBC solver, default settings. You can change everything in the configure panel.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCreateConfirm}
              disabled={createScenario.isPending}
              data-testid="button-create-confirm"
            >
              {createScenario.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
