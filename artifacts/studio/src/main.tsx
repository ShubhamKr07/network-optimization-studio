import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import { initAnalytics } from "./lib/analytics";
import "./index.css";

setBaseUrl(import.meta.env.VITE_API_BASE_URL ?? null);
initAnalytics();

createRoot(document.getElementById("root")!).render(<App />);
