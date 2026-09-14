import { describe, it, expect, vi } from "vitest";
import {
  defaults,
  endpointUrl,
  excluded,
  isTrusted,
  differences,
  cacheIdentity,
  decodeResponse,
  type Inference,
} from "../src/core";
import { infer } from "../src/provider";
const req: Inference = {
  requestId: "11111111-1111-4111-8111-111111111111",
  operation: "explain",
  providerId: "configured",
  text: "interested in buying",
  context: "",
  sourceLanguage: "auto",
  targetLanguage: "zh-TW",
};
describe("provider boundary", () => {
  it.each([
    "http://example.com/v1",
    "https://user:secret@example.com",
    "javascript:alert(1)",
    "https://example.com?key=x",
  ])("rejects unsafe endpoint %s", (url) =>
    expect(() => endpointUrl(url)).toThrow(),
  );
  it.each([
    "http://localhost:11434/v1",
    "http://127.0.0.1:11434/v1",
    "https://api.example.com/v1",
  ])("allows configured endpoint %s", (url) =>
    expect(endpointUrl(url)).toBeInstanceOf(URL),
  );
  it("checks domain boundaries", () => {
    expect(excluded("https://mail.example.com", ["example.com"])).toBe(true);
    expect(excluded("https://notexample.com", ["example.com"])).toBe(false);
  });
  it("refuses forged content script senders", () => {
    expect(isTrusted({ id: "x", url: "https://site.test", tab: {} }, "x")).toBe(
      false,
    );
    expect(
      isTrusted({ id: "x", url: "chrome-extension://x/panel.html" }, "x"),
    ).toBe(true);
  });
  it("keys cache by actual context", () => {
    const a = {
      ...req,
      text: "It works.",
      context: "The printer is repaired.",
    };
    const b = { ...a, context: "The medication was tested." };
    expect(cacheIdentity(a, defaults)).not.toBe(cacheIdentity(b, defaults));
  });
  it("deterministically shows a correction diff", () =>
    expect(differences("interested to buy", "interested in buying")).toEqual({
      prefix: "interested ",
      removed: "to buy",
      added: "in buying",
      suffix: "",
    }));
  it("rejects duplicate and missing article IDs", () =>
    expect(() =>
      decodeResponse(
        {
          translations: [
            { id: "b1", translation: "a" },
            { id: "b1", translation: "b" },
          ],
        },
        {
          ...req,
          operation: "article",
          blocks: [
            { id: "b1", text: "a" },
            { id: "b2", text: "b" },
          ],
        },
      ),
    ).toThrow());
  it("passes model and auth only to configured endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  result: "有興趣購買",
                  explanation: "in + V-ing",
                  rule: "interested in",
                }),
              },
            },
          ],
        }),
      ),
    );
    const value = await infer(
      req,
      {
        ...defaults,
        setupKind: "custom",
        endpoint: "http://localhost:11434/v1",
        model: "test-model",
        key: "synthetic-test-key",
      },
      new AbortController().signal,
      fetcher,
    );
    expect(value).toHaveProperty("rule", "interested in");
    expect(fetcher.mock.calls[0][0]).toBe(
      "http://localhost:11434/v1/chat/completions",
    );
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      redirect: "error",
      credentials: "omit",
    });
  });
  it.each([
    [401, "authentication_failed"],
    [429, "rate_limited"],
    [500, "network_error"],
  ])("maps HTTP %s", async (status, code) => {
    await expect(
      infer(
        req,
        {
          ...defaults,
          setupKind: "custom",
          endpoint: "http://localhost:11434/v1",
          model: "test",
        },
        new AbortController().signal,
        vi
          .fn()
          .mockResolvedValue(new Response("", { status: status as number })),
      ),
    ).rejects.toHaveProperty("code", code);
  });
  it("rejects malformed inference output", async () => {
    await expect(
      infer(
        req,
        {
          ...defaults,
          setupKind: "custom",
          endpoint: "http://localhost:11434/v1",
          model: "test",
        },
        new AbortController().signal,
        vi.fn().mockResolvedValue(new Response("not-json")),
      ),
    ).rejects.toHaveProperty("code", "invalid_response");
  });
});

it("validates management origin and rejects URL secrets", async () => {
  const { managementUrl } = await import("../src/core");
  expect(managementUrl("http://127.0.0.1:8317/v1", "/management.html")).toBe(
    "http://127.0.0.1:8317/management.html",
  );
  expect(managementUrl("http://127.0.0.1:8317/v1", "/proxy/admin")).toBe(
    "http://127.0.0.1:8317/proxy/admin",
  );
  for (const address of [
    "https://evil.example",
    "//evil.example",
    "/admin?key=secret",
    "/admin#token",
    "http://user:pass@127.0.0.1:8317",
    "",
  ]) {
    expect(() => managementUrl("http://127.0.0.1:8317/v1", address)).toThrow();
  }
});
it("normalizes model IDs and enforces catalog boundaries", async () => {
  const { decodeModels } = await import("../src/core");
  expect(
    decodeModels({
      data: [{ id: "claude/b" }, { id: "gpt/a" }, { id: "claude/b" }],
    }),
  ).toEqual(["claude/b", "gpt/a"]);
  expect(decodeModels({ data: [] })).toEqual([]);
  for (const data of [
    {},
    { data: Array.from({ length: 2001 }, () => ({ id: "a" })) },
    { data: [{ id: "" }] },
    { data: [{ id: " " }] },
    { data: [{ id: "a".repeat(257) }] },
  ])
    expect(() => decodeModels(data)).toThrow();
});

it("word differences show the complete corrected word", async () => {
  const { wordDifferences } = await import("../src/core");
  expect(
    wordDifferences(
      "I look forward to hear from you.",
      "I look forward to hearing from you.",
    ),
  ).toMatchObject({
    prefix: "I look forward to ",
    removed: "hear",
    added: "hearing",
    suffix: " from you.",
  });
  expect(wordDifferences("Same.", "Same.").removed).toBe("");
  expect(wordDifferences("", "Hello").added).toBe("Hello");
});

it("marks only separate capitalization and punctuation changes", async () => {
  const { wordDifferences } = await import("../src/core");
  const result = wordDifferences(
    "sure, I'll release this version later",
    "Sure, I'll release this version later.",
  );
  expect(result.segments).toEqual([
    { kind: "removed", text: "sure" },
    { kind: "added", text: "Sure" },
    { kind: "equal", text: ", I'll release this version later" },
    { kind: "added", text: "." },
  ]);
  for (const [original, replacement] of [
    ["I has two book.", "I have two books."],
    ["", "Hello"],
    ["Same.", "Same."],
    ["Hi!", ""],
  ]) {
    const parts = wordDifferences(original, replacement).segments;
    expect(
      parts
        .filter((p) => p.kind !== "added")
        .map((p) => p.text)
        .join(""),
    ).toBe(original);
    expect(
      parts
        .filter((p) => p.kind !== "removed")
        .map((p) => p.text)
        .join(""),
    ).toBe(replacement);
  }
});

it("defaults legacy writing context and separates cached project styles", async () => {
  const { settingsSchema } = await import("../src/core");
  const { writingContext: _, ...legacy } = defaults;
  void _;
  expect(settingsSchema.parse(legacy).writingContext).toBe("");
  expect(() =>
    settingsSchema.parse({ ...defaults, writingContext: "x".repeat(4001) }),
  ).toThrow();
  expect(cacheIdentity(req, defaults)).not.toBe(
    cacheIdentity(req, {
      ...defaults,
      writingContext: "Professional business email",
    }),
  );
});

it("sends configured context while preserving explicit language and JSON contracts", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                result: "I will release it shortly.",
                explanation: "商務英文",
                rule: "",
              }),
            },
          },
        ],
      }),
    ),
  );
  await infer(
    {
      ...req,
      operation: "translate",
      text: "我等下會釋出下一版",
      targetLanguage: "en",
    },
    {
      ...defaults,
      setupKind: "custom",
      model: "test",
      writingContext: "你是一位商務溝通專家。請協助改寫 Email。",
    },
    new AbortController().signal,
    fetcher,
  );
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body.messages[0].content).toContain("商務溝通專家");
  expect(body.messages[0].content).toContain("Translation output language: en");
  expect(body.messages[0].content).toContain("Explanation language (explanation and rule fields ONLY): zh-TW");
  expect(body.messages[0].content).toContain("Return JSON only");
});

it("preserves unchanged Chinese characters between punctuation and wording edits", async () => {
  const { wordDifferences } = await import("../src/core");
  const parts = wordDifferences(
    "好的, 我等下會釋出下一版",
    "好的，我稍後會釋出下一版。",
  ).segments;
  expect(
    parts
      .filter((p) => p.kind === "removed")
      .map((p) => p.text)
      .join(""),
  ).toBe(", 等下");
  expect(
    parts.some((p) => p.kind === "equal" && p.text.includes("會釋出下一版")),
  ).toBe(true);
});

it("validates both writing versions and keys selected context", async () => {
  const { writingResultSchema, settingsSchema } = await import("../src/core");
  const variant = { result: "Hello.", explanation: "", rule: "" };
  expect(
    writingResultSchema.parse({
      baseline: variant,
      suggestion: variant,
      sourceLanguage: "en",
    }).baseline.result,
  ).toBe("Hello.");
  expect(() =>
    writingResultSchema.parse({ baseline: variant, sourceLanguage: "en" }),
  ).toThrow();
  expect(() =>
    settingsSchema.parse({
      ...defaults,
      writingProfiles: [
        { id: "a", name: "A", prompt: "" },
        { id: "a", name: "B", prompt: "" },
      ],
    }),
  ).toThrow();
  expect(cacheIdentity({ ...req, writingProfileId: "a" }, defaults)).not.toBe(
    cacheIdentity({ ...req, writingProfileId: "b" }, defaults),
  );
});

it("paired prompt keeps baseline independent of selected profile", async () => {
  const variant = { result: "Hello.", explanation: "", rule: "" };
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                baseline: variant,
                suggestion: variant,
                sourceLanguage: "en",
              }),
            },
          },
        ],
      }),
    ),
  );
  await infer(
    {
      ...req,
      operation: "writing",
      writingProfileId: "general",
      targetLanguage: "original",
    },
    { ...defaults, setupKind: "custom", model: "test" },
    new AbortController().signal,
    fetcher,
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  const prompt = JSON.parse(fetcher.mock.calls[0][1].body).messages[0].content;
  expect(prompt).toContain("Produce TWO complete versions");
  expect(prompt).toContain("ignore style preferences");
  expect(prompt).toContain("Translation output language: original");
  await expect(
    infer(
      { ...req, operation: "writing", writingProfileId: "deleted" },
      { ...defaults, setupKind: "custom", model: "test" },
      new AbortController().signal,
      fetcher,
    ),
  ).rejects.toMatchObject({ code: "configuration_required" });
});
it("isolates cached output between accounts of the same provider", () => {
  expect(cacheIdentity(req, { ...defaults, connectionId: "a" })).not.toBe(
    cacheIdentity(req, { ...defaults, connectionId: "b" }),
  );
});

it("rejects Chinese writing results when English was explicitly requested", () => {
  const request: Inference = {
    ...req,
    operation: "writing",
    text: "謝謝你的更新，明天我會回覆。",
    targetLanguage: "en",
  };
  const chinese = { result: request.text, explanation: "原文正確。", rule: "" };
  const english = {
    ...chinese,
    result: "Thanks for the update. I will reply tomorrow.",
  };
  for (const bad of [
    { baseline: chinese, suggestion: english },
    { baseline: english, suggestion: chinese },
  ]) {
    expect(() =>
      decodeResponse({ ...bad, sourceLanguage: "zh" }, request),
    ).toThrow(/language/i);
  }
  expect(
    decodeResponse(
      { baseline: english, suggestion: english, sourceLanguage: "zh" },
      request,
    ),
  ).toMatchObject({ baseline: english });
  expect(
    decodeResponse(
      { baseline: chinese, suggestion: chinese, sourceLanguage: "zh" },
      { ...request, targetLanguage: "original" },
    ),
  ).toMatchObject({ baseline: chinese });
});

it("keeps explicit English output above a Chinese business profile and explanations", async () => {
  const variant = {
    result: "Thanks for the update. I will reply tomorrow.",
    explanation: "忠實翻譯。",
    rule: "",
  };
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  sourceLanguage: "zh",
                  baseline: variant,
                  suggestion: variant,
                }),
              },
            },
          ],
        }),
      ),
    );
  await infer(
    {
      ...req,
      operation: "writing",
      text: "謝謝你的更新，明天我會回覆。",
      targetLanguage: "en",
      writingProfileId: "business",
    },
    {
      ...defaults,
      setupKind: "custom",
      model: "test",
      writingProfiles: [
        {
          id: "business",
          name: "商務寫作",
          prompt: "你是一位擁有 15 年經驗的商務溝通專家。保留原文語言。",
        },
      ],
    },
    new AbortController().signal,
    fetcher,
  );
  const prompt = JSON.parse(fetcher.mock.calls[0][1].body).messages[0].content;
  expect(prompt).toContain(
    "Both baseline.result and suggestion.result MUST be written in English",
  );
  expect(prompt).toContain("overrides ALL context/style preferences");
  expect(prompt).toContain("explanation and rule fields ONLY");
  expect(prompt).not.toContain("For single correct/rewrite operations");
});
