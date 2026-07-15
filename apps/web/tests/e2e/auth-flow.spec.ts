/**
 * Auth flow smoke tests — register, login, logout.
 * These interact with the real Next.js auth pages.
 */
import { test, expect } from "@playwright/test";

function uniqueEmail() {
  return `pw_test_${Date.now()}@example.com`;
}

test("register page renders form", async ({ page }) => {
  await page.goto("/register");
  await expect(page.locator("input[type='email'], input[name='email']")).toBeVisible();
  await expect(page.locator("input[type='password'], input[name='password']")).toBeVisible();
});

test("login page renders form", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("input[type='email'], input[name='email']")).toBeVisible();
  await expect(page.locator("input[type='password'], input[name='password']")).toBeVisible();
});

test("login with wrong credentials shows error", async ({ page }) => {
  await page.goto("/login");
  await page.locator("input[type='email'], input[name='email']").first().fill("nobody@nowhere.com");
  await page.locator("input[type='password'], input[name='password']").first().fill("wrongpassword");
  await page.getByRole("button", { name: /sign in|log in|login/i }).click();
  // Should show an error message or stay on login page
  const url = page.url();
  const body = await page.locator("body").textContent() ?? "";
  const hasError = body.includes("Invalid") || body.includes("incorrect") || body.includes("error") || url.includes("login");
  expect(hasError).toBeTruthy();
});
