import { beforeEach, it, expect, vi } from "vitest";
import { infer } from "../src/provider";
import { defaults, type Inference } from "../src/core";
import {
  beginLogin,
  finishLogin,
  logout,
  accessToken,
  loginStatus,
  decodeCodexStream,
  readCodexStream,
  boundedText,
} from "../src/chatgpt";
let local: Record<string, any>, session: Record<string, any>;
beforeEach(() => {
  local = {};
  session = {};
  const area = (data: Record<string, any>) => ({
    get: async (key: string) => ({ [key]: data[key] }),
    set: async (value: any) => Object.assign(data, value),
    remove: async (key: string) => {
      delete data[key];
    },
  });
  vi.stubGlobal("chrome", {
    storage: { local: area(local), session: area(session) },
  });
  vi.stubGlobal("fetch", vi.fn());
});
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
it("device login stays in extension, respects poll interval and never returns tokens", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    response({
      device_auth_id: "private-device",
      user_code: "ABCD",
      interval: 5,
    }),
  );
  expect(await beginLogin()).toEqual({
    userCode: "ABCD",
    url: "https://auth.openai.com/codex/device",
  });
  expect(await finishLogin()).toEqual({ pending: true });
  expect(fetch).toHaveBeenCalledTimes(1);
  session.codexPending.nextPoll = 0;
  vi.mocked(fetch).mockResolvedValueOnce(response({}, 403));
  expect(await finishLogin()).toEqual({ pending: true });
  session.codexPending.nextPoll = 0;
  vi.mocked(fetch)
    .mockResolvedValueOnce(
      response({
        authorization_code: "private-code",
        code_verifier: "verifier",
      }),
    )
    .mockResolvedValueOnce(
      response({
        access_token: "private-access",
        refresh_token: "private-refresh",
        expires_in: 3600,
      }),
    );
  expect(await finishLogin()).toEqual({ pending: false, signedIn: true });
  expect(await loginStatus()).toEqual({ signedIn: true, userCode: undefined });
  expect(await accessToken()).toBe("private-access");
  expect(JSON.stringify(await loginStatus())).not.toContain("private");
  await logout();
  expect(local.codexAuth).toBeUndefined();
  expect(session.codexPending).toBeUndefined();
});
it("expired login requires explicit restart", async () => {
  session.codexPending = { expiresAt: 0 };
  await expect(finishLogin()).rejects.toThrow("expired");
  expect(fetch).not.toHaveBeenCalled();
});
it("refresh is single flight and logout prevents an in-flight refresh from restoring tokens", async () => {
  local.codexAuth = {
    access_token: "old",
    refresh_token: "refresh",
    expiresAt: 0,
  };
  let release!: (value: Response) => void;
  vi.mocked(fetch).mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const first = accessToken(),
    second = accessToken();
  const results = Promise.allSettled([first, second]);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await logout();
  release(
    response({
      access_token: "new",
      refresh_token: "new-refresh",
      expires_in: 3600,
    }),
  );
  expect((await results).every((r) => r.status === "rejected")).toBe(true);
  expect(local.codexAuth).toBeUndefined();
});
it("SSE requires completed language JSON and rejects failed or partial output", () => {
  const data = { result: "Hello", explanation: "why", rule: "" };
  expect(
    decodeCodexStream(
      "data: " +
        JSON.stringify({
          type: "response.completed",
          response: {
            status: "completed",
            output: [
              {
                content: [{ type: "output_text", text: JSON.stringify(data) }],
              },
            ],
          },
        }) +
        "\n",
    ),
  ).toEqual(data);
  for (const raw of [
    'data: {"type":"response.failed"}\n',
    'data: {"type":"response.incomplete"}\n',
    'data: {"type":"response.output_text.delta","delta":"partial"}\n',
    "data: garbage\n",
  ])
    expect(() => decodeCodexStream(raw)).toThrow();
});

it("direct inference uses fixed Codex origin and validated Responses output", async () => {
  const { infer } = await import("../src/provider");
  const { defaults } = await import("../src/core");
  local.codexAuth = {
    access_token: "private-access",
    refresh_token: "private-refresh",
    expiresAt: Date.now() + 3600000,
  };
  const result = { result: "Hello", explanation: "why", rule: "" };
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      "data: " +
        JSON.stringify({
          type: "response.completed",
          response: {
            status: "completed",
            output: [
              {
                content: [
                  { type: "output_text", text: JSON.stringify(result) },
                ],
              },
            ],
          },
        }) +
        "\n",
    ),
  );
  const request = {
    requestId: "11111111-1111-4111-8111-111111111111",
    operation: "test" as const,
    providerId: "configured" as const,
    text: "Hello",
    context: "",
    sourceLanguage: "auto" as const,
    targetLanguage: "zh-TW",
  };
  expect(
    await infer(
      request,
      { ...defaults, model: "example-model", endpoint: "https://evil.example" },
      new AbortController().signal,
      fetcher,
    ),
  ).toEqual(result);
  expect(fetcher.mock.calls[0][0]).toBe(
    "https://chatgpt.com/backend-api/codex/responses",
  );
  const opts = fetcher.mock.calls[0][1];
  expect(opts.headers.Authorization).toBe("Bearer private-access");
  expect(JSON.parse(opts.body)).toMatchObject({ stream: true, store: false });
});

it("account catalog uses fixed authenticated destination and lists visible unique models", async () => {
  const { listAccountModels } = await import("../src/chatgpt");
  local.codexAuth = {
    access_token: "private-access",
    expiresAt: Date.now() + 3600000,
  };
  vi.mocked(fetch).mockResolvedValue(
    response({
      models: [
        {
          slug: "model-b",
          visibility: "list",
          priority: 2,
          instructions: "private metadata",
        },
        { slug: "hidden", visibility: "hide" },
        { slug: "model-a", visibility: "list", priority: 1 },
        { slug: "model-b", visibility: "list", priority: 2 },
      ],
    }),
  );
  expect(await listAccountModels()).toEqual(["model-a", "model-b"]);
  expect(fetch).toHaveBeenCalledWith(
    "https://chatgpt.com/backend-api/codex/models?client_version=0.149.0",
    expect.objectContaining({
      credentials: "omit",
      redirect: "error",
      headers: { Authorization: "Bearer private-access" },
    }),
  );
  vi.mocked(fetch).mockResolvedValue(response({}, 401));
  await expect(listAccountModels()).rejects.toThrow(
    "Sign out and sign in again",
  );
  vi.mocked(fetch).mockResolvedValue(response({ models: [{ slug: "bad" }] }));
  await expect(listAccountModels()).rejects.toThrow("Could not load");
});

it("Codex output-item events supply text when completion carries only metadata", () => {
  const result = { result: "你好，世界。", explanation: "翻譯", rule: "" };
  const item = {
    type: "message",
    id: "m1",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: JSON.stringify(result) }],
  };
  const events = [
    { type: "response.output_item.done", output_index: 0, item },
    {
      type: "response.completed",
      response: { id: "r1", status: "completed", usage: {} },
    },
  ];
  const stream = (values: unknown[]) =>
    values.map((e) => "data: " + JSON.stringify(e) + "\n\n").join("");
  expect(decodeCodexStream(stream(events))).toEqual(result);
  expect(
    decodeCodexStream(
      stream([
        events[0],
        {
          type: "response.completed",
          response: { status: "completed", output: [item] },
        },
      ]),
    ),
  ).toEqual(result);
  expect(() => decodeCodexStream(stream([events[0]]))).toThrow("No completed");
  expect(() =>
    decodeCodexStream(stream([events[0], { type: "response.failed" }])),
  ).toThrow("did not complete");
});
it("isolates same-provider credentials and logout by connection", async () => {
  local["codexAuth:private"] = {
    access_token: "private-token",
    refresh_token: "p-refresh",
    expiresAt: Date.now() + 3600000,
  };
  local["codexAuth:work"] = {
    access_token: "work-token",
    refresh_token: "w-refresh",
    expiresAt: Date.now() + 3600000,
  };
  expect(await accessToken("private")).toBe("private-token");
  expect(await accessToken("work")).toBe("work-token");
  await logout("private");
  expect(local["codexAuth:private"]).toBeUndefined();
  expect(await accessToken("work")).toBe("work-token");
});

it("recognizes context overflow in failed Codex stream events without exposing raw text", () => {
  expect(() => decodeCodexStream('data: '+JSON.stringify({type:'response.failed',response:{error:{code:'context_length_exceeded',message:'private detail'}}})+'\n')).toThrow(expect.objectContaining({code:'context_limit'}));
});

it("translates an article when Codex stream overhead exceeds 250 KB but the result is small", async () => {
  local.codexAuth = { access_token: "fixture-token", expiresAt: Date.now() + 3600000 };
  const request: Inference = { requestId: "11111111-1111-4111-8111-111111111111", operation: "article", providerId: "configured", text: "Translate", context: "", sourceLanguage: "auto", targetLanguage: "zh-TW", blocks: [{ id: "a", text: "Hello" }] };
  const result = { translations: [{ id: "a", translation: "你好" }] };
  const delta = 'data: ' + JSON.stringify({ type: "response.output_text.delta", delta: "x".repeat(200) }) + '\n\n';
  const raw = delta.repeat(2000) + 'data: ' + JSON.stringify({ type: "response.completed", response: { status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify(result) }] }] } }) + '\n\n';
  expect(new TextEncoder().encode(raw).length).toBeGreaterThan(250000);
  const fetcher = vi.fn().mockImplementation(() => new Response(raw));
  await expect(infer(request, { ...defaults, setupKind: "chatgpt", model: "fixture" }, new AbortController().signal, fetcher)).resolves.toEqual(result);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("splits article batches after an oversized Codex result and validates merged block IDs", async () => {
  local.codexAuth = { access_token: "fixture-token", expiresAt: Date.now() + 3600000 };
  const request: Inference = { requestId: "11111111-1111-4111-8111-111111111111", operation: "article", providerId: "configured", text: "Translate", context: "", sourceLanguage: "auto", targetLanguage: "zh-TW", blocks: ["a", "b"].map(id => ({ id, text: "Hello" })) };
  const fetcher = vi.fn().mockImplementation((_url, init) => {
    const input = JSON.parse(JSON.parse(init.body).input[0].content[0].text);
    const output = input.blocks.length > 1 ? "你".repeat(90000) : JSON.stringify({ translations: input.blocks.map((block: {id: string}) => ({id: block.id, translation: "你好"})) });
    return new Response(sse({type: "response.completed", response: {status: "completed", output: [{ content: [{type: "output_text", text: output}] }]}}));
  });
  await expect(infer(request, { ...defaults, setupKind: "chatgpt", model: "fixture" }, new AbortController().signal, fetcher)).resolves.toEqual({ translations: [{ id: "a", translation: "你好" }, { id: "b", translation: "你好" }] });
  expect(fetcher).toHaveBeenCalledTimes(3);
});

function streamedResponse(raw: string, chunkSize = 32768) {
  const bytes = new TextEncoder().encode(raw);
  let offset = 0;
  const cancel = vi.fn();
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset = Math.min(bytes.length, offset + chunkSize);
    },
    cancel,
  }));
  return { response, cancel };
}
const sse = (event: unknown) => 'data: ' + JSON.stringify(event) + '\r\n\r\n';

it("incrementally decodes UTF-8 events and deduplicates completed items before a usage-only completion", async () => {
  const result = { result: "你好，日本語 한국어", explanation: "", rule: "" };
  const item = { id: "message", content: [{ type: "output_text", text: JSON.stringify(result) }] };
  const raw = ': keepalive\r\nevent: response.output_item.done\r\n' +
    sse({ type: "response.output_item.done", item }) +
    sse({ type: "response.output_item.done", item }) +
    'data: ' + JSON.stringify({ type: "response.completed", response: { status: "completed", usage: {} } });
  await expect(readCodexStream(streamedResponse(raw, 3).response)).resolves.toEqual(result);
});

it("refuses malformed, failed, or truncated streams instead of returning partial output", async () => {
  const item = sse({ type: "response.output_item.done", item: { content: [{ type: "output_text", text: '{"result":"partial"}' }] } });
  for (const raw of [item, 'data: {broken}\n', item + sse({ type: "response.failed", response: { error: { message: "private detail" } } })]) {
    await expect(readCodexStream(streamedResponse(raw, 7).response)).rejects.toMatchObject({ code: "invalid_response" });
  }
  await expect(readCodexStream(streamedResponse(sse({ type: "response.failed", response: { error: { code: "context_length_exceeded" } } })).response)).rejects.toMatchObject({ code: "context_limit" });
});

it("bounds event size, retained output, and total wire bytes and cancels oversized streams", async () => {
  const largeItem = { id: "large", content: [{ type: "output_text", text: "你".repeat(90000) }] };
  for (const raw of [
    'data: ' + 'x'.repeat(1000001),
    sse({ type: "response.output_item.done", item: largeItem }),
    sse({ type: "response.completed", response: { output: [largeItem] } }),
    (':' + 'x'.repeat(899999) + '\n').repeat(10),
  ]) {
    const { response, cancel } = streamedResponse(raw);
    await expect(readCodexStream(response)).rejects.toMatchObject({ code: "response_too_large" });
    expect(cancel).toHaveBeenCalledTimes(1);
  }
});

it("honors cancellation before accepting a complete streamed result", async () => {
  const controller = new AbortController();
  controller.abort(new Error("Stopped"));
  const { response, cancel } = streamedResponse(sse({ type: "response.completed", response: { output: [] } }));
  await expect(readCodexStream(response, controller.signal)).rejects.toThrow("Stopped");
  expect(cancel).toHaveBeenCalledTimes(1);
});

it("retains the smaller generic response limit for authorization and other JSON responses", async () => {
  await expect(boundedText(new Response('x'.repeat(250001)))).rejects.toThrow("Response exceeded the size limit.");
});
