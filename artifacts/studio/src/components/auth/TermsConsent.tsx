import { Checkbox } from "@/components/ui/checkbox";

// Plain <a target="_blank">, not wouter's <Link>: the documents open in a new
// tab so a half-filled form survives (spec B2), and a SPA click handler must
// not get a chance to navigate this tab instead (D6).
const legalHref = (path: "/terms" | "/privacy") => `${import.meta.env.BASE_URL.replace(/\/$/, "")}${path}`;

export function TermsConsent({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  const link = { className: "underline", style: { color: "var(--link)" }, target: "_blank", rel: "noopener noreferrer" } as const;
  return (
    <div className="flex items-start gap-2">
      <Checkbox id="accept-terms" checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)}
        className="mt-0.5" data-testid="checkbox-accept-terms" />
      <label htmlFor="accept-terms" style={{ fontSize: "12.5px", lineHeight: 1.45, color: "var(--text-muted)" }}>
        I agree to the <a href={legalHref("/terms")} {...link} data-testid="link-consent-terms">Terms of Service</a> and
        the <a href={legalHref("/privacy")} {...link} data-testid="link-consent-privacy">Privacy Notice</a> (FERPA, GDPR)
      </label>
    </div>
  );
}
