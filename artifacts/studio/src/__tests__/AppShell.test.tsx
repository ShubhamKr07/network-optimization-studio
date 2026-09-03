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

describe("AppShell band hero", () => {
  it("carries the .scnd-band class on the header", () => {
    render(
      <AppShell userEmail="student@example.com">
        <div>lab content</div>
      </AppShell>,
    );
    const header = screen.getByTestId("text-user-email").closest("header") as HTMLElement;
    expect(header.className).toContain("scnd-band");
  });

  it("renders the given heroTitle in the band", () => {
    render(
      <AppShell userEmail="student@example.com" heroTitle="Network Design Labs">
        <div>lab content</div>
      </AppShell>,
    );
    expect(screen.getByText("Network Design Labs")).toBeInTheDocument();
    expect(screen.queryByText("SCND Optimization Studio")).not.toBeInTheDocument();
  });

  it("falls back to the SCND Optimization Studio wordmark when no heroTitle is given", () => {
    render(
      <AppShell userEmail="student@example.com">
        <div>lab content</div>
      </AppShell>,
    );
    expect(screen.getByText("SCND Optimization Studio")).toBeInTheDocument();
  });
});

describe("AppShell layout", () => {
  it("clamps its root to exactly one viewport height and scopes scrolling to <main>", () => {
    render(
      <AppShell userEmail="student@example.com">
        <div>lab content</div>
      </AppShell>,
    );
    const root = screen.getByTestId("text-user-email").closest("div.flex.flex-col") as HTMLElement;
    // .closest() already returns the outermost div AppShell renders (the
    // text-user-email span is nested span -> header -> root-div, so walking
    // up the flex/flex-col chain lands on the root div itself).
    const outerRoot = root as HTMLElement;
    expect(outerRoot.className).toContain("h-screen");
    expect(outerRoot.className).not.toContain("min-h-screen");
    expect(outerRoot.className).toContain("overflow-hidden");
    const main = screen.getByText("lab content").closest("main") as HTMLElement;
    expect(main.className).toContain("overflow-y-auto");
  });

  it("mounts the app footer below the body content, reserving its own height", () => {
    render(
      <AppShell userEmail="student@example.com">
        <div>lab content</div>
      </AppShell>,
    );
    const footer = screen.getByTestId("app-footer");
    expect(footer).toBeInTheDocument();
    expect(footer.className).toContain("flex-shrink-0");
    // The footer must be a sibling of <main>, not nested inside it — nesting
    // it inside the scrollable region would let it scroll out of view /
    // overlap body content instead of always reserving its own fixed strip
    // at the bottom of the h-screen column.
    const main = screen.getByText("lab content").closest("main") as HTMLElement;
    expect(footer.parentElement).toBe(main.parentElement);
  });

  it("keeps the footer un-clipped and non-overlapping at a narrow (375px) viewport", () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 375 });
    window.dispatchEvent(new Event("resize"));
    try {
      render(
        <AppShell userEmail="student@example.com">
          <div>lab content</div>
        </AppShell>,
      );
      const root = screen.getByTestId("app-footer").closest("div.h-screen") as HTMLElement;
      const footer = screen.getByTestId("app-footer");
      const main = screen.getByText("lab content").closest("main") as HTMLElement;
      // Column layout (h-screen flex flex-col) with a flex-shrink-0 footer
      // is width-independent for the overlap concern: the footer always
      // reserves its own row at the bottom regardless of viewport width, and
      // <main> stays the sole scrollable/clippable region.
      expect(root).toBeInTheDocument();
      expect(footer.className).toContain("flex-shrink-0");
      expect(main.className).toContain("overflow-y-auto");
      expect(footer.parentElement).toBe(main.parentElement);
    } finally {
      Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: originalWidth });
    }
  });
});
