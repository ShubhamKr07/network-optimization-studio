import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/", mockNavigate],
}));

const mockSetQueryData = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ setQueryData: mockSetQueryData }),
}));

const mockLogoutMutate = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useLogoutUser: () => ({ mutate: mockLogoutMutate }),
  getGetCurrentAuthUserQueryKey: () => ["getCurrentAuthUser"],
}));

import { AppShell } from "@/components/AppShell";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AppShell logout", () => {
  it("clears the auth-user cache synchronously and navigates to /login on success", async () => {
    mockLogoutMutate.mockImplementation((_body, { onSuccess }) => onSuccess());
    render(
      <AppShell userEmail="student@example.com">
        <div>content</div>
      </AppShell>,
    );
    await userEvent.click(screen.getByTestId("button-logout"));

    // Writing { user: null } directly (not invalidate + refetch) closes the
    // mirror-image of Login/Register's race: navigating to "/login"
    // immediately used to race Gate()'s auth-gated render against an async
    // refetch, so Gate() would still see the stale logged-in user, render
    // AuthedRouter for the new "/login" URL, and 404 (AuthedRouter has no
    // "/login" route).
    expect(mockSetQueryData).toHaveBeenCalledWith(["getCurrentAuthUser"], { user: null });
    expect(mockNavigate).toHaveBeenCalledWith("/login", { replace: true });
  });

  it("renders the user's email and children", () => {
    render(
      <AppShell userEmail="student@example.com">
        <div>lab content</div>
      </AppShell>,
    );
    expect(screen.getByTestId("text-user-email")).toHaveTextContent("student@example.com");
    expect(screen.getByText("lab content")).toBeInTheDocument();
  });
});
