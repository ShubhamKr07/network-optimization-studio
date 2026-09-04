import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useLoginUser, getGetCurrentAuthUserQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AuthShell } from "@/components/auth/AuthShell";

export function Login() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const loginUser = useLoginUser();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loginUser.mutate(
      { data: { email, password } },
      {
        onSuccess: (data) => {
          // Write the cache synchronously instead of invalidating + waiting
          // on a refetch: navigating to "/" immediately races Gate()'s
          // auth-gated render against that refetch, and on a slow enough
          // round trip (e.g. real cross-origin network latency), Gate()
          // still sees no user, renders UnauthedRouter for the new "/" URL,
          // and its catch-all bounces the URL back to "/login" — which
          // isn't a route in AuthedRouter, so once the user data does
          // arrive the app 404s instead of showing Landing.
          queryClient.setQueryData(getGetCurrentAuthUserQueryKey(), data);
          navigate("/", { replace: true });
        },
      },
    );
  }

  return (
    <AuthShell tagline="Log in to continue your labs. Build a scenario on the map, solve it with a real optimizer, compare the results.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        {loginUser.isError && (
          <Alert variant="destructive" data-testid="alert-login-error">
            <AlertDescription>Invalid email or password.</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-email" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-password" />
        </div>
        <Button type="submit" disabled={loginUser.isPending} data-testid="button-login" className="mt-1">
          {loginUser.isPending ? "Logging in…" : "Log in"}
        </Button>
      </form>
      <div className="flex items-center gap-2.5 my-4">
        <div className="flex-1 h-px" style={{ background: "var(--line)" }} />
        <span className="uppercase" style={{ fontFamily: "var(--app-font-mono)", fontSize: "9px", letterSpacing: "0.1em", color: "var(--text-faint)" }}>or</span>
        <div className="flex-1 h-px" style={{ background: "var(--line)" }} />
      </div>
      <div className="text-center" style={{ fontSize: "12.5px", color: "var(--text-muted)" }}>
        No account? <Link href="/register" className="underline" style={{ color: "var(--link)" }}>Register</Link>
      </div>
    </AuthShell>
  );
}
