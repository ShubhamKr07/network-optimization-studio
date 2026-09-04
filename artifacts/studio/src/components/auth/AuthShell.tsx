import { ReactNode } from "react";
import coverUrl from "@/assets/book-cover.jpg";

const LABS = ["Ch 3 · p-median", "Ch 5 · transport LP", "Ch 5 · capacitated", "Ch 10 · two-echelon"];
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

function AuthCredit() {
  return (
    <div className="mt-4 pt-3 text-center border-t" style={{ borderColor: "var(--line)" }} data-testid="auth-credit">
      <div className="uppercase" style={{ fontFamily: MONO, fontSize: "10px", letterSpacing: "0.08em", color: "var(--text-muted)" }}>Developed by Shubham</div>
      <div className="mt-2" style={{ fontFamily: MONO, fontSize: "10px", letterSpacing: "0.08em", color: "var(--text-muted)" }}>Facing issues?</div>
      <div className="mt-1 flex items-center justify-center gap-1.5" style={{ fontFamily: MONO, fontSize: "10px", letterSpacing: "0.08em", color: "var(--text-muted)" }}>
        <span>Reach me out at</span>
        <a href="https://www.linkedin.com/in/shubhamkumarcse/" target="_blank" rel="noopener" title="LinkedIn" className="inline-flex" style={{ color: "var(--green-600)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-label="LinkedIn"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" /></svg>
        </a>
        <a href="mailto:shubham.shubham4995@gmail.com" title="Email" className="inline-flex" style={{ color: "var(--green-600)" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-label="Email"><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M3 6.5l9 6.5 9-6.5" /></svg>
        </a>
      </div>
    </div>
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
            <AuthCredit />
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
