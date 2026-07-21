export type StudioModelType = "p_median" | "transport" | "capacitated_pmedian";

export interface Chapter {
  path: string;
  problemType: StudioModelType;
  chapter: string;
  title: string;
  description: string;
}

export const CHAPTERS: Chapter[] = [
  {
    path: "/chapter-3",
    problemType: "p_median",
    chapter: "Chapter 3",
    title: "Al's Athletics — P-Median",
    description: "Facility-location: choose which warehouses to open to minimize weighted distance to customers.",
  },
  {
    path: "/chapter-5/transport",
    problemType: "transport",
    chapter: "Chapter 5",
    title: "Coal Transport LP",
    description: "Transportation LP: route coal from mines to power stations at minimum cost.",
  },
  {
    path: "/chapter-5/brazil",
    problemType: "capacitated_pmedian",
    chapter: "Chapter 5",
    title: "Brazil Capacity — Capacitated P-Median",
    description: "Capacitated facility location: open warehouses under per-site capacity limits.",
  },
];

export function chapterPathForProblemType(problemType: string | undefined): string | undefined {
  return CHAPTERS.find((c) => c.problemType === problemType)?.path;
}
