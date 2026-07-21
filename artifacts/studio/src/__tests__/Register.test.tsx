import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/register", mockNavigate],
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

const mockInvalidateQueries = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
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

  it("navigates home and invalidates the auth query on success", async () => {
    mockRegisterMutate.mockImplementation((_body, { onSuccess }) => onSuccess());
    render(<Register />);
    await userEvent.type(screen.getByTestId("input-email"), "student@example.com");
    await userEvent.type(screen.getByTestId("input-password"), "correcthorse");
    await userEvent.click(screen.getByTestId("button-register"));

    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["getCurrentAuthUser"] });
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
});
