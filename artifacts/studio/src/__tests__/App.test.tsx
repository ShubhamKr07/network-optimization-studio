import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

// Real wouter, real react-query — this bug (a real production 404 after
// login/register/logout) was a routing/timing issue that a fully-mocked
// router could never reproduce or guard against. Page components are
// stubbed so this test is purely about routing, not their internals.
vi.mock("@/pages/auth/Login", () => ({ Login: () => <div>LoginPage</div> }));
vi.mock("@/pages/auth/Register", () => ({ Register: () => <div>RegisterPage</div> }));
vi.mock("@/pages/Landing", () => ({ Landing: () => <div>LandingPage</div> }));
vi.mock("@/pages/Studio", () => ({ Studio: () => <div>StudioPage</div> }));
vi.mock("@/pages/Workspace", () => ({ Workspace: () => <div>WorkspacePage</div> }));
vi.mock("@/pages/Compare", () => ({ Compare: () => <div>ComparePage</div> }));
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
}));

const mockUseGetCurrentAuthUser = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useGetCurrentAuthUser: () => mockUseGetCurrentAuthUser(),
}));

import { Gate } from "@/App";

function renderAt(path: string, user: { email: string } | null) {
  mockUseGetCurrentAuthUser.mockReturnValue({ data: { user }, isLoading: false });
  const { hook } = memoryLocation({ path });
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <Gate />
      </Router>
    </QueryClientProvider>,
  );
}

describe("Gate routing — a fixed route set (no swapped auth/unauth trees)", () => {
  // This is the actual production bug: AuthedRouter/UnauthedRouter used to
  // be two separate <Switch> trees swapped based on auth state. Each one's
  // own catch-all fired independently the instant location changed, even
  // before Gate itself re-rendered with fresh auth data — landing on a
  // route the OTHER tree owned, which fell through to a hard NotFound.
  it("never shows NotFound at / while unauthenticated (redirects toward /login instead)", () => {
    renderAt("/", null);
    expect(screen.queryByText("LandingPage")).not.toBeInTheDocument();
  });

  it("never shows NotFound at /login while authenticated (redirects to / instead)", () => {
    renderAt("/login", { email: "student@example.com" });
    expect(screen.getByText("LandingPage")).toBeInTheDocument();
    expect(screen.queryByText("LoginPage")).not.toBeInTheDocument();
  });

  it("never shows NotFound at /register while authenticated (redirects to / instead)", () => {
    renderAt("/register", { email: "student@example.com" });
    expect(screen.getByText("LandingPage")).toBeInTheDocument();
    expect(screen.queryByText("RegisterPage")).not.toBeInTheDocument();
  });

  it("shows Login at /login when unauthenticated", () => {
    renderAt("/login", null);
    expect(screen.getByText("LoginPage")).toBeInTheDocument();
  });

  it("shows Register at /register when unauthenticated", () => {
    renderAt("/register", null);
    expect(screen.getByText("RegisterPage")).toBeInTheDocument();
  });

  it("shows Landing at / when authenticated, inside AppShell", () => {
    renderAt("/", { email: "student@example.com" });
    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
    expect(screen.getByText("LandingPage")).toBeInTheDocument();
  });

  it("shows Studio at a non-workspace chapter path when authenticated", () => {
    renderAt("/chapter-10/gold-refinery", { email: "student@example.com" });
    expect(screen.getByText("StudioPage")).toBeInTheDocument();
  });

  it("shows Compare at /compare when authenticated", () => {
    renderAt("/compare", { email: "student@example.com" });
    expect(screen.getByText("ComparePage")).toBeInTheDocument();
  });

  it("redirects an unknown path to /login when unauthenticated (not a bare 404)", () => {
    renderAt("/some-unknown-path", null);
    expect(screen.getByText("LoginPage")).toBeInTheDocument();
  });
});

describe("Gate routing — A0.2 pilot flip: /chapter-3 renders Workspace, not Studio", () => {
  it("shows Workspace (not Studio) at /chapter-3 when authenticated", () => {
    renderAt("/chapter-3", { email: "student@example.com" });
    expect(screen.getByText("WorkspacePage")).toBeInTheDocument();
    expect(screen.queryByText("StudioPage")).not.toBeInTheDocument();
  });

  it("does NOT wrap Workspace in AppShell (Workspace renders its own self-contained header — avoids the double-header risk flagged by A0.1's review)", () => {
    renderAt("/chapter-3", { email: "student@example.com" });
    expect(screen.queryByTestId("app-shell")).not.toBeInTheDocument();
  });

  it("redirects to /login at /chapter-3 when unauthenticated, same as every other chapter route", () => {
    renderAt("/chapter-3", null);
    expect(screen.getByText("LoginPage")).toBeInTheDocument();
    expect(screen.queryByText("WorkspacePage")).not.toBeInTheDocument();
  });

  it.each(["/chapter-10/gold-refinery"])(
    "still shows Studio inside AppShell at %s (fast-follow flip is a later task)",
    (path) => {
      renderAt(path, { email: "student@example.com" });
      expect(screen.getByText("StudioPage")).toBeInTheDocument();
      expect(screen.getByTestId("app-shell")).toBeInTheDocument();
      expect(screen.queryByText("WorkspacePage")).not.toBeInTheDocument();
    },
  );
});

describe("Gate routing — A5.1/A5.2 fast-follow flips: transport-coal and p-median-brazil render Workspace, not Studio", () => {
  it.each(["/chapter-5/transport", "/chapter-5/brazil"])(
    "shows Workspace (not Studio) at %s when authenticated",
    (path) => {
      renderAt(path, { email: "student@example.com" });
      expect(screen.getByText("WorkspacePage")).toBeInTheDocument();
      expect(screen.queryByText("StudioPage")).not.toBeInTheDocument();
    },
  );

  it.each(["/chapter-5/transport", "/chapter-5/brazil"])(
    "does NOT wrap Workspace in AppShell at %s",
    (path) => {
      renderAt(path, { email: "student@example.com" });
      expect(screen.queryByTestId("app-shell")).not.toBeInTheDocument();
    },
  );

  it.each(["/chapter-5/transport", "/chapter-5/brazil"])(
    "redirects to /login at %s when unauthenticated",
    (path) => {
      renderAt(path, null);
      expect(screen.getByText("LoginPage")).toBeInTheDocument();
      expect(screen.queryByText("WorkspacePage")).not.toBeInTheDocument();
    },
  );
});
