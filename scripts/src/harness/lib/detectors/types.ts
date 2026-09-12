import type { InventoryRecord } from "../inventory.js";

export interface Candidate {
  id: string;
  type: "stale_reference" | "superseded" | "redundant_passage" | "conflicting_instruction" | "orphan" | "memory_contradiction";
  origin: "repo" | "memory";
  file: string;
  lines: [number, number];
  evidence: string;
  related: string[];
}

export interface AuditConfig {
  include: string[];
  exclude: string[];
  memoryDir: string;
  authority: string[];
}

export type Detector = (records: InventoryRecord[], cfg: AuditConfig, repoRoot: string) => Candidate[];
