import app from "./app";
import { logger } from "./lib/logger";
import { reapStuckJobs } from "./solver/jobRunner.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Startup reaper — clear any "running" jobs orphaned by a prior process
// before we begin accepting requests. Wrapped so a failure here can never
// block the server from coming up (best-effort cleanup).
try {
  await reapStuckJobs();
} catch {
  /* never block startup */
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
