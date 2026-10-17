// SCU-2.P3 (spec B2.4) — the "Download ▾" control every migrated Workspace
// table puts in its DataTable toolbar (P4 input tables reuse it). One trigger,
// two items: CSV and JSON. Testids are passed literally per table (nothing is
// derived). Built on the Popover FilterMenu already uses, so it opens on a
// plain click (fireEvent.click works in jsdom) and closes on Escape /
// outside click for free. `disabledReason` disables the TRIGGER and is its
// tooltip, exactly as the single Download CSV buttons it replaces did.

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type DownloadFormat = "csv" | "json";

export interface DownloadMenuProps {
  /** data-testid on the trigger button. */
  testId: string;
  /** data-testid on each menu item. */
  itemTestIds: Record<DownloadFormat, string>;
  onDownload: (format: DownloadFormat) => void;
  /** Non-null disables the trigger; shown as its title. */
  disabledReason?: string;
}

const ITEMS: Array<{ format: DownloadFormat; label: string }> = [
  { format: "csv", label: "CSV" },
  { format: "json", label: "JSON" },
];

export function DownloadMenu({ testId, itemTestIds, onDownload, disabledReason }: DownloadMenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          data-testid={testId}
          disabled={disabledReason != null}
          title={disabledReason}
        >
          Download
          <ChevronDown className="w-3.5 h-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-32 p-1" align="end" role="menu">
        {ITEMS.map(({ format, label }) => (
          <button
            key={format}
            type="button"
            role="menuitem"
            className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-muted"
            data-testid={itemTestIds[format]}
            onClick={() => {
              setOpen(false);
              onDownload(format);
            }}
          >
            {label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
