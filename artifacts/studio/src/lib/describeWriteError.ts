const GENERIC = "Something went wrong. Please try again.";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/** A server message we can show a student. Rejects anything that looks like a
 *  serialised structure — belt and braces, since the formatter is supposed to
 *  make this unreachable. */
function usableSentence(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t === "") return null;
  if (t.startsWith("{") || t.startsWith("[")) return null;
  return t;
}

function detailFrom(errors: unknown): string | null {
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const parts = errors
    .map(e => usableSentence(e) ?? usableSentence(asRecord(e)?.message))
    .filter((s): s is string => s !== null);
  return parts.length > 0 ? parts.join("; ") : null;
}

// custom-fetch.ts's generated `ApiError` isn't re-exported from the package
// index (see custom-fetch.ts, and exportEntity.ts's `isLegacyResolveRejection`
// for the same workaround elsewhere in this codebase), so importing it here
// would mean reaching into package internals. Duck-type instead: ApiError
// always sets a numeric `status`, which a plain `Error` never does. This is
// a structural check, not a message-text one — unlike a `message.startsWith
// ("HTTP ")` test, it can't misfire on a genuine Error whose text happens to
// start that way (this repo's own test mocks do exactly that, e.g.
// `new Error("HTTP 422: ...")` in Studio.test.tsx / Workspace.test.tsx).
function isApiErrorShaped(err: unknown): boolean {
  return typeof asRecord(err)?.status === "number";
}

/**
 * Turns a mutation rejection into one sentence fit for a toast.
 *
 * Reads `ApiError.data` rather than `.message`, because custom-fetch.ts's
 * buildErrorMessage prefixes the message with "HTTP <status> <statusText>: ".
 * Reading `.data` avoids that prefix entirely instead of stripping it, so
 * there is no regex to drift.
 *
 * Two server body shapes are handled: `{ error }` (every input-validation
 * 422, formatted server-side) and `{ error, errors[] }` (the network-edit
 * precheck, where `error` is only a label and the reasons are in `errors`).
 */
export function describeWriteError(err: unknown, fallback: string = GENERIC): string {
  const data = asRecord(asRecord(err)?.data);
  if (data) {
    const detail = detailFrom(data.errors);
    const label = usableSentence(data.error);
    if (detail && label) return `${label}: ${detail}`;
    if (detail) return detail;
    if (label) return label;
  }
  if (err instanceof Error && !isApiErrorShaped(err)) {
    // A bare Error (not ApiError-shaped) carries no HTTP prefix convention to
    // worry about; an ApiError would have been handled by the `data` branch
    // above (or, if its body had nothing usable, falls through to `fallback`
    // below rather than leaking its own "HTTP ..." message).
    const m = usableSentence(err.message);
    if (m) return m;
  }
  return fallback;
}
