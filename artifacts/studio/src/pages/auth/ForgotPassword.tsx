import { useState } from "react";
import { Link } from "wouter";
import { useForgotPassword } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AuthShell } from "@/components/auth/AuthShell";
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
    <AuthShell tagline="Forgot your password? We'll email you a link to set a new one.">
      {sent ? (
        <div className="flex flex-col gap-3" data-testid="text-reset-sent" style={{ fontSize: "13px", color: "var(--text-muted)" }}>
          {/* Deliberately vague: the endpoint answers identically for an
              address with no account, and a more specific UI would undo
              that. */}
          <p>If that email has an account, a reset link is on its way. The link works for one hour.</p>
          <p>Didn't get it? Check spam, then try again.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          {error && (
            <Alert variant="destructive" data-testid="alert-forgot-error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-email" />
          </div>
          <Button type="submit" disabled={forgotPassword.isPending} data-testid="button-request-reset" className="mt-1">
            {forgotPassword.isPending ? "Sending…" : "Email me a reset link"}
          </Button>
        </form>
      )}
      <div className="text-center mt-4" style={{ fontSize: "12.5px", color: "var(--text-muted)" }}>
        <Link href="/login" className="underline" style={{ color: "var(--link)" }}>Back to log in</Link>
      </div>
    </AuthShell>
  );
}
