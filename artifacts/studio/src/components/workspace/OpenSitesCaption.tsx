import { useState } from "react";
import type { SolveResult } from "@workspace/api-client-react";
import type { EntityIdentity } from "@/lib/entityIdentity";
import { formatCityState } from "@/lib/formatLocation";
import { OPEN_SITE_NOUN, OPEN_SITE_NOUN_FALLBACK, openSiteIds } from "@/lib/openSites";

const SHOWN = 5;

// QFX-8 — one line above the Output Map naming the sites the displayed solve
// opened: "<Noun>: <displayId · City, ST>, … +N more". Ids come from the same
// openSiteIds() authority the narrative uses; labels from the SOLVED identity
// map (Workspace's outputIdentityById). Sorted by the displayed id,
// numeric-aware (W2 before W10). Renders nothing when no site is open.
export function OpenSitesCaption({ result, modelId, identityById }: {
  result: SolveResult | null;
  modelId?: string;
  identityById: Record<string, EntityIdentity>;
}) {
  const [expanded, setExpanded] = useState(false);
  const labels = (openSiteIds(result, modelId ?? "") ?? [])
    .map(id => identityById[id] ?? { displayId: id, city: "", state: "" })
    .sort((a, b) => a.displayId.localeCompare(b.displayId, undefined, { numeric: true }))
    .map(i => (i.city || i.state ? `${i.displayId} · ${formatCityState(i.city, i.state)}` : i.displayId));
  if (labels.length === 0) return null;
  const hidden = labels.length - SHOWN;
  const shown = expanded || hidden <= 0 ? labels : labels.slice(0, SHOWN);
  return (
    <p data-testid="output-map-open-sites" className="flex-shrink-0 text-xs leading-relaxed">
      <span className="text-muted-foreground">{OPEN_SITE_NOUN[modelId ?? ""] ?? OPEN_SITE_NOUN_FALLBACK}: </span>
      {shown.join(", ")}
      {hidden > 0 && (
        <>
          {" "}
          <button
            type="button"
            data-testid="output-map-open-sites-toggle"
            aria-expanded={expanded}
            className="text-primary hover:underline"
            onClick={() => setExpanded(e => !e)}
          >
            {expanded ? "Show fewer" : `+${hidden} more`}
          </button>
        </>
      )}
    </p>
  );
}
