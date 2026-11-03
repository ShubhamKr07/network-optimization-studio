import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import { initAnalytics } from "./lib/analytics";
import { initErrorTracking, SentryErrorBoundary } from "./lib/errorTracking";
import { UnitProvider } from "./contexts/UnitContext";
import "./lib/leafletZoomGuard";
import "./index.css";
import { applyTheme, getThemePref } from "@/lib/theme";

setBaseUrl(import.meta.env.VITE_API_BASE_URL ?? null);
initAnalytics();
initErrorTracking();
applyTheme(getThemePref());
window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
  if (getThemePref() === "system") applyTheme("system");
});

createRoot(document.getElementById("root")!).render(
  <SentryErrorBoundary fallback={<div className="p-8 text-center">Something went wrong. Please reload.</div>}>
    <UnitProvider>
      <App />
    </UnitProvider>
  </SentryErrorBoundary>,
);
