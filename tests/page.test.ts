import { beforeEach, it, expect, vi } from "vitest";
import { pageAction } from "../src/content";
beforeEach(() => {
  delete (globalThis as any).__langloop;
  document.body.innerHTML = "";
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue({
    length: 1,
  } as DOMRectList);
});
it("applies native textarea correction and guarded Undo", () => {
  document.body.innerHTML = "<textarea>A</textarea>";
  const t = document.querySelector("textarea")!;
  t.focus();
  const s = pageAction("capture", {});
  pageAction("apply", { generation: s.generation, original: "A", result: "B" });
  expect(t.value).toBe("B");
  pageAction("undo", {});
  expect(t.value).toBe("A");
});
it("preserves B when request r1 captured A", () => {
  document.body.innerHTML = "<textarea>A</textarea>";
  const t = document.querySelector("textarea")!;
  t.focus();
  const s = pageAction("capture", {});
  t.value = "B";
  expect(() =>
    pageAction("apply", {
      generation: s.generation,
      original: "A",
      result: "C",
    }),
  ).toThrow("stale_source");
  expect(t.value).toBe("B");
});
it("Undo refuses intervening edits", () => {
  document.body.innerHTML = "<textarea>A</textarea>";
  const t = document.querySelector("textarea")!;
  t.focus();
  const s = pageAction("capture", {});
  pageAction("apply", { generation: s.generation, original: "A", result: "B" });
  t.value = "C";
  expect(() => pageAction("undo", {})).toThrow();
  expect(t.value).toBe("C");
});
it("never captures password fields", () => {
  document.body.innerHTML = '<input type="password" value="sensitive">';
  document.querySelector("input")!.focus();
  expect(() => pageAction("capture", {})).toThrow("Sensitive");
});
it("controlled textarea uses native setter and input event", () => {
  document.body.innerHTML = "<textarea>Draft</textarea>";
  const t = document.querySelector("textarea")!;
  (t as any).__reactProps$test = {};
  t.focus();
  const snapshot = pageAction("capture", {});
  const changed = vi.fn();
  t.addEventListener("input", changed);
  pageAction("apply", {
    generation: snapshot.generation,
    original: "Draft",
    result: "Corrected",
  });
  expect(t.value).toBe("Corrected");
  expect(changed).toHaveBeenCalledOnce();
});
it("excludes code editable and hidden article regions", () => {
  document.body.innerHTML =
    '<article><p>Visible content</p><pre><p>Secret code</p></pre><div hidden><p>Hidden text</p></div><p contenteditable="true">Editable</p><p>Contains <code>code</code></p></article>';
  expect(pageAction("extract", {}).blocks!.map((b: any) => b.text)).toEqual([
    "Visible content",
  ]);
});
it("restore rejects late inserts and preserves originals", () => {
  document.body.innerHTML = "<article><p>Original paragraph</p></article>";
  const s = pageAction("extract", {});
  pageAction("insert", {
    generation: s.generation,
    translations: [{ id: "b0", translation: "原文" }],
  });
  expect(document.querySelectorAll("[data-langloop-translation]").length).toBe(
    1,
  );
  pageAction("restore", {});
  pageAction("insert", {
    generation: s.generation,
    translations: [{ id: "b0", translation: "late" }],
  });
  expect(document.body.textContent).toBe("Original paragraph");
});
it("changed source discards stale translation and treats markup as text", () => {
  document.body.innerHTML = "<article><p>Original paragraph</p></article>";
  const s = pageAction("extract", {});
  document.querySelector("p")!.textContent = "Changed paragraph";
  expect(
    pageAction("insert", {
      generation: s.generation,
      translations: [{ id: "b0", translation: "wrong" }],
    }).inserted,
  ).toBe(0);
  const fresh = pageAction("extract", {});
  pageAction("insert", {
    generation: fresh.generation,
    translations: [{ id: "b0", translation: "<script>evil()</script>" }],
  });
  expect(document.querySelector("script")).toBeNull();
});

it("translation remains inside the original layout item and is not mistaken for source edits", async () => {
  document.body.innerHTML =
    '<main style="display:flex"><p>Original text</p></main>';
  const original = document.querySelector("p")!;
  const snapshot = pageAction("extract", {});
  pageAction("insert", {
    generation: snapshot.generation,
    translations: [{ id: "b0", translation: "翻譯內容" }],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.querySelector("main")!.children).toHaveLength(1);
  expect(
    original.querySelector("[data-langloop-translation]")?.textContent,
  ).toBe("翻譯內容");
  pageAction("restore", {});
  expect(original.textContent).toBe("Original text");
});
it("allows figure captions while skipping positioned diagram labels", () => {
  document.body.innerHTML =
    '<main><figure><p>Diagram label</p></figure><div style="position:absolute"><p>Positioned label</p></div><p>Normal paragraph</p></main>';
  expect(pageAction("extract", {}).blocks!.map((b: any) => b.text)).toEqual([
    "Diagram label",
    "Normal paragraph",
  ]);
});

it("includes page heading outside article, sticky navigation and figure description without duplicates", () => {
  document.body.innerHTML =
    '<header><h1>Page title</h1><p>Page subtitle</p></header><nav style="position:fixed"><a href="#topic"><span>Topic link</span></a></nav><main><article><p>Article body</p><figure><header><h2>Request flow</h2><p>Figure explanation</p></header><div style="position:absolute"><p>Node label</p></div></figure><div>Additional text</div></article></main>';
  expect(pageAction("extract", {}).blocks!.map((b: any) => b.text)).toEqual([
    "Page title",
    "Page subtitle",
    "Topic link",
    "Article body",
    "Request flow",
    "Figure explanation",
    "Additional text",
  ]);
});
