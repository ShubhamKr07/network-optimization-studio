import { ReactNode } from "react";
import coverUrl from "@/assets/book-cover.jpg";
import { DeveloperCredit } from "@/components/DeveloperCredit";
import { CHAPTERS } from "@/lib/chapters";

// distinct non-hidden chapters, one label per chapter (dedupe by `chapter`)
const LABS = Array.from(new Set(CHAPTERS.filter((c) => !c.hiddenFromLanding).map((c) => c.chapter)));
const MONO = "var(--app-font-mono)";

function Diamond() {
  return (
    <span
      aria-hidden
      className="inline-block align-middle mx-2"
      style={{ width: 5, height: 5, background: "var(--green-400)", transform: "rotate(45deg)" }}
    />
  );
}

export function AuthShell({ tagline, children }: { tagline: string; children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-background" data-testid="auth-shell">
      <div
        data-testid="auth-cover"
        className="flex flex-col items-center justify-center gap-5 px-9 py-6 md:py-10 md:basis-[44%] md:flex-shrink-0 border-b-2 md:border-b-0 md:border-r-2"
        style={{ background: "var(--surface-band)", borderColor: "var(--green-400)" }}
      >
        <img
          src={coverUrl}
          alt="Supply Chain Network Design book cover"
          className="block w-[46%] max-w-[160px] md:w-[72%] md:max-w-[290px]"
          style={{ boxShadow: "0 22px 48px rgba(0,0,0,.55)" }}
        />
        <div className="text-center uppercase" style={{ fontFamily: MONO, fontSize: "9.5px", letterSpacing: "0.14em", color: "var(--ink-300)" }}>
          <Diamond />The textbook behind the labs<Diamond />
        </div>
      </div>
      <div className="flex-1 flex flex-col bg-background">
        <div className="flex-1 flex items-center justify-center px-6 py-10">
          <div className="w-full max-w-[360px]">
            <div className="uppercase" style={{ fontFamily: MONO, fontSize: "10px", letterSpacing: "0.14em", color: "var(--text-muted)" }}>By Prof. Michael Watson</div>
            <div className="mt-2 mb-1.5" style={{ fontFamily: "var(--app-font-display)", fontWeight: 700, fontSize: "32px", lineHeight: 1.1, color: "var(--green-600)" }}>Optimization Studio</div>
            <div className="mb-5" style={{ fontSize: "13px", lineHeight: 1.5, color: "var(--text-muted)" }}>{tagline}</div>
            {children}
            <div className="mt-4 pt-3 text-center border-t" style={{ borderColor: "var(--line)" }} data-testid="auth-credit">
              <DeveloperCredit />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-1 px-6 py-3 border-t" style={{ background: "var(--card)", borderColor: "var(--line)" }} data-testid="auth-labs-strip">
          {LABS.map((l) => (
            <span key={l} style={{ fontFamily: MONO, fontSize: "10px", letterSpacing: "0.08em", color: "var(--text-muted)" }}>{l}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
