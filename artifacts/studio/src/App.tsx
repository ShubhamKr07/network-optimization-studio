import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Studio } from "@/pages/Studio";
import { Compare } from "@/pages/Compare";
import { GamificationProvider } from "@/context/GamificationContext";
import { ArcadiaShell } from "@/components/ArcadiaShell";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Studio} />
      <Route path="/compare" component={Compare} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <GamificationProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <ArcadiaShell>
              <Router />
            </ArcadiaShell>
          </WouterRouter>
          <Toaster />
        </GamificationProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
