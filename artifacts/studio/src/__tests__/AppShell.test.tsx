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

// WF-3 — bare-spy mock, same pattern as Workspace.test.tsx: no DOM toast
// renders in this suite, so a failed logout is asserted via the call to
// `toast(...)`, not by querying for rendered text.
const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ toast: mockToast }));

// COSM-4 — the wholesale @workspace/api-client-react mock above exports no
// useSubmitFeedback, so every hero-mode render would mount the real widget
// and crash on an undefined hook. Stub the component instead of widening the
// hook mock: AppShell's contract here is "the widget is mounted in hero
// mode", and the widget's own behaviour is covered by FeedbackWidget.test.tsx.
vi.mock("@/components/FeedbackWidget", () => ({
  FeedbackWidget: () => <div data-testid="feedback-button" />,
}));

// COSM-5 — the real component needs canvas APIs this suite does not provide
// (no ctx/matchMedia/rAF mocks here); NetworkBackground.test.tsx owns those.
vi.mock("@/components/NetworkBackground", () => ({
  NetworkBackground: () => <div data-testid="network-background" />,
}));

import { AppShell } from "@/components/AppShell";
import { UnitProvider } from "@/contexts/UnitContext";

// T10 mounts <UnitToggle/> (which requires a UnitProvider ancestor) inside
// AppShell's own header — every render of AppShell needs that provider now.
function renderShell(ui: React.ReactElement) {
  return render(<UnitProvider>{ui}</UnitProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AppShell logout", () => {
  it("clears the auth-user cache synchronously and navigates to /login on success", async () => {
    mockLogoutMutate.mockImplementation((_body, { onSuccess }) => onSuccess());
    renderShell(
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

  // WF-3 — before this fix, `handleLogout` passed no `onError` at all, so a
  // rejected logout call left the student still signed in with no visible
  // sign anything had happened: no toast, no navigation, the cache and the
  // header both untouched. Drives the REAL `onError` the component registers
  // (not a hand-rolled one), so reverting the fix in AppShell.tsx — deleting
  // the `onError` key — makes this red: `mockLogoutMutate`'s second argument
  // would then have no `onError` property to call, and `mockToast` would
  // never fire.
  it("toasts a failure and leaves the student signed in — no cache clear, no navigation", async () => {
    const apiErr = Object.assign(new Error("HTTP 500 Internal Server Error"), {
      status: 500,
      data: {},
    });
    mockLogoutMutate.mockImplementation((_body, { onError }) => onError(apiErr));
    renderShell(
      <AppShell userEmail="student@example.com">
        <div>content</div>
      </AppShell>,
    );
    await userEvent.click(screen.getByTestId("button-logout"));

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Couldn't log you out",
      description: "You are still signed in. Try again.",
      variant: "destructive",
    }));
    expect(mockSetQueryData).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("renders the user's email and children", () => {
    renderShell(
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
    renderShell(
      <AppShell userEmail="student@example.com">
        <div>lab content</div>
      </AppShell>,
    );
    const header = screen.getByTestId("text-user-email").closest("header") as HTMLElement;
    expect(header.className).toContain("scnd-band");
  });

  it("renders the given heroTitle in the band", () => {
    renderShell(
      <AppShell userEmail="student@example.com" heroTitle="Network Design Labs">
        <div>lab content</div>
      </AppShell>,
    );
    expect(screen.getByText("Network Design Labs")).toBeInTheDocument();
    expect(screen.queryByText("SCND Optimization Studio")).not.toBeInTheDocument();
  });

  it("falls back to the SCND Optimization Studio wordmark when no heroTitle is given", () => {
    renderShell(
      <AppShell userEmail="student@example.com">
        <div>lab content</div>
      </AppShell>,
    );
    expect(screen.getByText("SCND Optimization Studio")).toBeInTheDocument();
  });
});

describe("AppShell hero variant", () => {
  it("renders the tagline and heroTitle in the expanded band when hero is set", () => {
    renderShell(
      <AppShell userEmail="a@b.edu" heroTitle="Network Design Labs" hero>
        <div>content</div>
      </AppShell>,
    );
    expect(screen.getByText("Network Design Labs")).toBeInTheDocument();
    expect(screen.getByTestId("hero-tagline")).toHaveTextContent(/build a scenario/i);
    expect(screen.getByTestId("text-user-email")).toHaveTextContent("a@b.edu");
  });

  it("omits the tagline in the compact (non-hero) band", () => {
    renderShell(
      <AppShell userEmail="a@b.edu" heroTitle="Network Design Labs">
        <div>content</div>
      </AppShell>,
    );
    expect(screen.queryByTestId("hero-tagline")).not.toBeInTheDocument();
  });

  // COSM-4 — the `hero &&` gate is what scopes the feedback widget to the
  // homepage (App.tsx is the only caller that passes `hero`). Nothing else
  // covers that gate: FeedbackWidget.test.tsx renders the component directly.
  it("mounts the feedback widget only in hero mode", () => {
    const { rerender } = renderShell(
      <AppShell userEmail="a@b.edu" hero><div>content</div></AppShell>,
    );
    expect(screen.getByTestId("feedback-button")).toBeInTheDocument();
    rerender(<UnitProvider><AppShell userEmail="a@b.edu"><div>content</div></AppShell></UnitProvider>);
    expect(screen.queryByTestId("feedback-button")).not.toBeInTheDocument();
  });

  // COSM-5 — same hero gate as the feedback widget scopes the animated
  // background to the homepage.
  it("renders the network background only on the homepage hero shell", () => {
    const { rerender } = renderShell(<AppShell userEmail="a@b.c" hero>{<div />}</AppShell>);
    expect(screen.getByTestId("network-background")).toBeInTheDocument();

    rerender(<UnitProvider><AppShell userEmail="a@b.c">{<div />}</AppShell></UnitProvider>);
    expect(screen.queryByTestId("network-background")).not.toBeInTheDocument();
  });

  // Regression: the launcher used to float inside the scroll wrapper, where it
  // sat over a chapter card at 768-900px and over whatever was scrolling past
  // it at any width. Docking it in the footer is what fixes that, so assert
  // CONTAINMENT rather than presence — a bare getByTestId would pass just as
  // happily with the launcher floating back over the content.
  it("docks the feedback launcher in the footer, never in the scrolling region", () => {
    renderShell(<AppShell userEmail="a@b.c" hero>{<div>body</div>}</AppShell>);

    const launcher = screen.getByTestId("feedback-button");
    const footer = screen.getByTestId("homepage-credit-footer");
    const main = screen.getByText("body").closest("main") as HTMLElement;

    expect(footer).toContainElement(launcher);
    expect(main).not.toContainElement(launcher);
    // <main> is the scroll container; its parent is the stacking wrapper that
    // used to host the launcher. Both must be clear of it.
    expect(main.parentElement).not.toContainElement(launcher);
  });
});

describe("AppShell layout", () => {
  it("clamps its root to exactly one viewport height and scopes scrolling to <main>", () => {
    renderShell(
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
    renderShell(
      <AppShell userEmail="student@example.com">
        <div>lab content</div>
      </AppShell>,
    );
    const footer = screen.getByTestId("app-footer");
    expect(footer).toBeInTheDocument();
    expect(footer.className).toContain("flex-shrink-0");
    const main = screen.getByText("lab content").closest("main") as HTMLElement;
    const scrollWrapper = main.parentElement as HTMLElement;
    // COSM-4 — the footer must be a sibling of the WRAPPER, not of <main>:
    // <main> is now the scrolling element inside that wrapper, and nesting
    // the footer in there would let it scroll out of view / overlap body
    // content instead of always reserving its own fixed strip at the bottom
    // of the h-screen column.
    expect(footer.parentElement).toBe(scrollWrapper.parentElement);
    expect(scrollWrapper).not.toContainElement(footer);
  });

  it("keeps the footer un-clipped and non-overlapping at a narrow (375px) viewport", () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 375 });
    window.dispatchEvent(new Event("resize"));
    try {
      renderShell(
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
      // COSM-4 — same topology shift as the test above: the footer is a
      // sibling of the scroll WRAPPER, and must stay outside it.
      const scrollWrapper = main.parentElement as HTMLElement;
      expect(footer.parentElement).toBe(scrollWrapper.parentElement);
      expect(scrollWrapper).not.toContainElement(footer);
    } finally {
      Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: originalWidth });
    }
  });

  it("renders the book-cover icon in the hero band", () => {
    renderShell(<AppShell userEmail="a@b.edu" heroTitle="Network Design Labs" hero><div>c</div></AppShell>);
    const header = screen.getByTestId("text-user-email").closest("header") as HTMLElement;
    expect(header.querySelector("img")).toBeInTheDocument();
  });

  it("shows the developer-credit footer in hero mode and the plain footer otherwise", () => {
    const { rerender } = renderShell(<AppShell userEmail="a@b.edu" heroTitle="X" hero><div>c</div></AppShell>);
    expect(screen.getByTestId("homepage-credit-footer")).toHaveTextContent("Developed by Shubham");
    expect(screen.queryByTestId("app-footer")).not.toBeInTheDocument();
    rerender(<UnitProvider><AppShell userEmail="a@b.edu"><div>c</div></AppShell></UnitProvider>);
    expect(screen.queryByTestId("homepage-credit-footer")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-footer")).toBeInTheDocument();
  });

  it("gives the log-out button a hover-highlight class", () => {
    renderShell(<AppShell userEmail="a@b.edu" hero><div>c</div></AppShell>);
    expect(screen.getByTestId("button-logout").className).toContain("hover:bg-white/10");
  });
});
