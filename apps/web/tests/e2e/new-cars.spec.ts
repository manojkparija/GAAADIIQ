/**
 * New Cars scenario coverage — Next.js public surfaces.
 */
import { test, expect } from "@playwright/test";
import path from "path";

const OUT = "/opt/cursor/artifacts/new-cars";

test.describe("New Cars — Next.js scenarios", () => {
  test("NC-UI-001 Navbar New Cars goes to listing_type=new", async ({ page }) => {
    await page.goto("/");
    const link = page.getByRole("link", { name: /^New Cars$/i }).first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/listing_type=new/);
  });

  test("NC-UI-002 /listings?listing_type=new page loads", async ({ page }) => {
    await page.goto("/listings?listing_type=new");
    await expect(page.locator("body")).not.toContainText(/Application error|Internal Server Error/i);
    const titleish = page.getByText(/New Cars|new car|listings/i).first();
    await expect(titleish).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: path.join(OUT, "01-listings-new.png"), fullPage: true });
  });

  test("NC-UI-003 Homepage New Cars CTA", async ({ page }) => {
    await page.goto("/");
    const cta = page.getByRole("link", { name: /New Cars/i }).first();
    await expect(cta).toBeVisible();
    const href = await cta.getAttribute("href");
    expect(href).toMatch(/listing_type=new|\/listings/);
  });

  test("NC-UI-004 /cars brand directory loads", async ({ page }) => {
    await page.goto("/cars");
    await expect(page.getByText(/Car Catalogue|Brand|Maruti|Hyundai/i).first()).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: path.join(OUT, "02-cars-directory.png"), fullPage: true });
  });

  test("NC-UI-005 /cars/hyundai brand page loads", async ({ page }) => {
    await page.goto("/cars/hyundai");
    await expect(page.getByText(/Hyundai/i).first()).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: path.join(OUT, "03-cars-hyundai.png"), fullPage: true });
  });

  test("NC-UI-006 Brand page body-type links leave new-cars scope", async ({ page }) => {
    await page.goto("/cars");
    const suv = page.getByRole("link", { name: /SUV/i }).first();
    if (await suv.count()) {
      const href = await suv.getAttribute("href");
      // Gap if body type does not preserve listing_type=new
      expect(href).toBeTruthy();
      if (href && !href.includes("listing_type=new")) {
        test.info().annotations.push({
          type: "gap",
          description: `Body-type link missing listing_type=new: ${href}`,
        });
      }
    }
  });

  test("NC-UI-007 Compare page reachable from nav (new-car adjacent)", async ({ page }) => {
    await page.goto("/compare");
    await expect(page.getByText(/Compare/i).first()).toBeVisible({ timeout: 15000 });
  });

  test("NC-UI-008 No model/variant catalogue routes", async ({ page }) => {
    const res = await page.goto("/cars/hyundai/creta");
    // Expect 404 — PRD gap
    const status = res?.status() ?? 0;
    const body = await page.locator("body").innerText();
    const is404 = status === 404 || /404|not found|this page could not be found/i.test(body);
    expect(is404).toBeTruthy();
    test.info().annotations.push({
      type: "gap",
      description: "PRD route /cars/[brand]/[model] missing (404)",
    });
  });

  test("NC-UI-009 Empty brand CTA href is broken /listings/new", async ({ page }) => {
    await page.goto("/cars/bmw");
    const link = page.getByRole("link", { name: /List Your Car/i });
    await expect(link).toBeVisible();
    const href = await link.getAttribute("href");
    // Documented product gap: should be /dashboard/listings/new (auth-gated)
    expect(href).toBe("/listings/new");
    const res = await page.request.get("/listings/new");
    expect(res.status()).toBe(404);
    test.info().annotations.push({
      type: "gap",
      description: "Empty brand CTA points to missing /listings/new (404)",
    });
  });

  test("NC-UI-010 Dealers page missing", async ({ page }) => {
    const res = await page.goto("/dealers");
    const status = res?.status() ?? 0;
    const body = await page.locator("body").innerText();
    const missing = status === 404 || /404|not found/i.test(body);
    expect(missing).toBeTruthy();
    test.info().annotations.push({ type: "gap", description: "/dealers missing" });
  });

  test("NC-UI-011 Mobile new listings screenshot", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/listings?listing_type=new");
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, "04-listings-new-mobile.png"), fullPage: true });
  });
});
