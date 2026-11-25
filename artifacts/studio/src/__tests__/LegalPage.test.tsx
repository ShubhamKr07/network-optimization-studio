import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href?: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import { LegalPage } from "@/pages/legal/LegalPage";
import { TERMS_OF_SERVICE, PRIVACY_NOTICE } from "@/pages/legal/legalText";
import { LEGAL_DRAFT, PRIVACY_CONTACT_EMAIL, TERMS_VERSION } from "@/pages/legal/legalMeta";

describe("LegalPage", () => {
  it("renders the Terms of Service with its version and the contact link", () => {
    render(<LegalPage doc={TERMS_OF_SERVICE} />);
    expect(screen.getByTestId("page-terms")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Terms of Service");
    expect(screen.getByTestId("legal-version")).toHaveTextContent(TERMS_VERSION);
    expect(screen.getByTestId("link-legal-contact")).toHaveAttribute("href", `mailto:${PRIVACY_CONTACT_EMAIL}`);
  });

  it("shows the draft banner while the text is pending review", () => {
    expect(LEGAL_DRAFT).toBe(true); // B9 deletes the flag and flips this test
    render(<LegalPage doc={PRIVACY_NOTICE} />);
    expect(screen.getByTestId("legal-draft-banner")).toHaveTextContent("Draft — pending review");
  });

  it("the Privacy Notice names every outside service that receives student data (spec B1)", () => {
    render(<LegalPage doc={PRIVACY_NOTICE} />);
    const text = screen.getByTestId("page-privacy").textContent ?? "";
    for (const service of ["Anthropic", "PostHog", "Sentry", "Resend", "OpenRouteService", "Render"]) {
      expect(text, service).toContain(service);
    }
  });

  it("the Privacy Notice covers storage, rights, FERPA and anonymous feedback (spec B1, B5)", () => {
    render(<LegalPage doc={PRIVACY_NOTICE} />);
    const text = screen.getByTestId("page-privacy").textContent ?? "";
    for (const phrase of ["password", "scenarios", "WatBot", "which version you accepted", "Delete my account", "FERPA", "cannot be traced back to you", "backups", "GDPR"]) {
      expect(text, phrase).toContain(phrase);
    }
  });
});
