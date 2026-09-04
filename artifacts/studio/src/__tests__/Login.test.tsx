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
    expect(screen.getByText(/^Register$/)).toBeInTheDocument();
  });

  it("does not mount the global app footer (inline credit replaces it)", () => {
    render(<Login />);
    expect(screen.queryByTestId("app-footer")).not.toBeInTheDocument();
    expect(screen.getByTestId("auth-credit")).toHaveTextContent("Developed by Shubham");
  });

  it("renders the cover panel, heading, and kicker", () => {
    render(<Login />);
    expect(screen.getByTestId("auth-cover")).toBeInTheDocument();
    expect(screen.getByAltText(/book cover/i)).toBeInTheDocument();
    expect(screen.getByText("Optimization Studio")).toBeInTheDocument();
    expect(screen.getByText("By Prof. Michael Watson")).toBeInTheDocument();
  });

  it("exposes the developer contact links (mockup values)", () => {
    render(<Login />);
    expect(screen.getByTitle("LinkedIn").closest("a")).toHaveAttribute("href", "https://www.linkedin.com/in/shubhamkumarcse/");
    expect(screen.getByTitle("Email").closest("a")).toHaveAttribute("href", "mailto:shubham.shubham4995@gmail.com");
  });

  it("shows only non-hidden chapter labels in the footer labs strip", () => {
    render(<Login />);
    const strip = screen.getByTestId("auth-labs-strip");
    expect(strip).toHaveTextContent("Chapter 3");
    // Ch5 (transport-coal, p-median-brazil) and Ch10 (two-echelon-gold-au)
    // are hiddenFromLanding — the footer strip must not show them.
    expect(strip).not.toHaveTextContent("Ch 5");
    expect(strip).not.toHaveTextContent("Ch 10");
    expect(strip).not.toHaveTextContent("Chapter 5");
    expect(strip).not.toHaveTextContent("Chapter 10");
  });

  it("uses a stacked-on-narrow / side-by-side-on-wide split layout", () => {
    render(<Login />);
    const shell = screen.getByTestId("auth-shell");
    expect(shell.className).toContain("flex-col");
    expect(shell.className).toContain("md:flex-row");
    // cover collapses to a top band on narrow, becomes the left rail on wide
    expect(screen.getByTestId("auth-cover").className).toContain("md:basis-[44%]");
  });
});
