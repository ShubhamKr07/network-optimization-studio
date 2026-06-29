import { ReactNode } from "react";
import { useLocation } from "wouter";
import { useGamification, LEVEL_NAMES } from "@/context/GamificationContext";
import { LoginPage, ArcadiaGlyph } from "@/pages/arcadia/LoginPage";
import { Dashboard } from "@/pages/arcadia/Dashboard";
import { QuestMap } from "@/pages/arcadia/QuestMap";
import { Leaderboard } from "@/pages/arcadia/Leaderboard";
import { Badges } from "@/pages/arcadia/Badges";

const NAV_ITEMS = [
  {
    id: "dash" as const,
    label: "Home",
    icon: `<path d="M4 13h7V4H4zM13 20h7v-9h-7zM13 4v5h7V4zM4 20h7v-3H4z"/>`,
  },
  {
    id: "quest" as const,
    label: "Map",
    icon: `<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="7" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8 7l8 .5M7 8l4 8M16 9l-3 7"/>`,
  },
  {
    id: "lab" as const,
    label: "Lab",
    icon: `<path d="M9 3v6l-5 9a2 2 0 002 3h12a2 2 0 002-3l-5-9V3M8 3h8M7 15h10"/>`,
  },
  {
    id: "board" as const,
    label: "Ranks",
    icon: `<path d="M8 21h8M12 17v4M6 4h12v5a6 6 0 01-12 0zM6 5H3v2a3 3 0 003 3M18 5h3v2a3 3 0 01-3 3"/>`,
  },
  {
    id: "ach" as const,
    label: "Badges",
    icon: `<circle cx="12" cy="9" r="6"/><path d="M9 14l-2 7 5-3 5 3-2-7"/>`,
  },
];

const QUEST_LABELS: Record<number, string> = {
  1: "Model Lab · Al's Athletics",
  2: "Model Lab · Coal Transport LP",
};

const CRUMB: Record<string, string> = {
  dash: "Home",
  quest: "The Network",
  lab: "Model Lab",
  board: "Leaderboard",
  ach: "Badges",
};

interface ArcadiaShellProps {
  children: ReactNode;
}

export function ArcadiaShell({ children }: ArcadiaShellProps) {
  const { state, setView } = useGamification();
  const [location] = useLocation();

  if (!state.isLoggedIn) {
    return <LoginPage />;
  }

  const isCompare = location.includes("compare");
  const activeView = isCompare ? "lab" : state.activeView;

  const renderContent = () => {
    if (activeView === "dash") return <Dashboard />;
    if (activeView === "quest") return <QuestMap />;
    if (activeView === "board") return <Leaderboard />;
    if (activeView === "ach") return <Badges />;
    return children;
  };

  const levelName = LEVEL_NAMES[state.level - 1] ?? "Network Architect";
  const initials = state.userId
    ? state.userId.slice(0, 2).toUpperCase()
    : "U";

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "78px 1fr",
      minHeight: "100vh",
      background: "radial-gradient(1200px 700px at 78% -10%, #143949 0%, rgba(20,57,73,0) 60%), radial-gradient(900px 600px at 0% 110%, #102C39 0%, rgba(16,44,57,0) 55%), var(--arc-ink)",
      backgroundAttachment: "fixed",
      color: "var(--arc-paper)",
      fontFamily: "var(--arc-body)",
    }}>
      {/* Left rail */}
      <nav style={{
        position: "sticky", top: 0, height: "100vh",
        background: "rgba(8,24,32,.72)",
        borderRight: "1px solid var(--arc-grat-soft)",
        backdropFilter: "blur(8px)",
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: "6px", padding: "18px 0 14px", zIndex: 30,
      }}>
        <div style={{ marginBottom: "14px", cursor: "pointer" }} onClick={() => setView("dash")}>
          <ArcadiaGlyph size={30} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px", width: "100%", alignItems: "center", flex: 1 }}>
          {NAV_ITEMS.map(item => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                title={item.label}
                style={{
                  width: "54px", height: "50px", borderRadius: "13px",
                  display: "flex", flexDirection: "column", alignItems: "center",
                  justifyContent: "center", gap: "3px",
                  color: isActive ? "var(--arc-ink)" : "var(--arc-muted)",
                  background: isActive ? "var(--arc-amber)" : "transparent",
                  boxShadow: isActive ? "0 8px 20px -8px var(--arc-amber-deep)" : "none",
                  transition: "0.18s", border: "none", cursor: "pointer",
                }}
                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "var(--arc-ink-3)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--arc-paper)"; }}
                onMouseLeave={e => { if (!isActive) { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "var(--arc-muted)"; } }}
              >
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={isActive ? 2 : 1.7}
                  dangerouslySetInnerHTML={{ __html: item.icon }} />
                <span style={{ fontSize: "9.5px", fontFamily: "var(--arc-mono)", letterSpacing: "0.04em" }}>{item.label}</span>
              </button>
            );
          })}
        </div>
        <div style={{
          width: "42px", height: "42px", borderRadius: "12px",
          background: "linear-gradient(140deg, var(--arc-cyan), var(--arc-cyan-deep))",
          display: "grid", placeItems: "center",
          fontFamily: "var(--arc-display)", fontWeight: 700, color: "var(--arc-ink)",
          border: "2px solid rgba(234,244,244,.15)",
          fontSize: "13px",
        }}>
          {initials}
        </div>
      </nav>

      {/* Main */}
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* Top bar */}
        <header style={{
          position: "sticky", top: 0, zIndex: 20,
          display: "flex", alignItems: "center", gap: "18px",
          padding: "16px 28px",
          background: "linear-gradient(var(--arc-ink), rgba(11,31,42,.4))",
          backdropFilter: "blur(6px)",
          borderBottom: "1px solid var(--arc-grat-soft)",
        }}>
          <div style={{ fontFamily: "var(--arc-mono)", fontSize: "12px", color: "var(--arc-muted)", letterSpacing: "0.04em" }}>
            Arcadia / <b style={{ color: "var(--arc-paper)", fontWeight: 500 }}>
              {activeView === "lab" ? (QUEST_LABELS[state.activeQuestId] ?? CRUMB.lab) : (CRUMB[activeView] ?? "Lab")}
            </b>
          </div>
          <div style={{ flex: 1 }} />
          <label style={{
            display: "flex", alignItems: "center", gap: "9px",
            background: "var(--arc-ink-2)", border: "1px solid var(--arc-grat-soft)",
            padding: "9px 13px", borderRadius: "11px", color: "var(--arc-muted)", minWidth: "230px",
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>
            </svg>
            <input
              placeholder="Search models, concepts, scenarios…"
              style={{ background: "none", border: "none", color: "var(--arc-paper)", fontFamily: "var(--arc-body)", fontSize: "13px", width: "100%", outline: "none" }}
            />
          </label>
          {/* Streak pill */}
          <div style={{
            display: "flex", alignItems: "center", gap: "7px",
            background: "var(--arc-ink-2)", border: "1px solid var(--arc-grat-soft)",
            padding: "8px 12px", borderRadius: "30px",
            fontFamily: "var(--arc-mono)", fontSize: "12px", color: "var(--arc-coral)",
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="#F2745C">
              <path d="M12 2c2 4-1 5 0 8 3-1 3-4 3-4 2 3 3 5 3 8a6 6 0 11-12 0c0-3 2-5 3-7 1 2 2 2 3-5z"/>
            </svg>
            {state.streakDays}
          </div>
          {/* XP pill */}
          <div style={{
            display: "flex", alignItems: "center", gap: "7px",
            background: "var(--arc-ink-2)", border: "1px solid var(--arc-grat-soft)",
            padding: "8px 12px", borderRadius: "30px",
            fontFamily: "var(--arc-mono)", fontSize: "12px", color: "var(--arc-amber)",
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="#F2B45C">
              <path d="M13 2L4 14h6l-1 8 9-12h-6z"/>
            </svg>
            {state.xp.toLocaleString()} XP
          </div>
          {/* Level */}
          <div style={{ fontFamily: "var(--arc-mono)", fontSize: "11px", color: "var(--arc-muted)" }}>
            {levelName}
          </div>
        </header>

        {/* Content */}
        <main style={{ flex: 1, overflowY: "auto" }}>
          {renderContent()}
        </main>
      </div>
    </div>
  );
}
