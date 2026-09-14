import { defaults } from "../../src/core";
import { test, expect, chromium } from "@playwright/test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
test("unmodified ZIP loads and in-place update preserves identity, settings and cards", async ({}, testInfo) => {
  const extension = mkdtempSync(path.join(tmpdir(), "langloop-package-"));
  const profile = mkdtempSync(path.join(tmpdir(), "langloop-upgrade-"));
  execFileSync("unzip", [
    "-q",
    path.resolve("dist/langloop-extension.zip"),
    "-d",
    extension,
  ]);
  const original = JSON.parse(
    readFileSync(path.join(extension, "manifest.json"), "utf8"),
  );
  expect(original.host_permissions).toEqual(["http://*/*", "https://*/*"]);
  expect(original.optional_host_permissions).toBeUndefined();
  expect(original.content_scripts[0].js).toEqual(["page.js"]);
  const launch = () =>
    chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    });
  let ctx = await launch();
  try {
    let worker =
      ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
    const id = new URL(worker.url()).host;
    await worker.evaluate(
      (settings) => chrome.storage.local.set({ settings }),
      { ...defaults, uiLanguage: "en" },
    );
    let page = await ctx.newPage();
    await page.goto(`chrome-extension://${id}/panel.html`);
    await expect(
      page.getByRole("heading", { name: "LangLoop", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Model", { exact: true }).fill("local");
    await page
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await expect(page.locator(".notice[role=status]")).toContainText(
      "Settings saved",
    );
    const saved = await page.evaluate(async () =>
      chrome.runtime.sendMessage({
        type: "saveCard",
        payload: {
          id: "c1",
          original: "interested to buy",
          result: "interested in buying",
          explanation: "in 是介系詞，後接動名詞。",
          rule: "interested in + V-ing",
          createdAt: 1,
        },
      }),
    );
    expect(saved.status).toBe("ok");
    await page.reload();
    await page
      .getByRole("button", { name: "My learning", exact: true })
      .click();
    await expect(page.locator(".card")).toHaveCount(1);
    await ctx.close();
    writeFileSync(
      path.join(extension, "manifest.json"),
      JSON.stringify({ ...original, version: "0.1.1" }),
    );
    ctx = await launch();
    worker =
      ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
    expect(new URL(worker.url()).host).toBe(id);
    page = await ctx.newPage();
    await page.setViewportSize({ width: 420, height: 850 });
    await page.goto(`chrome-extension://${id}/panel.html`);
    await expect(page.locator("header")).toContainText("v0.1.1");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByLabel("Model", { exact: true })).toHaveValue(
      "local",
    );
    await page
      .getByRole("button", { name: "My learning", exact: true })
      .click();
    await expect(page.locator(".card")).toHaveCount(1);
    await page.getByText("Reveal explanation").click();
    await page.screenshot({
      path: testInfo.outputPath("learning.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Assist", exact: true }).click();
    await page
      .getByLabel("Selected text or draft")
      .fill("I look forward to hear from you.");
    await page.screenshot({
      path: testInfo.outputPath("assist.png"),
      fullPage: true,
    });
  } finally {
    await ctx.close();
    rmSync(extension, { recursive: true, force: true });
    rmSync(profile, { recursive: true, force: true });
  }
});
