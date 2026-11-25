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
const mockFetchQuery = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ setQueryData: mockSetQueryData, fetchQuery: mockFetchQuery }),
}));

const mockMutate = vi.fn();
let state: { isPending: boolean; isError: boolean; error: unknown } = { isPending: false, isError: false, error: null };
vi.mock("@workspace/api-client-react", () => ({
  useResetPassword: () => ({ mutate: mockMutate, ...state }),
  getCurrentAuthUser: vi.fn(),
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

  async function submitReset() {
    setHash("#token=abc123");
    mockMutate.mockImplementation((_body, { onSuccess }) => onSuccess({ user: { id: "u1", email: "s@example.test", role: "student" } }));
    render(<ResetPassword />);
    await userEvent.type(screen.getByTestId("input-new-password"), "brandnewpass1");
    await userEvent.click(screen.getByTestId("button-set-password"));
  }

  it("asks the server who is signed in and goes home when the reset signed the student in", async () => {
    mockFetchQuery.mockResolvedValue({ user: { id: "u1", email: "s@example.test", role: "student" } });
    await submitReset();
    await vi.waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true }));
    expect(mockFetchQuery).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["getCurrentAuthUser"], staleTime: 0 }));
    expect(mockSetQueryData).not.toHaveBeenCalled(); // never trust the body: it is identical either way
  });

  it("sends the student to Log in when the reset set no session (terms not yet accepted)", async () => {
    mockFetchQuery.mockResolvedValue({ user: null });
    await submitReset();
    await vi.waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/login?reset=done", { replace: true }));
  });

  it("falls back to Log in when the who-am-I check itself fails", async () => {
    mockFetchQuery.mockRejectedValue(new Error("offline"));
    await submitReset();
    await vi.waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/login?reset=done", { replace: true }));
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
