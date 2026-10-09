import { ReactNode } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useLogoutUser, getGetCurrentAuthUserQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { AppFooter } from "@/components/AppFooter";
import coverUrl from "@/assets/book-cover.jpg";
import { DeveloperCredit } from "@/components/DeveloperCredit";
import { FeedbackWidget } from "@/components/FeedbackWidget";
import { NetworkBackground } from "@/components/NetworkBackground";
import { resetUser } from "@/lib/analytics";
import { clearErrorUser } from "@/lib/errorTracking";
import { toast } from "@/hooks/use-toast";
import { describeWriteError } from "@/lib/describeWriteError";

interface AppShellProps {
  userEmail: string;
  children: ReactNode;
  heroTitle?: string;
  hero?: boolean;
}

export function AppShell({ userEmail, children, heroTitle, hero }: AppShellProps) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const logoutUser = useLogoutUser();

  function handleLogout() {
    logoutUser.mutate(undefined, {
      onSuccess: () => {
        // Same class of bug as Login.tsx/Register.tsx, mirrored: navigating
        // to "/login" immediately used to race Gate()'s auth-gated render
        // against an async invalidate+refetch. Gate() would still see the
        // (stale) logged-in user, render AuthedRouter for the new "/login"
        // URL, and AuthedRouter has no "/login" route — 404. Clear the
        // cache synchronously instead of waiting on a refetch.
        queryClient.setQueryData(getGetCurrentAuthUserQueryKey(), { user: null });
        resetUser();
        clearErrorUser();
        navigate("/login", { replace: true });
      },
      // WF-3 — the one mutation in this file (and, before this, in all of
      // src/) with no failure surface at all: a 500 or dropped connection
      // left the student still signed in, still looking at the header they
      // just clicked, with no toast and no navigation — easy to read as "I'm
      // logged out" on a shared lab machine. A toast matches every other
      // write-failure surface in the app (see Workspace.tsx's mutation
      // sites) rather than inventing an inline affordance for this one
      // header; the fallback names the STATE the student is actually in
      // (still signed in), not the HTTP detail, since that's what they need
      // to act on.
      onError: err => {
        toast({
          title: "Couldn't log you out",
          description: describeWriteError(err, "You are still signed in. Try again."),
          variant: "destructive",
        });
      },
    });
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {hero ? (
        <header className="scnd-band flex-shrink-0">
          <div className="max-w-[860px] mx-auto px-6 py-[30px] flex items-start gap-4">
            <img src={coverUrl} alt="" className="h-24 w-auto rounded-sm flex-shrink-0" style={{ boxShadow: "0 4px 12px rgba(0,0,0,.4)" }} />
            <div className="flex-1 min-w-0">
              <div className="scnd-kicker">Optimization Studio by Prof. Michael Watson</div>
              <div className="scnd-display font-bold" style={{ fontSize: "32px", lineHeight: 1.1, color: "var(--green-400)" }}>{heroTitle}</div>
              <div className="mt-2" style={{ fontSize: "13px", color: "var(--ink-300)" }} data-testid="hero-tagline">
                Build a scenario on the map, solve it with a real optimizer, compare the results.
              </div>
            </div>
            {/* ch4-fixes item 1 — no UnitToggle on the homepage. The toggle
                lives only where distances are actually edited/compared
                (Workspace's own header); Landing's Recent Solves render in
                whatever preference was last persisted (default "auto" = each
                model's own canonical unit). */}
            <div className="flex items-center gap-2.5 flex-shrink-0">
              <span className="text-sm" style={{ color: "var(--ink-300)" }} data-testid="text-user-email">{userEmail}</span>
              <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout"
                className="hover:bg-white/10 hover:text-[color:var(--surface-band-fg)]"
                style={{ color: "var(--ink-300)" }}>Log out</Button>
            </div>
          </div>
        </header>
      ) : (
        <header className="scnd-band flex-shrink-0 flex items-center gap-3 px-4 py-3">
          <div className="flex-1 min-w-0">
            <div className="scnd-kicker">Optimization Studio by Prof. Michael Watson</div>
            {heroTitle
              ? <div className="scnd-display text-lg font-semibold" style={{ color: "var(--green-400)" }}>{heroTitle}</div>
              : <div className="scnd-display text-sm font-semibold" style={{ color: "var(--surface-band-fg)" }}>SCND Optimization Studio</div>}
          </div>
          <span className="text-sm" style={{ color: "var(--ink-300)" }} data-testid="text-user-email">{userEmail}</span>
          <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout"
            className="hover:bg-white/10 hover:text-[color:var(--surface-band-fg)]"
            style={{ color: "var(--ink-300)" }}>
            Log out
          </Button>
        </header>
      )}
      {/* COSM-5 — one relative wrapper owns the scroll area's stacking
          context, so the background canvas (z-0) sits behind <main> (z-10). */}
      <div className="flex-1 min-h-0 relative">
        {hero && <NetworkBackground />}
        <main className="absolute inset-0 overflow-y-auto z-10">{children}</main>
      </div>
      {hero
        ? // The feedback launcher is docked in the footer, NOT in the scroll
          // wrapper above. Floating it there put it over a chapter card at
          // 768-900px, and because it did not scroll, content passed under it
          // at any width. Anchored to the footer — which is outside the scroll
          // area and always visible — it cannot overlap content at all.
          // QF-2: it now sits in normal flow ABOVE the credit line rather than
          // absolutely positioned beside it, so the two never compete for the
          // same horizontal space at narrow widths. The footer no longer needs
          // to be a positioning context — the widget supplies its own, for its
          // panel only.
          <footer data-testid="homepage-credit-footer" className="flex-shrink-0 border-t bg-background px-6 py-3 text-center" style={{ borderColor: "var(--line)" }}>
            <FeedbackWidget />
            <DeveloperCredit />
          </footer>
        : <AppFooter />}
    </div>
  );
}
