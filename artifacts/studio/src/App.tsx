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

function AuthedRouter() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      {CHAPTERS.map((c) => (
        <Route key={c.path} path={c.path}>
          <Studio problemType={c.problemType} />
        </Route>
      ))}
      <Route path="/compare" component={Compare} />
      <Route component={NotFound} />
    </Switch>
  );
}

function UnauthedRouter() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route>
        <Redirect to="/login" />
      </Route>
    </Switch>
  );
}

function Gate() {
  const { data, isLoading } = useGetCurrentAuthUser();

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  }

  if (!data?.user) {
    return <UnauthedRouter />;
  }

  return (
    <AppShell userEmail={data.user.email}>
      <AuthedRouter />
    </AppShell>
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
