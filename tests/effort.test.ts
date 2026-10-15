import { expect, it, vi } from "vitest";
import { defaults, settingsSchema, cacheIdentity, type Inference, type Settings } from "../src/core";
import { infer } from "../src/provider";
vi.mock("../src/chatgpt", async (original) => ({
  ...await original<typeof import("../src/chatgpt")>(),
  accessToken: vi.fn().mockResolvedValue("synthetic-token"),
  accountHeader: vi.fn().mockReturnValue({}),
}));
vi.mock("../src/subscriptions", async (original) => ({
  ...await original<typeof import("../src/subscriptions")>(),
  subscriptionToken: vi.fn().mockResolvedValue("synthetic-token"),
}));
const request: Inference = {
  requestId: "11111111-1111-4111-8111-111111111111",
  operation: "explain", providerId: "configured", text: "Hello", context: "",
  sourceLanguage: "auto", targetLanguage: "en",
};
it("migrates legacy effort and rejects invalid values", () => {
  const legacy: Partial<Settings> = { ...defaults };
  delete legacy.reasoningEffort;
  expect(settingsSchema.parse(legacy).reasoningEffort).toBe("default");
  expect(settingsSchema.safeParse({ ...defaults, reasoningEffort: "surprise" }).success).toBe(false);
});
it.each(["chatgpt", "custom", "cliproxyapi", "ollama", "claude"] as const)(
  "%s serializes only its supported effort protocol and omits default", async (setupKind) => {
    for (const reasoningEffort of ["default", "none", "high"] as const) {
      const fetcher = vi.fn().mockResolvedValue(new Response("synthetic failure", { status: 500 }));
      await expect(infer(request, { ...defaults, setupKind, model: "test", reasoningEffort }, new AbortController().signal, fetcher)).rejects.toBeDefined();
      expect(fetcher).toHaveBeenCalledOnce();
      const body = JSON.parse(fetcher.mock.calls[0][1].body);
      const explicit = reasoningEffort !== "default";
      expect(body.reasoning).toEqual(setupKind === "chatgpt" && explicit ? { effort: reasoningEffort } : undefined);
      expect(body.reasoning_effort).toBe(["custom", "cliproxyapi"].includes(setupKind) && explicit ? reasoningEffort : undefined);
    }
  },
);
it("separates effective effort in cache keys", () => {
  expect(cacheIdentity(request, defaults)).not.toBe(cacheIdentity(request, { ...defaults, reasoningEffort: "high" }));
  const unsupported: Settings = { ...defaults, setupKind: "claude" };
  expect(cacheIdentity(request, unsupported)).toBe(cacheIdentity(request, { ...unsupported, reasoningEffort: "high" }));
});
