import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DownloadMenu } from "@/components/data-table/DownloadMenu";
import { chooseDownload } from "@/__tests__/helpers/downloadMenu";

const ids = { csv: "button-download-x-csv", json: "button-download-x-json" };

describe("DownloadMenu (SCU-2.P3, spec B2.4)", () => {
  it("renders only the trigger until opened; items carry the literal testids", () => {
    render(<DownloadMenu testId="button-download-x" itemTestIds={ids} onDownload={() => {}} />);
    expect(screen.getByTestId("button-download-x")).toHaveTextContent("Download");
    expect(screen.queryByTestId("button-download-x-csv")).toBeNull();
    fireEvent.click(screen.getByTestId("button-download-x"));
    expect(screen.getByTestId("button-download-x-csv")).toHaveTextContent("CSV");
    expect(screen.getByTestId("button-download-x-json")).toHaveTextContent("JSON");
  });

  it("reports the chosen format and closes", () => {
    const onDownload = vi.fn();
    render(<DownloadMenu testId="button-download-x" itemTestIds={ids} onDownload={onDownload} />);
    chooseDownload("button-download-x", "button-download-x-json");
    expect(onDownload).toHaveBeenCalledWith("json");
    expect(screen.queryByTestId("button-download-x-json")).toBeNull();
    chooseDownload("button-download-x", "button-download-x-csv");
    expect(onDownload).toHaveBeenLastCalledWith("csv");
  });

  it("disabledReason disables the trigger and is its title", () => {
    render(<DownloadMenu testId="button-download-x" itemTestIds={ids} onDownload={() => {}} disabledReason="Loading…" />);
    const trigger = screen.getByTestId("button-download-x");
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute("title", "Loading…");
  });

  it("Escape closes the open menu", async () => {
    const user = userEvent.setup();
    render(<DownloadMenu testId="button-download-x" itemTestIds={ids} onDownload={() => {}} />);
    await user.click(screen.getByTestId("button-download-x"));
    expect(screen.getByTestId("button-download-x-csv")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("button-download-x-csv")).toBeNull();
  });
});
