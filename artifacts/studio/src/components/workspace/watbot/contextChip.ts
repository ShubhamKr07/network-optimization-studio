import type { WorkspaceView } from "@/lib/workspaceView";

export function buildContextChip(view: WorkspaceView | null, scenario: { name: string; inputs?: unknown } | null) {
  if (!view && !scenario) return null;
  const parts: string[] = [];
  if (view) parts.push(view.label);
  if (scenario) parts.push(scenario.name);
  const p = (scenario?.inputs as { p?: unknown } | undefined)?.p;
  if (typeof p === "number") parts.push(`p = ${p}`);
  return { label: parts.join(" · "), tab: view?.entity ?? null };
}
