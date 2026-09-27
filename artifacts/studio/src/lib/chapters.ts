export type StudioModelType = "p-median-us" | "transport-coal" | "p-median-brazil" | "two-echelon-gold-au" | "two-echelon-jade-us" | "chens-cosmetics-cn";

export interface Chapter {
  path: string;
  modelId: StudioModelType;
  chapter: string;
  title: string;
  description: string;
  hiddenFromLanding?: boolean;
  /**
   * ch4-lock — the chapter still appears on Landing but is greyed out,
   * labelled "locked", and not clickable (its Recent-Solves rows lose their
   * link too, so the lock can't be sidestepped from the history list).
   *
   * Deliberately DISTINCT from `hiddenFromLanding`: hidden means "don't
   * advertise this yet", locked means "advertise it as deliberately
   * unavailable". A hidden chapter shows nothing; a locked one shows a
   * closed door.
   *
   * SCOPE, stated plainly: this is a Landing-surface affordance only. The
   * chapter's route stays registered in App.tsx, so a direct URL or a
   * bookmarked deep link still opens the Workspace. Making the lock
   * enforceable needs a route guard (and, to be real, a server-side rule) —
   * not built here.
   */
  locked?: boolean;
  /** SCN v0.3 route cutover flag (DD-4): when true, App.tsx renders the new
   * tabbed Workspace page instead of Studio for this chapter's route. Set
   * per-chapter as each model's Workspace tab content lands (A5.1-A5.3
   * fast-follow flips other chapters); false/absent chapters keep Studio
   * unchanged until then. */
  workspace?: boolean;
  /** Studio header bar's compact title, e.g. "AL's Athletics · Model Lab". */
  labHeaderTitle: string;
  /** Studio header bar's mono subtitle line, e.g. "Ch 3 · p-median · facility location". */
  labHeaderSubtitle: string;
}

export const CHAPTERS: Chapter[] = [
  {
    path: "/chapter-3",
    modelId: "p-median-us",
    chapter: "Chapter 3",
    title: "AL's Athletics",
    description: "Facility-location: choose which warehouses to open to minimize weighted distance to customers.",
    workspace: true,
    labHeaderTitle: "AL's Athletics · Model Lab",
    labHeaderSubtitle: "Ch 3 · p-median · facility location",
  },
  {
    path: "/chapter-4",
    modelId: "chens-cosmetics-cn",
    chapter: "Chapter 4",
    title: "Chen's Cosmetics — Service Coverage",
    description: "Service-level facility location across China: open warehouses to maximize the demand served within a target service distance.",
    workspace: true,
    hiddenFromLanding: false,
    locked: true,
    labHeaderTitle: "Chen's Cosmetics · Model Lab",
    labHeaderSubtitle: "Ch 4 · service coverage · China warehouses → customers",
  },
  {
    path: "/chapter-5/transport",
    modelId: "transport-coal",
    chapter: "Chapter 5",
    title: "Coal Transport LP",
    description: "Transportation LP: route coal from mines to power stations at minimum cost.",
    hiddenFromLanding: true,
    workspace: true,
    labHeaderTitle: "Coal Transport LP · Model Lab",
    labHeaderSubtitle: "Ch 5 · transport LP · coal mines → power stations",
  },
  {
    path: "/chapter-5/brazil",
    modelId: "p-median-brazil",
    chapter: "Chapter 5",
    title: "Brazil Capacity — Capacitated P-Median",
    description: "Capacitated facility location: open warehouses under per-site capacity limits.",
    hiddenFromLanding: true,
    workspace: true,
    labHeaderTitle: "Brazil Capacity · Model Lab",
    labHeaderSubtitle: "Ch 5 · capacitated p-median · Brazil",
  },
  {
    path: "/chapter-10/gold-refinery",
    modelId: "two-echelon-gold-au",
    chapter: "Chapter 10",
    title: "Gold Refinery Siting — Two-Echelon",
    description: "Two-echelon facility location: site a refinery between a gold mine and ten customers, and watch the choice flip as the bill-of-materials ratio changes.",
    workspace: true,
    hiddenFromLanding: true,
    labHeaderTitle: "Gold Refinery Siting · Model Lab",
    labHeaderSubtitle: "Ch 10 · two-echelon LP · mine → refinery → customer",
  },
  {
    path: "/chapter-9/jade",
    modelId: "two-echelon-jade-us",
    chapter: "Chapter 9",
    title: "JADE Network — Multi-Product Two-Echelon",
    description: "Multi-product two-echelon facility location: choose which warehouses to open so plants can ship several distinct products through them to customers at minimum cost.",
    workspace: true,
    locked: true,
    labHeaderTitle: "JADE Network · Model Lab",
    labHeaderSubtitle: "Ch 9 · two-echelon multi-product · plants → warehouses → customers",
  },
];

export function chapterForModelId(modelId: string | undefined): Chapter | undefined {
  return CHAPTERS.find((c) => c.modelId === modelId);
}

export function chapterPathForModelId(modelId: string | undefined): string | undefined {
  return CHAPTERS.find((c) => c.modelId === modelId)?.path;
}
