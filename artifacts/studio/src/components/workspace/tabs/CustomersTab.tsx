import type { Customer } from "@workspace/api-client-react";
import { CustomerTable, type CustomerOverride } from "@/components/tables/CustomerTable";

interface CustomersTabProps {
  customers: Customer[];
  overrides: CustomerOverride[];
  onChange: (next: CustomerOverride[]) => void;
}

// A1.1 — thin Workspace-tab wrapper around the existing CustomerTable (built
// for Studio.tsx's Overrides dialog, D3.1). Re-homed as-is, no fork.
export function CustomersTab({ customers, overrides, onChange }: CustomersTabProps) {
  if (customers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="customers-tab-empty">
        No customers in this dataset.
      </p>
    );
  }

  return (
    <div data-testid="customers-tab">
      <CustomerTable customers={customers} overrides={overrides} onChange={onChange} />
    </div>
  );
}
