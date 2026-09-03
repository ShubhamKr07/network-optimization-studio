export interface StaleOutputBannerProps {
  onRunOptimizer?: () => void;
  /** false = never solved ("Not yet solved"); true = solved but stale. */
  solved?: boolean;
}
