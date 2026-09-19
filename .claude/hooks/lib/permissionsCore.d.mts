/**
 * Type declarations for the dependency-free plain-ESM `permissionsCore.mjs`, so TypeScript
 * consumers (e.g. `scripts/src/harness/lib/permissions.ts`) get typed imports without this module
 * itself needing a build step (it must stay directly runnable by the standalone Claude Code hook).
 */

/** Escape one rendered string for a Markdown table cell — see permissionsCore.mjs for the locked order. */
export declare function escapeCell(input: string): string;

/** Deterministically redact a raw command into typed placeholders (`<db-url>`, `<token>`, etc). */
export declare function redactCommand(command: string): string;

/** True if the command, after redaction, still carries a secret keyword or a residual high-entropy token. */
export declare function scanSensitive(command: string): boolean;

/** SHA-256 hex digest of a UTF-8 string. */
export declare function sha256Hex(input: string): string;
