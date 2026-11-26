import { Link } from "wouter";
import { formatDistanceDisplay } from "@/lib/formatDistanceDisplay";
import { ArrowRight, Lock } from "lucide-react";
import { CHAPTERS, chapterPathForModelId, chapterForModelId } from "@/lib/chapters";
import { useGetSolveHistory, useGetLandingSummary } from "@workspace/api-client-react";
import { formatRelativeTime } from "@/lib/relativeTime";
import { formatChenObjective, formatObjective as formatObjectiveShared } from "@/lib/formatObjective";
import { useDisplayUnit, type UnitApi } from "@/contexts/UnitContext";
import type { CanonicalUnit } from "@workspace/units";
import { isRetryableFailureCode } from "@/lib/solveFailure";
import { UnverifiedInfo } from "@/components/UnverifiedInfo";

function chapterNumeral(chapterLabel: string): string | null {
  return chapterLabel.match(/\d+/)?.[0] ?? null;
}

function pluralScenarios(n: number): string {
  return `${n} ${n === 1 ? "scenario" : "scenarios"}`;
}

const NetworkGlyph = () => (
  <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
    <path d="M8 30 20 10 32 28 8 30M20 10v20" />
    <circle cx="8" cy="30" r="4" fill="currentColor" /><circle cx="20" cy="10" r="4" fill="currentColor" />
    <circle cx="32" cy="28" r="4" fill="currentColor" /><circle cx="20" cy="30" r="3" fill="var(--home-card)" />
  </svg>
);

// `GetSolveHistoryResponseItem.distanceUnit` is a plain `string` at the
// schema level, but the contract (see its own description) guarantees it is
// always "mi"|"km", never anything else, never absent — narrowed defensively
// here rather than trusted blindly.
function asCanonicalUnit(raw: string): CanonicalUnit | null {
  return raw === "km" || raw === "mi" ? raw : null;
}

// D14/C4.10, chen-bands-units Part D decision 6 — every recent-solves row
// carries BOTH `modelId` and `distanceUnit` synchronously (no manifest fetch
// needed, unlike ObjectiveBar/CostSummaryTab), so the six-model
// `formatObjective` contract is used unconditionally per row rather than
// gated on an async resolution. `formatChenObjective`'s narrower
// mode-agnostic default is kept only as a genuinely-defensive fallback for a
// malformed/unexpected `distanceUnit` value, which the contract says cannot
// happen — not a "canonical unresolved" case.
function formatHistoryObjective(
  h: { objective: number; objectiveMode: string | null; modelId: string; distanceUnit: string },
  unit: UnitApi,
): string {
  const canonical = asCanonicalUnit(h.distanceUnit);
  if (canonical != null) {
    return formatObjectiveShared(h.modelId, h.objectiveMode, h.objective, canonical, unit);
  }
  return formatChenObjective(h.objective, h.objectiveMode) ?? `obj ${h.objective.toExponential(2)}`;
}

function formatHistoryDistance(h: { weightedAvgDistance: number; distanceUnit: string }, unit: UnitApi): string {
  const canonical = asCanonicalUnit(h.distanceUnit);
  if (canonical != null) {
    return `${formatDistanceDisplay(unit.toDisplay(h.weightedAvgDistance, canonical))} ${unit.effectiveUnit(canonical)}`;
  }
  return `${formatDistanceDisplay(h.weightedAvgDistance)} ${h.distanceUnit}`;
}

export function Landing() {
  const unit = useDisplayUnit();
  const { data: history } = useGetSolveHistory({ limit: 5 });
  const { data: summary, isPending, isError } = useGetLandingSummary();
  // TanStack retains the last successful `data` through a background-refetch
  // error, so `summary != null` alone would treat a stale-then-errored summary
  // as ready. Gate on the flags too — pending OR errored falls back to the T2
  // baseline (numeral + Start, no stats line), never a half-filled footer.
  const ready = !isPending && !isError && summary != null;
  const byModel = new Map((summary?.perChapter ?? []).map((r) => [r.modelId, r]));

  const hiddenModelIds = new Set<string>(CHAPTERS.filter((c) => c.hiddenFromLanding).map((c) => c.modelId));
  const visibleHistory = history?.filter((h) => !hiddenModelIds.has(h.modelId));
  const visiblePerChapter = (summary?.perChapter ?? []).filter((r) => !hiddenModelIds.has(r.modelId));

  // The single most-recently-solved VISIBLE chapter — that card shows
  // "Active"; every other shows "Start →".
  let activeModelId: string | undefined;
  let activeAt = -Infinity;
  for (const r of visiblePerChapter) {
    if (!r.lastSucceededSolveAt) continue;
    const t = new Date(r.lastSucceededSolveAt).getTime();
    if (t > activeAt) { activeAt = t; activeModelId = r.modelId; }
  }

  const visibleLabs = CHAPTERS.filter((c) => !c.hiddenFromLanding).length;
  const visibleScenarios = visiblePerChapter.reduce((sum, r) => sum + r.scenarioCount, 0);
  const visibleSolved = visiblePerChapter.reduce((sum, r) => sum + r.solvedScenarioCount, 0);

  return (
    <div className="home-page wrap">
      <div className="head">
        <div>
          <h1>Labs</h1>
          <p className="sub">Pick a chapter to start or continue a scenario.</p>
        </div>
        {ready && summary && (
          <span data-testid="landing-stats-line" className="stats">
            {visibleLabs} labs · {pluralScenarios(visibleScenarios)} · {visibleSolved} solved
          </span>
        )}
      </div>
      <ul className="home-grid">
        {CHAPTERS.filter((c) => !c.hiddenFromLanding).map((c) => {
          // ch4-lock — a locked chapter still shows (unlike hiddenFromLanding)
          // but reads as a closed door: greyed, no hover affordance, and NOT
          // wrapped in a <Link>, so the whole card is genuinely inert rather
          // than a link styled to look disabled.
          const locked = c.locked === true;
          const numeral = chapterNumeral(c.chapter);
          const entry = byModel.get(c.modelId);
          const status = locked
            ? "locked"
            : !ready
              ? null
              : !entry || entry.scenarioCount === 0
                ? "no scenarios yet"
                : entry.lastSucceededSolveAt
                  ? `${pluralScenarios(entry.scenarioCount)} · solved ${formatRelativeTime(entry.lastSucceededSolveAt)}`
                  : pluralScenarios(entry.scenarioCount);
          // A locked chapter never claims "Active", even if it happens to
          // hold the most recent solve — that would contradict the lock.
          const isActive = !locked && ready && c.modelId === activeModelId;
          const card = (
            <article className="home-card" data-testid={`landing-card-${c.modelId}`} data-locked={locked ? "true" : undefined}>
              <div className="card-body">
                <span className="num" aria-hidden="true">{numeral ?? <NetworkGlyph />}</span>
                <h2 className="title"><span className="sr">{c.chapter}: </span>{c.title}</h2>
                <p className="desc">{c.description}</p>
              </div>
              <div className="card-foot" data-testid={`landing-card-footer-${c.modelId}`}>
                <span className="status">{status}</span>
                {locked ? (
                  <span className="chip neutral" data-testid={`landing-card-locked-${c.modelId}`}><Lock size={11} aria-hidden="true" />Locked</span>
                ) : isActive ? (
                  <span className="chip ok"><span className="dotm" />Active</span>
                ) : (
                  <span className="go">Start<ArrowRight size={14} aria-hidden="true" /></span>
                )}
              </div>
            </article>
          );
          return (
            <li key={c.path}>
              {locked ? (
                <div data-testid={`locked-${c.path}`} title="This chapter is locked.">{card}</div>
              ) : (
                <Link href={c.path} data-testid={`link-${c.path}`}>{card}</Link>
              )}
            </li>
          );
        })}
      </ul>

      {visibleHistory && visibleHistory.length > 0 && (
        <section className="home-recent" aria-labelledby="home-recent-h">
          <h2 id="home-recent-h">Recent solves</h2>
          <p className="sub">Most recent solve per scenario — click to open one.</p>
          <ul className="rows">
            {visibleHistory.map((h) => {
              const chapterPath = chapterPathForModelId(h.modelId);
              // A9 (SCND correctness, §2.7.1) — `h.status` is the job-
              // lifecycle status, always authoritative on its own: a
              // superseded-but-successful job (A7) is a real "succeeded"
              // status here and must render as such, NEVER as a failure —
              // this badge is derived from `h.status` alone, with no
              // second-guessing from any other field. `legacyUnverified` is
              // an orthogonal PROOF-STATE concern layered on top only for a
              // succeeded row: a normalized-legacy/unverified result still
              // "succeeded" as a job, it just isn't a verified proof — so it
              // gets an ADDITIONAL neutral "unverified" badge, never
              // promoted to (and never rendered as) anything resembling
              // "Proven optimal".
              const isRetryable = h.status === "failed" && isRetryableFailureCode(h.errorCode);
              const unverified = h.status === "succeeded" && h.legacyUnverified;
              const statusChip = h.status === "succeeded" ? "ok" : h.status === "failed" ? "bad" : "warn";
              const row = (
                <div className="row">
                  <span className="ch">{chapterForModelId(h.modelId)?.chapter ?? ""}</span>
                  <span className="sc">{h.scenarioName}</span>
                  <span className="tags">
                    <span className={`chip ${statusChip}`}><span className="dotm" />{h.status}</span>
                    {unverified && <span className="chip neutral" data-testid={`badge-legacy-unverified-${h.id}`}>unverified</span>}
                    {isRetryable && <span className="retry" data-testid={`link-retry-solve-history-${h.id}`}>Retry<ArrowRight size={13} aria-hidden="true" /></span>}
                  </span>
                  <span className="figs">
                    {h.objective != null && <span>{formatHistoryObjective({ ...h, objective: h.objective }, unit)}</span>}
                    {h.weightedAvgDistance != null && <span>{formatHistoryDistance({ ...h, weightedAvgDistance: h.weightedAvgDistance }, unit)}</span>}
                    {h.runTimeSec != null && <span>{h.runTimeSec.toFixed(2)}s</span>}
                  </span>
                  {/* A9 — failure rendering consumes errorCode/errorMessage
                      (A5's permanent, server-owned safe strings), never a
                      raw diagnostic; there is no raw diagnostic anywhere on
                      this typed response to fall back to. */}
                  {h.status === "failed" && h.errorMessage && (
                    <p className="err" data-testid={`text-error-message-${h.id}`}>{h.errorMessage}</p>
                  )}
                </div>
              );
              // ch4-lock — a locked chapter's history rows lose their link
              // too. Leaving them clickable would let a student walk straight
              // into a chapter whose card says "Locked", which is worse than
              // no lock at all: the rule would look arbitrary rather than
              // absent. The row still RENDERS (the solve happened; hiding it
              // would misreport their own history), just inert.
              const rowLocked = chapterForModelId(h.modelId)?.locked === true;
              // DU-3.F2 — the ⓘ is a SIBLING of the link (a <button> inside an <a> is
              // invalid HTML and an a11y trap), so it needs no preventDefault.
              const info = unverified ? <div className="pr-3 flex-shrink-0"><UnverifiedInfo /></div> : null;
              return chapterPath && !rowLocked ? (
                <li key={h.id}>
                  <Link href={`${chapterPath}?scenario=${h.scenarioId}`} data-testid={`link-solve-history-${h.id}`} className="row-link">{row}</Link>
                  {info}
                </li>
              ) : (
                <li key={h.id} data-locked={rowLocked ? "true" : undefined} data-testid={rowLocked ? `locked-solve-history-${h.id}` : undefined} title={rowLocked ? "This chapter is locked." : undefined}>
                  <div className="row-link">{row}</div>
                  {info}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
