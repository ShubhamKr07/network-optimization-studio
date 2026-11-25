// WATBOT-POPOVER-KATEX — the corpus stores formulas as $$…$$ LaTeX and some symbols as $\cmd$.
// Lazy-loaded by WatBotMessages, so KaTeX ships only when a citation popover holds a formula.
// KaTeX's default trust:false refuses \href, \url and raw HTML in the source; maxSize caps
// \rule and spacing at 10em.
import katex from "katex";
import "katex/dist/katex.min.css";

import { MATH } from "./citationHighlight"; // one regex for splitting and rendering

export default function MathText({ text }: { text: string }) {
  // split() with two groups yields [text, $$-group, $-group, text, …]; an unclosed $$ stays text.
  return <>{text.split(MATH).map((part, i) => i % 3 === 0 ? part : part === undefined ? null
    : <span key={i} dangerouslySetInnerHTML={{ __html: katex.renderToString(part, { throwOnError: false, maxSize: 10 }) }} />)}</>;
}
