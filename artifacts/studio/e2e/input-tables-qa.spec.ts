/**
 * Browser E2E — Bundle 2 P4 input tables (SCU-2.P4.15 QA).
 *
 * Committed coverage for two things the QA pass first proved in throwaway
 * scripts and that have a real fixture path (transport-coal, quick solve):
 *   1. D2 history read-only — while browsing an older result every control in
 *      Mines / Stations / Lane Costs is disabled, Upload ▾ / Download ▾ carry
 *      "Input exports reflect the current scenario", and an inline add-row form
 *      that was open at the latest entry is disabled after stepping back. A
 *      non-vacuity check first proves the same tabs HAVE enabled controls at the
 *      latest entry (an all-disabled assertion on a tab with no controls
 *      proves nothing).
 *   2. Lane Costs' cost-range filter resets on a km/mi switch (user decision
 *      2026-10-17: input distance-range filters reset on unit change).
 *
 * Fixture rows go in through the real import-apply endpoint (the production
 * writer), not hand-built inputs. The two solves are real (CBC), via the API.
 *
 * Target: E2E_BASE_URL + the vite dev proxy — see e2e/CLAUDE.md.
 */
import { test, expect, type Page } from "./fixtures";
import { readSolvedAt } from "./helpers/solvedAt";

const HEADER_TIMEOUT = 10_000;
const READ_ONLY_TITLE = "Read-only while browsing result history.";
const EXPORT_TITLE = "Input exports reflect the current scenario";

async function registerAndGoHome(page: Page): Promise<void> {
  const email = `e2e-inputtablesqa-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", { data: { email, password: "correcthorse1" } });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
}

async function createTransportScenario(page: Page): Promise<string> {
  const resp = await page.request.post("/api/scenarios", {
    data: {
      name: `E2E InputTablesQA ${Date.now()}`,
      modelId: "transport-coal",
      inputs: {
        distanceBands: [500, 1000, 1500, 2000],
        gap: 0,
        timeLimitSec: 120,
        capacityFactor: 1.0,
        singleSource: false,
        capacityInactive: false,
      },
    },
  });
  expect(resp.status()).toBe(201);
  return String((await resp.json()).id);
}

async function applyImport(page: Page, id: string, entity: string, csvText: string): Promise<void> {
  const resp = await page.request.post(`/api/scenarios/${id}/import/apply`, {
    data: { entity, csvText, mode: "all_or_nothing" },
  });
  expect(resp.status(), await resp.text()).toBe(200);
}

const SOLVE_TIMEOUT = 90_000;

/**
 * Solve through the real UI. Result history is client SESSION state (the page
 * appends an entry each time a new result arrives while it is open), so two API
 * solves followed by a page load show 1/1, not 2/2 — the solves must happen with
 * the page open. Completion signal: `solvedAt` advancing (e2e/CLAUDE.md).
 */
async function solveViaUi(page: Page, id: string): Promise<void> {
  const before = await readSolvedAt(page, id);
  await page.getByTestId("button-run-optimizer").click();
  await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
  await page.getByTestId("solve-dialog-solve").click();
  await expect
    .poll(() => readSolvedAt(page, id), { timeout: SOLVE_TIMEOUT, intervals: [500, 1000, 2000] })
    .not.toBe(before);
  await expect(page.getByTestId("solve-progress-overlay")).toHaveCount(0, { timeout: HEADER_TIMEOUT });
}

async function saveViaHeader(page: Page): Promise<void> {
  const save = page.getByTestId("button-save").first();
  await expect(save).toBeEnabled({ timeout: HEADER_TIMEOUT });
  await save.click();
  await expect(save).toBeDisabled({ timeout: HEADER_TIMEOUT });
}

async function openTab(page: Page, sidebar: string, root: string): Promise<void> {
  await page.getByTestId(sidebar).click({ timeout: HEADER_TIMEOUT });
  await expect(page.getByTestId(root)).toBeVisible({ timeout: HEADER_TIMEOUT });
}

/** Every button / input / checkbox in a tab, except the browse-only filter trigger and pager. */
async function enabledCount(page: Page, root: string): Promise<{ enabled: number; total: number; enabledIds: string[] }> {
  return page
    .locator(`[data-testid="${root}"]`)
    .locator('input:not([type="hidden"]):not([type="file"]), button, [role="checkbox"]')
    .evaluateAll(els => {
    const skip = (t: string) => t === "button-filter-menu-trigger" || t.endsWith("-prev") || t.endsWith("-next");
    const all = els.filter(e => !skip(e.getAttribute("data-testid") ?? ""));
    const on = all.filter(e => !(e as HTMLInputElement).disabled);
    return { enabled: on.length, total: all.length, enabledIds: on.map(e => e.getAttribute("data-testid") ?? "(none)") };
  });
}

const TABS = [
  { label: "Mines", sidebar: "sidebar-input-mines", root: "mines-tab", t: "mines" },
  { label: "Stations", sidebar: "sidebar-input-stations", root: "stations-tab", t: "stations" },
  { label: "Lane Costs", sidebar: "sidebar-input-laneCosts", root: "lanecosts-tab", t: "lanecosts" },
] as const;

test.describe("Input tables — history read-only (D2) and unit-reset (SCU-2.P4.15, transport-coal)", () => {
  test("every control in Mines / Stations / Lane Costs is disabled while browsing history, including an inline add form opened at the latest entry", async ({ page }) => {
    test.setTimeout(240_000);
    await registerAndGoHome(page);
    const id = await createTransportScenario(page);
    try {
      await applyImport(page, id, "mines", "template_version,id,display_code,city,state,lat,lng,capacity\n1,,,Denver,CO,39.7,-104.9,5000000\n");
      await applyImport(page, id, "stations", "template_version,id,display_code,city,state,lat,lng,demand\n1,,,Denver,CO,39.7,-104.9,1000\n");
      await applyImport(page, id, "laneCosts", "template_version,unit,from_id,to_id,cost\n2,mi,KY,LAX,100\n");
      await page.goto(`/chapter-5/transport?scenario=${id}`);
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await solveViaUi(page, id);
      // A genuinely different second input (a station demand override) so history gets a distinct 2nd entry.
      await page.getByTestId("sidebar-input-stations").click();
      const demand = page.locator('[data-testid^="input-station-demand-"]').first();
      await expect(demand).toBeVisible({ timeout: HEADER_TIMEOUT });
      await demand.fill("1500");
      await saveViaHeader(page);
      await solveViaUi(page, id);
      await expect(page.getByTestId("text-result-history-position")).toHaveText("2/2", { timeout: HEADER_TIMEOUT });

      // Non-vacuity: at the latest entry each tab has enabled controls.
      for (const tab of TABS) {
        await openTab(page, tab.sidebar, tab.root);
        const { enabled, total } = await enabledCount(page, tab.root);
        expect(enabled, `${tab.label}: ${enabled}/${total} enabled at the latest entry — the history assertion would be vacuous`).toBeGreaterThan(0);
      }

      // Open Lane Costs' inline add-row form at the latest entry, then step back with it open.
      await openTab(page, "sidebar-input-laneCosts", "lanecosts-tab");
      await page.getByTestId("button-add-lanecost-row").click();
      await expect(page.getByTestId("add-lanecost-row-form")).toBeVisible();
      await page.getByTestId("button-result-back").click();
      await expect(page.getByTestId("text-result-history-position")).toHaveText("1/2", { timeout: HEADER_TIMEOUT });
      for (const tid of ["input-new-lanecost-from", "input-new-lanecost-to", "input-new-lanecost-value", "button-add-lanecost-confirm"]) {
        await expect(page.getByTestId(tid), `${tid} must be disabled in history`).toBeDisabled();
      }

      // History: nothing editable in any tab; Upload/Download carry the export reason.
      for (const tab of TABS) {
        await openTab(page, tab.sidebar, tab.root);
        const { enabledIds, total } = await enabledCount(page, tab.root);
        expect(total, `${tab.label} has controls`).toBeGreaterThan(0);
        // Cancel on an open inline form is the only control allowed to stay enabled.
        expect(enabledIds.filter(t => !t.endsWith("-cancel")), `${tab.label}: enabled controls while browsing history`).toEqual([]);
        for (const trigger of [`button-import-${tab.t}`, `button-download-${tab.t}`]) {
          await expect(page.getByTestId(trigger)).toBeDisabled();
          await expect(page.getByTestId(trigger)).toHaveAttribute("title", EXPORT_TITLE);
        }
      }
      // Cell controls say why.
      await openTab(page, "sidebar-input-mines", "mines-tab");
      await expect(page.locator('[data-testid^="input-mine-capacity-"]').first()).toHaveAttribute("title", READ_ONLY_TITLE);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("Lane Costs' cost-range filter resets when the km/mi display unit switches", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page);
    const id = await createTransportScenario(page);
    try {
      // 12 overrides so the table exceeds 10 rows and the FilterMenu appears.
      const mines = ["KY", "WY", "PA"];
      const stations = ["LAX", "NYC", "CHI", "HOU"];
      const rows = mines.flatMap((m, i) => stations.map((s, j) => `2,mi,${m},${s},${100 + i * 10 + j}`));
      await applyImport(page, id, "laneCosts", `template_version,unit,from_id,to_id,cost\n${rows.join("\n")}\n`);

      await page.goto(`/chapter-5/transport?scenario=${id}`);
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await openTab(page, "sidebar-input-laneCosts", "lanecosts-tab");
      await page.getByTestId("unit-toggle-mi").click();

      await page.getByTestId("button-filter-menu-trigger").click({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("input-filter-cost-min").fill("105");
      await expect(page.getByTestId("input-filter-cost-min")).toHaveValue("105");
      await page.keyboard.press("Escape");
      const filtered = await page.locator('tr[data-row-key]').count();
      expect(filtered).toBeLessThan(12);

      await page.getByTestId("unit-toggle-km").click();
      await page.getByTestId("button-filter-menu-trigger").click({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("input-filter-cost-min")).toHaveValue("");
      await page.keyboard.press("Escape");
      await expect(page.locator('tr[data-row-key]')).toHaveCount(12, { timeout: HEADER_TIMEOUT });
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});
