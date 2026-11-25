import { NewTabMark } from "@/components/auth/CoverShell";

// Plain <a target="_blank">, not wouter's <Link>: the documents open in a new
// tab so a half-filled form survives (spec B2), and a SPA click handler must
// not get a chance to navigate this tab instead (D6).
const legalHref = (path: "/terms" | "/privacy") => `${import.meta.env.BASE_URL.replace(/\/$/, "")}${path}`;

// Native checkbox, not the shadcn one: this only renders inside the light-only
// cover shell (L6), which must not read theme tokens.
export function TermsConsent({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  const link = { target: "_blank", rel: "noopener noreferrer" } as const;
  return (
    <div className="consent">
      <input id="accept-terms" type="checkbox" checked={checked} onChange={(e) => onCheckedChange(e.target.checked)} data-testid="checkbox-accept-terms" />
      <label htmlFor="accept-terms">
        I agree to the <a href={legalHref("/terms")} {...link} data-testid="link-consent-terms">Terms of Service<NewTabMark /></a> and
        the <a href={legalHref("/privacy")} {...link} data-testid="link-consent-privacy">Privacy Notice<NewTabMark /></a> (FERPA, GDPR)
      </label>
    </div>
  );
}
