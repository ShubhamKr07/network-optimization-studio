import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("wouter", () => ({ useLocation: () => ["/", mockNavigate] }));
const mockSetQueryData = vi.fn();
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ setQueryData: mockSetQueryData }) }));
const mockMutate = vi.fn();
const mockReset = vi.fn();
let state: { isPending: boolean; isError: boolean; error: unknown } = { isPending: false, isError: false, error: null };
vi.mock("@workspace/api-client-react", () => ({
  useDeleteAccount: () => ({ mutate: mockMutate, reset: mockReset, ...state }),
  getGetCurrentAuthUserQueryKey: () => ["getCurrentAuthUser"],
}));
const mockResetUser = vi.fn();
vi.mock("@/lib/analytics", () => ({ resetUser: () => mockResetUser() }));
const mockClearErrorUser = vi.fn();
vi.mock("@/lib/errorTracking", () => ({ clearErrorUser: () => mockClearErrorUser() }));
const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => mockToast(...a) }));

import { DeleteAccountDialog } from "@/components/DeleteAccountDialog";

beforeEach(() => {
  vi.clearAllMocks();
  state = { isPending: false, isError: false, error: null };
});

describe("DeleteAccountDialog", () => {
  it("names what is deleted, says it cannot be undone, and needs the password before confirming", async () => {
    render(<DeleteAccountDialog open onOpenChange={() => {}} />);
    const dialog = screen.getByTestId("dialog-delete-account");
    for (const phrase of ["scenarios", "solves", "WatBot", "cannot be undone"]) expect(dialog).toHaveTextContent(phrase);
    expect(screen.getByTestId("button-confirm-delete")).toBeDisabled();
    await userEvent.type(screen.getByTestId("input-delete-password"), "correcthorse1");
    expect(screen.getByTestId("button-confirm-delete")).toBeEnabled();
  });

  it("sends the password, then clears the session state and goes to Log in", async () => {
    mockMutate.mockImplementation((_v, { onSuccess }) => onSuccess());
    render(<DeleteAccountDialog open onOpenChange={() => {}} />);
    await userEvent.type(screen.getByTestId("input-delete-password"), "correcthorse1");
    await userEvent.click(screen.getByTestId("button-confirm-delete"));
    expect(mockMutate).toHaveBeenCalledWith({ data: { password: "correcthorse1" } }, expect.anything());
    expect(mockSetQueryData).toHaveBeenCalledWith(["getCurrentAuthUser"], { user: null });
    expect(mockResetUser).toHaveBeenCalled();
    expect(mockClearErrorUser).toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Your account was deleted." }));
    expect(mockNavigate).toHaveBeenCalledWith("/login", { replace: true });
  });

  it("shows the server's sentence on failure, never a raw HTTP message", () => {
    state = { isPending: false, isError: true, error: Object.assign(new Error("HTTP 409 Conflict: {…}"), { status: 409, data: { error: "A solve is still queued or running for your account. Wait for it to finish, then try again." } }) };
    render(<DeleteAccountDialog open onOpenChange={() => {}} />);
    const alert = screen.getByTestId("alert-delete-error");
    expect(alert).toHaveTextContent("A solve is still queued or running");
    expect(alert.textContent).not.toMatch(/HTTP/);
  });

  it("cancel closes without deleting and resets the mutation", async () => {
    const onOpenChange = vi.fn();
    render(<DeleteAccountDialog open onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByTestId("button-cancel-delete"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockReset).toHaveBeenCalled();
  });
});
