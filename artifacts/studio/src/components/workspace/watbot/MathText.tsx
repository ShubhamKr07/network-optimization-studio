// WATBOT-POPOVER-KATEX — the corpus stores formulas as $$…$$ LaTeX. Lazy-loaded by
// WatBotMessages, so KaTeX ships only when a citation popover holds a formula.
// KaTeX's default trust:false refuses \href, \url and raw HTML in the source.
import katex from "katex";
import "katex/dist/katex.min.css";

export default function MathText({ text }: { text: string }) {
  // Odd parts are the LaTeX between a pair of $$; an unclosed $$ stays in the text.
  return <>{text.split(/\$\$([\s\S]+?)\$\$/).map((part, i) => i % 2
    ? <span key={i} dangerouslySetInnerHTML={{ __html: katex.renderToString(part, { throwOnError: false }) }} />
    : part)}</>;
}
