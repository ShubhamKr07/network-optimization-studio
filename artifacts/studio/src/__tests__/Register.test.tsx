import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/register", mockNavigate],
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

const mockSetQueryData = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ setQueryData: mockSetQueryData }),
}));

const mockRegisterMutate = vi.fn();
let registerState: { isPending: boolean; isError: boolean; error: unknown } = {
  isPending: false,
  isError: false,
  error: null,
};
vi.mock("@workspace/api-client-react", () => ({
  useRegisterUser: () => ({ mutate: mockRegisterMutate, ...registerState }),
  getGetCurrentAuthUserQueryKey: () => ["getCurrentAuthUser"],
}));

import { Register } from "@/pages/auth/Register";

beforeEach(() => {
  vi.clearAllMocks();
  registerState = { isPending: false, isError: false, error: null };
});

describe("Register", () => {
  it("submits email and password", async () => {
    render(<Register />);
    await userEvent.type(screen.getByTestId("input-email"), "student@example.com");
    await userEvent.type(screen.getByTestId("input-password"), "correcthorse");
    await userEvent.click(screen.getByTestId("button-register"));

    expect(mockRegisterMutate).toHaveBeenCalledWith(
      { data: { email: "student@example.com", password: "correcthorse" } },
      expect.anything(),
    );
  });

  it("writes the auth-user cache synchronously and navigates home on success", async () => {
    const authEnvelope = { user: { id: "u1", email: "student@example.com", role: "student" } };
    mockRegisterMutate.mockImplementation((_body, { onSuccess }) => onSuccess(authEnvelope));
    render(<Register />);
    await userEvent.type(screen.getByTestId("input-email"), "student@example.com");
    await userEvent.type(screen.getByTestId("input-password"), "correcthorse");
    await userEvent.click(screen.getByTestId("button-register"));

    // See Login.test.tsx for why this must write the cache directly rather
    // than invalidate + refetch (closes a real production 404 race).
    expect(mockSetQueryData).toHaveBeenCalledWith(["getCurrentAuthUser"], authEnvelope);
    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("shows an inline hint and blocks submit when password is under 8 characters", async () => {
    render(<Register />);
    await userEvent.type(screen.getByTestId("input-email"), "student@example.com");
    await userEvent.type(screen.getByTestId("input-password"), "short");
    expect(screen.getByTestId("text-password-hint")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-register"));
    expect(mockRegisterMutate).not.toHaveBeenCalled();
  });

  it("shows a duplicate-email message on 409 without mentioning password match", () => {
    registerState = { isPending: false, isError: true, error: { status: 409 } };
    render(<Register />);
    const alert = screen.getByTestId("alert-register-error");
    expect(alert).toHaveTextContent(/already exists/i);
    expect(alert.textContent).not.toMatch(/password/i);
  });

  it("shows a generic message for non-409 errors", () => {
    registerState = { isPending: false, isError: true, error: { status: 500 } };
    render(<Register />);
    expect(screen.getByTestId("alert-register-error")).toHaveTextContent(/could not create the account/i);
  });

  it("links to the login page", () => {
    render(<Register />);
    expect(screen.getByText("Log in")).toBeInTheDocument();
  });

  it("mounts the app footer", () => {
    render(<Register />);
    expect(screen.getByTestId("app-footer")).toBeInTheDocument();
  });

  it("renders the book-cover band with the studio title and kicker", () => {
    render(<Register />);
    const band = screen.getByTestId("auth-band");
    expect(band.className).toContain("scnd-band");
    expect(band).toHaveTextContent("SCND Optimization Studio");
    expect(band).toHaveTextContent("By Prof. Michael Watson");
  });

  it("keeps the footer un-clipped at a narrow (375px) viewport", () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 375 });
    window.dispatchEvent(new Event("resize"));
    try {
      render(<Register />);
      const footer = screen.getByTestId("app-footer");
      const root = footer.closest("div.min-h-screen") as HTMLElement;
      // min-h-screen + flex-col + flex-shrink-0 footer: the footer always
      // reserves its own row below the centered card, regardless of
      // viewport width — never overlapped or clipped by page content.
      expect(root.className).toContain("flex-col");
      expect(footer.className).toContain("flex-shrink-0");
    } finally {
      Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: originalWidth });
    }
  });
});
