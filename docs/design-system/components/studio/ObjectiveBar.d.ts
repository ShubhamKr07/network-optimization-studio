export interface ObjectiveBarProps {
  /** Mono uppercase eyebrow, e.g. "Chapter 3". */
  kicker?: string;
  /** Model title, e.g. "Al's Athletics — P-Median". */
  title?: string;
  scenarioName?: string;
  /** Teaching-intent description of the model. */
  description?: string;
  /** Plain solve stats, e.g. ["objective 2,384,911", "avg distance 413 mi", "run 0.24s"]. Empty = "Not yet solved". */
  stats?: string[];
}
