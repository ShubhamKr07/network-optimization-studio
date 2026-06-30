import { test as setup } from "@playwright/test";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, ".auth/session.json");

// isLoggedIn lives in React state (not localStorage), so saving cookies
// alone doesn't bypass the login form. We just ensure the auth file exists
// so Playwright's storageState doesn't crash. Actual login is done per-test.
setup("create auth placeholder", async () => {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  if (!fs.existsSync(AUTH_FILE)) {
    fs.writeFileSync(AUTH_FILE, JSON.stringify({ cookies: [], origins: [] }));
  }
});
