import { useEffect, useState, useMemo } from "react";
import { Link, useSearch } from "wouter";
import { 
  useListScenarios,
  useCompareScenarios,
  useGetDataset,
  useGetScenario
} from "@workspace/api-client-react";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { OverlayMap } from "@/components/OverlayMap";
import type { ScenarioMetrics, SolveResult, Scenario } from "@workspace/api-client-react";

export function Compare() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const currentScenarioId = params.get("scenario") ? parseInt(params.get("scenario")!, 10) : undefined;

  const { data: scenarios, isLoading: isScenariosLoading } = useListScenarios();
  const { data: dataset, isLoading: isDatasetLoading } = useGetDataset();
  
  const compareMutation = useCompareScenarios();
  
  const [metrics, setMetrics] = useState<ScenarioMetrics[]>([]);
  const [isDeltaView, setIsDeltaView] = useState(false);

  // Overlay Map State
  const [overlayMode, setOverlayMode] = useState<"before" | "after" | "overlay">("overlay");

  const solvedScenarios = useMemo(() => {
    return (scenarios || []).filter(s => s.result !== null).sort((a, b) => a.pValue - b.pValue);
  }, [scenarios]);

  useEffect(() => {
    if (solvedScenarios.length > 0 && metrics.length === 0 && !compareMutation.isPending) {
      compareMutation.mutate({
        data: { scenarioIds: solvedScenarios.map(s => s.id) }
      }, {
        onSuccess: (res) => {
          setMetrics(res.scenarios);
        }
      });
    }
  }, [solvedScenarios, metrics.length, compareMutation]);

  const bestDistance = Math.min(...metrics.map(m => m.weightedAvgDistanceMi));
  const bestObjective = Math.min(...metrics.map(m => m.objective));
  const bestUtilization = Math.max(...metrics.map(m => m.avgUtilization));

  // Determine before and after scenarios for the overlay
  // We'll pick the first two sorted by P value if available
  const beforeScenarioMeta = solvedScenarios.length >= 2 ? solvedScenarios[0] : null;
  const afterScenarioMeta = solvedScenarios.length >= 2 ? solvedScenarios[1] : null;

  const formatDelta = (val: number, isImprovement: boolean) => {
    const sign = val > 0 ? "+" : "";
    const color = isImprovement ? "text-green-600" : (val > 0 ? "text-red-600" : "");
    return <span className={color}>{sign}{val}</span>;
  };

  const getBands = () => {
    if (!metrics.length) return [];
    return metrics[0].bandDemandPercent.map(b => b.band);
  };

  const bands = getBands();

  if (isScenariosLoading || isDatasetLoading) {
    return <div className="p-8"><Skeleton className="w-full h-14 mb-4" /><Skeleton className="w-full h-96" /></div>;
  }

  if (solvedScenarios.length < 2) {
    return (
      <div className="p-8">
        <Link href={currentScenarioId ? `/?scenario=${currentScenarioId}` : "/"} className="inline-flex items-center text-sm font-medium text-primary hover:underline mb-6">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Link>
        <div className="bg-slate-50 border rounded-lg p-8 text-center">
          <h2 className="text-lg font-bold mb-2">Not enough solved scenarios</h2>
          <p className="text-muted-foreground">You need at least two solved scenarios to compare them. Go back and run the solver on more scenarios.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 overflow-y-auto">
      <div className="max-w-7xl mx-auto p-6">
        <header className="mb-8">
          <Link href={currentScenarioId ? `/?scenario=${currentScenarioId}` : "/"} className="inline-flex items-center text-sm font-medium text-primary hover:underline mb-4">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Link>
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Compare Scenarios</h1>
              <p className="text-sm text-muted-foreground mt-1">Step 5</p>
            </div>
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-md border shadow-sm">
              <Switch id="delta-view" checked={isDeltaView} onCheckedChange={setIsDeltaView} />
              <Label htmlFor="delta-view" className="text-xs font-semibold cursor-pointer">Delta view</Label>
            </div>
          </div>
        </header>

        {metrics.length > 0 ? (
          <div className="bg-white border rounded-xl shadow-sm overflow-hidden mb-8">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b bg-slate-50/50">
                  <th className="py-4 px-4 font-medium text-muted-foreground w-48">Metric</th>
                  {metrics.map(m => {
                    const isCurrent = m.scenarioId === currentScenarioId;
                    const isLowestDist = m.weightedAvgDistanceMi === bestDistance;
                    return (
                      <th key={m.scenarioId} className="py-4 px-4 border-l min-w-[200px] align-top">
                        <div className="font-bold text-slate-900 text-base mb-2">{m.name}</div>
                        <div className="flex flex-wrap gap-1">
                          {isCurrent && <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Current</Badge>}
                          {isLowestDist && <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Lowest distance</Badge>}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr>
                  <td className="py-3 px-4 font-medium text-slate-700">Open sites</td>
                  {metrics.map((m, i) => (
                    <td key={m.scenarioId} className="py-3 px-4 border-l">
                      <div className="truncate max-w-[200px]" title={m.openSites.join(" · ")}>
                        {m.openSites.join(" · ")}
                      </div>
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-3 px-4 font-medium text-slate-700">Weighted-avg distance</td>
                  {metrics.map((m, i) => {
                    const base = metrics[0].weightedAvgDistanceMi;
                    const isBest = m.weightedAvgDistanceMi === bestDistance;
                    return (
                      <td key={m.scenarioId} className={`py-3 px-4 border-l font-semibold ${isBest && !isDeltaView ? 'text-green-600 bg-green-50/30' : ''}`}>
                        {isDeltaView && i > 0 
                          ? formatDelta(+(m.weightedAvgDistanceMi - base).toFixed(1), m.weightedAvgDistanceMi < base)
                          : `${m.weightedAvgDistanceMi.toFixed(1)} mi`}
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <td className="py-3 px-4 font-medium text-slate-700">Total objective</td>
                  {metrics.map((m, i) => {
                    const base = metrics[0].objective;
                    const isBest = m.objective === bestObjective;
                    return (
                      <td key={m.scenarioId} className={`py-3 px-4 border-l font-medium ${isBest && !isDeltaView ? 'text-green-600 bg-green-50/30' : ''}`}>
                        {isDeltaView && i > 0
                          ? formatDelta(+(m.objective - base), m.objective < base)
                          : m.objective.toExponential(2)}
                      </td>
                    );
                  })}
                </tr>
                {bands.map((band, bandIdx) => (
                  <tr key={`band-${band}`}>
                    <td className="py-3 px-4 font-medium text-slate-700">Demand &lt; {band} mi</td>
                    {metrics.map((m, i) => {
                      const val = m.bandDemandPercent.find(b => b.band === band)?.percent || 0;
                      const baseVal = metrics[0].bandDemandPercent.find(b => b.band === band)?.percent || 0;
                      const bestVal = Math.max(...metrics.map(met => met.bandDemandPercent.find(b => b.band === band)?.percent || 0));
                      const isBest = val === bestVal;
                      return (
                        <td key={m.scenarioId} className={`py-3 px-4 border-l font-medium ${isBest && !isDeltaView ? 'text-green-600 bg-green-50/30' : ''}`}>
                          {isDeltaView && i > 0
                            ? formatDelta(+(val - baseVal).toFixed(1), val > baseVal)
                            : `${val.toFixed(1)}%`}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <td className="py-3 px-4 font-medium text-slate-700">Avg utilization</td>
                  {metrics.map((m, i) => {
                    const base = metrics[0].avgUtilization;
                    const isBest = m.avgUtilization === bestUtilization;
                    return (
                      <td key={m.scenarioId} className={`py-3 px-4 border-l font-medium ${isBest && !isDeltaView ? 'text-green-600 bg-green-50/30' : ''}`}>
                        {isDeltaView && i > 0
                          ? formatDelta(+(m.avgUtilization - base).toFixed(0), m.avgUtilization > base)
                          : `${m.avgUtilization.toFixed(0)}%`}
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <td className="py-3 px-4 font-medium text-slate-700">Solver status</td>
                  {metrics.map(m => (
                    <td key={m.scenarioId} className="py-3 px-4 border-l">
                      {m.solverStatus === "optimal" ? "Optimal" : "—"}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center"><Skeleton className="w-full h-64" /></div>
        )}

        {beforeScenarioMeta && afterScenarioMeta && beforeScenarioMeta.result && afterScenarioMeta.result && dataset && (
          <div className="mb-12">
            <div className="mb-6">
              <h2 className="text-xl font-bold text-slate-900">Before / After Overlay</h2>
              <p className="text-sm text-muted-foreground mt-1">Step 4 extra · how the network reshapes going from {beforeScenarioMeta.pValue} to {afterScenarioMeta.pValue} warehouses</p>
            </div>
            
            <div className="grid grid-cols-3 gap-6">
              <div className="col-span-2 bg-white border rounded-xl shadow-sm flex flex-col h-[500px] overflow-hidden">
                <div className="p-3 border-b flex justify-center bg-slate-50/50">
                  <div className="flex bg-slate-200/50 p-1 rounded-lg">
                    <button 
                      className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${overlayMode === "before" ? "bg-white shadow-sm text-slate-900" : "text-slate-600 hover:text-slate-900"}`}
                      onClick={() => setOverlayMode("before")}
                    >
                      Before ({beforeScenarioMeta.pValue} WH)
                    </button>
                    <button 
                      className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${overlayMode === "after" ? "bg-white shadow-sm text-slate-900" : "text-slate-600 hover:text-slate-900"}`}
                      onClick={() => setOverlayMode("after")}
                    >
                      After ({afterScenarioMeta.pValue} WH)
                    </button>
                    <button 
                      className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${overlayMode === "overlay" ? "bg-white shadow-sm text-slate-900" : "text-slate-600 hover:text-slate-900"}`}
                      onClick={() => setOverlayMode("overlay")}
                    >
                      Overlay
                    </button>
                  </div>
                </div>
                <div className="flex-1 relative z-0">
                  <OverlayMap 
                    dataset={dataset}
                    beforeResult={beforeScenarioMeta.result}
                    afterResult={afterScenarioMeta.result}
                    mode={overlayMode}
                  />
                </div>
              </div>
              
              <div className="col-span-1 flex flex-col gap-4">
                <div className="bg-white border rounded-xl shadow-sm p-5">
                  <h3 className="font-bold text-base mb-1">What changed</h3>
                  <p className="text-xs text-muted-foreground mb-4">{beforeScenarioMeta.pValue} → {afterScenarioMeta.pValue} warehouses</p>
                  
                  <div className="space-y-4">
                    {/* Just some static calculation logic for demo based on differences */}
                    {(() => {
                      const bSet = new Set(beforeScenarioMeta.result!.openWarehouseIds);
                      const newWHs = afterScenarioMeta.result!.openWarehouseIds.filter(id => !bSet.has(id));
                      const newWHCities = newWHs.map(id => dataset.warehouses.find(w => w.id === id)?.city).join(", ");
                      
                      const bAvg = beforeScenarioMeta.result!.weightedAvgDistanceMi;
                      const aAvg = afterScenarioMeta.result!.weightedAvgDistanceMi;
                      const distDiff = aAvg - bAvg;
                      const distPct = (distDiff / bAvg) * 100;
                      
                      const reassignedCount = dataset.customers.filter(c => {
                        const bAss = beforeScenarioMeta.result!.assignments.find(a => a.customerId === c.id);
                        const aAss = afterScenarioMeta.result!.assignments.find(a => a.customerId === c.id);
                        return bAss?.warehouseId !== aAss?.warehouseId;
                      }).length;

                      const bUtil = beforeScenarioMeta.result!.utilization.reduce((sum, u) => sum + u.utilization, 0) / beforeScenarioMeta.result!.utilization.length;
                      const aUtil = afterScenarioMeta.result!.utilization.reduce((sum, u) => sum + u.utilization, 0) / afterScenarioMeta.result!.utilization.length;

                      return (
                        <>
                          {newWHs.length > 0 && (
                            <div className="p-3 bg-blue-50/50 border border-blue-100 rounded-lg">
                              <h4 className="font-semibold text-blue-700 text-sm">+{newWHs.length} warehouse{newWHs.length > 1 ? 's' : ''}: {newWHCities}</h4>
                              <p className="text-xs text-blue-600/80 mt-1">New capacity region established</p>
                            </div>
                          )}
                          
                          <div className="p-3 bg-slate-50 border rounded-lg">
                            <h4 className="font-semibold text-slate-800 text-sm">{reassignedCount} customers reassigned</h4>
                            <p className="text-xs text-muted-foreground mt-1">Pulled off existing routes</p>
                          </div>
                          
                          <div className={`p-3 border rounded-lg ${distDiff < 0 ? 'bg-green-50/50 border-green-100' : 'bg-red-50/50 border-red-100'}`}>
                            <h4 className={`font-semibold text-sm ${distDiff < 0 ? 'text-green-700' : 'text-red-700'}`}>
                              {distDiff < 0 ? '' : '+'}{distPct.toFixed(1)}% weighted-avg distance
                            </h4>
                            <p className={`text-xs mt-1 ${distDiff < 0 ? 'text-green-600/80' : 'text-red-600/80'}`}>
                              {bAvg.toFixed(1)} mi → {aAvg.toFixed(1)} mi
                            </p>
                          </div>
                          
                          <div className={`p-3 border rounded-lg ${aUtil < bUtil ? 'bg-amber-50/50 border-amber-100' : 'bg-slate-50'}`}>
                            <h4 className={`font-semibold text-sm ${aUtil < bUtil ? 'text-amber-800' : 'text-slate-800'}`}>
                              Avg utilization: {(bUtil*100).toFixed(1)}% → {(aUtil*100).toFixed(1)}%
                            </h4>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
