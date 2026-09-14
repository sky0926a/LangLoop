import { z } from "zod";
export const text = z.string().max(20000);
export const writingProfileSchema = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(64),
    prompt: z.string().max(4000),
  })
  .strict();
export const writingTargetSchema = z.enum(["original", "en", "zh-TW"]);
export const settingsSchema = z
  .object({
    version: z.literal(1),
    connectionId: z.string().min(1).max(64).default("legacy"),
    uiLanguage: z.enum(["zh-TW", "en"]).default("zh-TW"),
    endpoint: z.string().max(2048),
    model: z.string().max(256),
    setupKind: z
      .enum([
        "custom",
        "ollama",
        "chatgpt",
        "cliproxyapi",
        "kimi",
        "xai",
        "claude",
        "antigravity",
        "devin",
      ])
      .default("custom"),
    managementPath: z.string().max(2048).default("/management.html"),
    key: z.string().max(4096),
    target: z.string().min(2).max(30),
    writingContext: z.string().max(4000).default(""),
    writingProfiles: z
      .array(writingProfileSchema)
      .max(20)
      .refine(
        (items) => new Set(items.map((x) => x.id)).size === items.length,
        "Duplicate profile IDs",
      )
      .default([]),
    writingProfileId: z.string().max(64).default("general"),
    writingTarget: writingTargetSchema.default("original"),
    excluded: z.array(z.string().max(253)).max(500),
  })
  .strict();
export type Settings = z.infer<typeof settingsSchema>;
export const defaults: Settings = {
  version: 1,
  connectionId: "legacy",
  uiLanguage: "zh-TW",
  setupKind: "chatgpt",
  managementPath: "/management.html",
  endpoint: "https://chatgpt.com/backend-api/codex",
  model: "",
  key: "",
  target: "zh-TW",
  writingContext: "",
  writingProfiles: [
    {
      id: "general",
      name: "一般寫作",
      prompt: "自然、清楚、簡潔，保留原意，不新增事實、期限或承諾。",
    },
  ],
  writingProfileId: "general",
  writingTarget: "original",
  excluded: [],
};
export const resultSchema = z
  .object({
    result: text.min(1),
    explanation: text,
    rule: z.string().max(1000),
  })
  .strict();
export type Result = z.infer<typeof resultSchema>;
export const writingResultSchema = z
  .object({
    baseline: resultSchema,
    suggestion: resultSchema,
    sourceLanguage: z.enum(["en", "zh", "other"]),
  })
  .strict();
export const operationSchema = z.enum([
  "translate",
  "explain",
  "correct",
  "rewrite",
  "test",
  "article",
  "writing",
]);
export type Operation = z.infer<typeof operationSchema>;
export const sourceSchema = z
  .object({
    tabId: z.number().int(),
    frameId: z.literal(0),
    generation: z.string().max(100),
    url: z.string().max(4096),
  })
  .strict();
export type Source = z.infer<typeof sourceSchema>;
export const inferenceSchema = z
  .object({
    requestId: z.string().uuid(),
    operation: operationSchema,
    providerId: z.literal("configured"),
    text: text.min(1),
    context: text.default(""),
    writingProfileId: z.string().max(64).optional(),
    sourceLanguage: z.literal("auto"),
    targetLanguage: z.string().min(2).max(30),
    source: sourceSchema.optional(),
    blocks: z
      .array(z.object({ id: z.string().max(100), text: text.min(1) }).strict())
      .max(40)
      .optional(),
  })
  .strict();
export type Inference = z.infer<typeof inferenceSchema>;
export class Fault extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function fault(error: unknown) {
  return error instanceof Fault
    ? { code: error.code, message: error.message }
    : {
        code: "invalid_response",
        message:
          "The operation could not complete. Check your settings and retry.",
      };
}
export function endpointUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Fault("configuration_required", "Enter a valid API base URL.");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
    throw new Fault(
      "configuration_required",
      "Use HTTPS, or HTTP on localhost only.",
    );
  return url;
}
export function originPattern(value: string) {
  const u = endpointUrl(value);
  return `${u.protocol}//${u.hostname}/*`;
}
export function excluded(url: string, domains: string[]) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return domains.some((d) => host === d || host.endsWith("." + d));
  } catch {
    return true;
  }
}
export function validateDomains(domains: string[]) {
  const out = domains.map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (out.some((x) => !/^([a-z0-9-]+\.)*[a-z0-9-]+$/.test(x)))
    throw new Fault(
      "configuration_required",
      "Use domain names only, one per line.",
    );
  return out;
}
export function differences(original: string, replacement: string) {
  let start = 0;
  while (
    start < original.length &&
    start < replacement.length &&
    original[start] === replacement[start]
  )
    start++;
  let end = 0;
  while (
    end < original.length - start &&
    end < replacement.length - start &&
    original[original.length - 1 - end] ===
      replacement[replacement.length - 1 - end]
  )
    end++;
  return {
    prefix: original.slice(0, start),
    removed: original.slice(start, original.length - end),
    added: replacement.slice(start, replacement.length - end),
    suffix: end ? original.slice(-end) : "",
  };
}
// Word boundaries keep spelling/inflection corrections readable in the page popover.
export function wordDifferences(original: string, replacement: string) {
  const tokenize = (text: string) =>
    text.match(
      /\s+|\p{Script=Han}|(?:(?!\p{Script=Han})[\p{L}\p{N}_])+|[^\s]/gu,
    ) ?? [];
  const before = tokenize(original),
    after = tokenize(replacement);
  let start = 0,
    end = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start++;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++;
  const prefix = before.slice(0, start).join("");
  const suffix = end ? before.slice(-end).join("") : "";
  const left = before.slice(start, before.length - end);
  const right = after.slice(start, after.length - end);
  const segments: { kind: "equal" | "removed" | "added"; text: string }[] = [];
  function append(kind: "equal" | "removed" | "added", text: string) {
    if (!text) return;
    const last = segments.at(-1);
    if (last?.kind === kind) last.text += text;
    else segments.push({ kind, text });
  }
  append("equal", prefix);
  // Bound memory/work for long unrelated rewrites after trimming common edges.
  if (left.length * right.length > 1_000_000) {
    append("removed", left.join(""));
    append("added", right.join(""));
  } else {
    const rows = Array.from(
      { length: left.length + 1 },
      () => new Uint16Array(right.length + 1),
    );
    for (let i = left.length - 1; i >= 0; i--)
      for (let j = right.length - 1; j >= 0; j--)
        rows[i][j] =
          left[i] === right[j]
            ? rows[i + 1][j + 1] + 1
            : Math.max(rows[i + 1][j], rows[i][j + 1]);
    let i = 0,
      j = 0;
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) {
        append("equal", left[i++]);
        j++;
      } else if (
        i < left.length &&
        (j === right.length || rows[i + 1][j] >= rows[i][j + 1])
      ) {
        append("removed", left[i++]);
      } else append("added", right[j++]);
    }
  }
  append("equal", suffix);
  return {
    prefix,
    removed: left.join(""),
    added: right.join(""),
    suffix,
    segments,
  };
}
export function cacheIdentity(r: Inference, s: Settings) {
  return JSON.stringify([
    1,
    r.operation,
    r.text,
    r.context,
    r.blocks,
    r.sourceLanguage,
    r.targetLanguage,
    s.connectionId,
    s.setupKind,
    s.endpoint,
    s.model,
    s.writingContext,
    s.writingProfiles,
    r.writingProfileId,
    s.target,
    2,
  ]);
}
export function decodeResponse(value: unknown, request: Inference) {
  if (request.operation === "writing") {
    const result = writingResultSchema.parse(value);
    // Catch clearly untranslated Chinese output without rejecting English text
    // that includes a Chinese proper name. This is a script check, not a full
    // language detector; short names and mixed-language text remain ambiguous.
    if (request.targetLanguage === "en") {
      for (const variant of [result.baseline, result.suggestion]) {
        const han = variant.result.match(/\p{Script=Han}/gu)?.length ?? 0;
        const latin = variant.result.match(/\p{Script=Latin}/gu)?.length ?? 0;
        if (han >= 2 && han > latin)
          throw new Fault(
            "invalid_response",
            "The AI returned the wrong output language. Please generate suggestions again.",
          );
      }
    }
    return result;
  }
  if (request.operation !== "article") return resultSchema.parse(value);
  const data = z
    .object({
      translations: z
        .array(z.object({ id: z.string(), translation: text.min(1) }).strict())
        .max(40),
    })
    .strict()
    .parse(value);
  const ids = request.blocks?.map((b) => b.id) ?? [];
  if (
    data.translations.length !== ids.length ||
    new Set(data.translations.map((b) => b.id)).size !== ids.length ||
    data.translations.some((b) => !ids.includes(b.id))
  )
    throw new Fault(
      "invalid_response",
      "Translation block IDs do not match. Retry the page.",
    );
  return data;
}
export function isTrusted(
  sender: { id?: string; url?: string; tab?: unknown },
  id: string,
) {
  return (
    sender.id === id &&
    sender.url?.split("?")[0] === `chrome-extension://${id}/panel.html`
  );
}

export const discoverySchema = settingsSchema.pick({
  endpoint: true,
  key: true,
});
export function managementUrl(endpoint: string, path: string) {
  const base = endpointUrl(endpoint);
  let url: URL;
  try {
    url = endpointUrl(new URL(path, base.origin).href);
  } catch {
    throw new Fault(
      "configuration_required",
      "Enter a same-origin management path without credentials, query or fragment.",
    );
  }
  if (url.origin !== base.origin || !path.trim())
    throw new Fault(
      "configuration_required",
      "Management must use the same origin as the proxy.",
    );
  return url.href;
}
export function decodeModels(value: unknown): string[] {
  const parsed = z
    .object({
      data: z
        .array(
          z.object({
            id: z
              .string()
              .min(1)
              .max(256)
              .refine((id) => !!id.trim()),
          }),
        )
        .max(2000),
    })
    .safeParse(value);
  if (!parsed.success)
    throw new Fault(
      "invalid_response",
      "The proxy returned an invalid model catalog. Enter a model manually or retry.",
    );
  return [...new Set(parsed.data.data.map((item) => item.id))].sort();
}
