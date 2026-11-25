import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useLoginUser, useRegisterUser, getGetCurrentAuthUserQueryKey } from "@workspace/api-client-react";
import { TermsConsent } from "@/components/auth/TermsConsent";
import { CoverShell } from "@/components/auth/CoverShell";
import { describeWriteError } from "@/lib/describeWriteError";

/** Log in / Create account, one page. `/login` and `/register` only pick the starting mode (L4). */
export function SignIn({ initialMode }: { initialMode: "login" | "register" }) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const loginUser = useLoginUser();
  const registerUser = useRegisterUser();
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  // WQF-B2 — ResetPassword lands here when the reset could not sign the
  // student in (terms not yet accepted). Read once; wouter's path excludes search.
  const [passwordChanged] = useState(() => new URLSearchParams(window.location.search).get("reset") === "done");

  const create = mode === "register";
  const mutation = create ? registerUser : loginUser;
  const passwordTooShort = create && password.length > 0 && password.length < 8;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (passwordTooShort || !acceptedTerms) return;
    mutation.mutate(
      { data: { email, password, acceptTerms: true } },
      {
        onSuccess: (data) => {
          // Write the cache synchronously instead of invalidating + waiting
          // on a refetch: navigating to "/" immediately races Gate()'s
          // auth-gated render against that refetch, and on a slow enough
          // round trip (e.g. real cross-origin network latency), Gate()
          // still sees no user, redirects the new "/" URL to "/login", and
          // the app lands on the wrong page instead of Landing.
          queryClient.setQueryData(getGetCurrentAuthUserQueryKey(), data);
          navigate("/", { replace: true });
        },
      },
    );
  }

  const errorMessage = mutation.isError
    ? describeWriteError(mutation.error, create ? "Could not create the account. Please try again." : "Could not log in. Please try again.")
    : null;

  return (
    <CoverShell>
      <ul className="modes" role="group" aria-label="Choose">
        <li><button type="button" data-testid="mode-login" aria-pressed={!create} onClick={() => setMode("login")}>Log in</button></li>
        <li><button type="button" data-testid="mode-register" aria-pressed={create} onClick={() => setMode("register")}>Create account</button></li>
      </ul>
      <form onSubmit={handleSubmit}>
        {passwordChanged && !create && !errorMessage && (
          <p className="note" role="status" data-testid="alert-password-changed">Your password was changed. Log in to continue.</p>
        )}
        {errorMessage && (
          <p className="note error" role="alert" data-testid={create ? "alert-register-error" : "alert-login-error"}>{errorMessage}</p>
        )}
        <div>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-email" />
        </div>
        <div>
          <div className="row">
            <label htmlFor="password">Password</label>
            {/* One word, so the label row cannot wrap at phone width. */}
            {!create && <Link href="/forgot-password" data-testid="link-forgot-password">Forgot?</Link>}
          </div>
          {/* maxLength mirrors LoginRequest/RegisterRequest.password in openapi.yaml — the
              server rejects anything longer, so cap it rather than let the student type a
              password the API will refuse. */}
          <input id="password" type="password" required maxLength={128} minLength={create ? 8 : undefined} autoComplete={create ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-password" />
          {passwordTooShort && <p className="field-error" data-testid="text-password-hint">Password must be at least 8 characters.</p>}
        </div>
        <TermsConsent checked={acceptedTerms} onCheckedChange={setAcceptedTerms} />
        <button type="submit" className="go" disabled={mutation.isPending || !acceptedTerms} data-testid={create ? "button-register" : "button-login"}>
          {create ? (mutation.isPending ? "Creating account…" : "Create account") : (mutation.isPending ? "Logging in…" : "Log in")}
        </button>
      </form>
      <p className="hint">
        {create
          ? "Password: at least 8 characters. Free for students and instructors using the book; any email works, no invite code needed."
          : <>New here? Choose <strong>Create account</strong> above.</>}
      </p>
    </CoverShell>
  );
}
