import { useState } from "react";
import { useGamification } from "@/context/GamificationContext";

export function ArcadiaGlyph({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-label="Arcadia">
      <path d="M5 22 L15 9 L25 20" stroke="var(--arc-cyan)" strokeWidth="2" fill="none" opacity="0.8"/>
      <polygon points="15,5 19,12 11,12" fill="var(--arc-amber)"/>
      <circle cx="5" cy="22" r="3" fill="var(--arc-coral)"/>
      <circle cx="25" cy="20" r="3" fill="var(--arc-coral)"/>
    </svg>
  );
}

export function LoginPage() {
  const { login } = useGamification();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    await login(email.trim().toLowerCase() || "guest");
    setLoading(false);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 60,
      display: "grid", gridTemplateColumns: "1.1fr 1fr",
      background: "var(--arc-ink)", fontFamily: "var(--arc-body)",
    }}>
      {/* Left art panel */}
      <div style={{
        position: "relative", overflow: "hidden",
        background: "radial-gradient(1200px 700px at 78% -10%, #143949 0%, rgba(20,57,73,0) 60%), radial-gradient(900px 600px at 0% 110%, #102C39 0%, rgba(16,44,57,0) 55%), var(--arc-ink)",
        borderRight: "1px solid var(--arc-grat-soft)", padding: "48px",
      }}>
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.9, zIndex: 0 }}
          viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <g stroke="#1E4859" strokeWidth="1" opacity="0.5">
            <path d="M120 180 L300 300 L470 150 M300 300 L260 520 M300 300 L500 480 M260 520 L120 620 M260 520 L470 640"/>
          </g>
          <g>
            <circle cx="260" cy="520" r="7" fill="#F2745C"/>
            <circle cx="120" cy="620" r="6" fill="#F2745C"/>
            <circle cx="470" cy="640" r="6" fill="#F2745C"/>
            <circle cx="500" cy="480" r="6" fill="#F2745C"/>
            <polygon points="300,288 312,310 288,310" fill="#F2B45C"/>
            <polygon points="120,168 132,190 108,190" fill="#F2B45C"/>
            <polygon points="470,138 482,160 458,160" fill="#F2B45C"/>
          </g>
        </svg>
        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{ fontFamily: "var(--arc-mono)", fontSize: "11px", letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--arc-cyan)", marginBottom: "18px" }}>
            OpScales × Northwestern · Network Design Lab
          </div>
          <h1 style={{ fontFamily: "var(--arc-display)", fontSize: "46px", lineHeight: 1.04, margin: "18px 0 14px", maxWidth: "14ch", color: "var(--arc-paper)" }}>
            Learn network design by designing networks.
          </h1>
          <p style={{ color: "var(--arc-muted)", maxWidth: "42ch", fontSize: "15px", lineHeight: 1.6 }}>
            Tune real optimization models, watch the map re-solve in front of you, and level up as the concepts click.
          </p>
          <div style={{ display: "flex", gap: "26px", marginTop: "34px" }}>
            <div>
              <div style={{ fontFamily: "var(--arc-mono)", fontSize: "26px", color: "var(--arc-amber)" }}>7</div>
              <div style={{ fontFamily: "var(--arc-mono)", fontSize: "11px", color: "var(--arc-muted)" }}>live models</div>
            </div>
            <div>
              <div style={{ fontFamily: "var(--arc-mono)", fontSize: "26px", color: "var(--arc-cyan)" }}>42</div>
              <div style={{ fontFamily: "var(--arc-mono)", fontSize: "11px", color: "var(--arc-muted)" }}>scenarios to solve</div>
            </div>
            <div>
              <div style={{ fontFamily: "var(--arc-mono)", fontSize: "26px", color: "var(--arc-coral)" }}>1.2k</div>
              <div style={{ fontFamily: "var(--arc-mono)", fontSize: "11px", color: "var(--arc-muted)" }}>learners</div>
            </div>
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div style={{ display: "grid", placeItems: "center", padding: "40px", background: "var(--arc-ink)" }}>
        <div style={{ width: "100%", maxWidth: "340px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "24px" }}>
            <ArcadiaGlyph />
            <span style={{ fontFamily: "var(--arc-display)", fontWeight: 700, fontSize: "20px", letterSpacing: "-0.02em", color: "var(--arc-paper)" }}>Arcadia</span>
          </div>
          <h2 style={{ fontFamily: "var(--arc-display)", fontSize: "24px", marginBottom: "6px", color: "var(--arc-paper)" }}>Welcome back</h2>
          <p style={{ color: "var(--arc-muted)", fontSize: "14px", marginBottom: "26px" }}>Enter your NetID or email to pick up where you left off.</p>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div>
              <label style={{ display: "block", fontFamily: "var(--arc-mono)", fontSize: "11px", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--arc-muted)", marginBottom: "8px" }}>
                NetID / Email
              </label>
              <input
                type="text"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="e.g. jdoe2025"
                autoFocus
                style={{
                  width: "100%", boxSizing: "border-box",
                  background: "var(--arc-ink-2)", border: "1px solid var(--arc-grat)",
                  borderRadius: "11px", padding: "12px 14px",
                  color: "var(--arc-paper)", fontFamily: "var(--arc-body)", fontSize: "14px",
                  outline: "none",
                }}
                onFocus={e => (e.currentTarget.style.borderColor = "var(--arc-cyan)")}
                onBlur={e => (e.currentTarget.style.borderColor = "var(--arc-grat)")}
              />
            </div>

            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="arc-btn"
              style={{ width: "100%", justifyContent: "center", display: "flex", alignItems: "center", gap: "8px", opacity: (!email.trim() || loading) ? 0.5 : 1 }}
            >
              {loading ? "Loading…" : "Continue"}
              {!loading && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
              )}
            </button>
          </form>

          <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
            <button onClick={() => login("google-user")} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", background: "var(--arc-ink-2)", border: "1px solid var(--arc-grat)", borderRadius: "11px", padding: "11px", fontSize: "13px", color: "var(--arc-paper)", cursor: "pointer", transition: "0.15s", fontFamily: "var(--arc-body)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#EA4335" d="M5.266 9.765A7.077 7.077 0 0 1 12 4.909c1.69 0 3.218.6 4.418 1.582L19.91 3C17.782 1.145 15.055 0 12 0 7.27 0 3.198 2.698 1.24 6.65l4.026 3.115z"/><path fill="#34A853" d="M16.04 18.013c-1.09.703-2.474 1.078-4.04 1.078a7.077 7.077 0 0 1-6.723-4.823l-4.04 3.067A11.965 11.965 0 0 0 12 24c2.933 0 5.735-1.043 7.834-3l-3.793-2.987z"/><path fill="#4A90E2" d="M19.834 21c2.195-2.048 3.62-5.096 3.62-9 0-.71-.109-1.473-.272-2.182H12v4.637h6.436c-.317 1.559-1.17 2.766-2.395 3.558L19.834 21z"/><path fill="#FBBC05" d="M5.277 14.268A7.12 7.12 0 0 1 4.909 12c0-.782.125-1.533.357-2.235L1.24 6.65A11.934 11.934 0 0 0 0 12c0 1.92.445 3.73 1.237 5.335l4.04-3.067z"/></svg>
              Google
            </button>
            <button onClick={() => login("nu-sso-user")} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", background: "var(--arc-ink-2)", border: "1px solid var(--arc-grat)", borderRadius: "11px", padding: "11px", fontSize: "13px", color: "var(--arc-paper)", cursor: "pointer", transition: "0.15s", fontFamily: "var(--arc-body)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--arc-cyan)" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              NU SSO
            </button>
          </div>

          <button onClick={() => login("guest")} className="arc-btn arc-btn--ghost" style={{ width: "100%", justifyContent: "center", marginTop: "12px" }}>
            Continue as Guest
          </button>

          <p style={{ marginTop: "26px", fontSize: "12px", color: "var(--arc-muted-2)", textAlign: "center" }}>
            By continuing you agree to the <b style={{ color: "var(--arc-muted)" }}>Honor Code</b> for collaborative learning.
          </p>
        </div>
      </div>
    </div>
  );
}
