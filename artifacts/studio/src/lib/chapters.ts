export type StudioModelType = "p-median-us" | "transport-coal" | "p-median-brazil" | "two-echelon-gold-au";

export interface Chapter {
  path: string;
  modelId: StudioModelType;
  chapter: string;
  title: string;
  description: string;
  hiddenFromLanding?: boolean;
  /** SCN v0.3 route cutover flag (DD-4): when true, App.tsx renders the new
   * tabbed Workspace page instead of Studio for this chapter's route. Set
   * per-chapter as each model's Workspace tab content lands (A5.1-A5.3
   * fast-follow flips other chapters); false/absent chapters keep Studio
   * unchanged until then. */
  workspace?: boolean;
  /** Studio header bar's compact title, e.g. "Al's Athletics · Model Lab". */
  labHeaderTitle: string;
  /** Studio header bar's mono subtitle line, e.g. "Ch 3 · p-median · facility location". */
  labHeaderSubtitle: string;
}

export const CHAPTERS: Chapter[] = [
  {
    path: "/chapter-3",
    modelId: "p-median-us",
    chapter: "Chapter 3",
    title: "Al's Athletics — P-Median",
    description: "Facility-location: choose which warehouses to open to minimize weighted distance to customers.",
    workspace: true,
    labHeaderTitle: "Al's Athletics · Model Lab",
    labHeaderSubtitle: "Ch 3 · p-median · facility location",
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
    labHeaderTitle: "Gold Refinery Siting · Model Lab",
    labHeaderSubtitle: "Ch 10 · two-echelon LP · mine → refinery → customer",
  },
];

export function chapterForModelId(modelId: string | undefined): Chapter | undefined {
  return CHAPTERS.find((c) => c.modelId === modelId);
}

export function chapterPathForModelId(modelId: string | undefined): string | undefined {
  return CHAPTERS.find((c) => c.modelId === modelId)?.path;
}
