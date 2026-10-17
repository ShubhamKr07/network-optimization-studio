// SCU-2.P4.1 — RTL helpers shared by the migrated input-table tests (P4).
// The From/To boxes became FilterMenu controls (B2.2) and the Upload /
// Download buttons became menus (B2.3/B2.4), so a test now opens the menu
// first. `within` scopes to one tab when two filter triggers are on screen.
import { fireEvent, screen } from "@testing-library/react";

/** Opens the (single) FilterMenu if it is not open yet. */
export function openFilterMenu(triggerTestId = "button-filter-menu-trigger"): void {
  if (!screen.queryByTestId("filter-menu-popover")) fireEvent.click(screen.getByTestId(triggerTestId));
}

/** Types into a FilterMenu text control (`input-filter-{key}`). */
export function filterText(key: string, value: string): void {
  openFilterMenu();
  fireEvent.change(screen.getByTestId(`input-filter-${key}`), { target: { value } });
}

/** Ticks a FilterMenu select option (`checkbox-filter-{key}-{value}`). */
export function filterSelect(key: string, value: string): void {
  openFilterMenu();
  fireEvent.click(screen.getByTestId(`checkbox-filter-${key}-${value}`));
}

/** Upload ▾ → CSV/JSON (`button-import-{t}` then `button-import-{t}-{format}`). */
export function chooseUpload(t: string, format: "csv" | "json" = "csv"): void {
  fireEvent.click(screen.getByTestId(`button-import-${t}`));
  fireEvent.click(screen.getByTestId(`button-import-${t}-${format}`));
}

/** Download ▾ → CSV/JSON (`button-download-{t}` then `button-export-{t}-{format}`). */
export function chooseInputDownload(t: string, format: "csv" | "json" = "csv"): void {
  fireEvent.click(screen.getByTestId(`button-download-${t}`));
  fireEvent.click(screen.getByTestId(`button-export-${t}-${format}`));
}
