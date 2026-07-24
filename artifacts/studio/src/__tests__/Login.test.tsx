import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/login", mockNavigate],
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

const mockSetQueryData = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ setQueryData: mockSetQueryData }),
}));

const mockLoginMutate = vi.fn();
let loginState: { isPending: boolean; isError: boolean } = { isPending: false, isError: false };
vi.mock("@workspace/api-client-react", () => ({
  useLoginUser: () => ({ mutate: mockLoginMutate, ...loginState }),
  getGetCurrentAuthUserQueryKey: () => ["getCurrentAuthUser"],
}));

import { Login } from "@/pages/auth/Login";

beforeEach(() => {
  vi.clearAllMocks();
  loginState = { isPending: false, isError: false };
});

describe("Login", () => {
  it("submits email and password", async () => {
    render(<Login />);
    await userEvent.type(screen.getByTestId("input-email"), "student@example.com");
    await userEvent.type(screen.getByTestId("input-password"), "correcthorse");
    await userEvent.click(screen.getByTestId("button-login"));

    expect(mockLoginMutate).toHaveBeenCalledWith(
      { data: { email: "student@example.com", password: "correcthorse" } },
      expect.anything(),
    );
  });

  it("writes the auth-user cache synchronously and navigates home on success", async () => {
    const authEnvelope = { user: { id: "u1", email: "student@example.com", role: "student" } };
    mockLoginMutate.mockImplementation((_body, { onSuccess }) => onSuccess(authEnvelope));
    render(<Login />);
    await userEvent.type(screen.getByTestId("input-email"), "student@example.com");
    await userEvent.type(screen.getByTestId("input-password"), "correcthorse");
    await userEvent.click(screen.getByTestId("button-login"));

    // Writing the cache directly (not invalidate + refetch) is the fix for
    // a real production 404: navigating to "/" immediately used to race
    // Gate()'s auth-gated render against an async refetch, and on a slow
    // enough round trip Gate() would still see no user, bounce the URL to
    // "/login" via UnauthedRouter's catch-all, then land on AuthedRouter's
    // NotFound once the stale URL didn't match any of its routes.
    expect(mockSetQueryData).toHaveBeenCalledWith(["getCurrentAuthUser"], authEnvelope);
    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("shows an error message when login fails", () => {
    loginState = { isPending: false, isError: true };
    render(<Login />);
    expect(screen.getByTestId("alert-login-error")).toHaveTextContent(/invalid email or password/i);
  });

  it("disables the submit button while pending", () => {
    loginState = { isPending: true, isError: false };
    render(<Login />);
    expect(screen.getByTestId("button-login")).toBeDisabled();
  });

  it("links to the register page", () => {
    render(<Login />);
    expect(screen.getByText("Register")).toBeInTheDocument();
  });
});
