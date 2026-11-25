// WQF-A5 — where the cited text sits in its passage, for the citation popover. Free of KaTeX,
// so the main bundle can split a page without loading the lazy MathText chunk.

// $$…$$, or single-$ inline math that starts with a \command ($\forall$); a price such as
// "$2 or $3" never starts with a backslash, so it stays text. Inline math ends at its line, so
// an unclosed $\cmd (a quote cut mid-formula) cannot swallow the next paragraph.
export const MATH = /\$\$([\s\S]+?)\$\$|\$(\\[a-zA-Z][^$\n]*)\$/g;

export type Segment = { text: string; math: boolean; mark: boolean };

// Runs of whitespace become one space; at[i] is where the i-th kept character sits in `s`.
function collapse(s: string) {
  let text = "";
  const at: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const space = /\s/.test(s[i]!);
    if (space && text.endsWith(" ")) continue;
    text += space ? " " : s[i];
    at.push(i);
  }
  return { text, at };
}

// [start, end) of the cited text in `body`: the first exact match once whitespace runs are
// collapsed in both (no fuzzy matching). null when it is empty, missing, or the whole body.
function citedRange(body: string, citedText: string): [number, number] | null {
  const cited = collapse(citedText).text.trim();
  const b = collapse(body);
  const k = cited ? b.text.indexOf(cited) : -1;
  if (k < 0 || cited === b.text.trim()) return null;
  return [b.at[k]!, b.at[k + cited.length - 1]! + 1];
}

// The body split into text and formulas; only text inside the cited range is marked, so a
// formula renders whole and unmarked even inside the range. The texts join back to `body`.
export function citationSegments(body: string, citedText: string): Segment[] {
  const range = citedRange(body, citedText);
  const out: Segment[] = [];
  const text = (from: number, to: number) => {
    const clamp = (n: number) => Math.min(Math.max(n, from), to);
    const [a, z] = range ? [clamp(range[0]), clamp(range[1])] : [to, to];
    if (from < a) out.push({ text: body.slice(from, a), math: false, mark: false });
    if (a < z) out.push({ text: body.slice(a, z), math: false, mark: true });
    if (z < to) out.push({ text: body.slice(z, to), math: false, mark: false });
  };
  let last = 0;
  for (const m of body.matchAll(MATH)) {
    text(last, m.index!);
    out.push({ text: m[0], math: true, mark: false });
    last = m.index! + m[0].length;
  }
  text(last, body.length);
  return out;
}
