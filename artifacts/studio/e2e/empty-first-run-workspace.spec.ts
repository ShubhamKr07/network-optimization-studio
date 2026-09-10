/**
 * Browser E2E — QA regression: empty-first-run Workspace state.
 *
 * A logged-in user opening a model's Workspace (`/chapter-3`) with ZERO
 * scenarios created yet must not crash, must show a sensible empty state in
 * the Scenarios sidebar section and the tab content area, must gate Outputs
 * (disabled — no solved run possible with no scenario) and Run Optimizer
 * (disabled — nothing to solve), and the create-first-scenario flow must
 * actually work end to end (the dialog is reachable and, once confirmed,
 * becomes the active scenario with Bundle 6's one-shot Input Map seed
 * firing now that a scenario exists).
 *
 * This targets the same bug CLASS documented in CLAUDE.md's "A `<Dialog>`
 * triggered from an early-return branch must also be RENDERED in that same
 * branch" gotcha (Studio.tsx's pre-Workspace first-run crash) — Workspace.tsx
 * has a single always-rendered return (no early-return branches), so this
 * spec is regression coverage for that structural invariant holding, not
 * just a feature check.
 */
import { test, expect, type Page } from "@playwright/test";

const HEADER_TIMEOUT = 10_000;

async function registerFreshAccount(page: Page): Promise<void> {
  const email = `e2e-emptyfirstrun-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
}

test.describe("Empty-first-run Workspace state", () => {
  test("brand-new account with zero scenarios: no crash, sensible empty state, create-first-scenario works", async ({ page }) => {
    test.setTimeout(60_000);

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", msg => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", err => pageErrors.push(String(err)));

    await registerFreshAccount(page);
    await page.goto("/chapter-3");

    // 1. Page renders, no crash.
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });

    // 2. Scenarios sidebar: empty state + reachable create control.
    await expect(page.getByText("No scenarios yet")).toBeVisible();
    const createBtn = page.getByTestId("button-create-scenario");
    await expect(createBtn).toBeVisible();
    await expect(createBtn).toBeEnabled();

    // 3. Header: chapter summary renders, Run Optimizer present but
    // disabled (no scenario to solve), Bundle 6 header-rework removals hold
    // (no scenario-context select / user-email / logout inside Workspace —
    // those only ever lived in AppShell, which Workspace does not use).
    await expect(page.getByTestId("workspace-chapter-summary")).toBeVisible();
    await expect(page.getByTestId("button-run-optimizer")).toBeDisabled();
    await expect(page.getByTestId("select-scenario-context")).toHaveCount(0);
    await expect(page.getByTestId("text-user-email")).toHaveCount(0);
    await expect(page.getByTestId("button-logout")).toHaveCount(0);

    // 4. Content area with no scenario: a sensible prompt, not blank/broken.
    await expect(page.getByText("Pick an item from the sidebar to open it as a tab.")).toBeVisible();

    // 5. Every sidebar Inputs entry opens without crashing; Outputs stay
    // disabled throughout (hasSolvedRun is false with no scenario at all).
    for (const entity of ["warehouses", "customers", "optimization-parameters", "input-map", "distances"]) {
      await page.getByTestId(`sidebar-input-${entity}`).click();
    }
    await expect(page.getByTestId("sidebar-output-output-map")).toBeDisabled();
    await expect(page.getByTestId("sidebar-output-open-warehouses")).toBeDisabled();

    // 6. Create-first-scenario flow: dialog opens and is actually rendered
    // (the historical bug class), confirming creates a real scenario, it
    // becomes active, and the Input Map auto-opens (Bundle 6 one-shot seed
    // now firing since currentScenario exists).
    await createBtn.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: HEADER_TIMEOUT });
    await dialog.getByRole("button", { name: /create/i }).click();

    await expect(page.getByTestId("input-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(page.getByText("No scenarios yet")).not.toBeVisible();
    await expect(page.getByTestId("button-run-optimizer")).toBeEnabled();

    expect(consoleErrors, `unexpected console errors:\n${consoleErrors.join("\n")}`).toEqual([]);
    expect(pageErrors, `unexpected page errors:\n${pageErrors.join("\n")}`).toEqual([]);

    // Cleanup — delete the created scenario via the API.
    const scenariosResp = await page.request.get("/api/scenarios?modelId=p-median-us");
    const scenarios = await scenariosResp.json();
    for (const s of scenarios) {
      await page.request.delete(`/api/scenarios/${s.id}`);
    }
  });
});
