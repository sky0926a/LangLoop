import { defaults } from "../../src/core";
import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Worker,
  type Page,
} from "@playwright/test";
import { createServer, type Server } from "node:http";
import {
  mkdtempSync,
  rmSync,
  cpSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
let fixtureExtension: string;
let server: Server,
  context: BrowserContext,
  worker: Worker,
  panel: Page,
  web: Page,
  profile: string,
  port: number,
  extensionId: string;
const catalogDelay = 0,
  catalogStatus = 200,
  sampleStatus = 200;
let sampleDelay = 0;
const catalog: unknown = {
  data: [{ id: "claude/b" }, { id: "gpt/a" }, { id: "claude/b" }],
};
const requests: any[] = [];
test.describe.configure({ mode: "serial" });
const extension = path.resolve("dist/extension");
test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/draft-editor") {
      res.setHeader("Content-Type", "text/html");
      res.end(readFileSync("tests/fixtures/draft-editor.html"));
    } else if (req.url?.startsWith("/draft-vendor/")) {
      const name = path.basename(req.url);
      res.setHeader(
        "Content-Type",
        name.endsWith("css") ? "text/css" : "text/javascript",
      );
      res.end(readFileSync(path.join("tests/fixtures/draft-vendor", name)));
    } else if (req.url?.endsWith("/models")) {
      const body = JSON.stringify(catalog),
        status = catalogStatus;
      setTimeout(() => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(body);
      }, catalogDelay);
    } else if (req.method === "POST") {
      let body = "";
      req.on("data", (x) => (body += x));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        requests.push(parsed);
        const input = JSON.parse(parsed.messages[1].content);
        let output: any = input.blocks
          ? {
              translations: input.blocks.map((b: any) => ({
                id: b.id,
                translation: "翻譯：" + b.text,
              })),
            }
          : {
              result:
                input.text === "sure, I\'ll release this version later"
                  ? "Sure, I\'ll release this version later."
                  : "I look forward to hearing from you.",
              explanation:
                input.text === "sure, I\'ll release this version later"
                  ? "句首改為大寫，並補上句點。"
                  : "look forward to 後接動名詞。",
              rule: "look forward to + V-ing",
            };
        if (input.text === "好的, 我等下會釋出下一版" && "result" in output) {
          const instruction = parsed.messages[0].content;
          output.result = instruction.includes("Translate faithfully")
            ? "I'll release the next version shortly."
            : instruction.includes("Rewrite naturally")
              ? "好的，我稍後會安排釋出下一個版本。"
              : "好的，我等下會釋出下一版。";
          output.explanation = "依所選寫作操作提供建議。";
        }
        if (
          parsed.messages[0].content.includes("Produce TWO complete versions")
        ) {
          const chinese = /[\u4e00-\u9fff]/.test(input.text);
          const englishTarget = parsed.messages[0].content.includes(
            "Translation output language: en",
          );
          const baseline = chinese
            ? englishTarget
              ? "I'll release the next version shortly."
              : "好的，我等下會釋出下一版。"
            : output.result;
          output = {
            sourceLanguage: chinese ? "zh" : "en",
            baseline: {
              result: baseline,
              explanation: "基本校正或忠實翻譯。",
              rule: "",
            },
            suggestion: {
              result: chinese
                ? englishTarget
                  ? "I will release the next version shortly."
                  : "好的，我稍後會釋出下一個版本。"
                : output.result,
              explanation: "依情境調整語氣。",
              rule: "",
            },
          };
        }
        res.setHeader("Content-Type", "application/json");
        setTimeout(() => {
          res.statusCode = sampleStatus;
          res.end(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify(output) } }],
            }),
          );
        }, sampleDelay);
      });
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!doctype html><title>Article fixture</title><article><h1>A quieter way to learn</h1><p id="phrase">She is interested in buying the house.</p><p>The printer is repaired. It works.</p><pre><code>do_not_translate()</code></pre></article><textarea id="draft">I look forward to hear from you.</textarea><input type="password" value="sensitive">',
      );
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as any).port;
  fixtureExtension = mkdtempSync(
    path.join(tmpdir(), "langloop-fixture-extension-"),
  );
  cpSync(extension, fixtureExtension, { recursive: true });
  const manifest = JSON.parse(
    readFileSync(path.join(fixtureExtension, "manifest.json"), "utf8"),
  );
  manifest.host_permissions = ["http://127.0.0.1/*"];
  writeFileSync(
    path.join(fixtureExtension, "manifest.json"),
    JSON.stringify(manifest),
  );
  // Fixture-only hook: invoke the real registered context-menu handler without native browser UI automation.
  const backgroundFile = path.join(fixtureExtension, "background.js");
  writeFileSync(
    backgroundFile,
    `const addMenuListener = chrome.contextMenus.onClicked.addListener.bind(chrome.contextMenus.onClicked); chrome.contextMenus.onClicked.addListener = (fn) => { globalThis.__menuClick = fn; addMenuListener(fn); };\n` +
      readFileSync(backgroundFile, "utf8"),
  );
  profile = mkdtempSync(path.join(tmpdir(), "langloop-e2e-"));
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${fixtureExtension}`,
      `--load-extension=${fixtureExtension}`,
    ],
  });
  worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  extensionId = new URL(worker.url()).host;
  await worker.evaluate((settings) => chrome.storage.local.set({ settings }), {
    ...defaults,
    uiLanguage: "en",
  });
  // Loopback host permission is pregranted only in this fixture copy, not the shipped manifest.
  web = await context.newPage();
  await web.goto(`http://127.0.0.1:${port}`);
  panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
});
test.afterAll(async () => {
  await context?.close();
  await new Promise<void>((r) => server?.close(() => r()));
  rmSync(profile, { recursive: true, force: true });
  rmSync(fixtureExtension, { recursive: true, force: true });
});
test("onboarding inference and explicit correction to local card", async () => {
  await panel.getByRole("button", { name: "Settings", exact: true }).click();
  await panel.getByRole("tab", { name: "AI connections", exact: true }).click();
  await panel.getByLabel("Preset").selectOption("custom");
  await panel.getByLabel("API base URL").fill(`http://127.0.0.1:${port}/v1`);
  await panel.getByLabel("Model", { exact: true }).fill("fixture-model");
  await panel.getByRole("button", { name: "Save & test connection" }).click();
  await expect(panel.getByRole("status").first()).toContainText(
    "Connected to fixture-model",
  );
  expect(requests.length).toBe(1);
  await panel.getByRole("button", { name: "Assist", exact: true }).click();
  await panel
    .getByLabel("Selected text or draft")
    .fill("I look forward to hear from you.");
  await panel
    .locator(".selection-tools")
    .evaluate((el: HTMLDetailsElement) => (el.open = true));
  await panel
    .getByRole("button", { name: "Correct grammar", exact: true })
    .click();
  await expect(panel.locator(".output")).toHaveText(
    "I look forward to hearing from you.",
  );
  await expect(panel.locator("ins")).toContainText("hearing");
  await panel.getByRole("button", { name: "My learning", exact: true }).click();
  await expect(panel.locator(".card")).toHaveCount(0);
  await panel.getByRole("button", { name: "Assist", exact: true }).click();
  await panel.getByRole("button", { name: "Save learning card" }).click();
  await panel.getByRole("button", { name: "My learning", exact: true }).click();
  await expect(panel.locator(".card")).toHaveCount(1);
  await panel.reload();
  await panel.getByRole("button", { name: "My learning", exact: true }).click();
  await expect(panel.locator(".card")).toHaveCount(1);
});
test("selection capture, explanation and textarea Apply / Undo", async () => {
  const tabId = await worker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => t.url === url)!.id!;
  }, web.url());
  await web.locator("#phrase").evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  const capture = await panel.evaluate(
    async (id) => chrome.runtime.sendMessage({ type: "capture", payload: id }),
    tabId,
  );
  expect(capture.status).toBe("ok");
  await panel.getByRole("button", { name: "Assist", exact: true }).click();
  await expect(panel.getByLabel("Selected text or draft")).toHaveValue(
    "She is interested in buying the house.",
  );
  await panel
    .locator(".selection-tools")
    .evaluate((el: HTMLDetailsElement) => (el.open = true));
  await panel.getByRole("button", { name: "Explain", exact: true }).click();
  await expect(panel.locator(".result")).toContainText(
    "look forward to 後接動名詞",
  );
  await panel.getByRole("button", { name: "Save learning card" }).click();
  await panel.getByRole("button", { name: "My learning", exact: true }).click();
  await expect(panel.locator(".card")).toHaveCount(2);
  await context.setOffline(true);
  await panel.locator(".card").first().getByText("Reveal explanation").click();
  await expect(panel.locator(".card").first()).toContainText(
    "look forward to 後接動名詞",
  );
  await panel
    .locator(".card")
    .first()
    .getByRole("button", { name: "Delete card" })
    .click();
  await expect(panel.locator(".card")).toHaveCount(1);
  await context.setOffline(false);
  await panel.getByRole("button", { name: "Assist", exact: true }).click();
  await web.locator("#draft").focus();
  await panel.evaluate(
    async (id) => chrome.runtime.sendMessage({ type: "capture", payload: id }),
    tabId,
  );
  await panel
    .locator(".selection-tools")
    .evaluate((el: HTMLDetailsElement) => (el.open = true));
  await panel
    .getByRole("button", { name: "Correct grammar", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Apply to field" }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Apply to field" }).click();
  await expect(web.locator("#draft")).toHaveValue(
    "I look forward to hearing from you.",
  );
  await panel.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(web.locator("#draft")).toHaveValue(
    "I look forward to hear from you.",
  );
});
test("article bilingual insertion and restore preserve source", async () => {
  await panel
    .getByRole("button", { name: "Translate article", exact: true })
    .click();
  await expect(web.locator("[data-langloop-translation]")).toHaveCount(3);
  expect(requests.at(-1).messages[1].content).not.toContain("do_not_translate");
  await panel.getByRole("button", { name: "Restore original" }).click();
  await expect(web.locator("[data-langloop-translation]")).toHaveCount(0);
  await expect(web.locator("#phrase")).toHaveText(
    "She is interested in buying the house.",
  );
});
test("page launcher stays idle until clicked and corrects textarea and contenteditable in place", async () => {
  const before = requests.length;
  await web.reload();
  await expect(
    web.getByRole("button", { name: "Open LangLoop page tools" }),
  ).toBeVisible();
  await expect(
    web.getByRole("button", { name: "Translate page", exact: true }),
  ).not.toBeVisible();
  expect(requests.length).toBe(before);
  const launcher = web.getByRole("button", {
    name: "Open LangLoop page tools",
  });
  const initial = (await launcher.boundingBox())!;
  await web.mouse.move(
    initial.x + initial.width / 2,
    initial.y + initial.height / 2,
  );
  await web.mouse.down();
  await web.mouse.move(initial.x - 180, initial.y - 160, { steps: 8 });
  await web.mouse.up();
  const moved = (await launcher.boundingBox())!;
  expect(moved.x).toBeCloseTo(initial.x, 0);
  expect(moved.y).toBeLessThan(initial.y);
  await expect(
    web.getByRole("button", { name: "Translate page", exact: true }),
  ).not.toBeVisible();
  await web.evaluate(() => {
    const fixture = document.createElement("div");
    fixture.id = "layout-fixture";
    fixture.innerHTML =
      '<div id="flex-row" style="display:flex;width:600px"><p id="flex-copy" style="width:450px;flex-shrink:0">How we adapted our application storage platform to unprecedented growth.</p></div><div id="grid-row" style="display:grid;grid-template-columns:400px 150px"><p id="grid-copy">A normal paragraph inside a grid cell.</p></div><figure id="diagram"><div style="position:relative;height:60px"><p style="position:absolute">CLIENTS</p></div></figure>';
    document.querySelector("article")!.append(fixture);
    const heading = document.createElement("header");
    heading.id = "page-heading";
    heading.innerHTML =
      "<h1>Page heading outside article</h1><p>Page introduction</p>";
    document.body.prepend(heading);
    const toc = document.createElement("nav");
    toc.id = "page-toc";
    toc.innerHTML =
      '<a href="#flex-copy"><span>Table of contents entry</span></a>';
    document.body.append(toc);
    const caption = document.createElement("figure");
    caption.id = "figure-caption";
    caption.innerHTML =
      "<header><h2>Request flow title</h2><p>Explanation of the diagram</p></header>";
    document.body.append(caption);
  });
  await launcher.click();
  expect(requests.length).toBe(before);
  await web
    .getByRole("button", { name: "Translate page", exact: true })
    .click();
  await expect(web.getByRole("status")).toContainText("Translated");
  await expect(
    web.locator("[data-langloop-translation]").first(),
  ).toBeVisible();
  const geometry = await web.evaluate(() => {
    const flex = document.querySelector("#flex-row")!;
    const grid = document.querySelector("#grid-row")!;
    const translation = document.querySelector(
      "#flex-copy [data-langloop-translation]",
    )!;
    const css = getComputedStyle(translation);
    return {
      flexChildren: flex.children.length,
      gridChildren: grid.children.length,
      width: translation.getBoundingClientRect().width,
      border: css.borderLeftWidth,
      background: css.backgroundColor,
      diagram: document.querySelectorAll("#diagram [data-langloop-translation]")
        .length,
    };
  });
  expect(geometry).toMatchObject({
    flexChildren: 1,
    gridChildren: 1,
    border: "0px",
    background: "rgba(0, 0, 0, 0)",
    diagram: 0,
  });
  expect(geometry.width).toBeGreaterThan(400);
  await expect(
    web.locator("#page-heading [data-langloop-translation]"),
  ).toHaveCount(2);
  await expect(
    web.locator("#page-toc [data-langloop-translation]"),
  ).toHaveCount(1);
  await expect(
    web.locator("#figure-caption [data-langloop-translation]"),
  ).toHaveCount(2);
  await expect(web.locator("#page-toc a")).toHaveAttribute(
    "href",
    "#flex-copy",
  );
  await web.screenshot({
    path: ".local/translation-layout.png",
    fullPage: true,
  });
  await web.getByRole("button", { name: "Restore page", exact: true }).click();
  await expect(web.locator("[data-langloop-translation]")).toHaveCount(0);
  await web.locator("#draft").fill("I look forward to hear from you.");
  await web
    .getByRole("button", { name: "LangLoop correct this field", exact: true })
    .click();
  await web
    .getByRole("button", { name: /^Generate (suggestions|again)$/ })
    .click();
  await expect(
    web.getByRole("button", { name: "Apply basic version", exact: true }),
  ).toBeVisible();
  await expect(web.locator("[data-correction-diff] del")).toHaveText("hear");
  await expect(web.locator("[data-correction-diff] ins")).toHaveText("hearing");
  await expect(
    web.getByRole("dialog", { name: "Field writing suggestions" }),
  ).toContainText("Full suggestion");
  await web.screenshot({ path: ".local/correction-word-diff.png" });
  await web
    .getByRole("button", { name: "Apply basic version", exact: true })
    .click();
  await expect(web.locator("#draft")).toHaveValue(
    "I look forward to hearing from you.",
  );
  await web
    .getByRole("button", { name: "Undo application", exact: true })
    .click();
  await expect(web.locator("#draft")).toHaveValue(
    "I look forward to hear from you.",
  );
  await web.evaluate(() => {
    const editor = document.createElement("div");
    editor.id = "chat-editor";
    editor.contentEditable = "true";
    editor.textContent = "I look forward to hear from you.";
    const composer = document.createElement("form");
    composer.id = "composer";
    composer.style.cssText =
      "position:fixed;left:80px;top:100px;width:600px;display:flex;gap:12px;padding:12px;background:#222;color:white;border-radius:24px";
    editor.style.cssText = "flex:1;min-height:32px";
    const controls = document.createElement("button");
    controls.id = "native-send";
    controls.type = "button";
    controls.textContent = "Model / Voice / Send";
    composer.append(editor, controls);
    document.body.append(composer);
    editor.focus();
  });
  await web
    .getByRole("button", { name: "LangLoop correct this field", exact: true })
    .click();
  await web
    .getByRole("button", { name: /^Generate (suggestions|again)$/ })
    .click();
  await expect(
    web.getByRole("button", { name: "Apply basic version", exact: true }),
  ).toBeVisible();
  await expect(web.locator("[data-correction-diff] del")).toHaveText("hear");
  await expect(web.locator("[data-correction-diff] ins")).toHaveText("hearing");
  await expect(
    web.getByRole("dialog", { name: "Field writing suggestions" }),
  ).toContainText("Full suggestion");
  await web.screenshot({ path: ".local/correction-word-diff.png" });
  await web
    .getByRole("button", { name: "Apply basic version", exact: true })
    .click();
  await expect(web.locator("#chat-editor")).toHaveText(
    "I look forward to hearing from you.",
  );
  await web
    .getByRole("button", { name: "Undo application", exact: true })
    .click();
  await expect(web.locator("#chat-editor")).toHaveText(
    "I look forward to hear from you.",
  );
  const popover = web.getByRole("dialog", {
    name: "Field writing suggestions",
  });
  await expect(popover).toBeVisible();
  const popupRect = (await popover.boundingBox())!;
  const composerRect = (await web.locator("#composer").boundingBox())!;
  const miniRect = (await web
    .getByRole("button", { name: "LangLoop correct this field" })
    .boundingBox())!;
  expect(miniRect.y + miniRect.height / 2).toBeCloseTo(
    composerRect.y + composerRect.height / 2,
    0,
  );
  expect(miniRect.x).toBeGreaterThanOrEqual(composerRect.x);
  expect(miniRect.x + miniRect.width).toBeLessThan(
    composerRect.x + composerRect.width,
  );
  const nativeRect = (await web.locator("#native-send").boundingBox())!;
  expect(miniRect.x + miniRect.width).toBeLessThan(nativeRect.x);
  const fieldRect = (await web.locator("#chat-editor").boundingBox())!;
  expect(miniRect.x).toBeGreaterThan(fieldRect.x);
  expect(miniRect.x + miniRect.width).toBeLessThanOrEqual(
    fieldRect.x + fieldRect.width,
  );
  const badgeImage = web
    .getByRole("button", { name: "LangLoop correct this field" })
    .locator("img");
  expect(
    await badgeImage.evaluate(
      (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
    ),
  ).toBe(true);
  expect(popupRect.y).toBeCloseTo(composerRect.y + composerRect.height + 8, 0);
  await expect(
    web.getByRole("button", { name: "Translate page", exact: true }),
  ).not.toBeVisible();
  await web.screenshot({ path: ".local/anchored-correction.png" });
  await web.evaluate(() => {
    const composer = document.getElementById("composer")!;
    composer.style.height = "52px";
    composer.style.boxSizing = "border-box";
    composer.style.alignItems = "center";
    const editor = document.getElementById("chat-editor")!;
    editor.style.height = "42px";
    editor.style.transform = "translateY(9px)";
    window.dispatchEvent(new Event("resize"));
  });
  const asymmetricComposer = (await web.locator("#composer").boundingBox())!;
  const centeredBadge = (await web
    .getByRole("button", { name: "LangLoop correct this field" })
    .boundingBox())!;
  expect(centeredBadge.y + centeredBadge.height / 2).toBeCloseTo(
    asymmetricComposer.y + asymmetricComposer.height / 2,
    0,
  );

  await web.evaluate(() => {
    const composer = document.querySelector("#composer") as HTMLElement;
    composer.style.cssText +=
      ";left:0;top:auto;bottom:4px;width:100%;box-sizing:border-box";
    window.dispatchEvent(new Event("resize"));
  });
  const bottomComposer = (await web.locator("#composer").boundingBox())!;
  const aboveMini = (await web
    .getByRole("button", { name: "LangLoop correct this field" })
    .boundingBox())!;
  const abovePopup = (await popover.boundingBox())!;
  expect(aboveMini.y).toBeGreaterThanOrEqual(bottomComposer.y);
  expect(aboveMini.y + aboveMini.height).toBeLessThanOrEqual(
    bottomComposer.y + bottomComposer.height,
  );
  expect(abovePopup.y + abovePopup.height).toBeLessThan(bottomComposer.y);
  await web
    .getByRole("button", { name: "Close suggestions", exact: true })
    .click();
  await web.locator("#chat-editor").focus();
  await expect(
    web.getByRole("button", { name: "LangLoop correct this field" }),
  ).toBeVisible();
  await web.screenshot({ path: ".local/page-floating-buttons.png" });
  await web
    .locator("#chat-editor")
    .fill("sure, I'll release this version later");
  await web
    .getByRole("button", { name: "LangLoop correct this field" })
    .click();
  await web
    .getByRole("button", { name: /^Generate (suggestions|again)$/ })
    .click();
  await expect(web.locator("[data-correction-diff] del")).toHaveText("sure");
  await expect(web.locator("[data-correction-diff] ins")).toHaveText([
    "Sure",
    ".",
  ]);
  await web.screenshot({ path: ".local/correction-minimal-diff.png" });
  await web
    .getByRole("button", { name: "Close suggestions", exact: true })
    .click();
  await web.locator("#chat-editor").evaluate((el) => el.replaceChildren());
  await expect(
    web.getByRole("button", { name: "LangLoop correct this field" }),
  ).not.toBeVisible();
  await expect(web.getByRole("dialog")).not.toBeVisible();
  const idle = requests.length;
  await web.reload();
  await expect(
    web.getByRole("button", { name: "Open LangLoop page tools" }),
  ).toBeVisible();
  await web.getByRole("button", { name: "Open LangLoop page tools" }).click();
  await expect(
    web.getByRole("button", { name: "Stop", exact: true }),
  ).not.toBeVisible();
  await expect(
    web.getByRole("button", { name: "Restore page", exact: true }),
  ).toBeDisabled();
  await expect(
    web.getByRole("button", { name: /校正.*輸入框/ }),
  ).not.toBeVisible();
  await web.screenshot({ path: ".local/page-tools-brand.png" });
  sampleDelay = 1500;
  await web
    .locator("#phrase")
    .evaluate(
      (el) =>
        (el.textContent = "A new paragraph for cancellation verification."),
    );
  await web
    .getByRole("button", { name: "Translate page", exact: true })
    .click();
  await expect(
    web.getByRole("button", { name: "Stop", exact: true }),
  ).toBeEnabled();
  await expect.poll(() => requests.length).toBe(idle + 1);
  await web.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(
    web.getByRole("button", { name: "Stop", exact: true }),
  ).not.toBeVisible();
  sampleDelay = 0;
  await web.getByRole("button", { name: "Collapse", exact: true }).click();
  await web.locator("#draft").focus();
  const badge = web.getByRole("button", {
    name: "LangLoop correct this field",
  });
  await expect(badge).toBeVisible();
  await web
    .locator("#draft")
    .evaluate((el: HTMLTextAreaElement) => (el.readOnly = true));
  await expect(badge).not.toBeVisible();
  expect(
    await web.locator("#draft").evaluate((el) => el.style.paddingRight),
  ).toBe("");
  await web.locator("#draft").evaluate((el: HTMLTextAreaElement) => {
    el.readOnly = false;
    el.setAttribute("aria-readonly", "true");
  });
  await web.locator("#draft").focus();
  await expect(badge).not.toBeVisible();
  await web.locator("input[type=password]").focus();
  await expect(
    web.getByRole("button", { name: "LangLoop correct this field" }),
  ).not.toBeVisible();
  expect(requests.length).toBe(idle + 1);
});

test("paired writing preserves context profiles, local diffs and explicit apply", async () => {
  await panel.getByRole("button", { name: "Settings", exact: true }).click();
  await panel
    .getByRole("tab", { name: "Writing contexts", exact: true })
    .click();
  await panel.getByLabel("Default writing output language", { exact: true }).selectOption("ja");
  await panel.getByLabel("Context name", { exact: true }).fill("商務對話");
  await panel
    .getByLabel("Context / custom prompt")
    .fill("你是一位商務溝通專家。保留原意與承諾程度。");
  await panel.getByRole("button", { name: "Add context", exact: true }).click();
  await panel.getByLabel("Context name", { exact: true }).fill("日常聊天");
  await panel
    .getByLabel("Context / custom prompt")
    .fill("自然輕鬆的聊天語氣。");
  await panel
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await panel.reload();
  await panel.getByRole("button", { name: "Settings", exact: true }).click();
  await panel
    .getByRole("tab", { name: "Writing contexts", exact: true })
    .click();
  await expect(
    panel
      .getByLabel("Default writing context", { exact: true })
      .locator("option"),
  ).toHaveText(["商務對話", "日常聊天"]);
  await expect(panel.getByLabel("Default writing output language", { exact: true })).toHaveValue("ja");
  for (const target of ["auto", "ko", "original"]) {
    await panel.getByLabel("Default writing output language", { exact: true }).selectOption(target);
  }
  await panel.getByRole("button", { name: "Save settings", exact: true }).click();
  await web.reload();
  await web.locator("#draft").fill("好的, 我等下會釋出下一版");
  const before = requests.length;
  await web
    .getByRole("button", { name: "LangLoop correct this field" })
    .click();
  await expect(web.getByLabel("Context", { exact: true })).toBeEnabled();
  await web
    .getByLabel("Context", { exact: true })
    .selectOption({ label: "商務對話" });
  for (const target of ["auto", "ja", "ko"]) {
    await web.getByLabel("Output language", { exact: true }).selectOption(target);
    await expect(web.getByLabel("Output language", { exact: true })).toHaveValue(target);
  }
  await web.getByLabel("Output language", { exact: true }).selectOption("en");
  expect(requests.length).toBe(before);
  await web
    .getByRole("button", { name: /^Generate (suggestions|again)$/ })
    .click();
  await expect(web.locator('[data-writing-output="baseline"]')).toHaveText(
    "I'll release the next version shortly.",
  );
  await expect(web.locator('[data-writing-output="suggestion"]')).toHaveText(
    "I will release the next version shortly.",
  );
  expect(requests.length).toBe(before + 1);
  expect(requests.at(-1).messages[0].content).toContain("商務溝通專家");
  await expect(web.getByRole("dialog").locator("del")).toHaveCount(0);
  await web
    .getByRole("button", { name: "Apply contextual suggestion", exact: true })
    .click();
  await expect(web.locator("#draft")).toHaveValue(
    "I will release the next version shortly.",
  );
  await web
    .getByRole("button", { name: "Undo application", exact: true })
    .click();
  await expect(web.locator("#draft")).toHaveValue("好的, 我等下會釋出下一版");
  await web
    .getByLabel("Output language", { exact: true })
    .selectOption("original");
  await web
    .getByRole("button", { name: /^Generate (suggestions|again)$/ })
    .click();
  await expect(web.locator('[data-writing-output="baseline"]')).toHaveText(
    "好的，我等下會釋出下一版。",
  );
  await expect(web.locator("[data-correction-diff] del")).toHaveText(", ");
  await expect(web.locator("[data-suggestion-diff] del")).not.toHaveCount(0);
  await web.screenshot({ path: ".local/paired-writing.png" });
  const current = requests.length;
  await web
    .getByLabel("Context", { exact: true })
    .selectOption({ label: "日常聊天" });
  await expect(web.locator("[data-writing-output]")).toHaveCount(2);
  await expect(
    web.getByRole("button", { name: "Apply basic version" }),
  ).toBeDisabled();
  expect(requests.length).toBe(current);
  await web.locator("#draft").fill("");
  await expect(
    web.getByRole("button", { name: "LangLoop correct this field" }),
  ).not.toBeVisible();
  await expect(web.getByRole("dialog")).not.toBeVisible();
  await panel
    .getByRole("button", { name: "Delete this context", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await panel.reload();
  await panel.getByRole("button", { name: "Settings", exact: true }).click();
  await panel
    .getByRole("tab", { name: "Writing contexts", exact: true })
    .click();
  await expect(
    panel
      .getByLabel("Default writing context", { exact: true })
      .locator("option"),
  ).toHaveText(["商務對話"]);
});

test("writing draft stays editable after apply and regenerates without changing the page", async () => {
  await web.locator("#draft").fill("I look forward to hear from you.");
  await web
    .getByRole("button", { name: "LangLoop correct this field" })
    .click();
  const draft = web.getByRole("textbox", { name: "Original draft" });
  await expect(draft).toHaveValue("I look forward to hear from you.");
  await web
    .getByRole("button", { name: /^Generate (suggestions|again)$/ })
    .click();
  const baseline = web.locator('[data-writing-output="baseline"]');
  await expect(baseline).toBeInViewport({ ratio: 1 });
  const headingBottom = await web
    .locator(".writing-heading")
    .evaluate((element) => element.getBoundingClientRect().bottom);
  expect((await baseline.boundingBox())!.y).toBeGreaterThan(headingBottom);
  await expect(web.getByRole("button", { name: "Close suggestions" })).toBeInViewport();
  await web.getByRole("button", { name: "Apply basic version" }).click();
  await expect(web.locator("[data-writing-output]")).toHaveCount(2);
  await expect(draft).toHaveValue("I look forward to hear from you.");
  await web
    .getByRole("button", { name: "Apply contextual suggestion" })
    .click();
  await expect(web.locator("[data-writing-output]")).toHaveCount(2);
  const pageText = await web.locator("#draft").inputValue();
  const before = requests.length;
  await draft.fill("sure, I'll release this version later");
  expect(requests.length).toBe(before);
  await expect(web.locator("[data-writing-output]")).toHaveCount(2);
  await expect(
    web.getByRole("button", { name: "Apply basic version" }),
  ).toBeDisabled();
  await web
    .getByRole("button", { name: /^Generate (suggestions|again)$/ })
    .click();
  await expect(web.locator('[data-writing-output="baseline"]')).toHaveText(
    "Sure, I'll release this version later.",
  );
  await expect(web.locator("#draft")).toHaveValue(pageText);
  await web.getByRole("button", { name: "Apply basic version" }).click();
  await expect(web.locator("#draft")).toHaveValue(
    "Sure, I'll release this version later.",
  );
  await expect(web.locator("[data-writing-output]")).toHaveCount(2);
  await expect(draft).toHaveValue("sure, I'll release this version later");
  const dialog = web.getByRole("dialog", { name: "Field writing suggestions" });
  const initialBox = (await dialog.boundingBox())!;
  expect(initialBox.height).toBeLessThanOrEqual(
    Math.min(400, web.viewportSize()!.height / 2) + 1,
  );
  const close = web.getByRole("button", { name: "Close suggestions" });
  const initialClose = (await close.boundingBox())!;
  await dialog.evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  const scrolledClose = (await close.boundingBox())!;
  expect(scrolledClose.y).toBeCloseTo(initialClose.y, 0);
  await expect(close).toBeInViewport();
  await web.getByRole("button", { name: "Expand height", exact: true }).click();
  const expandedBox = (await dialog.boundingBox())!;
  expect(expandedBox.height).toBeGreaterThan(initialBox.height * 1.5);
  expect(expandedBox.y + expandedBox.height).toBeLessThanOrEqual(
    web.viewportSize()!.height - 7,
  );
  await expect(close).toBeInViewport();
  await web
    .getByRole("button", { name: "Compact height", exact: true })
    .click();
  const compactBox = (await dialog.boundingBox())!;
  await web.mouse.move(
    compactBox.x + compactBox.width - 5,
    compactBox.y + compactBox.height - 5,
  );
  await web.mouse.down();
  await web.mouse.move(
    compactBox.x + compactBox.width - 5,
    compactBox.y + compactBox.height - 85,
    { steps: 8 },
  );
  await web.mouse.up();
  expect((await dialog.boundingBox())!.height).toBeLessThan(
    compactBox.height - 40,
  );
  await expect(close).toBeInViewport();
  await web.screenshot({ path: ".local/editable-writing-draft.png" });
  await web.getByRole("button", { name: "Undo application" }).click();
  await expect(web.locator("#draft")).toHaveValue(pageText);
  await web.getByRole("button", { name: "Close suggestions" }).click();
});

test("Draft.js shell anchors the badge and controlled state survives apply/undo", async () => {
  const draftPage = await context.newPage();
  await draftPage.goto(`http://127.0.0.1:${port}/draft-editor`);
  const editor = draftPage.locator(".public-DraftEditor-content");
  await editor.click();
  const badge = draftPage.getByRole("button", {
    name: "LangLoop correct this field",
  });
  await expect(badge).toBeVisible();
  const fieldRect = (await editor.boundingBox())!,
    shell = (await draftPage.locator(".editor").boundingBox())!,
    icon = (await badge.boundingBox())!;
  expect(fieldRect.height).toBeLessThan(28);
  expect(icon.y + icon.height / 2).toBeCloseTo(shell.y + shell.height / 2, 0);
  await badge.click();
  await draftPage
    .getByRole("button", { name: /^Generate (suggestions|again)$/ })
    .click();
  await draftPage.getByRole("button", { name: "Apply basic version" }).click();
  await expect(draftPage.locator("#model-text")).toHaveText(
    "I look forward to hearing from you.",
  );
  await draftPage.getByRole("button", { name: "Undo application" }).click();
  await expect(draftPage.locator("#model-text")).toHaveText(
    "I look forward to hear from you.",
  );
  await draftPage.getByRole("button", { name: "Parent rerender" }).click();
  await expect(editor).toHaveText("I look forward to hear from you.");
  await editor.click();
  await expect(badge).toBeVisible();
  await draftPage.screenshot({ path: ".local/draftjs-compatibility.png" });
  await draftPage.close();
});

test("Assist uses the same paired context and language review", async () => {
  await panel.getByRole("button", { name: "Assist", exact: true }).click();
  await panel
    .getByLabel("Selected text or draft")
    .fill("好的, 我等下會釋出下一版");
  await panel
    .getByLabel("Writing output language", { exact: true })
    .selectOption("en");
  for (const target of ["auto", "ja", "ko", "en"]) {
    await panel.getByLabel("Writing output language", { exact: true }).selectOption(target);
  }
  const count = requests.length;
  await panel
    .getByRole("button", { name: /^Generate (suggestions|again)$/ })
    .click();
  await expect(panel.locator(".result .output")).toHaveText([
    "I'll release the next version shortly.",
    "I will release the next version shortly.",
  ]);
  expect(requests.length).toBe(count + 1);
  await expect(panel.locator(".result del")).toHaveCount(0);
  await panel
    .getByLabel("Writing output language", { exact: true })
    .selectOption("original");
  await expect(panel.locator(".result")).toHaveCount(0);
  await panel
    .getByRole("button", { name: /^Generate (suggestions|again)$/ })
    .click();
  await expect(panel.locator(".result .output").first()).toHaveText(
    "好的，我等下會釋出下一版。",
  );
  await expect(panel.locator(".result").first().locator("del")).toHaveText(
    ", ",
  );
  await panel.setViewportSize({ width: 400, height: 900 });
  await panel.evaluate(() => window.scrollTo(0, 0));
  await panel.screenshot({ path: ".local/assist-paired.png", fullPage: true });
});

test("launcher docks on both edges without toggle drift and UI language stays independent", async () => {
  const launcher = web.getByRole("button", {
    name: "Open LangLoop page tools",
  });
  if (
    await web.getByRole("button", { name: "Collapse", exact: true }).isVisible()
  )
    await web.getByRole("button", { name: "Collapse", exact: true }).click();
  for (const left of [true, false]) {
    const rect = (await launcher.boundingBox())!;
    const viewport = web.viewportSize()!;
    await web.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await web.mouse.down();
    await web.mouse.move(left ? 40 : viewport.width - 40, 240, { steps: 12 });
    await web.mouse.up();
    const docked = (await launcher.boundingBox())!;
    expect(
      left ? docked.x : viewport.width - docked.x - docked.width,
    ).toBeLessThan(16);
    for (let i = 0; i < 3; i++) {
      await launcher.click();
      const tools = web.locator("section").filter({
        has: web.getByRole("button", { name: "Translate page", exact: true }),
      });
      const box = (await tools.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(8);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 8);
      await web.getByRole("button", { name: "Collapse", exact: true }).click();
      const collapsed = (await launcher.boundingBox())!;
      expect(collapsed.x).toBeCloseTo(docked.x, 0);
      expect(collapsed.y).toBeCloseTo(docked.y, 0);
    }
  }
  const originalViewport = web.viewportSize()!;
  await web.setViewportSize({ width: 620, height: 480 });
  const resized = (await launcher.boundingBox())!;
  await launcher.click();
  await web.getByRole("button", { name: "Collapse", exact: true }).click();
  const restored = (await launcher.boundingBox())!;
  expect(restored.x).toBeCloseTo(resized.x, 0);
  expect(restored.y).toBeCloseTo(resized.y, 0);
  await web.setViewportSize(originalViewport);
  const before = requests.length;
  await panel.getByRole("button", { name: "Settings", exact: true }).click();
  await panel.getByRole("tab", { name: "General", exact: true }).click();
  const target = await panel
    .getByLabel("Translation and explanation language")
    .inputValue();
  await panel
    .getByLabel("Interface language", { exact: true })
    .selectOption("zh-TW");
  await panel.getByRole("button", { name: "儲存設定", exact: true }).click();
  await expect(
    web.getByRole("button", { name: "開啟 LangLoop 網頁工具" }),
  ).toBeVisible();
  await web.getByRole("button", { name: "開啟 LangLoop 網頁工具" }).click();
  await expect(
    web.getByRole("button", { name: "翻譯網頁", exact: true }),
  ).toBeVisible();
  await expect(
    web.getByRole("button", { name: "停止", exact: true }),
  ).not.toBeVisible();
  await panel.reload();
  await panel.getByRole("button", { name: "設定", exact: true }).click();
  await panel.getByRole("tab", { name: "一般", exact: true }).click();
  await expect(panel.getByLabel("介面語言", { exact: true })).toHaveValue(
    "zh-TW",
  );
  await expect(panel.getByLabel("翻譯與解釋語言")).toHaveValue(target);
  await panel.getByRole("tab", { name: "寫作情境設定", exact: true }).click();
  await expect(panel.getByLabel("預設寫作情境").locator("option")).toHaveText([
    "商務對話",
  ]);
  await panel.evaluate(() => window.scrollTo(0, 0));
  await panel.screenshot({ path: ".local/settings-zh.png", fullPage: true });
  await panel.getByRole("tab", { name: "一般", exact: true }).click();
  await panel.getByLabel("介面語言", { exact: true }).selectOption("en");
  await panel
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(
    web.getByRole("button", { name: "Translate page", exact: true }),
  ).toBeVisible();
  await web.getByRole("button", { name: "Collapse", exact: true }).click();
  expect(requests.length).toBe(before);
});

test("page context menu translates a forty-paragraph batch and restores IDs", async () => {
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/batch-test`);
  await page.evaluate(() => {
    document.body.innerHTML =
      "<article>" +
      Array.from(
        { length: 40 },
        (_, i) =>
          `<p>Context paragraph number ${i} about a shared project.</p>`,
      ).join("") +
      "</article>";
  });
  const before = requests.length;
  await worker.evaluate(async (url) => {
    await chrome.contextMenus.update("translate-page", {
      title: "LangLoop: Translate page",
    });
    const tab = (await chrome.tabs.query({})).find((tab) => tab.url === url)!;
    (globalThis as any).__menuClick({ menuItemId: "translate-page" }, tab);
  }, page.url());
  await expect(page.locator("[data-langloop-translation]")).toHaveCount(40);
  expect(requests.length).toBe(before + 1);
  const submitted = JSON.parse(requests.at(-1).messages[1].content).blocks;
  expect(submitted).toHaveLength(40);
  await expect(page.getByRole("status")).toContainText("Translated 40");
  await page.getByRole("button", { name: "Restore page", exact: true }).click();
  await expect(page.locator("[data-langloop-translation]")).toHaveCount(0);
  await expect(page.locator("article p")).toHaveCount(40);
  await page.close();
});

test("excluded domain and restricted page refuse capture before inference", async () => {
  const count = requests.length;
  await panel.getByRole("button", { name: "Settings", exact: true }).click();
  await panel.getByRole("tab", { name: "General", exact: true }).click();
  await panel.getByLabel("Excluded domains").fill("127.0.0.1");
  await panel
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  const tabId = await worker.evaluate(async (url) => {
    return (await chrome.tabs.query({})).find((t) => t.url === url)!.id!;
  }, web.url());
  const response = await panel.evaluate(
    async (id) => chrome.runtime.sendMessage({ type: "capture", payload: id }),
    tabId,
  );
  expect(response.error.code).toBe("permission_denied");
  expect(requests.length).toBe(count);
  await panel.getByLabel("Excluded domains").fill("");
  await panel
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  const existingIds = await worker.evaluate(async () =>
    (await chrome.tabs.query({})).map((t) => t.id),
  );
  const protectedPage = await context.newPage();
  await protectedPage.goto("chrome://version");
  const id = await worker.evaluate(async (ids) => {
    return (await chrome.tabs.query({})).find((t) => !ids.includes(t.id))!.id!;
  }, existingIds);
  const restricted = await panel.evaluate(
    async (id) => chrome.runtime.sendMessage({ type: "capture", payload: id }),
    id,
  );
  expect(restricted.error.code).toBe("permission_denied");
  expect(restricted.error.message).toContain("Paste");
  await protectedPage.close();
});

test("extension-only setup exposes direct login and no proxy management", async () => {
  await panel.goto(`chrome-extension://${extensionId}/panel.html?settings`);
  await panel.getByRole("tab", { name: "AI connections", exact: true }).click();
  await panel.getByLabel("Preset").selectOption("chatgpt");
  await expect(
    panel.getByRole("button", { name: "Sign in to ChatGPT", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Open proxy management" }),
  ).toHaveCount(0);
  await expect(panel.getByLabel("API base URL")).toHaveCount(0);
  const before = requests.length;
  await panel
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  expect(requests.length).toBe(before);
  await panel.getByRole("tab", { name: "AI connections", exact: true }).click();
  await panel.getByLabel("Preset").selectOption("custom");
  await panel.getByLabel("API base URL").fill(`http://127.0.0.1:${port}/v1`);
  await panel.getByRole("button", { name: "Load / refresh models" }).click();
  await expect(panel.locator(".model-picker")).toContainText("2 models listed");
  await panel.setViewportSize({ width: 400, height: 850 });
  await panel.getByRole("tab", { name: "AI connections", exact: true }).click();
  await panel.getByLabel("Preset").selectOption("chatgpt");
  await panel.evaluate(() => window.scrollTo(0, 0));
  await panel.screenshot({ path: ".local/direct-login.png", fullPage: true });
});

test("connected account automatically lists models and hides sign-in", async () => {
  const connected = await context.newPage();
  await connected.addInitScript(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = ((message: any) => {
      if (message.type === "chatgptStatus")
        return Promise.resolve({ status: "ok", data: { signedIn: true } });
      if (message.type === "chatgptModels")
        return Promise.resolve({ status: "ok", data: ["model-a", "model-b"] });
      return original(message);
    }) as typeof chrome.runtime.sendMessage;
    chrome.permissions.contains = (() =>
      Promise.resolve(true)) as typeof chrome.permissions.contains;
  });
  await connected.goto(`chrome-extension://${extensionId}/panel.html?settings`);
  await connected.getByLabel("Preset").selectOption("chatgpt");
  await expect(
    connected.getByRole("button", { name: "Sign in to ChatGPT", exact: true }),
  ).toHaveCount(0);
  await expect(
    connected.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await expect(connected.getByLabel("Available models")).toBeVisible();
  await connected.getByLabel("Available models").selectOption("model-b");
  await expect(connected.getByLabel("Available models")).toHaveValue("model-b");
  await expect(
    connected.getByLabel("Model", { exact: true }),
  ).not.toBeVisible();
  await connected.setViewportSize({ width: 400, height: 850 });
  await connected.screenshot({
    path: ".local/connected-model-picker.png",
    fullPage: true,
  });
  await connected.close();
});

test("connection test shows pending, exact failure and successful output beside button", async () => {
  const checking = await context.newPage();
  await checking.addInitScript(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    let calls = 0;
    chrome.runtime.sendMessage = ((message: any) => {
      if (message.type === "infer") {
        calls++;
        return new Promise<any>((resolve) =>
          setTimeout(
            () =>
              resolve(
                calls === 1
                  ? {
                      status: "error",
                      error: {
                        code: "invalid_response",
                        message:
                          "ChatGPT returned an unexpected language result.",
                      },
                    }
                  : {
                      status: "ok",
                      data: {
                        result: "你好，世界。",
                        explanation: "",
                        rule: "",
                      },
                    },
              ),
            400,
          ),
        );
      }
      return original(message);
    }) as typeof chrome.runtime.sendMessage;
    chrome.permissions.request = (() =>
      Promise.resolve(true)) as typeof chrome.permissions.request;
  });
  await checking.goto(`chrome-extension://${extensionId}/panel.html?settings`);
  await checking
    .getByRole("button", { name: "Save & test connection", exact: true })
    .click();
  const status = checking.getByRole("status", {
    name: "Connection test result",
  });
  await expect(
    checking.getByRole("button", { name: "Testing connection…", exact: true }),
  ).toBeDisabled();
  await expect(status).toContainText("translating");
  await expect(status).toContainText(
    "Settings saved. Test failed: invalid_response: ChatGPT returned an unexpected language result.",
  );
  await checking
    .getByRole("button", { name: "Save & test connection", exact: true })
    .click();
  await expect(status).toContainText("Test translation: 你好，世界。");
  await checking.close();
});

test("old background gives actionable reload instead of unsupported login", async () => {
  await panel.addInitScript(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = ((message: any) =>
      message.type.startsWith("chatgpt")
        ? Promise.resolve({
            status: "error",
            error: { code: "permission_denied", message: "Unsupported action" },
          })
        : original(message)) as typeof chrome.runtime.sendMessage;
  });
  await panel.goto(`chrome-extension://${extensionId}/panel.html?settings`);
  await expect(panel.getByRole("status").first()).toContainText(
    "previous background version",
  );
  await expect(
    panel.getByRole("button", { name: "Reload LangLoop", exact: true }),
  ).toBeVisible();
});

test("separate settings sections and multiple same-provider connections retain independent models", async () => {
  const p = await context.newPage();
  await p.goto(`chrome-extension://${extensionId}/panel.html?settings`);
  await p.getByRole("tab", { name: "General", exact: true }).click();
  await expect(p.getByLabel("Preset", { exact: true })).not.toBeVisible();
  await expect(
    p.getByLabel("Interface language", { exact: true }),
  ).toBeVisible();
  await p.getByRole("tab", { name: "AI connections", exact: true }).click();

  await p
    .getByLabel("New connection provider", { exact: true })
    .selectOption("chatgpt");
  await p
    .getByRole("button", { name: "Add account connection", exact: true })
    .click();
  await expect(
    p
      .getByLabel("Active connection", { exact: true })
      .locator("option:checked"),
  ).toContainText("Agent 1");
  const first = await p
    .getByLabel("Active connection", { exact: true })
    .inputValue();
  await p.getByLabel("Model", { exact: true }).fill("personal-model");
  await p.getByLabel("Reasoning effort", { exact: true }).selectOption("low");
  await p.getByRole("button", { name: "Save settings", exact: true }).click();

  await p
    .getByRole("button", { name: "Add account connection", exact: true })
    .click();
  await expect(
    p
      .getByLabel("Active connection", { exact: true })
      .locator("option:checked"),
  ).toContainText("Agent 2");
  await expect(p.getByLabel("Model", { exact: true })).toHaveValue("");
  await expect(p.getByLabel("Reasoning effort", { exact: true })).toHaveValue("default");
  await p.getByLabel("Active connection", { exact: true }).selectOption(first);
  await expect(p.getByLabel("Model", { exact: true })).toHaveValue(
    "personal-model",
  );
  await expect(p.getByLabel("Reasoning effort", { exact: true })).toHaveValue("low");
  p.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Agent 1");
    await dialog.dismiss();
  });
  await p
    .getByRole("button", { name: "Remove connection", exact: true })
    .click();
  await expect(p.getByLabel("Active connection", { exact: true })).toHaveValue(
    first,
  );
  p.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Agent 1");
    await dialog.accept();
  });
  await p
    .getByRole("button", { name: "Remove connection", exact: true })
    .click();
  await expect(
    p
      .getByLabel("Active connection", { exact: true })
      .locator("option")
      .filter({ hasText: "Agent 1" }),
  ).toHaveCount(0);
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.screenshot({
    path: ".local/multiple-connections.png",
    fullPage: true,
  });
  await p.close();
});

test("mention entities remain untouched and output language stays selectable during generation", async () => {
  await worker.evaluate((settings) => chrome.storage.local.set({ settings }), {
    ...defaults, uiLanguage: "en", setupKind: "custom",
    endpoint: `http://127.0.0.1:${port}/v1`, model: "fixture-model",
  });
  await web.reload();
  await web.evaluate(() => {
    const field = document.createElement('div');
    field.id = 'mention-editor'; field.contentEditable = 'true';
    field.setAttribute('role','textbox'); field.setAttribute('aria-label','Mention composer');
    field.innerHTML = '<span contenteditable="false" data-mention-id="synthetic">@Example Person</span> Notification Matrix';
    field.style.cssText = 'position:fixed;top:140px;left:50px;width:600px;min-height:80px;background:white';
    document.body.append(field);
  });
  const field = web.getByRole('textbox',{name:'Mention composer'});
  await field.click();
  await web.getByRole('button',{name:'LangLoop correct this field'}).click();
  const output = web.getByLabel('Output language',{exact:true});
  await output.selectOption('en');
  sampleDelay = 400;
  try {
    await web.getByRole('button',{name:/^Generate (suggestions|again)$/}).click();
    await expect(output).toBeEnabled();
    await output.selectOption('zh-TW');
    await expect(web.getByRole('button',{name:/^Generate (suggestions|again)$/})).toBeEnabled();
    await expect(web.locator('[data-writing-output]')).toHaveCount(0);
    await web.getByRole('button',{name:/^Generate (suggestions|again)$/}).click();
    await expect(web.locator('[data-writing-output]')).toHaveCount(2);
    await expect(web.getByRole('button',{name:'Apply basic version',exact:true})).toBeDisabled();
    await expect(web.getByRole('button',{name:'Copy basic version as plain text',exact:true})).toBeVisible();
    await expect(field.locator('[data-mention-id]')).toHaveText('@Example Person');
    await expect(field).toHaveText('@Example Person Notification Matrix');
    expect(requests.at(-1).messages[0].content).toContain('Translation output language: zh-TW');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await web.getByRole('button',{name:'Copy basic version as plain text',exact:true}).click();
    await expect.poll(() => web.evaluate(() => navigator.clipboard.readText())).toBe('I look forward to hearing from you.');
    await expect(field.locator('[data-mention-id]')).toHaveText('@Example Person');
  } finally { sampleDelay = 0; }
});

test("original draft isolates composing keystrokes and paste from page shortcuts", async () => {
  await web.reload();
  await web.locator('#draft').fill('Original message');
  await web.getByRole('button',{name:'LangLoop correct this field'}).click();
  const draft = web.getByRole('textbox',{name:'Original draft',exact:true});
  await draft.focus();
  await web.evaluate(() => {
    (window as any).imeLeaks = 0;
    document.addEventListener('keydown', (event) => {
      if (event.isComposing || event.key === 'Enter') {
        (window as any).imeLeaks++;
        event.preventDefault();
        (document.querySelector('#draft') as HTMLTextAreaElement).focus();
      }
    });
    document.addEventListener('compositionstart', () => {
      (window as any).imeLeaks++;
      (document.querySelector('#draft') as HTMLTextAreaElement).focus();
    });
    document.addEventListener('paste', (event) => { (window as any).imeLeaks++; event.preventDefault(); });
  });
  await draft.dispatchEvent('compositionstart', {data:'中',bubbles:true,composed:true});
  await draft.dispatchEvent('keydown',{key:'Unidentified',code:'',keyCode:229,isComposing:true,bubbles:true,composed:true,cancelable:true});
  await expect(draft).toBeFocused();
  await web.keyboard.insertText('中文測試');
  await draft.dispatchEvent('compositionend',{data:'中文測試',bubbles:true,composed:true});
  await draft.dispatchEvent('paste',{bubbles:true,composed:true,cancelable:true});
  await draft.press('Enter');
  expect(await draft.inputValue()).toContain('中文測試\n');
  expect(await web.evaluate(() => (window as any).imeLeaks)).toBe(0);
  await expect(web.locator('#draft')).toHaveValue('Original message');
});
