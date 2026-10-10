import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/reset-password", mockNavigate],
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href?: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const mockSetQueryData = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ setQueryData: mockSetQueryData }),
}));

const mockMutate = vi.fn();
let state: { isPending: boolean; isError: boolean; error: unknown } = { isPending: false, isError: false, error: null };
vi.mock("@workspace/api-client-react", () => ({
  useResetPassword: () => ({ mutate: mockMutate, ...state }),
  getGetCurrentAuthUserQueryKey: () => ["getCurrentAuthUser"],
}));

import { ResetPassword } from "@/pages/auth/ResetPassword";

function setHash(hash: string) {
  window.history.replaceState(null, "", `/reset-password${hash}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  state = { isPending: false, isError: false, error: null };
  setHash("");
});

describe("ResetPassword", () => {
  it("reads the token from the URL fragment and submits it", async () => {
    setHash("#token=abc123");
    render(<ResetPassword />);
    await userEvent.type(screen.getByTestId("input-new-password"), "brandnewpass1");
    await userEvent.click(screen.getByTestId("button-set-password"));
    expect(mockMutate).toHaveBeenCalledWith(
      { data: { token: "abc123", password: "brandnewpass1" } },
      expect.anything(),
    );
  });

  // The token must not survive in history or leak via Referer.
  it("strips the fragment from the URL after reading it", async () => {
    setHash("#token=abc123");
    render(<ResetPassword />);
    expect(window.location.hash).toBe("");
  });

  it("tells the user the link is unusable when there is no token", () => {
    setHash("");
    render(<ResetPassword />);
    expect(screen.getByTestId("text-reset-link-invalid")).toBeInTheDocument();
    expect(screen.queryByTestId("input-new-password")).toBeNull();
  });

  it("logs the user in and redirects on success", async () => {
    setHash("#token=abc123");
    const data = { user: { id: "u1", email: "s@e.com", role: "student" } };
    mockMutate.mockImplementation((_vars, opts) => opts.onSuccess?.(data));
    render(<ResetPassword />);
    await userEvent.type(screen.getByTestId("input-new-password"), "brandnewpass1");
    await userEvent.click(screen.getByTestId("button-set-password"));

    expect(mockSetQueryData).toHaveBeenCalledWith(["getCurrentAuthUser"], data);
    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("surfaces an expired-link failure", async () => {
    setHash("#token=stale");
    mockMutate.mockImplementation((_vars, opts) =>
      opts.onError?.({ status: 400, data: { error: "This reset link is invalid or has expired." } }),
    );
    render(<ResetPassword />);
    await userEvent.type(screen.getByTestId("input-new-password"), "brandnewpass1");
    await userEvent.click(screen.getByTestId("button-set-password"));

    expect(screen.getByTestId("alert-reset-error").textContent).toMatch(/invalid or has expired/i);
  });
});
