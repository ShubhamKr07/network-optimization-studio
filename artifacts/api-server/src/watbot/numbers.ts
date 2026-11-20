// artifacts/api-server/src/watbot/numbers.ts
// Number reading shared by the D20 value check and the FR-44 grader (Task 11).

// "1,234,567.8" · "$1.23M" · "1.2 million" · "45k" → numbers. Lowercase "m" is a
// distance unit (metres/miles) and "km" is not the k multiplier.
const NUMBER_RE = /(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(million\b|M\b|[kK]\b)?/g;

export function extractNumbers(text: string): number[] {
  return [...text.matchAll(NUMBER_RE)].map((m) => {
    const n = Number(m[1]!.replace(/,/g, "") + (m[2] ?? ""));
    const unit = m[3];
    return unit === "million" || unit === "M" ? n * 1_000_000 : unit ? n * 1_000 : n;
  });
}

// A candidate "is" the value when it equals the value rounded to 2+ significant
// figures. One significant figure ("about 1 million") is too coarse to count.
export function matchesValue(candidate: number, value: number): boolean {
  for (let k = 2; k <= 15; k++) {
    if (Math.abs(candidate - Number(value.toPrecision(k))) <= Math.abs(value) * 1e-9) return true;
  }
  return false;
}
