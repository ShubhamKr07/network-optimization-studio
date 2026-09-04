const MONO = "var(--app-font-mono)";

export function DeveloperCredit() {
  return (
    <>
      <div className="uppercase" style={{ fontFamily: MONO, fontSize: "10px", letterSpacing: "0.08em", color: "var(--text-muted)" }}>Developed by Shubham</div>
      <div className="mt-2" style={{ fontFamily: MONO, fontSize: "10px", letterSpacing: "0.08em", color: "var(--text-muted)" }}>Facing issues?</div>
      <div className="mt-1 flex items-center justify-center gap-1.5" style={{ fontFamily: MONO, fontSize: "10px", letterSpacing: "0.08em", color: "var(--text-muted)" }}>
        <span>Reach out at</span>
        <a href="https://www.linkedin.com/in/shubhamkumarcse/" target="_blank" rel="noopener" title="LinkedIn" className="inline-flex" style={{ color: "var(--green-600)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-label="LinkedIn"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" /></svg>
        </a>
        <a href="mailto:shubham.shubham4995@gmail.com" title="Email" className="inline-flex" style={{ color: "var(--green-600)" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-label="Email"><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M3 6.5l9 6.5 9-6.5" /></svg>
        </a>
      </div>
    </>
  );
}
