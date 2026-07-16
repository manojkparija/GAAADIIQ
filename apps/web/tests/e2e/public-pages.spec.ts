/**
 * Smoke tests for public-facing pages.
 * These run against the Next.js dev server (or a deployed URL via PLAYWRIGHT_BASE_URL).
 */
import { test, expect } from "@playwright/test";

// ── Homepage ──────────────────────────────────────────────────────────────────

test("homepage loads and shows hero heading", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/GAADIIQ/i);
  // Heading or call-to-action should be visible
  const heading = page.locator("h1, h2").first();
  await expect(heading).toBeVisible();
});

// ── Listings ──────────────────────────────────────────────────────────────────

test("/listings page renders without error", async ({ page }) => {
  await page.goto("/listings");
  await expect(page).toHaveTitle(/GAADIIQ/i);
  await expect(page.locator("main")).toBeVisible();
});

// ── Search ────────────────────────────────────────────────────────────────────

test("/search page renders search bar", async ({ page }) => {
  await page.goto("/search?q=swift");
  await expect(page.getByRole("heading", { name: /Search Cars/i })).toBeVisible();
  await expect(page.locator("input, [role='searchbox']").first()).toBeVisible();
});

// ── Compare ───────────────────────────────────────────────────────────────────

test("/compare page loads with add-car prompt", async ({ page }) => {
  await page.goto("/compare");
  await expect(page).toHaveTitle(/GAADIIQ/i);
  await expect(page.getByText("Add a car to compare")).toBeVisible();
});

// ── AI Advisor / Recommend ────────────────────────────────────────────────────

test("/recommend page shows advisor questionnaire", async ({ page }) => {
  await page.goto("/recommend");
  await expect(page).toHaveTitle(/Car Advisor|GAADIIQ/i);
  await expect(page.getByRole("heading", { name: "Car Advisor" })).toBeVisible();
  await expect(page.getByText("Find Your Perfect Car")).toBeVisible();
});

test("/recommend budget step is interactive", async ({ page }) => {
  await page.goto("/recommend");
  const option = page.getByText("Under ₹5 L");
  await expect(option).toBeVisible();
  await option.click();
  // Should advance to next step
  await expect(page.getByText("Preferred fuel type?")).toBeVisible();
});

// ── TCO Calculator ────────────────────────────────────────────────────────────

test("/tco page loads calculator with default values", async ({ page }) => {
  await page.goto("/tco");
  await expect(page).toHaveTitle(/GAADIIQ/i);
  await expect(page.getByText("Total Cost of Ownership")).toBeVisible();
  await expect(page.getByText("Total").first()).toBeVisible();
});

test("/tco changing fuel type updates costs", async ({ page }) => {
  await page.goto("/tco");
  // Click Electric
  await page.getByRole("button", { name: "Electric" }).click();
  await expect(page.getByText("Electricity")).toBeVisible();
});

// ── Cars / Brand Catalogue ────────────────────────────────────────────────────

test("/cars page shows brand grid", async ({ page }) => {
  await page.goto("/cars");
  await expect(page).toHaveTitle(/GAADIIQ/i);
  await expect(page.getByText("Car Catalogue")).toBeVisible();
  await expect(page.getByText("Hyundai")).toBeVisible();
  await expect(page.getByText("Maruti Suzuki")).toBeVisible();
});

test("/cars/hyundai brand page renders", async ({ page }) => {
  await page.goto("/cars/hyundai");
  await expect(page.getByText("Hyundai Cars")).toBeVisible();
  await expect(page.getByText("All Brands")).toBeVisible();
});

// ── Protected pages redirect to login ────────────────────────────────────────

test("/dashboard redirects unauthenticated user to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/login|signin/i);
});

test("/notifications redirects unauthenticated user to login", async ({ page }) => {
  await page.goto("/notifications");
  await expect(page).toHaveURL(/login|signin/i);
});

test("/dashboard/analytics redirects unauthenticated user", async ({ page }) => {
  await page.goto("/dashboard/analytics");
  await expect(page).toHaveURL(/login|signin/i);
});

test("/dashboard/leads redirects unauthenticated user", async ({ page }) => {
  await page.goto("/dashboard/leads");
  await expect(page).toHaveURL(/login|signin/i);
});
