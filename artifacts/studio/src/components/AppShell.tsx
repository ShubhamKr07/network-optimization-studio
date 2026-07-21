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
        queryClient.invalidateQueries({ queryKey: getGetCurrentAuthUserQueryKey() });
        navigate("/login", { replace: true });
      },
    });
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-12 border-b flex items-center px-4 gap-3 flex-shrink-0 bg-background">
        <span className="font-semibold text-sm">Network Optimization Studio</span>
        <div className="flex-1" />
        <span className="text-sm text-muted-foreground" data-testid="text-user-email">{userEmail}</span>
        <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout">
          Log out
        </Button>
      </header>
      <main className="flex-1 min-h-0">{children}</main>
    </div>
  );
}
