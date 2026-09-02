// B2.2-T10a — bottom-center app footer, mounted at the end of every
// top-level `h-screen flex flex-col` shell (Workspace via T9, AppShell /
// Login / Register via T10b). `FOOTER_H` is the fixed pixel height those
// shells reserve so footer content never overlaps body/map content —
// exported so callers can size their own layout math against the same
// constant instead of a magic number.
export const FOOTER_H = 24;

export function AppFooter() {
  return (
    <footer
      data-testid="app-footer"
      className="flex-shrink-0 flex items-center justify-center border-t bg-background text-xs text-muted-foreground"
      style={{ height: FOOTER_H }}
    >
      <span>&copy; Developed by hx1</span>
    </footer>
  );
}
