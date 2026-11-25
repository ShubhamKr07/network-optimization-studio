import { Link } from "wouter";
import { PRIVACY_CONTACT_EMAIL, TERMS_VERSION } from "./legalMeta";
import type { LegalDoc } from "./legalText";

export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <div className="min-h-screen bg-background text-foreground" data-testid={`page-${doc.slug}`}>
      <main className="max-w-[720px] mx-auto px-6 py-10">
        <h1 className="scnd-display text-3xl font-bold" style={{ color: "var(--text-brand)" }}>{doc.title}</h1>
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }} data-testid="legal-version">Version {TERMS_VERSION}</p>
        <p className="mt-4 text-sm leading-relaxed">{doc.intro}</p>
        {doc.sections.map((s) => (
          <section key={s.heading} className="mt-6">
            <h2 className="text-base font-semibold">{s.heading}</h2>
            {s.bullets && (
              <ul className="mt-2 list-disc pl-5 text-sm leading-relaxed space-y-1">
                {s.bullets.map((b) => <li key={b}>{b}</li>)}
              </ul>
            )}
            {s.paragraphs.map((p) => <p key={p} className="mt-2 text-sm leading-relaxed">{p}</p>)}
          </section>
        ))}
        <section className="mt-6">
          <h2 className="text-base font-semibold">Contact</h2>
          <p className="mt-2 text-sm">
            Questions and requests:{" "}
            <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="underline" style={{ color: "var(--link)" }} data-testid="link-legal-contact">
              {PRIVACY_CONTACT_EMAIL}
            </a>
          </p>
        </section>
        <p className="mt-8 text-sm">
          <Link href="/" className="underline" style={{ color: "var(--link)" }}>Back to Optimization Studio</Link>
        </p>
      </main>
    </div>
  );
}
