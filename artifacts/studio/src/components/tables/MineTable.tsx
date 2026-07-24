import { useState } from "react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";

export interface MineOverride { id: string; capacity?: number | null; }

interface MineRow { id: string; city: string; state: string; }

interface MineTableProps {
  mines: MineRow[];
  overrides: MineOverride[];
  onChange: (next: MineOverride[]) => void;
}

export function MineTable({ mines, overrides, onChange }: MineTableProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const getOverride = (id: string) => overrides.find(o => o.id === id);

  function upsert(id: string, capacity: number | null) {
    const rest = overrides.filter(o => o.id !== id);
    onChange(capacity == null ? rest : [...rest, { id, capacity }]);
  }

  return (
    <div className="max-h-[60vh] overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>City, State</TableHead>
            <TableHead>Capacity override (tons)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {mines.map(m => {
            const o = getOverride(m.id);
            return (
              <TableRow key={m.id}>
                <TableCell className="font-mono text-xs">{m.id}</TableCell>
                <TableCell className="text-xs">{m.city}, {m.state}</TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min={0}
                    value={drafts[m.id] ?? String(o?.capacity ?? "")}
                    onChange={e => {
                      const raw = e.target.value;
                      setDrafts(prev => ({ ...prev, [m.id]: raw }));
                      upsert(m.id, raw === "" ? null : Math.max(0, parseInt(raw, 10) || 0));
                    }}
                    className="h-7 text-xs w-32"
                    placeholder="base capacity"
                    data-testid={`input-mine-capacity-${m.id}`}
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
