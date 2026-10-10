import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useResetPassword, getGetCurrentAuthUserQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AuthShell } from "@/components/auth/AuthShell";
import { describeWriteError } from "@/lib/describeWriteError";

/** The link puts the token in the fragment, which never reaches the server. */
function tokenFromHash(): string {
  return new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token") ?? "";
}

export function ResetPassword() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const resetPassword = useResetPassword();
  // Read once, on mount, before the effect below clears the hash.
  const [token] = useState(tokenFromHash);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Keep the token out of browser history and any later Referer. It lives
    // in component state from here on.
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    resetPassword.mutate(
      { data: { token, password } },
      {
        onSuccess: (data) => {
          // Same reasoning as Login.tsx's onSuccess: write the cache
          // synchronously rather than invalidating, to avoid racing Gate()'s
          // auth-gated render.
          queryClient.setQueryData(getGetCurrentAuthUserQueryKey(), data);
          navigate("/", { replace: true });
        },
        onError: (err: unknown) =>
          setError(describeWriteError(err, "Could not set your new password. Request a fresh link.")),
      },
    );
  }

  if (!token) {
    return (
      <AuthShell tagline="Set a new password to get back into your labs.">
        <div className="flex flex-col gap-3" data-testid="text-reset-link-invalid" style={{ fontSize: "13px", color: "var(--text-muted)" }}>
          <p>This reset link is missing its token. It may have been truncated by your email client.</p>
          <p><Link href="/forgot-password" className="underline" style={{ color: "var(--link)" }}>Request a new link</Link></p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell tagline="Set a new password to get back into your labs.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        {error && (
          <Alert variant="destructive" data-testid="alert-reset-error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">New password</Label>
          {/* Bounds mirror ResetPasswordRequest.password in openapi.yaml. */}
          <Input id="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-new-password" />
        </div>
        <Button type="submit" disabled={resetPassword.isPending} data-testid="button-set-password" className="mt-1">
          {resetPassword.isPending ? "Saving…" : "Set new password"}
        </Button>
      </form>
      <div className="text-center mt-4" style={{ fontSize: "12.5px", color: "var(--text-muted)" }}>
        <Link href="/login" className="underline" style={{ color: "var(--link)" }}>Back to log in</Link>
      </div>
    </AuthShell>
  );
}
