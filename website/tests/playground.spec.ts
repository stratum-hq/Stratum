import { test, expect } from "@playwright/test";

const LOCKED_OVERRIDE = `const mssp = await stratum.createTenant({ name: "Sentinel MSSP", slug: "sentinel" });
const acme = await stratum.createTenant({ name: "Acme Corp", slug: "acme", parent_id: mssp.id });
await stratum.setConfig(mssp.id, "data_region", { value: "us-east-1", locked: true });
try {
  await stratum.setConfig(acme.id, "data_region", { value: "eu-west-1" });
  console.log("override accepted");
} catch (err) {
  console.log("refused: " + err.name);
}`;

test("the code editor refuses an override of a locked config key", async ({ page }) => {
  await page.goto("/playground/");
  await page.locator(".tab[data-tab=config]").click();
  await page.locator(".cm-content").fill(LOCKED_OVERRIDE);
  await page.locator("#run-btn").click();
  await expect(page.locator("#output")).toContainText("refused: ConfigLockedError");
  await expect(page.locator("#output")).not.toContainText("override accepted");
});
