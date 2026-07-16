/**
 * Capture full-page screenshots for look-and-feel retest.
 */
import { test } from "@playwright/test";
import path from "path";

const OUT = "/opt/cursor/artifacts/ui-lookfeel";

const PAGES: { name: string; url: string }[] = [
  { name: "01-home", url: "/" },
  { name: "02-listings", url: "/listings" },
  { name: "03-search", url: "/search?q=swift" },
  { name: "04-compare", url: "/compare" },
  { name: "05-recommend", url: "/recommend" },
  { name: "06-tco", url: "/tco" },
  { name: "07-cars", url: "/cars" },
  { name: "08-cars-hyundai", url: "/cars/hyundai" },
  { name: "09-login", url: "/login" },
  { name: "10-register", url: "/register" },
  { name: "11-dashboard-redirect", url: "/dashboard" },
];

test.describe("look-and-feel screenshots", () => {
  for (const p of PAGES) {
    test(`screenshot ${p.name}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(p.url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(800);
      await page.screenshot({
        path: path.join(OUT, `${p.name}.png`),
        fullPage: true,
      });
    });
  }

  test("screenshot home mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(600);
    await page.screenshot({
      path: path.join(OUT, "12-home-mobile.png"),
      fullPage: true,
    });
  });
});
