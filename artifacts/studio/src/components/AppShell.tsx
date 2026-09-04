import { ReactNode } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useLogoutUser, getGetCurrentAuthUserQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { AppFooter } from "@/components/AppFooter";
import coverUrl from "@/assets/book-cover.jpg";
import { DeveloperCredit } from "@/components/DeveloperCredit";

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
        navigate("/login", { replace: true });
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
      <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>
      {hero
        ? <footer data-testid="homepage-credit-footer" className="flex-shrink-0 border-t bg-background px-6 py-3 text-center" style={{ borderColor: "var(--line)" }}>
            <DeveloperCredit />
          </footer>
        : <AppFooter />}
    </div>
  );
}
