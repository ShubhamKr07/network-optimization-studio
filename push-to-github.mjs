import { ReplitConnectors } from "@replit/connectors-sdk";
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";

const connectors = new ReplitConnectors();
const OWNER = "ShubhamKr07";
const REPO = "network-optimization-studio";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function ghProxy(path, method = "GET", body = null, retries = 4) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const opts = { method, headers: { "Content-Type": "application/json" } };
    if (body) opts.body = JSON.stringify(body);
    const res = await connectors.proxy("github", path, opts);
    const text = await res.text();
    if (text.startsWith("<")) {
      // Got HTML - rate limit or proxy error, back off
      const wait = 2000 * (attempt + 1);
      console.warn(`  HTML response on ${path}, waiting ${wait}ms...`);
      await sleep(wait);
      continue;
    }
    const data = JSON.parse(text);
    if (res.status === 429 || res.status === 403) {
      const wait = 3000 * (attempt + 1);
      console.warn(`  Rate limited, waiting ${wait}ms...`);
      await sleep(wait);
      continue;
    }
    if (res.status >= 400) throw new Error(`GitHub API ${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
    return data;
  }
  throw new Error(`Failed after retries: ${method} ${path}`);
}

// Get existing main branch sha (repo already initialized in previous run)
console.log("Getting current main branch...");
const ref = await ghProxy(`/repos/${OWNER}/${REPO}/git/ref/heads/main`);
const baseSha = ref.object.sha;
const baseCommit = await ghProxy(`/repos/${OWNER}/${REPO}/git/commits/${baseSha}`);
const baseTreeSha = baseCommit.tree.sha;
console.log("Base commit:", baseSha, "tree:", baseTreeSha);

// Get all tracked files
const files = execSync("git ls-files", { cwd: "/home/runner/workspace" })
  .toString().trim().split("\n")
  .filter(f => f && !f.startsWith(".git"));

console.log(`Creating blobs for ${files.length} files...`);

const treeEntries = [];
let count = 0;
for (const filePath of files) {
  const fullPath = `/home/runner/workspace/${filePath}`;
  if (!existsSync(fullPath)) continue;

  let content;
  try {
    content = readFileSync(fullPath).toString("base64");
  } catch (e) {
    console.warn(`  skip ${filePath}: ${e.message}`);
    continue;
  }

  const blob = await ghProxy(`/repos/${OWNER}/${REPO}/git/blobs`, "POST", { content, encoding: "base64" });
  treeEntries.push({ path: filePath, mode: "100644", type: "blob", sha: blob.sha });
  count++;
  if (count % 10 === 0) {
    console.log(`  ${count}/${files.length} blobs done...`);
    await sleep(300); // throttle every 10 files
  }
}

console.log(`All ${count} blobs done. Creating tree...`);

const tree = await ghProxy(`/repos/${OWNER}/${REPO}/git/trees`, "POST", {
  base_tree: baseTreeSha,
  tree: treeEntries,
});
console.log("Tree:", tree.sha);

const commit = await ghProxy(`/repos/${OWNER}/${REPO}/git/commits`, "POST", {
  message: "Initial commit: Network Optimization Studio\n\nP-Median facility location ILP solver (PuLP/CBC), React + Vite frontend,\nscenario management, interactive maps, Before/After comparison.\nBuilt for undergraduate supply chain optimization education.",
  tree: tree.sha,
  parents: [baseSha],
});
console.log("Commit:", commit.sha);

await ghProxy(`/repos/${OWNER}/${REPO}/git/refs/heads/main`, "PATCH", {
  sha: commit.sha,
  force: true,
});

console.log("\nDone! https://github.com/" + OWNER + "/" + REPO);
