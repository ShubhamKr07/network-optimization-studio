import { useState } from "react";
import { Link } from "wouter";
import { useForgotPassword } from "@workspace/api-client-react";
import { CoverShell } from "@/components/auth/CoverShell";
import { describeWriteError } from "@/lib/describeWriteError";

export function ForgotPassword() {
  const forgotPassword = useForgotPassword();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    forgotPassword.mutate(
      { data: { email } },
      {
        onSuccess: () => setSent(true),
        // The server answers 200 for an unknown address, so anything that
        // reaches here is a transport or rate-limit failure worth showing.
        onError: (err: unknown) =>
          setError(describeWriteError(err, "Could not send the reset email. Try again shortly.")),
      },
    );
  }

  return (
    <CoverShell>
      <ul className="modes"><li><h2 className="heading">Reset your password</h2></li></ul>
      {sent ? (
        <div className="flex flex-col gap-3" data-testid="text-reset-sent" style={{ fontSize: "13px", color: "var(--strip-ink-muted)" }}>
          {/* Deliberately vague: the endpoint answers identically for an
              address with no account, and a more specific UI would undo
              that. */}
          <p>If that email has an account, a reset link is on its way. The link works for one hour.</p>
          <p>Didn't get it? Check spam, then try again.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          {error && <p className="note error" role="alert" data-testid="alert-forgot-error">{error}</p>}
          <div>
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-email" />
          </div>
          <button type="submit" className="go" disabled={forgotPassword.isPending} data-testid="button-request-reset">
            {forgotPassword.isPending ? "Sending…" : "Email me a reset link"}
          </button>
        </form>
      )}
      <p className="hint"><Link href="/login">Back to log in</Link></p>
    </CoverShell>
  );
}
