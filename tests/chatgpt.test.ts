import { beforeEach, it, expect, vi } from "vitest";
import {
  beginLogin,
  finishLogin,
  logout,
  accessToken,
  loginStatus,
  decodeCodexStream,
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
