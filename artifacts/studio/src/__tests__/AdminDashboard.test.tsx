import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { AdminFlaggedAnswers, AdminSiteFeedback, AdminWatBotMetrics, AdminWatBotMetricsDaysItem, AdminWatBotPeriod } from "@workspace/api-client-react";

const mockUser = vi.fn();
const metricsHook = vi.fn();
const flaggedHook = vi.fn();
const feedbackHook = vi.fn();
vi.mock("@workspace/api-client-react", async (orig) => ({
  ...(await orig<typeof import("@workspace/api-client-react")>()),
  useGetCurrentAuthUser: () => mockUser(),
  useGetAdminWatBotMetrics: (...a: unknown[]) => metricsHook(...a),
  useGetAdminWatBotFlagged: (...a: unknown[]) => flaggedHook(...a),
  useGetAdminFeedback: (...a: unknown[]) => feedbackHook(...a),
  useListModels: () => ({ data: [{ id: "p-median-us", name: "Chapter 3 p-median" }, { id: "max-coverage-us", name: "Chapter 4 coverage" }] }),
}));
vi.mock("@/pages/Landing", () => ({ Landing: () => <div>LandingPage</div> }));

import { Gate } from "@/App";
import { presetRange } from "@/lib/adminMetrics";

const day = (date: string, o: Partial<AdminWatBotMetricsDaysItem> = {}): AdminWatBotMetricsDaysItem => ({
  date, asked: 10, answered: 9, cancelled: 0, unavailable: 1, limitReached: 0, ratings: 0, helped: 0, notices: 0, refused: 0, stopped: 0,
  failedNotices: 0, costUsd: 0.4, latencyMedianMs: 2000, latencyP95Ms: 4000, estimated: 0, ...o,
});
const period = (o: Partial<AdminWatBotPeriod> = {}): AdminWatBotPeriod => ({
  answered: 100, activeStudents: 20, studentsByModel: [{ modelId: "p-median-us", students: 12 }], sessions: 30, sessionMedianMinutes: 9, sessionMedianQuestions: 3,
  ratings: 4, helped: 3, notHelpedByReason: [{ reason: "still_stuck", count: 1 }], reanswered: 1, reportsByReason: [], costUsd: 4,
  tokens: { input: 1000, output: 100, cacheRead: 600, cacheWrite: 50 }, gapTopics: [], ...o,
});
const metrics: AdminWatBotMetrics = {
  // week of 9 Nov has exactly 4 ratings in total -> the helped rate must be "–"
  days: [day("2026-11-09", { answered: 11, ratings: 3, helped: 2 }), day("2026-11-10", { answered: 7, ratings: 1, helped: 1 })],
  matrix: [{ modelId: "p-median-us", messageType: "concept_question", answered: 18 }],
  period: period(), prior: period({ answered: 80 }),
  sessionsByWeek: [{ weekStart: "2026-11-09", sessions: 30, medianMinutes: 9, medianQuestions: 3 }],
  monthToDate: { spendUsd: 10, capUsd: 50, month: "2026-11" },
};
const flagged: AdminFlaggedAnswers = {
  truncated: false,
  items: [
    { at: "2026-11-10T16:00:00.000Z", modelId: "p-median-us", messageType: "concept_question", question: "Why is p fixed?",
      answer: { text: "Because the model opens exactly p sites.", citations: ["Ch 3 p.74"] }, rating: { reason: "still_stuck", note: "no help" }, report: null,
      reanswer: { status: "answered", text: "Try one scenario per p." } },
    { at: "2026-11-09T16:00:00.000Z", modelId: "p-median-us", messageType: null, question: null,
      answer: { text: "An answer without a question.", citations: [] }, rating: null, report: { reason: "wrong_or_misleading", note: "wrong" },
      reanswer: { status: "not_completed", text: null } },
  ],
};
const feedback: AdminSiteFeedback = { truncated: false, items: [{ id: 1, body: "Dark mode is great.", createdAt: "2026-11-10T12:00:00.000Z" }] };

function renderAt(path: string, role: "student" | "admin") {
  mockUser.mockReturnValue({ data: { user: { id: "u1", email: "a@example.com", role } }, isLoading: false });
  const { hook } = memoryLocation({ path });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Router hook={hook}><Gate /></Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  const ok = (data: unknown) => ({ data, isError: false, isPlaceholderData: false, refetch: vi.fn() });
  metricsHook.mockReturnValue(ok(metrics));
  flaggedHook.mockReturnValue(ok(flagged));
  feedbackHook.mockReturnValue(ok(feedback));
});

describe("/admin include-admins switch", () => {
  it("is off by default and passes includeAdmins: true to metrics and flagged (not site feedback) when toggled", async () => {
    renderAt("/admin", "admin");
    const box = screen.getByRole("checkbox", { name: "Include admin accounts" });
    expect(box).not.toBeChecked();
    expect(metricsHook.mock.calls.at(-1)![0]).not.toHaveProperty("includeAdmins");
    await userEvent.click(box);
    expect(metricsHook.mock.calls.at(-1)![0]).toMatchObject({ includeAdmins: true });
    expect(flaggedHook.mock.calls.at(-1)![0]).toMatchObject({ includeAdmins: true });
    expect(metricsHook.mock.calls.at(-1)![1].query.queryKey).toEqual(expect.arrayContaining([expect.objectContaining({ includeAdmins: true })]));
    expect(feedbackHook.mock.calls.at(-1)![0]).not.toHaveProperty("includeAdmins");
  });
});

describe("/admin", () => {
  it("shows NotFound and no Admin link to a student", () => {
    renderAt("/admin", "student");
    expect(screen.queryByTestId("admin-dashboard")).not.toBeInTheDocument();
    expect(screen.queryByTestId("link-admin")).not.toBeInTheDocument();
    expect(screen.getByText(/404/)).toBeInTheDocument();
  });

  it("renders tiles, tabs, the voice column and the header link for an admin", () => {
    renderAt("/admin", "admin");
    expect(screen.getByText("Questions answered")).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Metric groups" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What students said" })).toBeInTheDocument();
    expect(screen.getByTestId("link-admin")).toHaveTextContent("Admin");
    expect(screen.getByText(/Days in US Central time/)).toBeInTheDocument();
  });

  it("links back to the student app", () => {
    renderAt("/admin", "admin");
    expect(screen.getByTestId("link-back-to-labs")).toHaveAttribute("href", "/");
    expect(screen.getByTestId("link-back-to-labs")).toHaveTextContent("Back to labs");
  });

  it("the Table toggle on Questions per day lists the daily counts", async () => {
    renderAt("/admin", "admin");
    const card = screen.getByTestId("card-u1");
    await userEvent.click(within(card).getByRole("button", { name: "Table" }));
    const rows = within(card).getAllByRole("row").map((r) => r.textContent);
    expect(rows).toContain("9 Nov11");
    expect(rows).toContain("10 Nov7");
  });

  it("shows – for a week with 4 ratings (n < 5) and keeps n", async () => {
    renderAt("/admin", "admin");
    await userEvent.click(screen.getByRole("tab", { name: "Quality" }));
    const card = screen.getByTestId("card-q1");
    await userEvent.click(within(card).getByRole("button", { name: "Table" }));
    expect(within(card).getAllByRole("row").map((r) => r.textContent)).toContain("Week of 9 Nov4–");
  });

  it("rounds the session median and notes that edge-crossing sessions are cut", () => {
    metricsHook.mockReturnValue({ data: { ...metrics, period: period({ sessionMedianMinutes: 7.383333333333334, sessionMedianQuestions: 2.5 }) },
      isError: false, isPlaceholderData: false, refetch: vi.fn() });
    renderAt("/admin", "admin");
    const meta = screen.getByTestId("card-u3").textContent ?? "";
    expect(meta).toContain("Median 7 min · 2.5 questions per session");
    expect(meta).toContain("sessions crossing the range edge are cut");
  });

  it("a model filter explains that site feedback has no chapter", async () => {
    renderAt("/admin", "admin");
    expect(screen.queryByText("Site feedback has no chapter, so it shows for every chapter.")).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /Chapter/ }), "p-median-us");
    expect(screen.getByText("Site feedback has no chapter, so it shows for every chapter.")).toBeInTheDocument();
  });

  it("flagged items: re-answer, not-completed and a missing question", async () => {
    renderAt("/admin", "admin");
    expect(screen.getByText("(question not found)")).toBeInTheDocument();
    expect(screen.getByText("Re-answer didn't finish")).toBeInTheDocument(); // in the details body (closed details stay in the DOM)
    expect(screen.getByText("Try one scenario per p.")).toBeInTheDocument();
    expect(screen.getByText(/anonymous/)).toBeInTheDocument();
  });

  it("shows a plain sentence and Retry on a failed load, never the error message", () => {
    metricsHook.mockReturnValue({ data: undefined, isError: true, isPlaceholderData: false, refetch: vi.fn(), error: new Error("SECRET-DB-DETAIL") });
    renderAt("/admin", "admin");
    expect(screen.getByText(/Couldn't load the dashboard/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText(/SECRET-DB-DETAIL/)).not.toBeInTheDocument();
  });

  it("clearing a custom date shows the invalid-range sentence instead of crashing", async () => {
    renderAt("/admin", "admin");
    await userEvent.click(screen.getByRole("button", { name: "Custom" }));
    fireEvent.change(screen.getByLabelText(/From/), { target: { value: "" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/Pick a range of at most 90 days/);
  });

  it("anchors the 7-day chips to the range end and says so for a past range", async () => {
    renderAt("/admin", "admin");
    expect(screen.getByText(/Not answered, last 7 days/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Custom" }));
    fireEvent.change(screen.getByLabelText(/From/), { target: { value: "2026-11-01" } });
    fireEvent.change(screen.getByLabelText(/^to/), { target: { value: "2026-11-10" } });
    expect(screen.getByText(/Not answered, 7 days to 10 Nov: 10% \(n = 20\)/)).toBeInTheDocument();
    expect(screen.getByText(/flagged answers, 7 days to 10 Nov/)).toBeInTheDocument();
  });

  it("passes { from, to, modelId } to the hooks (site feedback gets no modelId)", async () => {
    renderAt("/admin", "admin");
    const { from, to } = presetRange(30);
    expect(metricsHook.mock.calls.at(-1)?.[0]).toEqual({ from, to });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /Chapter/ }), "p-median-us");
    expect(metricsHook.mock.calls.at(-1)?.[0]).toEqual({ from, to, modelId: "p-median-us" });
    expect(flaggedHook.mock.calls.at(-1)?.[0]).toEqual({ from, to, modelId: "p-median-us" });
    expect(feedbackHook.mock.calls.at(-1)?.[0]).toEqual({ from, to });
  });
});
