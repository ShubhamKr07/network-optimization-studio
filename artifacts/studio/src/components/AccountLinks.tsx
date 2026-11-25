import { useState } from "react";
import { Link } from "wouter";
import { DeleteAccountDialog } from "@/components/DeleteAccountDialog";

const MONO = "var(--app-font-mono)";

// WQF-B — lives in the home footer, deliberately far from the header's Log out
// button (spec B5), so a destructive action cannot be hit by a near-miss.
export function AccountLinks() {
  const [open, setOpen] = useState(false);
  const style = { color: "var(--text-brand)" };
  return (
    <div data-testid="account-links" className="mt-2 flex items-center justify-center gap-1.5"
      style={{ fontFamily: MONO, fontSize: "11px", letterSpacing: "0.08em", color: "var(--text-muted)" }}>
      <Link href="/terms" className="underline" style={style} data-testid="link-terms">Terms</Link>
      <span aria-hidden>·</span>
      <Link href="/privacy" className="underline" style={style} data-testid="link-privacy">Privacy</Link>
      <span aria-hidden>·</span>
      <button type="button" className="underline" style={style} onClick={() => setOpen(true)} data-testid="link-delete-account">
        Delete my account
      </button>
      <DeleteAccountDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
