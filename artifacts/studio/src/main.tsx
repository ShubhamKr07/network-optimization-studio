import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import { initAnalytics } from "./lib/analytics";
import { initErrorTracking, SentryErrorBoundary } from "./lib/errorTracking";
import "./index.css";

setBaseUrl(import.meta.env.VITE_API_BASE_URL ?? null);
initAnalytics();
initErrorTracking();

createRoot(document.getElementById("root")!).render(
  <SentryErrorBoundary fallback={<div className="p-8 text-center">Something went wrong. Please reload.</div>}>
    <App />
  </SentryErrorBoundary>,
);
