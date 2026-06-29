import { createContext, useContext, useReducer, useEffect, useRef, ReactNode } from "react";

export interface SolvedScenario {
  scenarioId: number;
  stars: number;
  avgDistance: number;
  solvedAt: string;
}

export interface GamificationState {
  isLoggedIn: boolean;
  userId: string | null;
  xp: number;
  level: number;
  streakDays: number;
  lastSolveDate: string | null;
  solvedScenarios: Record<number, SolvedScenario>;
  earnedBadges: string[];
  activeView: "dash" | "quest" | "lab" | "board" | "ach";
  activeQuestId: number;
  _synced: boolean;
}

const XP_THRESHOLDS = [0, 500, 1200, 2100, 3200, 4500, 6000, 7800, 9800, 12000];

function computeLevel(xp: number): number {
  let level = 1;
  for (let i = 1; i < XP_THRESHOLDS.length; i++) {
    if (xp >= XP_THRESHOLDS[i]) level = i + 1;
    else break;
  }
  return level;
}

function checkBadges(state: GamificationState, newSolved: Record<number, SolvedScenario>): string[] {
  const badges = [...state.earnedBadges];
  const solvedCount = Object.keys(newSolved).length;

  if (solvedCount >= 1 && !badges.includes("first_solve")) badges.push("first_solve");
  if (Object.values(newSolved).some(s => s.stars === 3) && !badges.includes("three_stars")) badges.push("three_stars");
  if (state.streakDays >= 7 && !badges.includes("week_streak")) badges.push("week_streak");
  if (state.xp >= 1000 && !badges.includes("speed_solver")) badges.push("speed_solver");

  return badges;
}

type Action =
  | { type: "LOGIN"; userId: string }
  | { type: "LOGOUT" }
  | { type: "SET_VIEW"; view: GamificationState["activeView"] }
  | { type: "SET_QUEST"; questId: number }
  | { type: "AWARD_XP"; amount: number; scenarioId: number; stars: number; avgDistance: number }
  | { type: "LOAD"; state: Partial<GamificationState> };

function reducer(state: GamificationState, action: Action): GamificationState {
  switch (action.type) {
    case "LOGIN":
      return { ...DEFAULT_STATE, isLoggedIn: true, userId: action.userId };
    case "LOGOUT":
      return { ...DEFAULT_STATE };
    case "SET_VIEW":
      return { ...state, activeView: action.view };
    case "SET_QUEST":
      return { ...state, activeQuestId: action.questId };
    case "AWARD_XP": {
      const today = new Date().toISOString().slice(0, 10);
      const isNewDay = state.lastSolveDate !== today;
      const newStreak = isNewDay ? state.streakDays + 1 : state.streakDays;

      const newSolved: Record<number, SolvedScenario> = {
        ...state.solvedScenarios,
        [action.scenarioId]: {
          scenarioId: action.scenarioId,
          stars: Math.max(action.stars, state.solvedScenarios[action.scenarioId]?.stars ?? 0),
          avgDistance: action.avgDistance,
          solvedAt: new Date().toISOString(),
        },
      };

      const newXp = state.xp + action.amount;
      const newLevel = computeLevel(newXp);
      const newBadges = checkBadges({ ...state, xp: newXp, streakDays: newStreak }, newSolved);

      return {
        ...state,
        xp: newXp,
        level: newLevel,
        streakDays: newStreak,
        lastSolveDate: today,
        solvedScenarios: newSolved,
        earnedBadges: newBadges,
      };
    }
    case "LOAD":
      return { ...state, ...action.state, _synced: true };
    default:
      return state;
  }
}

const DEFAULT_STATE: GamificationState = {
  isLoggedIn: false,
  userId: null,
  xp: 0,
  level: 1,
  streakDays: 0,
  lastSolveDate: null,
  solvedScenarios: {},
  earnedBadges: [],
  activeView: "dash",
  activeQuestId: 1,
  _synced: false,
};

async function fetchProgress(): Promise<Partial<GamificationState> | null> {
  try {
    const res = await fetch("/api/progress", { credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json() as {
      xp: number;
      level: number;
      streakDays: number;
      lastSolveDate: string | null;
      solvedScenarios: Record<string, unknown>;
      earnedBadges: string[];
    };
    return {
      xp: data.xp,
      level: data.level,
      streakDays: data.streakDays,
      lastSolveDate: data.lastSolveDate,
      solvedScenarios: data.solvedScenarios as Record<number, SolvedScenario>,
      earnedBadges: data.earnedBadges,
    };
  } catch {
    return null;
  }
}

async function pushProgress(state: GamificationState): Promise<void> {
  if (!state.isLoggedIn) return;
  try {
    await fetch("/api/progress", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        xp: state.xp,
        level: state.level,
        streakDays: state.streakDays,
        lastSolveDate: state.lastSolveDate,
        solvedScenarios: state.solvedScenarios,
        earnedBadges: state.earnedBadges,
      }),
    });
  } catch {
    // silent — progress will retry on next interaction
  }
}

interface GamificationContextValue {
  state: GamificationState;
  login: (userId: string) => Promise<void>;
  logout: () => void;
  setView: (view: GamificationState["activeView"]) => void;
  setActiveQuest: (questId: number) => void;
  awardXP: (amount: number, scenarioId: number, stars: number, avgDistance: number) => void;
  xpToNextLevel: () => { current: number; next: number; pct: number };
}

const GamificationContext = createContext<GamificationContextValue | null>(null);

export function GamificationProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, DEFAULT_STATE);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced sync to API whenever synced state changes
  useEffect(() => {
    if (!state._synced || !state.isLoggedIn) return;

    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      pushProgress(state);
    }, 800);

    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [state]);

  const login = async (userId: string) => {
    const uid = userId.trim().toLowerCase();
    // Tell the server to issue a signed session cookie
    await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ userId: uid }),
    });

    dispatch({ type: "LOGIN", userId: uid });

    // Load this user's saved progress
    const apiData = await fetchProgress();
    if (apiData) {
      dispatch({ type: "LOAD", state: apiData });
    } else {
      dispatch({ type: "LOAD", state: {} });
    }
  };

  const logout = () => {
    fetch("/api/logout", { method: "POST", credentials: "include" }).catch(() => {});
    dispatch({ type: "LOGOUT" });
  };

  const setView = (view: GamificationState["activeView"]) => dispatch({ type: "SET_VIEW", view });
  const setActiveQuest = (questId: number) => dispatch({ type: "SET_QUEST", questId });
  const awardXP = (amount: number, scenarioId: number, stars: number, avgDistance: number) =>
    dispatch({ type: "AWARD_XP", amount, scenarioId, stars, avgDistance });

  const xpToNextLevel = () => {
    const current = state.xp;
    const levelIdx = state.level - 1;
    const thisLevelXP = XP_THRESHOLDS[levelIdx] ?? 0;
    const nextLevelXP = XP_THRESHOLDS[levelIdx + 1] ?? XP_THRESHOLDS[XP_THRESHOLDS.length - 1];
    const pct = Math.min(100, ((current - thisLevelXP) / (nextLevelXP - thisLevelXP)) * 100);
    return { current, next: nextLevelXP, pct };
  };

  return (
    <GamificationContext.Provider value={{ state, login, logout, setView, setActiveQuest, awardXP, xpToNextLevel }}>
      {children}
    </GamificationContext.Provider>
  );
}

export function useGamification() {
  const ctx = useContext(GamificationContext);
  if (!ctx) throw new Error("useGamification must be used inside GamificationProvider");
  return ctx;
}

export { XP_THRESHOLDS };
export const LEVEL_NAMES = [
  "Novice", "Analyst", "Optimizer", "Strategist",
  "Specialist", "Expert", "Network Strategist", "Master",
  "Grand Master", "Network Architect"
];
