export type StudioModelType = "p-median-us" | "transport-coal" | "p-median-brazil";

export interface Chapter {
  path: string;
  modelId: StudioModelType;
  chapter: string;
  title: string;
  description: string;
}

export const CHAPTERS: Chapter[] = [
  {
    path: "/chapter-3",
    modelId: "p-median-us",
    chapter: "Chapter 3",
    title: "Al's Athletics — P-Median",
    description: "Facility-location: choose which warehouses to open to minimize weighted distance to customers.",
  },
  {
    path: "/chapter-5/transport",
    modelId: "transport-coal",
    chapter: "Chapter 5",
    title: "Coal Transport LP",
    description: "Transportation LP: route coal from mines to power stations at minimum cost.",
  },
  {
    path: "/chapter-5/brazil",
    modelId: "p-median-brazil",
    chapter: "Chapter 5",
    title: "Brazil Capacity — Capacitated P-Median",
    description: "Capacitated facility location: open warehouses under per-site capacity limits.",
  },
];

export function chapterPathForModelId(modelId: string | undefined): string | undefined {
  return CHAPTERS.find((c) => c.modelId === modelId)?.path;
}
