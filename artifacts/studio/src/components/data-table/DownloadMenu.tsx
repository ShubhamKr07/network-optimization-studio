// SCU-2.P3 (spec B2.4) — the "Download ▾" control every migrated Workspace
// table puts in its DataTable toolbar (P4 input tables reuse it). One trigger,
// three items: CSV, JSON and XLSX (QFX-2a). Testids are passed literally per table (nothing is
// derived). Built on the Popover FilterMenu already uses, so it opens on a
// plain click (fireEvent.click works in jsdom) and closes on Escape /
// outside click for free. `disabledReason` disables the TRIGGER and is its
// tooltip, exactly as the single Download CSV buttons it replaces did.

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type DownloadFormat = "csv" | "json" | "xlsx";

export interface DownloadMenuProps {
  /** data-testid on the trigger button. */
  testId: string;
  /** data-testid on each menu item. */
  itemTestIds: Record<DownloadFormat, string>;
  onDownload: (format: DownloadFormat) => void;
  /** Non-null disables the trigger; shown as its title. */
  disabledReason?: string;
  /** SCU-2.P4.1 — trigger text. Default "Download"; the input tables' Upload ▾ passes "Upload". */
  label?: string;
  /** SCU-2.P4.1 — rendered under the items (the input tables' expected-fields panel). */
  children?: ReactNode;
}

const ITEMS: Array<{ format: DownloadFormat; label: string }> = [
  { format: "csv", label: "CSV" },
  { format: "json", label: "JSON" },
  { format: "xlsx", label: "XLSX" },
];

export function DownloadMenu({ testId, itemTestIds, onDownload, disabledReason, label = "Download", children }: DownloadMenuProps) {
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
          {label}
          <ChevronDown className="w-3.5 h-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={children ? "w-[30rem] max-w-[90vw] p-1" : "w-32 p-1"} align="end">
        {ITEMS.map(({ format, label: itemLabel }) => (
          <button
            key={format}
            type="button"
            className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-muted"
            data-testid={itemTestIds[format]}
            onClick={() => {
              setOpen(false);
              onDownload(format);
            }}
          >
            {itemLabel}
          </button>
        ))}
        {children && <div className="mt-1 border-t pt-1">{children}</div>}
      </PopoverContent>
    </Popover>
  );
}
