import { ReactNode } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useLogoutUser, getGetCurrentAuthUserQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { AppFooter } from "@/components/AppFooter";

interface AppShellProps {
  userEmail: string;
  children: ReactNode;
  heroTitle?: string;
}

export function AppShell({ userEmail, children, heroTitle }: AppShellProps) {
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
      <header className="scnd-band flex-shrink-0 flex items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="scnd-kicker">Optimization Studio by Prof. Michael Watson</div>
          {heroTitle
            ? <div className="scnd-display text-lg font-semibold" style={{ color: "var(--green-400)" }}>{heroTitle}</div>
            : <div className="scnd-display text-sm font-semibold" style={{ color: "var(--surface-band-fg)" }}>SCND Optimization Studio</div>}
        </div>
        <span className="text-sm" style={{ color: "var(--ink-300)" }} data-testid="text-user-email">{userEmail}</span>
        <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout" style={{ color: "var(--ink-300)" }}>
          Log out
        </Button>
      </header>
      <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>
      <AppFooter />
    </div>
  );
}
