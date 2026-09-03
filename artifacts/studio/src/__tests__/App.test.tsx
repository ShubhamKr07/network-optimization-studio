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
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, heroTitle }: { children: React.ReactNode; heroTitle?: string }) => (
    <div data-testid="app-shell">
      {heroTitle ? <div>{heroTitle}</div> : <div>SCND Optimization Studio</div>}
      {children}
    </div>
  ),
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

  // A5.1-A5.3: every chapter route now has `workspace: true` — there is no
  // remaining "still shows Studio" chapter path to assert on (the
  // corresponding test above this describe block was removed for the same
  // reason). Studio.tsx itself is untouched and still exists (its deletion
  // is Phase D's D1.1, a separate task) but no live chapter route points at
  // it anymore.
});

describe("Gate routing — band hero title", () => {
  it("passes heroTitle=\"Network Design Labs\" to AppShell at /", () => {
    renderAt("/", { email: "student@example.com" });
    expect(screen.getByText("Network Design Labs")).toBeInTheDocument();
    expect(screen.queryByText("SCND Optimization Studio")).not.toBeInTheDocument();
  });

  it("renders the small SCND Optimization Studio wordmark fallback, not the large green hero title, at an unknown authenticated path (NotFound)", () => {
    renderAt("/some-unknown-path", { email: "student@example.com" });
    expect(screen.getByText("SCND Optimization Studio")).toBeInTheDocument();
    expect(screen.queryByText("Network Design Labs")).not.toBeInTheDocument();
  });
});

describe("Gate routing — A5.1/A5.2/A5.3 fast-follow flips: every chapter route renders Workspace, not Studio", () => {
  it.each(["/chapter-5/transport", "/chapter-5/brazil", "/chapter-10/gold-refinery"])(
    "shows Workspace (not Studio) at %s when authenticated",
    (path) => {
      renderAt(path, { email: "student@example.com" });
      expect(screen.getByText("WorkspacePage")).toBeInTheDocument();
      expect(screen.queryByText("StudioPage")).not.toBeInTheDocument();
    },
  );

  it.each(["/chapter-5/transport", "/chapter-5/brazil", "/chapter-10/gold-refinery"])(
    "does NOT wrap Workspace in AppShell at %s",
    (path) => {
      renderAt(path, { email: "student@example.com" });
      expect(screen.queryByTestId("app-shell")).not.toBeInTheDocument();
    },
  );

  it.each(["/chapter-5/transport", "/chapter-5/brazil", "/chapter-10/gold-refinery"])(
    "redirects to /login at %s when unauthenticated",
    (path) => {
      renderAt(path, null);
      expect(screen.getByText("LoginPage")).toBeInTheDocument();
      expect(screen.queryByText("WorkspacePage")).not.toBeInTheDocument();
    },
  );
});
