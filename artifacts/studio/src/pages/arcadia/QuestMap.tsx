import { useLocation } from "wouter";
import { useGamification } from "@/context/GamificationContext";

interface QuestNode {
  id: string;
  title: string;
  sub: string;
  xp: number;
  status: "done" | "open" | "locked";
  stars?: number;
  scenarioId?: number;
  icon: string;
  prerequisite?: string;
  prerequisiteMinStars?: number;
}

interface Track {
  id: string;
  label: string;
  trackNum: string;
  nodes: QuestNode[];
  prerequisiteTrack?: string;
}

const CHECK_ICON = `<path d="M5 13l4 4L19 7"/>`;
const LAB_ICON = `<path d="M9 3v6l-5 9a2 2 0 002 3h12a2 2 0 002-3l-5-9V3M8 3h8M7 15h10"/>`;
const FLOW_ICON = `<path d="M3 12h18M3 12l4-4M3 12l4 4M21 6h-6M21 18h-6"/>`;
const CAP_ICON = `<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9z"/>`;
const CROSS_ICON = `<path d="M12 3v18M3 12h18M6 6l12 12M18 6L6 18"/>`;
const CLOCK_ICON = `<path d="M4 12a8 8 0 1016 0 8 8 0 00-16 0zM12 4v8l5 3"/>`;
const HOME_ICON = `<path d="M5 21V7l7-4 7 4v14M9 21v-6h6v6"/>`;
const STAR_ICON = `<path d="M12 2l2.4 7.4H22l-6 4.5 2.3 7.1L12 16.5 5.7 21l2.3-7.1-6-4.5h7.6z"/>`;

const TRACKS: Track[] = [
  {
    id: "facility_location",
    label: "Facility Location",
    trackNum: "Track 01",
    nodes: [
      { id: "fl1", title: "Center of Gravity", sub: "CH 3 · warm-up", xp: 300, status: "done", stars: 3, icon: STAR_ICON },
      { id: "fl2", title: "Al's Athletics", sub: "CH 3 · p-median", xp: 450, status: "open", stars: 0, icon: LAB_ICON, scenarioId: 1, prerequisite: "fl1" },
    ],
  },
  {
    id: "flow_capacity",
    label: "Flow & Capacity",
    trackNum: "Track 02",
    prerequisiteTrack: "facility_location",
    nodes: [
      { id: "fc1", title: "Coal Transport LP", sub: "CH 5 · transport", xp: 450, status: "locked", icon: FLOW_ICON, scenarioId: 2, prerequisite: "fl2", prerequisiteMinStars: 2 },
      { id: "fc2", title: "Brazil Capacity", sub: "CH 5 · capacitated", xp: 500, status: "locked", icon: CAP_ICON, prerequisite: "fc1" },
    ],
  },
];

function StarDisplay({ count, max = 3 }: { count: number; max?: number }) {
  return (
    <div style={{ fontSize: "11px", letterSpacing: "1px", color: "var(--arc-amber)", marginTop: "4px", height: "14px" }}>
      {Array.from({ length: max }).map((_, i) => i < count ? "★" : "☆").join("")}
    </div>
  );
}

function QuestNodeCard({ node, onOpen }: { node: QuestNode; onOpen: () => void }) {
  const isDone = node.status === "done";
  const isOpen = node.status === "open";
  const isLocked = node.status === "locked";
  // Model nodes (with a scenarioId) are always launchable
  const isLaunchable = isOpen || (isLocked && !!node.scenarioId);

  const dotStyle: React.CSSProperties = {
    width: "60px", height: "60px", margin: "0 auto 10px", borderRadius: "18px",
    display: "grid", placeItems: "center", position: "relative", transition: "0.18s",
    border: "2px solid transparent",
    ...(isDone ? { background: "rgba(127,209,122,.16)", borderColor: "var(--arc-good)", color: "var(--arc-good)" } : {}),
    ...(isOpen ? {
      background: "linear-gradient(150deg, var(--arc-amber), var(--arc-amber-deep))",
      color: "var(--arc-ink)",
      boxShadow: "0 0 0 6px rgba(242,180,92,.12), 0 12px 26px -10px var(--arc-amber-deep)",
      cursor: "pointer"
    } : {}),
    ...(isLocked && !node.scenarioId ? { background: "var(--arc-ink-3)", borderColor: "var(--arc-grat)", color: "var(--arc-muted-2)" } : {}),
    ...(isLocked && node.scenarioId ? {
      background: "rgba(60,110,140,.22)", borderColor: "var(--arc-cyan)", color: "var(--arc-cyan)",
      cursor: "pointer",
    } : {}),
  };

  return (
    <div
      style={{ width: "118px", flexShrink: 0, textAlign: "center", position: "relative", cursor: isLaunchable ? "pointer" : "default" }}
      onClick={isLaunchable ? onOpen : undefined}
    >
      <div style={{ position: "absolute", top: "-6px", right: "14px", fontFamily: "var(--arc-mono)", fontSize: "9.5px", background: "var(--arc-ink)", border: "1px solid var(--arc-grat)", color: "var(--arc-amber)", padding: "2px 6px", borderRadius: "20px", zIndex: 1 }}>
        +{node.xp}
      </div>
      <div style={dotStyle}>
        {(isOpen || (isLocked && node.scenarioId)) && (
          <div style={{
            position: "absolute", inset: "-7px", borderRadius: "22px",
            border: `2px solid ${isOpen ? "var(--arc-amber)" : "var(--arc-cyan)"}`, opacity: 0.4,
            animation: "arc-pulse 2.4s ease-out infinite"
          }} />
        )}
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
          dangerouslySetInnerHTML={{ __html: node.icon }} />
      </div>
      <div style={{
        fontSize: "12.5px", fontWeight: 600, lineHeight: 1.25,
        color: "var(--arc-paper)",
        opacity: (isLocked && !node.scenarioId) ? 0.45 : 1,
        fontFamily: "var(--arc-display)"
      }}>
        {node.title}
      </div>
      <div style={{
        fontFamily: "var(--arc-mono)", fontSize: "10px", color: "var(--arc-muted)", marginTop: "3px",
        opacity: (isLocked && !node.scenarioId) ? 0.45 : 1
      }}>
        {node.sub}
      </div>
      {node.stars !== undefined && <StarDisplay count={node.stars} />}
    </div>
  );
}

export function QuestMap() {
  const { setView, setActiveQuest, state } = useGamification();
  const [, navigate] = useLocation();

  const solvedNodeIds = new Set<string>();
  const solvedScenarioIds = new Set(Object.keys(state.solvedScenarios).map(Number));

  const getPrerequisiteStars = (nodeId: string): number => {
    const allNodes = TRACKS.flatMap(t => t.nodes);
    const node = allNodes.find(n => n.id === nodeId);
    if (!node?.scenarioId) return node?.stars ?? 0;
    return state.solvedScenarios[node.scenarioId]?.stars ?? (node.status === "done" ? 3 : 0);
  };

  const resolveNodeStatuses = (): Map<string, "done" | "open" | "locked"> => {
    const statusMap = new Map<string, "done" | "open" | "locked">();

    for (const track of TRACKS) {
      for (const node of track.nodes) {
        const isSolvedByScenario = node.scenarioId ? solvedScenarioIds.has(node.scenarioId) : false;
        const baseStatus = node.status;

        if (baseStatus === "done" || isSolvedByScenario) {
          statusMap.set(node.id, "done");
          solvedNodeIds.add(node.id);
        } else if (baseStatus === "open") {
          const prereqMet = !node.prerequisite || solvedNodeIds.has(node.prerequisite) || statusMap.get(node.prerequisite ?? "") === "done";
          statusMap.set(node.id, prereqMet ? "open" : "locked");
        } else {
          const prereqDone = node.prerequisite
            ? (solvedNodeIds.has(node.prerequisite) || statusMap.get(node.prerequisite) === "done")
            : false;
          const starsMet = node.prerequisite && node.prerequisiteMinStars
            ? getPrerequisiteStars(node.prerequisite) >= node.prerequisiteMinStars
            : true;
          if (prereqDone && starsMet) {
            statusMap.set(node.id, "open");
          } else {
            statusMap.set(node.id, "locked");
          }
        }
      }
    }

    return statusMap;
  };

  const nodeStatuses = resolveNodeStatuses();

  const getNodeStars = (node: QuestNode): number | undefined => {
    if (node.scenarioId && state.solvedScenarios[node.scenarioId]) {
      return state.solvedScenarios[node.scenarioId].stars;
    }
    return node.stars;
  };

  const handleNodeOpen = (node: QuestNode) => {
    if (node.scenarioId) {
      setActiveQuest(node.scenarioId);
    }
    // Navigate to the Lab root — Studio auto-selects the first available scenario
    navigate("/");
    setView("lab");
  };

  return (
    <div style={{ padding: "26px 28px 60px", maxWidth: "1320px", width: "100%", animation: "arc-rise 0.4s cubic-bezier(.2,.7,.2,1)" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "20px", marginBottom: "18px", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: "var(--arc-mono)", fontSize: "11px", letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--arc-cyan)", marginBottom: "4px" }}>Curriculum</div>
          <h1 style={{ fontFamily: "var(--arc-display)", fontSize: "26px", marginBottom: "6px", color: "var(--arc-paper)" }}>The Network</h1>
          <p style={{ color: "var(--arc-muted)", maxWidth: "60ch", margin: 0 }}>
            Every concept is a node; every prerequisite is an arc. Solve a node to light up the routes ahead.
          </p>
        </div>
        <div style={{ display: "flex", gap: "16px", fontFamily: "var(--arc-mono)", fontSize: "11px", color: "var(--arc-muted)" }}>
          <span><span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", background: "var(--arc-good)", marginRight: "6px", verticalAlign: "middle" }} />Mastered</span>
          <span><span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", background: "var(--arc-amber)", marginRight: "6px", verticalAlign: "middle" }} />Unlocked</span>
          <span><span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", background: "var(--arc-muted-2)", marginRight: "6px", verticalAlign: "middle" }} />Locked</span>
        </div>
      </div>

      <div className="arc-card" style={{ position: "relative", padding: "30px 18px", overflowX: "auto" }}>
        {TRACKS.map((track, ti) => (
          <div key={track.id} style={{
            display: "grid", gridTemplateColumns: "170px 1fr", gap: 0,
            alignItems: "center", minHeight: "128px", position: "relative", zIndex: 1,
            borderTop: ti > 0 ? "1px solid var(--arc-grat-soft)" : "none",
            paddingTop: ti > 0 ? "16px" : 0,
            marginTop: ti > 0 ? "8px" : 0,
          }}>
            <div>
              <div style={{ fontFamily: "var(--arc-display)", fontSize: "14px", color: "var(--arc-paper)" }}>{track.label}</div>
              <small style={{ display: "block", fontFamily: "var(--arc-mono)", fontSize: "10.5px", color: "var(--arc-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginTop: "3px" }}>{track.trackNum}</small>
            </div>
            <div style={{ display: "flex", gap: "46px", alignItems: "center", padding: "14px 10px" }}>
              {track.nodes.map(node => {
                const resolved = nodeStatuses.get(node.id) ?? node.status;
                const stars = getNodeStars(node);
                return (
                  <QuestNodeCard
                    key={node.id}
                    node={{ ...node, status: resolved, stars }}
                    onOpen={() => handleNodeOpen(node)}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
