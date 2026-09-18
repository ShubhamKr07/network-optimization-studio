// Dependency-free, plain ESM. Shared by the standalone `.claude/hooks/permission-ledger.mjs` hook
// (which cannot import an uncompiled .ts module) AND `scripts/src/harness/lib/permissions.ts`
// (which re-exports these directly, never duplicates this logic — see permission-review-loop
// design doc, Important 5). Only Node builtins — no third-party deps, no bundler needed to run
// standalone as a hook script.
//
// See `docs/superpowers/specs/2026-09-18-permission-review-loop-design.md` and
// `docs/superpowers/plans/2026-09-18-permission-review-loop.md` (Task 2) for the design + the
// locked escaping contract this module implements verbatim.

import { createHash } from "node:crypto";

/**
 * Escape one rendered artifact string for safe inclusion in a Markdown table cell (and as
 * HTML-adjacent text, since GitHub renders Markdown-in-HTML). Order is LOCKED — do not reorder,
 * add, or remove a step without updating the design doc's canonical escaping contract:
 *
 *   1. control chars (CR, LF, NUL, and every other C0/DEL control char) -> single space (each,
 *      not collapsed)
 *   2. "&"  -> "&amp;"
 *   3. "<"  -> "&lt;"
 *   4. ">"  -> "&gt;"
 *   5. "|"  -> "\|"
 *   6. "`"  -> "\`"
 *   7. strip Unicode bidirectional control characters (U+202A-U+202E, U+2066-U+2069) — these can
 *      visually reorder rendered text (e.g. to disguise a command) and carry no useful information
 *      in a redacted preview.
 *
 * @param {string} input
 * @returns {string}
 */
export function escapeCell(input) {
  let out = input.replace(/[\x00-\x1f\x7f]/g, " ");
  out = out.replace(/&/g, "&amp;");
  out = out.replace(/</g, "&lt;");
  out = out.replace(/>/g, "&gt;");
  out = out.replace(/\|/g, "\\|");
  out = out.replace(/`/g, "\\`");
  out = out.replace(/[\u202A-\u202E\u2066-\u2069]/g, "");
  return out;
}

// Deterministic, ordered redaction rules. Order matters: a rule that recognizes a whole
// credentialed URL must run before the plain-email rule, or the URL's `user@host` fragment would
// be redacted as `<email>` first and never match the URL pattern as a whole.
const REDACTIONS = [
  // scheme://user:pass@host[:port]/path style connection strings (db and otherwise).
  { placeholder: "<db-url>", re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|amqp|amqps):\/\/\S+/gi },
  // Bearer tokens / Authorization headers.
  { placeholder: "<token>", re: /\bBearer\s+[A-Za-z0-9._-]+/gi },
  { placeholder: "<token>", re: /(--token|--api-key|-{0,2}token=|-{0,2}api[_-]?key=)\s*[A-Za-z0-9._-]+/gi },
  // password=... / --password xxx / -p xxx (explicit password flags only, not every "-p").
  { placeholder: "<password>", re: /(--password[= ]|password[= ])\S+/gi },
  // email addresses.
  { placeholder: "<email>", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // inline KEY=value environment prefixes, e.g. `FOO_BAR=baz some-command`.
  { placeholder: "<env>", re: /\b[A-Z][A-Z0-9_]{2,}=\S+/g },
  // absolute home-directory paths.
  { placeholder: "<home-path>", re: /\/(?:Users|home)\/[^/\s]+/g },
];

/**
 * Deterministically redact a raw command string into typed placeholders, so a redacted preview
 * can be safely committed to Git without leaking a credential, connection string, or PII.
 * @param {string} command
 * @returns {string}
 */
export function redactCommand(command) {
  let out = command;
  for (const { placeholder, re } of REDACTIONS) {
    out = out.replace(re, placeholder);
  }
  return out;
}

// Secret keyword indicators — deliberately case-insensitive and independent of the redaction
// placeholders above (a keyword can appear even when no value-shaped pattern matched).
const SECRET_KEYWORD_RE = /\b(SECRET|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|CREDENTIAL)\b/i;

// A "mixed-class" token: at least one letter AND one digit, contiguous, no whitespace.
function isMixedClassToken(token) {
  return /[A-Za-z]/.test(token) && /[0-9]/.test(token);
}

/**
 * Flag a command as sensitive if, AFTER redaction, it still carries a secret keyword or a
 * residual ≥16-character mixed-class token (letters+digits) that looks like a leftover credential
 * the deterministic redaction rules didn't recognize. Scans the redacted text (not the raw
 * command) — the point is to catch what redaction MISSED, not to re-flag what it already handled.
 * @param {string} command
 * @returns {boolean}
 */
export function scanSensitive(command) {
  const redacted = redactCommand(command);
  if (SECRET_KEYWORD_RE.test(redacted)) return true;
  const tokens = redacted.match(/[A-Za-z0-9+/_.=-]{16,}/g) ?? [];
  return tokens.some(isMixedClassToken);
}

/**
 * SHA-256 hex digest of a UTF-8 string. Shared so the standalone hook and the TS harness always
 * compute identical digests for the same input.
 * @param {string} input
 * @returns {string}
 */
export function sha256Hex(input) {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
