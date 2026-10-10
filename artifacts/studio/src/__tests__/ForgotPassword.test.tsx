import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href?: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const mockMutate = vi.fn();
let state: { isPending: boolean; isError: boolean; error: unknown } = { isPending: false, isError: false, error: null };
vi.mock("@workspace/api-client-react", () => ({
  useForgotPassword: () => ({ mutate: mockMutate, ...state }),
}));

import { ForgotPassword } from "@/pages/auth/ForgotPassword";

beforeEach(() => {
  vi.clearAllMocks();
  state = { isPending: false, isError: false, error: null };
});

describe("ForgotPassword", () => {
  it("submits the email address", async () => {
    render(<ForgotPassword />);
    await userEvent.type(screen.getByTestId("input-email"), "student@example.com");
    await userEvent.click(screen.getByTestId("button-request-reset"));
    expect(mockMutate).toHaveBeenCalledWith(
      { data: { email: "student@example.com" } },
      expect.anything(),
    );
  });

  // The endpoint's whole anti-enumeration guarantee is undone if the UI is
  // more specific than the API.
  it("shows the same vague confirmation regardless of whether the address exists", async () => {
    mockMutate.mockImplementation((_vars, opts) => opts.onSuccess?.());
    render(<ForgotPassword />);
    await userEvent.type(screen.getByTestId("input-email"), "nobody@example.com");
    await userEvent.click(screen.getByTestId("button-request-reset"));

    const sent = screen.getByTestId("text-reset-sent");
    expect(sent).toBeInTheDocument();
    expect(sent.textContent).toMatch(/if that email has an account/i);
    expect(sent.textContent).not.toMatch(/nobody@example\.com .*(exists|not found)/i);
  });

  it("surfaces a failure instead of swallowing it", async () => {
    mockMutate.mockImplementation((_vars, opts) =>
      opts.onError?.({ status: 429, data: { error: "Too many reset requests, try again shortly" } }),
    );
    render(<ForgotPassword />);
    await userEvent.type(screen.getByTestId("input-email"), "student@example.com");
    await userEvent.click(screen.getByTestId("button-request-reset"));

    expect(screen.getByTestId("alert-forgot-error").textContent).toMatch(/too many reset requests/i);
    expect(screen.queryByTestId("text-reset-sent")).toBeNull();
  });
});
