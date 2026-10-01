import { test, expect, type Page } from "@playwright/test";

const LOCKED_OVERRIDE = `const mssp = await stratum.createTenant({ name: "Sentinel MSSP", slug: "sentinel" });
const acme = await stratum.createTenant({ name: "Acme Corp", slug: "acme", parent_id: mssp.id });
await stratum.setConfig(mssp.id, "data_region", { value: "us-east-1", locked: true });
try {
  await stratum.setConfig(acme.id, "data_region", { value: "eu-west-1" });
  console.log("override accepted");
} catch (err) {
  console.log("refused: " + err.name);
}`;

async function start(page: Page) {
  await page.goto("/playground/");
  await page.locator("#start-btn").click();
  await expect(page.locator("#status")).toContainText("Ready", { timeout: 90_000 });
}

/** Run the tour up to and including the step with this id. */
async function runTourTo(page: Page, stepId: string) {
  await page.locator(`.step-btn[data-step=${stepId}]`).click();
  await page.locator("#step-run").click();
  await expect(page.locator(`.step-btn[data-step=${stepId}]`)).toHaveClass(/done/);
}

test("the code editor refuses an override of a locked config key", async ({ page }) => {
  await start(page);
  await page.locator(".mode-tab[data-mode=editor]").click();
  await page.locator(".tab[data-tab=config]").click();
  await page.locator(".cm-content").fill(LOCKED_OVERRIDE);
  await page.locator("#run-btn").click();
  await expect(page.locator("#output")).toContainText("refused: ConfigLockedError");
  await expect(page.locator("#output")).not.toContainText("override accepted");
});

test("the guided tour refuses the locked override and shows the lock in the inspector", async ({ page }) => {
  await start(page);
  await runTourTo(page, "locked");
  const output = page.locator("#tour-output");
  await expect(output).toContainText("refused: ConfigLockedError");
  await expect(output).not.toContainText("override accepted");
  await expect(page.locator("#inspector-config")).toContainText("LOCKED");
});

test("the RLS step shows each role the rows that row-level security allows", async ({ page }) => {
  await start(page);
  await runTourTo(page, "rls");
  const output = page.locator("#tour-output");
  await expect(output).toContainText("superuser sees 3 rows");
  await expect(output).toContainText("app role without a tenant sees 0 rows");
  await expect(output).toContainText("app role as Acme AWS prod sees 1 row: S3 bucket is public");
  await expect(output).toContainText("cross-tenant insert refused: new row violates row-level security policy");
  await expect(output).not.toContainText("cross-tenant insert accepted");
});

test("the subtree step lets a parent read its descendants and nothing else", async ({ page }) => {
  await start(page);
  await runTourTo(page, "subtree");
  const output = page.locator("#tour-output");
  await expect(output).toContainText("NorthStar MSP, exact scope, sees 0 rows");
  await expect(output).toContainText("NorthStar MSP, subtree scope, sees 3 rows");
  await expect(output).toContainText("Acme Corp, subtree scope, sees 2 rows");
  await expect(output).not.toContainText("RDP is open");
  await expect(output).toContainText("insert for a child refused: new row violates row-level security policy");
});
