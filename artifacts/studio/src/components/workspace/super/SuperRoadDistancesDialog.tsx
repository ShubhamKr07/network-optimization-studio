import { useFetchScenarioRoadDistances, RoadDistancesErrorCode } from "@workspace/api-client-react";
import type { Scenario } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { describeWriteError } from "@/lib/describeWriteError";

/** A road error carries its own sentence (`message`); `error` is a closed code (spec §8), never shown raw. */
export function describeRoadError(err: unknown): string {
  const data = (err as { data?: { error?: unknown; message?: unknown } } | null)?.data;
  if (data && typeof data.error === "string" && (Object.values(RoadDistancesErrorCode) as string[]).includes(data.error) && typeof data.message === "string") return data.message;
  return describeWriteError(err, "Could not fetch road distances.");
}

export interface SuperRoadDistancesDialogProps { open: boolean; onOpenChange(o: boolean): void; scenarioId: number; onApplied(s: Scenario): void }

export function SuperRoadDistancesDialog({ open, onOpenChange, scenarioId, onApplied }: SuperRoadDistancesDialogProps) {
  const fetchRoad = useFetchScenarioRoadDistances();
  const close = (o: boolean) => { if (!o) fetchRoad.reset(); onOpenChange(o); };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent data-testid="super-road-dialog" className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Fetch road distances</DialogTitle></DialogHeader>
        <div className="space-y-2 text-sm">
          <p data-testid="super-road-privacy">
            This sends the plant, warehouse and customer coordinates of this scenario to OpenRouteService (openrouteservice.org),
            which returns truck (driving-hgv) road distances. Names and demand are not sent.
          </p>
          <p className="text-xs text-muted-foreground">It can take up to two minutes. Distance overrides still win over road distances.</p>
          {fetchRoad.isError && <p className="text-xs text-destructive" data-testid="super-road-error">{describeRoadError(fetchRoad.error)}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => close(false)}>Cancel</Button>
          <Button size="sm" disabled={fetchRoad.isPending} data-testid="super-road-confirm"
            onClick={() => fetchRoad.mutate({ scenarioId }, {
              onSuccess: ({ scenario }) => { toast({ title: "Road distances fetched" }); onApplied(scenario); close(false); },
            })}>
            {fetchRoad.isPending ? "Fetching…" : "Send and fetch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
