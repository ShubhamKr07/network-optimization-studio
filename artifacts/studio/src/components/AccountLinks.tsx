import { useState } from "react";
import { Link } from "wouter";
import { Trash2 } from "lucide-react";
import { DeleteAccountDialog } from "@/components/DeleteAccountDialog";

// WQF-B — lives in the home footer, deliberately far from the header's Log out
// button (spec B5), so a destructive action cannot be hit by a near-miss.
export function AccountLinks() {
  const [open, setOpen] = useState(false);
  return (
    <nav data-testid="account-links" className="legal" aria-label="Account and legal">
      <Link href="/terms" data-testid="link-terms">Terms</Link>
      <Link href="/privacy" data-testid="link-privacy">Privacy</Link>
      <button type="button" className="btn-band danger" onClick={() => setOpen(true)} data-testid="link-delete-account">
        <Trash2 size={14} aria-hidden="true" /><span>Delete my account</span>
      </button>
      <DeleteAccountDialog open={open} onOpenChange={setOpen} />
    </nav>
  );
}
