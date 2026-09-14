import { it, expect } from "vitest";
import { articleBatches } from "../src/article";
import { decodeResponse, type Inference } from "../src/core";
it("preserves order and IDs while batching 200 short paragraphs into five requests", () => {
  const blocks = Array.from({ length: 200 }, (_, i) => ({
    id: String(i),
    text: `Paragraph ${i}`,
  }));
  const groups = articleBatches(blocks);
  expect(groups.map((g) => g.length)).toEqual([40, 40, 40, 40, 40]);
  expect(groups.flat()).toEqual(blocks);
});
it("bounds long paragraph volume without splitting text", () => {
  const blocks = Array.from({ length: 6 }, (_, i) => ({
    id: String(i),
    text: "a".repeat(5000),
  }));
  const groups = articleBatches(blocks);
  expect(groups.map((g) => g.length)).toEqual([2, 2, 2]);
  expect(groups.flat()).toEqual(blocks);
});
it("accepts reordered batch results by ID but rejects missing or duplicate IDs", () => {
  const blocks = Array.from({ length: 40 }, (_, i) => ({
    id: String(i),
    text: `Paragraph ${i}`,
  }));
  const request = { operation: "article", blocks } as Inference;
  const translations = blocks
    .map((b) => ({ id: b.id, translation: b.text }))
    .reverse();
  expect(decodeResponse({ translations }, request)).toEqual({ translations });
  expect(() =>
    decodeResponse({ translations: translations.slice(1) }, request),
  ).toThrow();
  expect(() =>
    decodeResponse(
      { translations: translations.map(() => translations[0]) },
      request,
    ),
  ).toThrow();
});
