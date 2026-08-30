import { useState } from "react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";

export interface StationOverride { id: string; demand?: number | null; }

interface StationRow { id: string; city: string; state: string; lat: number; lng: number; zip?: string; }

interface StationTableProps {
  stations: StationRow[];
  overrides: StationOverride[];
  onChange: (next: StationOverride[]) => void;
}

export function StationTable({ stations, overrides, onChange }: StationTableProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const getOverride = (id: string) => overrides.find(o => o.id === id);

  function upsert(id: string, demand: number | null) {
    const rest = overrides.filter(o => o.id !== id);
    onChange(demand == null ? rest : [...rest, { id, demand }]);
  }

  return (
    <div className="max-h-[60vh] overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>City</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Latitude</TableHead>
            <TableHead>Longitude</TableHead>
            {stations.some(s => s.zip) && <TableHead>Zip</TableHead>}
            <TableHead>Demand override (tons)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stations.map(s => {
            const o = getOverride(s.id);
            return (
              <TableRow key={s.id}>
                <TableCell className="font-mono text-xs">{s.id}</TableCell>
                <TableCell className="text-xs">{s.city}</TableCell>
                <TableCell className="text-xs">{s.state}</TableCell>
                <TableCell className="text-xs font-mono">{s.lat.toFixed(4)}</TableCell>
                <TableCell className="text-xs font-mono">{s.lng.toFixed(4)}</TableCell>
                {stations.some(x => x.zip) && <TableCell className="text-xs">{s.zip ?? "—"}</TableCell>}
                <TableCell>
                  <Input
                    type="number"
                    min={0}
                    value={drafts[s.id] ?? String(o?.demand ?? "")}
                    onChange={e => {
                      const raw = e.target.value;
                      setDrafts(prev => ({ ...prev, [s.id]: raw }));
                      upsert(s.id, raw === "" ? null : Math.max(0, parseInt(raw, 10) || 0));
                    }}
                    className="h-7 text-xs w-32"
                    placeholder="base demand"
                    data-testid={`input-station-demand-${s.id}`}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
