// Resend's REST API, called with native fetch (Node 26). No SDK: this is one
// POST, and the SDK's retries/idempotency/templates buy nothing for a single
// transactional send. If email needs grow, the SDK drops in behind this exact
// signature.
const RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "noreply@app.networkdesignbook.com";

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");

  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM ?? DEFAULT_FROM, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}
