import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/login", mockNavigate],
  // Forward props: the forgot-password test asserts on data-testid and href.
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href?: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const mockSetQueryData = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ setQueryData: mockSetQueryData }),
}));

type MutationState = { isPending: boolean; isError: boolean; error?: unknown };
const mockLoginMutate = vi.fn();
const mockRegisterMutate = vi.fn();
const mockLoginReset = vi.fn();
const mockRegisterReset = vi.fn();
let loginState: MutationState = { isPending: false, isError: false };
let registerState: MutationState = { isPending: false, isError: false };
vi.mock("@workspace/api-client-react", () => ({
  useLoginUser: () => ({ mutate: mockLoginMutate, reset: mockLoginReset, ...loginState }),
  useRegisterUser: () => ({ mutate: mockRegisterMutate, reset: mockRegisterReset, ...registerState }),
  getGetCurrentAuthUserQueryKey: () => ["getCurrentAuthUser"],
}));

import { SignIn } from "@/pages/auth/SignIn";

beforeEach(() => {
  vi.clearAllMocks();
  loginState = { isPending: false, isError: false };
  registerState = { isPending: false, isError: false };
});

describe("SignIn, log-in mode", () => {
  it("offers a forgot-password link pointing at /forgot-password", () => {
    render(<SignIn initialMode="login" />);
    const link = screen.getByTestId("link-forgot-password");
    expect(link).toHaveAttribute("href", "/forgot-password");
  });

  it("starts with the terms box unticked and the button disabled", async () => {
    render(<SignIn initialMode="login" />);
    expect(screen.getByTestId("checkbox-accept-terms")).not.toBeChecked();
    await userEvent.type(screen.getByTestId("input-email"), "student@example.com");
    await userEvent.type(screen.getByTestId("input-password"), "correcthorse");
    expect(screen.getByTestId("button-login")).toBeDisabled();
    await userEvent.click(screen.getByTestId("button-login"));
    expect(mockLoginMutate).not.toHaveBeenCalled();
  });

  it("enables the button once the box is ticked, and disables it again when unticked", async () => {
    render(<SignIn initialMode="login" />);
    const box = screen.getByTestId("checkbox-accept-terms");
    await userEvent.click(box);
    expect(screen.getByTestId("button-login")).toBeEnabled();
    await userEvent.click(box);
    expect(screen.getByTestId("button-login")).toBeDisabled();
  });

  it("submits email, password and acceptTerms: true", async () => {
    render(<SignIn initialMode="login" />);
    await userEvent.type(screen.getByTestId("input-email"), "student@example.com");
    await userEvent.type(screen.getByTestId("input-password"), "correcthorse");
    await userEvent.click(screen.getByTestId("checkbox-accept-terms"));
    await userEvent.click(screen.getByTestId("button-login"));
    expect(mockLoginMutate).toHaveBeenCalledWith(
      { data: { email: "student@example.com", password: "correcthorse", acceptTerms: true } },
      expect.anything(),
    );
    expect(mockRegisterMutate).not.toHaveBeenCalled();
  });

  it("labels the box with the exact consent sentence and links both documents in a new tab", () => {
    render(<SignIn initialMode="login" />);
    expect(document.querySelector("label[for='accept-terms']")).toHaveTextContent(
      "I agree to the Terms of Service (opens in a new tab) and the Privacy Notice (opens in a new tab) (FERPA, GDPR)",
    );
    for (const [id, path] of [["link-consent-terms", "/terms"], ["link-consent-privacy", "/privacy"]] as const) {
      const a = screen.getByTestId(id);
      expect(a).toHaveAttribute("href", path);
      expect(a).toHaveAttribute("target", "_blank");
      expect(a).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("writes the auth-user cache synchronously and navigates home on success", async () => {
    const authEnvelope = { user: { id: "u1", email: "student@example.com", role: "student" } };
    mockLoginMutate.mockImplementation((_body, { onSuccess }) => onSuccess(authEnvelope));
    render(<SignIn initialMode="login" />);
    await userEvent.type(screen.getByTestId("input-email"), "student@example.com");
    await userEvent.type(screen.getByTestId("input-password"), "correcthorse");
    await userEvent.click(screen.getByTestId("checkbox-accept-terms"));
    await userEvent.click(screen.getByTestId("button-login"));

    // Writing the cache directly (not invalidate + refetch) is the fix for a real
    // production 404: navigating to "/" immediately used to race Gate()'s auth-gated
    // render against an async refetch (see artifacts/studio/CLAUDE.md).
    expect(mockSetQueryData).toHaveBeenCalledWith(["getCurrentAuthUser"], authEnvelope);
    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("shows an error message when login fails", () => {
    loginState = { isPending: false, isError: true, error: { status: 401, data: { error: "Invalid email or password" } } };
    render(<SignIn initialMode="login" />);
    expect(screen.getByTestId("alert-login-error")).toHaveTextContent(/invalid email or password/i);
  });

  // A dropped request must not read as a wrong password.
  it("says the server could not be reached when the request never arrived", () => {
    loginState = { isPending: false, isError: true, error: Object.assign(new Error("Failed to fetch"), { name: "NetworkError" }) };
    render(<SignIn initialMode="login" />);
    const alert = screen.getByTestId("alert-login-error");
    expect(alert).toHaveTextContent(/couldn't reach the server/i);
    expect(alert.textContent).not.toMatch(/invalid email or password/i);
  });

  // A gateway or proxy answering with no usable body must not leak "HTTP 502 …".
  it("falls back to a plain sentence when the failure carries no usable body", () => {
    loginState = { isPending: false, isError: true, error: Object.assign(new Error("HTTP 502 Bad Gateway: <html>"), { status: 502, data: "<html>bad gateway</html>" }) };
    render(<SignIn initialMode="login" />);
    const alert = screen.getByTestId("alert-login-error");
    expect(alert).toHaveTextContent("Could not log in. Please try again.");
    expect(alert.textContent).not.toMatch(/HTTP 502/);
  });

  it("shows the rate-limit sentence on 429, not a wrong-password message", () => {
    loginState = { isPending: false, isError: true, error: { status: 429, data: { error: "Too many login attempts, try again shortly" } } };
    render(<SignIn initialMode="login" />);
    const alert = screen.getByTestId("alert-login-error");
    expect(alert).toHaveTextContent("Too many login attempts, try again shortly");
    expect(alert.textContent).not.toMatch(/invalid email or password/i);
  });

  it("disables the submit button while pending", () => {
    loginState = { isPending: true, isError: false };
    render(<SignIn initialMode="login" />);
    expect(screen.getByTestId("button-login")).toBeDisabled();
    expect(screen.getByTestId("button-login")).toHaveTextContent("Logging in…");
  });

  it("does not mount the global app footer", () => {
    render(<SignIn initialMode="login" />);
    expect(screen.queryByTestId("app-footer")).not.toBeInTheDocument();
  });

  it("tells the student their password changed when arriving from a reset", () => {
    window.history.replaceState(null, "", "/login?reset=done");
    render(<SignIn initialMode="login" />);
    expect(screen.getByTestId("alert-password-changed")).toHaveTextContent("Your password was changed. Log in to continue.");
    window.history.replaceState(null, "", "/login");
  });

  it("shows no password notice on a plain visit", () => {
    window.history.replaceState(null, "", "/login");
    render(<SignIn initialMode="login" />);
    expect(screen.queryByTestId("alert-password-changed")).toBeNull();
  });
});

describe("SignIn, create-account mode", () => {
  it("starts in create mode for initialMode=register (/register)", () => {
    render(<SignIn initialMode="register" />);
    expect(screen.getByTestId("mode-register")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("button-register")).toHaveTextContent("Create account");
    expect(screen.queryByTestId("button-login")).toBeNull();
  });

  it("starts with the terms box unticked and the button disabled", async () => {
    render(<SignIn initialMode="register" />);
    expect(screen.getByTestId("checkbox-accept-terms")).not.toBeChecked();
    await userEvent.type(screen.getByTestId("input-email"), "student@example.com");
    await userEvent.type(screen.getByTestId("input-password"), "correcthorse");
    expect(screen.getByTestId("button-register")).toBeDisabled();
    await userEvent.click(screen.getByTestId("button-register"));
    expect(mockRegisterMutate).not.toHaveBeenCalled();
  });

  it("enables the button once the box is ticked, and disables it again when unticked", async () => {
    render(<SignIn initialMode="register" />);
    const box = screen.getByTestId("checkbox-accept-terms");
    await userEvent.click(box);
    expect(screen.getByTestId("button-register")).toBeEnabled();
    await userEvent.click(box);
    expect(screen.getByTestId("button-register")).toBeDisabled();
  });

  it("submits email, password and acceptTerms: true", async () => {
    render(<SignIn initialMode="register" />);
    await userEvent.type(screen.getByTestId("input-email"), "student@example.com");
    await userEvent.type(screen.getByTestId("input-password"), "correcthorse");
    await userEvent.click(screen.getByTestId("checkbox-accept-terms"));
    await userEvent.click(screen.getByTestId("button-register"));
    expect(mockRegisterMutate).toHaveBeenCalledWith(
      { data: { email: "student@example.com", password: "correcthorse", acceptTerms: true } },
      expect.anything(),
    );
    expect(mockLoginMutate).not.toHaveBeenCalled();
  });

  it("labels the box with the exact consent sentence and links both documents in a new tab", () => {
    render(<SignIn initialMode="register" />);
    expect(document.querySelector("label[for='accept-terms']")).toHaveTextContent(
      "I agree to the Terms of Service (opens in a new tab) and the Privacy Notice (opens in a new tab) (FERPA, GDPR)",
    );
    for (const [id, path] of [["link-consent-terms", "/terms"], ["link-consent-privacy", "/privacy"]] as const) {
      const a = screen.getByTestId(id);
      expect(a).toHaveAttribute("href", path);
      expect(a).toHaveAttribute("target", "_blank");
      expect(a).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("writes the auth-user cache synchronously and navigates home on success", async () => {
    const authEnvelope = { user: { id: "u1", email: "student@example.com", role: "student" } };
    mockRegisterMutate.mockImplementation((_body, { onSuccess }) => onSuccess(authEnvelope));
    render(<SignIn initialMode="register" />);
    await userEvent.type(screen.getByTestId("input-email"), "student@example.com");
    await userEvent.type(screen.getByTestId("input-password"), "correcthorse");
    await userEvent.click(screen.getByTestId("checkbox-accept-terms"));
    await userEvent.click(screen.getByTestId("button-register"));
    expect(mockSetQueryData).toHaveBeenCalledWith(["getCurrentAuthUser"], authEnvelope);
    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("shows an inline hint and blocks submit when password is under 8 characters", async () => {
    render(<SignIn initialMode="register" />);
    await userEvent.type(screen.getByTestId("input-email"), "student@example.com");
    await userEvent.type(screen.getByTestId("input-password"), "short");
    expect(screen.getByTestId("text-password-hint")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("checkbox-accept-terms"));
    await userEvent.click(screen.getByTestId("button-register"));
    expect(mockRegisterMutate).not.toHaveBeenCalled();
  });

  it("shows a duplicate-email message on 409 without mentioning password match", () => {
    registerState = { isPending: false, isError: true, error: { status: 409, data: { error: "An account with this email already exists" } } };
    render(<SignIn initialMode="register" />);
    const alert = screen.getByTestId("alert-register-error");
    expect(alert).toHaveTextContent(/already exists/i);
    expect(alert.textContent).not.toMatch(/password/i);
  });

  it("shows a generic message for non-409 errors", () => {
    registerState = { isPending: false, isError: true, error: { status: 500 } };
    render(<SignIn initialMode="register" />);
    expect(screen.getByTestId("alert-register-error")).toHaveTextContent(/could not create the account/i);
  });

  // 2026-11-02: a corporate gateway dropped the signup POST and the student was
  // told to "check your details" — which were fine.
  it("says the server could not be reached when the request never arrived", () => {
    registerState = { isPending: false, isError: true, error: Object.assign(new Error("Failed to fetch"), { name: "NetworkError" }) };
    render(<SignIn initialMode="register" />);
    const alert = screen.getByTestId("alert-register-error");
    expect(alert).toHaveTextContent(/couldn't reach the server/i);
    expect(alert.textContent).not.toMatch(/check your details/i);
  });

  it("shows the server's own sentence for a rejected request", () => {
    registerState = { isPending: false, isError: true, error: { status: 400, data: { error: "email and password (8-128 chars) are required" } } };
    render(<SignIn initialMode="register" />);
    expect(screen.getByTestId("alert-register-error")).toHaveTextContent("email and password (8-128 chars) are required");
  });

  it("labels the pending button Creating account…", () => {
    registerState = { isPending: true, isError: false };
    render(<SignIn initialMode="register" />);
    expect(screen.getByTestId("button-register")).toBeDisabled();
    expect(screen.getByTestId("button-register")).toHaveTextContent("Creating account…");
  });

  it("shows no reset notice in create mode", () => {
    window.history.replaceState(null, "", "/register?reset=done");
    render(<SignIn initialMode="register" />);
    expect(screen.queryByTestId("alert-password-changed")).toBeNull();
    window.history.replaceState(null, "", "/login");
  });
});

describe("SignIn, mode toggle and cover content", () => {
  it("names the toggle group for screen readers", () => {
    render(<SignIn initialMode="login" />);
    expect(screen.getByRole("group", { name: "Log in or create an account" })).toContainElement(screen.getByTestId("mode-login"));
  });

  it("locks both modes and both submits while either request is in flight", () => {
    registerState = { isPending: true, isError: false };
    render(<SignIn initialMode="register" />);
    expect(screen.getByTestId("mode-login")).toBeDisabled();
    expect(screen.getByTestId("mode-register")).toBeDisabled();
    expect(screen.getByTestId("button-register")).toBeDisabled();
  });

  it("clears both requests' errors when the mode changes", async () => {
    loginState = { isPending: false, isError: true, error: { status: 401, data: { error: "Invalid email or password" } } };
    render(<SignIn initialMode="login" />);
    await userEvent.click(screen.getByTestId("mode-register"));
    expect(mockLoginReset).toHaveBeenCalledTimes(1);
    expect(mockRegisterReset).toHaveBeenCalledTimes(1);
  });

  it("toggles between log in and create account without a URL change, and back", async () => {
    render(<SignIn initialMode="login" />);
    expect(screen.getByTestId("mode-login")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("mode-register")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(/New here\?/)).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("mode-register"));
    expect(screen.getByTestId("mode-register")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("mode-login")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("button-register")).toHaveTextContent("Create account");
    expect(screen.queryByTestId("link-forgot-password")).toBeNull();
    expect(screen.getByText(/Free for students and instructors using the book; any email works, no invite code needed\./)).toBeInTheDocument();
    expect(screen.getByTestId("input-password")).toHaveAttribute("autocomplete", "new-password");
    expect(mockNavigate).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId("mode-login"));
    expect(screen.getByTestId("button-login")).toHaveTextContent("Log in");
    expect(screen.getByTestId("link-forgot-password")).toBeInTheDocument();
    expect(screen.getByTestId("input-password")).toHaveAttribute("autocomplete", "current-password");
  });

  it("keeps the typed email and ticked consent across a toggle", async () => {
    render(<SignIn initialMode="login" />);
    await userEvent.type(screen.getByTestId("input-email"), "student@example.com");
    await userEvent.click(screen.getByTestId("checkbox-accept-terms"));
    await userEvent.click(screen.getByTestId("mode-register"));
    expect(screen.getByTestId("input-email")).toHaveValue("student@example.com");
    expect(screen.getByTestId("button-register")).toBeEnabled();
  });

  it("renders one product name as the h1 and the strip as a labelled region", () => {
    render(<SignIn initialMode="login" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Network Design Labs");
    expect(screen.getByTestId("cover-strip")).toHaveAttribute("aria-label", "Sign in or create an account");
    expect(screen.queryByText(/Optimization Studio/)).toBeNull();
    expect(screen.queryByText(/By Prof/)).toBeNull();
    expect(screen.queryByText(/Chapter \d/)).toBeNull();
  });

  it("opens the book, LinkedIn, Terms and Privacy links in a new tab and announces it", () => {
    render(<SignIn initialMode="login" />);
    const book = screen.getByTestId("link-book");
    expect(book).toHaveAttribute("href", "https://www.amazon.com/dp/B078PNRZJB");
    const linkedin = screen.getByTestId("link-linkedin");
    expect(linkedin).toHaveAttribute("href", "https://www.linkedin.com/in/michael-watson-07600a1/");
    expect(linkedin).toHaveAttribute("aria-label", "Michael Watson on LinkedIn (opens in a new tab)");
    for (const a of [book, linkedin, screen.getByTestId("link-consent-terms"), screen.getByTestId("link-consent-privacy")]) {
      expect(a).toHaveAttribute("target", "_blank");
      expect(a.getAttribute("rel")).toContain("noopener");
    }
    for (const a of [book, screen.getByTestId("link-consent-terms"), screen.getByTestId("link-consent-privacy")]) {
      expect(within(a).getByText("(opens in a new tab)")).toBeInTheDocument();
    }
    expect(screen.getByTestId("link-watson-email")).toHaveAttribute("href", "mailto:michael.watson@northwestern.edu");
  });

  it("offers Michael Watson's contact above the footer and the developer contact in it", () => {
    render(<SignIn initialMode="login" />);
    expect(screen.getByTestId("cover-offered-by")).toHaveTextContent("Offered byMichael Watson");
    const help = screen.getByTestId("cover-help");
    expect(help).toHaveTextContent("Trouble signing in? Contact the developer");
    expect(within(help).getByRole("link")).toHaveAttribute("href", "mailto:shubham.shubham4995@gmail.com");
  });

  // L6: light only. jsdom loads no stylesheet, so the structural guarantee is what
  // we can assert here (the computed colours are covered in the real-browser spec):
  // nothing inside the shell uses a theme-token class or a shadcn control.
  it("stays light-only: no theme-token classes or shadcn controls inside the shell, even under html.dark", () => {
    document.documentElement.classList.add("dark");
    try {
      render(<SignIn initialMode="register" />);
      const shell = screen.getByTestId("cover-shell");
      const themed = /\b(?:bg|text|border|ring)-(?:background|foreground|card|primary|secondary|muted|destructive|input|ring|accent)\b/;
      const offenders = [shell, ...Array.from(shell.querySelectorAll("*"))].filter((el) => themed.test(el.getAttribute("class") ?? ""));
      expect(offenders).toEqual([]);
      expect(shell.querySelector("[role='checkbox'], [data-state]")).toBeNull();
    } finally {
      document.documentElement.classList.remove("dark");
    }
  });
});
