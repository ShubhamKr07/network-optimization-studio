import { ReactNode } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useLogoutUser, getGetCurrentAuthUserQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { AppFooter } from "@/components/AppFooter";
import coverUrl from "@/assets/book-cover.jpg";
import { DeveloperCredit } from "@/components/DeveloperCredit";
import { AccountLinks } from "@/components/AccountLinks";
import { FeedbackWidget } from "@/components/FeedbackWidget";
import { CoverBackdrop } from "@/components/cover/CoverBackdrop";
import "@/components/home/home.css";
import { LogOut, Loader2 } from "lucide-react";
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

  const logoutLabel = logoutUser.isPending
    ? <><Loader2 className="spin" size={14} aria-hidden="true" /><span>Logging out…</span></>
    : <><LogOut size={14} aria-hidden="true" /><span>Log out</span></>;

  if (hero) {
    return (
      <div className="home h-screen flex flex-col overflow-hidden">
        <header className="home-top flex-shrink-0">
          <div className="wrap">
            <div className="brand">
              <img src={coverUrl} alt="" className="thumb" />
              <div className="titles">
                <p className="name">{heroTitle ?? "Network Design Labs"}</p>
                <p className="offered">Offered by Michael Watson</p>
              </div>
            </div>
            {/* ch4-fixes item 1 — no UnitToggle on the homepage. The toggle
                lives only where distances are actually edited/compared
                (Workspace's own header); Landing's Recent Solves render in
                whatever preference was last persisted (default "auto" = each
                model's own canonical unit). */}
            <div className="who">
              <span className="email" title={userEmail} data-testid="text-user-email">{userEmail}</span>
              <button type="button" className="btn-band" onClick={handleLogout} disabled={logoutUser.isPending} data-testid="button-logout">
                {logoutLabel}
              </button>
            </div>
          </div>
        </header>
        <div className="cover-paper flex-1 min-h-0">
          <CoverBackdrop />
          <main className="absolute inset-0 overflow-y-auto z-10 flex flex-col">
            <div className="flex-1">{children}</div>
            {/* DU-2.8 — the footer scrolls with the content. QF-B: it is the
                positioning context for the feedback launcher, which floats just
                above this footer's top border line at the bottom-right. */}
            <footer data-testid="homepage-credit-footer" className="home-bottom">
              <FeedbackWidget />
              <div className="wrap">
                <DeveloperCredit />
                <AccountLinks />
              </div>
            </footer>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header className="scnd-band flex-shrink-0 flex items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="scnd-kicker">Offered by Michael Watson</div>
          {heroTitle
            ? <div className="scnd-display text-lg font-semibold" style={{ color: "var(--green-400)" }}>{heroTitle}</div>
            : <div className="scnd-display text-sm font-semibold" style={{ color: "var(--surface-band-fg)" }}>Network Design Labs</div>}
        </div>
        <span className="text-sm" style={{ color: "var(--ink-300)" }} data-testid="text-user-email">{userEmail}</span>
        <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout"
          className="hover:bg-white/10 hover:text-[color:var(--surface-band-fg)]"
          style={{ color: "var(--ink-300)" }}>
          Log out
        </Button>
      </header>
      {/* COSM-5 — one relative wrapper owns the scroll area's stacking
          context (the home page's backdrop now lives in the hero branch above). */}
      <div className="flex-1 min-h-0 relative">
        <main className="absolute inset-0 overflow-y-auto z-10">
          {children}
        </main>
      </div>
      <AppFooter />
    </div>
  );
}
