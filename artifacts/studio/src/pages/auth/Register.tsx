import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useRegisterUser, getGetCurrentAuthUserQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AuthShell } from "@/components/auth/AuthShell";

export function Register() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const registerUser = useRegisterUser();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const passwordTooShort = password.length > 0 && password.length < 8;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (passwordTooShort) return;
    registerUser.mutate(
      { data: { email, password } },
      {
        onSuccess: (data) => {
          // See Login.tsx's onSuccess for why this writes the cache
          // synchronously instead of invalidating + waiting on a refetch
          // (avoids a real race against Gate()'s auth-gated render).
          queryClient.setQueryData(getGetCurrentAuthUserQueryKey(), data);
          navigate("/", { replace: true });
        },
      },
    );
  }

  const errorMessage = registerUser.isError
    ? (registerUser.error as { status?: number })?.status === 409
      ? "An account with this email already exists."
      : "Could not create the account. Check your details and try again."
    : null;

  return (
    <AuthShell tagline="Register to start solving labs. Build a scenario on the map, solve it with a real optimizer, compare the results.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        {errorMessage && (
          <Alert variant="destructive" data-testid="alert-register-error">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" required autoComplete="email" placeholder="you@university.edu" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-email" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-password" />
          {passwordTooShort && (
            <p className="text-xs text-destructive" data-testid="text-password-hint">Password must be at least 8 characters.</p>
          )}
        </div>
        <Button type="submit" disabled={registerUser.isPending} data-testid="button-register" className="mt-1">
          {registerUser.isPending ? "Creating account…" : "Register"}
        </Button>
      </form>
      <div className="flex items-center gap-2.5 my-4">
        <div className="flex-1 h-px" style={{ background: "var(--line)" }} />
        <span className="uppercase" style={{ fontFamily: "var(--app-font-mono)", fontSize: "9px", letterSpacing: "0.1em", color: "var(--text-faint)" }}>or</span>
        <div className="flex-1 h-px" style={{ background: "var(--line)" }} />
      </div>
      <div className="text-center" style={{ fontSize: "12.5px", color: "var(--text-muted)" }}>
        Already have an account? <Link href="/login" className="underline" style={{ color: "var(--link)" }}>Log in</Link>
      </div>
    </AuthShell>
  );
}
