import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useLoginUser, getGetCurrentAuthUserQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

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
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Network Optimization Studio</CardTitle>
          <CardDescription>Log in to continue your labs.</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="flex flex-col gap-4">
            {loginUser.isError && (
              <Alert variant="destructive" data-testid="alert-login-error">
                <AlertDescription>Invalid email or password.</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="input-email"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="input-password"
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3 items-stretch">
            <Button type="submit" disabled={loginUser.isPending} data-testid="button-login">
              {loginUser.isPending ? "Logging in…" : "Log in"}
            </Button>
            <p className="text-sm text-muted-foreground text-center">
              No account? <Link href="/register" className="underline">Register</Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
