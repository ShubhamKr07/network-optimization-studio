import { test as setup } from "@playwright/test";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, ".auth/session.json");

// Auth is a real signed session cookie now, but each spec registers its own
// fresh account (for isolation between tests) rather than sharing one login
// across the suite via storageState. We just ensure the auth file exists so
// Playwright's storageState config doesn't crash on a missing file.
setup("create auth placeholder", async () => {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  if (!fs.existsSync(AUTH_FILE)) {
    fs.writeFileSync(AUTH_FILE, JSON.stringify({ cookies: [], origins: [] }));
  }
});
