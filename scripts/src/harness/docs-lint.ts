import { repoRoot } from "./lib/derive.js";
import { loadConfig, selectFiles } from "./docs-audit.js";
import { buildInventory } from "./lib/inventory.js";
import { staleReference } from "./lib/detectors/staleReference.js";

/**
 * The proposed `doc_drift` gate (docs/superpowers/gates/doc_drift.md). Runs ONLY the stale_reference
 * detector over the non-exempt docs and exits non-zero on any finding. Not wired into CI until the
 * human approves and the baseline is clean.
 */
function main() {
  const root = repoRoot();
  const cfg = loadConfig(root);
  const files = selectFiles(root, cfg).filter((f) => f.origin === "repo");
  const records = buildInventory(files, root);
  const findings = staleReference(records, cfg, root);
  for (const f of findings) process.stdout.write(`${f.file}:${f.lines[0]}  ${f.evidence}\n`);
  process.stdout.write(`\ndocs:lint — ${findings.length} stale reference(s)\n`);
  process.exit(findings.length > 0 ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
