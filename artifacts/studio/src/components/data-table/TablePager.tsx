// SCU-2.P1 (spec B2.2 "Paging") — Prev / "Page X of Y" / Next. Markup and
// classes are DistancesTab's `Pager` (DistancesTab.tsx:203-243) so a migrated
// table looks the same; testids are passed literally per table.

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface TablePagerTestIds {
  pager?: string;
  prev?: string;
  next?: string;
  indicator?: string;
}

export interface TablePagerProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  testIds?: TablePagerTestIds;
  className?: string;
}

export function TablePager({ page, pageCount, onPageChange, testIds = {}, className }: TablePagerProps) {
  return (
    <div className={cn("flex items-center justify-end gap-2 mt-1 text-xs", className)} data-testid={testIds.pager}>
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2 text-xs"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        data-testid={testIds.prev}
      >
        Prev
      </Button>
      <span className="font-mono text-[11px] text-muted-foreground" data-testid={testIds.indicator}>
        Page {page} of {pageCount}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2 text-xs"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
        data-testid={testIds.next}
      >
        Next
      </Button>
    </div>
  );
}
