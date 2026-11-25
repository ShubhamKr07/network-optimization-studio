import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href?: string } & Record<string, unknown>) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("@/components/DeleteAccountDialog", () => ({
  DeleteAccountDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="dialog-delete-account" /> : null),
}));

import { AccountLinks } from "@/components/AccountLinks";

describe("AccountLinks", () => {
  it("renders Terms · Privacy · Delete my account in that order", () => {
    render(<AccountLinks />);
    expect(screen.getByTestId("account-links")).toHaveTextContent(/^Terms·Privacy·Delete my account$/);
    expect(screen.getByTestId("link-terms")).toHaveAttribute("href", "/terms");
    expect(screen.getByTestId("link-privacy")).toHaveAttribute("href", "/privacy");
  });

  it("opens the delete dialog only on click", async () => {
    render(<AccountLinks />);
    expect(screen.queryByTestId("dialog-delete-account")).toBeNull();
    await userEvent.click(screen.getByTestId("link-delete-account"));
    expect(screen.getByTestId("dialog-delete-account")).toBeInTheDocument();
  });
});
