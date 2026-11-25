import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useResetPassword, getCurrentAuthUser, getGetCurrentAuthUserQueryKey } from "@workspace/api-client-react";
import { CoverShell } from "@/components/auth/CoverShell";
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
        onSuccess: async () => {
          // WQF-B2 / D4 — the server sets the session cookie only for an account
          // that has accepted the current terms, and the body is identical either
          // way, so ask the server who is signed in instead of trusting it.
          // fetchQuery also fills the cache BEFORE navigating, which is what the
          // old synchronous setQueryData was protecting (Gate race, Login.tsx).
          let signedIn = false;
          try {
            const fresh = await queryClient.fetchQuery({
              queryKey: getGetCurrentAuthUserQueryKey(),
              queryFn: () => getCurrentAuthUser(),
              staleTime: 0,
            });
            signedIn = Boolean(fresh.user);
          } catch {
            // The password is already changed; Log in is always a safe landing.
          }
          navigate(signedIn ? "/" : "/login?reset=done", { replace: true });
        },
        onError: (err: unknown) =>
          setError(describeWriteError(err, "Could not set your new password. Request a fresh link.")),
      },
    );
  }

  if (!token) {
    return (
      <CoverShell>
        <ul className="modes"><li><h2 className="heading">Set a new password</h2></li></ul>
        <div className="flex flex-col gap-3" data-testid="text-reset-link-invalid" style={{ fontSize: "13px", color: "var(--strip-ink-muted)" }}>
          <p>This reset link is missing its token. It may have been truncated by your email client.</p>
          <p><Link href="/forgot-password">Request a new link</Link></p>
        </div>
      </CoverShell>
    );
  }

  return (
    <CoverShell>
      <ul className="modes"><li><h2 className="heading">Set a new password</h2></li></ul>
      <form onSubmit={handleSubmit}>
        {error && <p className="note error" role="alert" data-testid="alert-reset-error">{error}</p>}
        <div>
          <label htmlFor="password">New password</label>
          {/* Bounds mirror ResetPasswordRequest.password in openapi.yaml. */}
          <input id="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-new-password" />
        </div>
        <button type="submit" className="go" disabled={resetPassword.isPending} data-testid="button-set-password">
          {resetPassword.isPending ? "Saving…" : "Set new password"}
        </button>
      </form>
      <p className="hint"><Link href="/login">Back to log in</Link></p>
    </CoverShell>
  );
}
