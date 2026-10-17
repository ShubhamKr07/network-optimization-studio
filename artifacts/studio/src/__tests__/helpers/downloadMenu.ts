// SCU-2.P3 — open a DownloadMenu (B2.4 "Download ▾") and pick one item.
// Shared by every output-tab test that used to click a single Download CSV button.
import { fireEvent, screen } from "@testing-library/react";

export function chooseDownload(triggerTestId: string, itemTestId: string): void {
  fireEvent.click(screen.getByTestId(triggerTestId));
  fireEvent.click(screen.getByTestId(itemTestId));
}
