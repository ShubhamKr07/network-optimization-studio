import { ReactNode } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useLogoutUser, getGetCurrentAuthUserQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";

interface AppShellProps {
  userEmail: string;
  children: ReactNode;
}

export function AppShell({ userEmail, children }: AppShellProps) {
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
      <header className="h-12 border-b flex items-center px-4 gap-3 flex-shrink-0 bg-background">
        <span className="font-semibold text-sm">Network Optimization Studio</span>
        <div className="flex-1" />
        <span className="text-sm text-muted-foreground" data-testid="text-user-email">{userEmail}</span>
        <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout">
          Log out
        </Button>
      </header>
      <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>
    </div>
  );
}
