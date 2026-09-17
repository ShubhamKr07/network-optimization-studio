// A3 (JADE Ch.9 Workspace Bundle, spec §10) — a reusable, generic filter
// popover paired with `lib/useTableFilters.ts`. One control per
// `ColumnFilterDescriptor`, rendered by its `type` (`text` → free-text input,
// `select` → multi-select checkbox list of distinct values, `number` → an
// inclusive min/max range), a per-filter clear affordance, a clear-all
// button, and a "{filteredCount} of {totalCount}" count line.
//
// IMPORTANT — this component does NOT decide its own visibility. Per spec
// §10, the caller (a `*Tab.tsx`) is responsible for rendering `<FilterMenu>`
// only when the table actually has enough rows to warrant it — the
// established threshold across this bundle's tasks is `totalCount > 10`.
// `FilterMenu` itself has no opinion on row count and will render
// unconditionally whenever mounted.

import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ColumnFilterDescriptor, FilterState, FilterValue, UseTableFiltersResult } from "@/lib/useTableFilters";

export interface FilterMenuProps<T> {
  descriptors: ColumnFilterDescriptor<T>[];
  /** The live result of `useTableFilters(rows, descriptors)` — `FilterMenu`
   * reads `filterState`/`distinctValuesByKey`/`totalCount`/`filteredCount`
   * from it and calls back through `setFilter`/`clearAll`. Passed as one
   * object (rather than each field individually) so a caller can spread its
   * existing `useTableFilters` return value straight in. */
  tableFilters: Pick<
    UseTableFiltersResult<T>,
    "filterState" | "setFilter" | "clearAll" | "totalCount" | "filteredCount" | "distinctValuesByKey"
  >;
  /** Trigger button label. Defaults to "Filter". */
  label?: string;
}

function isFilterActive(filter: FilterValue | undefined): boolean {
  if (!filter) return false;
  if (filter.type === "text") return filter.value.trim() !== "";
  if (filter.type === "select") return filter.values.length > 0;
  return filter.min !== undefined || filter.max !== undefined;
}

function activeFilterCount(filterState: FilterState): number {
  return Object.values(filterState).filter(isFilterActive).length;
}

export function FilterMenu<T>({ descriptors, tableFilters, label = "Filter" }: FilterMenuProps<T>) {
  const { filterState, setFilter, clearAll, totalCount, filteredCount, distinctValuesByKey } = tableFilters;
  const activeCount = activeFilterCount(filterState);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" data-testid="button-filter-menu-trigger">
          <Filter className="w-3.5 h-3.5" />
          {label}
          {activeCount > 0 && (
            <span
              className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground"
              data-testid="text-filter-active-count"
            >
              {activeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3" align="start" data-testid="filter-menu-popover">
        {descriptors.map(descriptor => {
          const filter = filterState[descriptor.key];
          const isActive = isFilterActive(filter);
          return (
            <div key={descriptor.key} className="space-y-1.5" data-testid={`filter-control-${descriptor.key}`}>
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium">{descriptor.label}</Label>
                {isActive && (
                  <button
                    type="button"
                    onClick={() => setFilter(descriptor.key, undefined)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Clear ${descriptor.label} filter`}
                    data-testid={`button-clear-filter-${descriptor.key}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {descriptor.type === "text" && (
                <Input
                  value={filter?.type === "text" ? filter.value : ""}
                  onChange={e => setFilter(descriptor.key, { type: "text", value: e.target.value })}
                  placeholder={`Filter ${descriptor.label.toLowerCase()}…`}
                  className="h-7 text-xs"
                  data-testid={`input-filter-${descriptor.key}`}
                />
              )}

              {descriptor.type === "select" && (
                <div className="max-h-40 overflow-y-auto space-y-1 pl-0.5" data-testid={`select-filter-${descriptor.key}`}>
                  {(distinctValuesByKey[descriptor.key] ?? []).map(value => {
                    const stringValue = String(value);
                    const selected = filter?.type === "select" ? filter.values : [];
                    const checked = selected.includes(stringValue);
                    return (
                      <label
                        key={stringValue}
                        className="flex items-center gap-1.5 text-xs cursor-pointer"
                        data-testid={`option-filter-${descriptor.key}-${stringValue}`}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={next => {
                            const nextValues = next
                              ? [...selected, stringValue]
                              : selected.filter(v => v !== stringValue);
                            setFilter(
                              descriptor.key,
                              nextValues.length > 0 ? { type: "select", values: nextValues } : undefined,
                            );
                          }}
                          data-testid={`checkbox-filter-${descriptor.key}-${stringValue}`}
                        />
                        <span>{stringValue}</span>
                      </label>
                    );
                  })}
                  {(distinctValuesByKey[descriptor.key] ?? []).length === 0 && (
                    <p className="text-[11px] text-muted-foreground">No values.</p>
                  )}
                </div>
              )}

              {descriptor.type === "number" && (
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    value={filter?.type === "number" && filter.min !== undefined ? filter.min : ""}
                    onChange={e => {
                      const raw = e.target.value;
                      const min = raw === "" ? undefined : Number(raw);
                      const max = filter?.type === "number" ? filter.max : undefined;
                      setFilter(
                        descriptor.key,
                        min !== undefined || max !== undefined ? { type: "number", min, max } : undefined,
                      );
                    }}
                    placeholder="Min"
                    className="h-7 text-xs w-full"
                    data-testid={`input-filter-${descriptor.key}-min`}
                  />
                  <span className="text-muted-foreground text-xs">–</span>
                  <Input
                    type="number"
                    value={filter?.type === "number" && filter.max !== undefined ? filter.max : ""}
                    onChange={e => {
                      const raw = e.target.value;
                      const max = raw === "" ? undefined : Number(raw);
                      const min = filter?.type === "number" ? filter.min : undefined;
                      setFilter(
                        descriptor.key,
                        min !== undefined || max !== undefined ? { type: "number", min, max } : undefined,
                      );
                    }}
                    placeholder="Max"
                    className="h-7 text-xs w-full"
                    data-testid={`input-filter-${descriptor.key}-max`}
                  />
                </div>
              )}
            </div>
          );
        })}

        <div className="flex items-center justify-between pt-2 border-t">
          <span className="text-[11px] text-muted-foreground" data-testid="text-filter-count">
            {filteredCount} of {totalCount}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={clearAll}
            disabled={activeCount === 0}
            data-testid="button-clear-all-filters"
          >
            Clear all
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
