import { expect, it, vi } from "vitest";
import { defaults, writingTargetSchema, writingSameLanguage, decodeResponse, type Inference } from "../src/core";
import { infer } from "../src/provider";
const req: Inference = {
 requestId: "11111111-1111-4111-8111-111111111111", operation: "writing",
 providerId: "configured", text: "Hello", context: "", sourceLanguage: "auto",
 targetLanguage: "auto", writingProfileId: "general",
};
it.each(["auto", "ja", "ko"])("accepts %s as a writing target", (target) => {
 expect(writingTargetSchema.parse(target)).toBe(target);
});
it.each(["ja", "ko"])("decodes %s and preserves same-language diff classification", (source) => {
 const value = { result: "test", explanation: "test", rule: "" };
 expect(decodeResponse({ sourceLanguage: source, baseline: value, suggestion: value }, req)).toHaveProperty("sourceLanguage", source);
 expect(writingSameLanguage(source, source)).toBe(true);
 expect(writingSameLanguage("en", source)).toBe(false);
 expect(writingSameLanguage("auto", source)).toBe(true);
});
it.each([["auto", "MUST stay in the draft's original language"], ["ja", "MUST be written in Japanese"], ["ko", "MUST be written in Korean"]])("requests %s independently of explanation language", async (target, expected) => {
 const fetcher = vi.fn().mockResolvedValue(new Response("synthetic", { status: 500 }));
 await expect(infer({ ...req, targetLanguage: target }, { ...defaults, setupKind: "custom", model: "test" }, new AbortController().signal, fetcher)).rejects.toBeDefined();
 const system = JSON.parse(fetcher.mock.calls[0][1].body).messages[0].content;
 expect(system).toContain(expected);
 expect(system).toContain("Explanation language (explanation and rule fields ONLY): zh-TW");
 if (target === "auto") expect(system).toContain("Do not translate");
});
