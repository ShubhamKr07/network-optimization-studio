import type { ReactNode } from "react";
import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useGetCurrentAuthUser } from "@workspace/api-client-react";
import NotFound from "@/pages/not-found";
import { Landing } from "@/pages/Landing";
import { Studio } from "@/pages/Studio";
import { Compare } from "@/pages/Compare";
import { Login } from "@/pages/auth/Login";
import { Register } from "@/pages/auth/Register";
import { AppShell } from "@/components/AppShell";
import { CHAPTERS } from "@/lib/chapters";

const queryClient = new QueryClient();

// Deliberately ONE <Switch> with a fixed route set, not swapped between an
// "authed" and "unauthed" tree keyed on auth state. Route/Switch subscribe
// to the current location independently of their parent (Gate) — swapping
// which tree is mounted left a real window where the OLD tree's Switch
// reacted to a brand-new location (e.g. right after login/register/logout
// navigates) before Gate itself re-rendered with fresh auth data, matched
// against a route set that didn't have it, and hit that tree's own
// catch-all — landing on the wrong page (a hard 404 in the worst case).
// Every path is always a real Route here; only the per-route CONTENT
// branches on auth state, so any transitional render still resolves to a
// Redirect rather than a dead end.
export function Gate() {
  const { data, isLoading } = useGetCurrentAuthUser();

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  }

  const user = data?.user;

  function authedOnly(children: ReactNode) {
    return user ? <AppShell userEmail={user.email}>{children}</AppShell> : <Redirect to="/login" />;
  }

  return (
    <Switch>
      <Route path="/login">{user ? <Redirect to="/" /> : <Login />}</Route>
      <Route path="/register">{user ? <Redirect to="/" /> : <Register />}</Route>
      <Route path="/">{authedOnly(<Landing />)}</Route>
      {CHAPTERS.map((c) => (
        <Route key={c.path} path={c.path}>
          {authedOnly(<Studio modelId={c.modelId} />)}
        </Route>
      ))}
      <Route path="/compare">{authedOnly(<Compare />)}</Route>
      <Route>{authedOnly(<NotFound />)}</Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Gate />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
