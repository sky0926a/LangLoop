import { beforeEach, it, expect, vi } from "vitest";
let handler: any;
let navigation: any;
let session: Record<string, any>;
let allowed: boolean;
let settings: any;
let fetcher: any;
const request = {
  requestId: "11111111-1111-4111-8111-111111111111",
  operation: "explain",
  providerId: "configured",
  text: "sample",
  context: "",
  sourceLanguage: "auto",
  targetLanguage: "zh-TW",
};
beforeEach(async () => {
  vi.resetModules();
  session = {};
  allowed = true;
  settings = {
    version: 1,
    endpoint: "http://localhost:11434/v1",
    model: "fixture",
    key: "synthetic",
    target: "zh-TW",
    excluded: [],
  };
  fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                result: "output",
                explanation: "why",
                rule: "rule",
              }),
            },
          },
        ],
      }),
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        setAccessLevel: vi.fn(),
        get: async () => ({ settings }),
        set: async (v: any) => {
          settings = v.settings;
        },
      },
      session: {
        setAccessLevel: vi.fn(),
        get: async () => ({ ...session }),
        set: async (v: any) => Object.assign(session, v),
        remove: async (key: string) => {
          delete session[key];
        },
      },
    },
    tabs: {
      onUpdated: {
        addListener: (fn: any) => {
          navigation = fn;
        },
      },
      get: async () => ({ url: "https://excluded.example" }),
    },
    scripting: { executeScript: vi.fn() },
    permissions: { contains: async () => allowed },
    runtime: {
      id: "testid",
      onInstalled: { addListener: vi.fn() },
      onMessage: {
        addListener: (fn: any) => {
          handler = fn;
        },
      },
    },
    action: { onClicked: { addListener: vi.fn() } },
    contextMenus: { onClicked: { addListener: vi.fn() } },
    sidePanel: {},
  });
  await import("../src/background");
});
const send = (
  type: string,
  payload?: unknown,
  sender: any = { id: "testid", url: "chrome-extension://testid/panel.html" },
) => new Promise<any>((resolve) => handler({ type, payload }, sender, resolve));
it("denied provider permission sends no traffic", async () => {
  allowed = false;
  expect((await send("infer", request)).error.code).toBe("permission_denied");
  expect(fetcher).not.toHaveBeenCalled();
});
it("forged page sender and arbitrary fields are rejected", async () => {
  expect(
    (
      await send("infer", request, {
        id: "testid",
        url: "https://evil.example",
        tab: { id: 1 },
      })
    ).error.code,
  ).toBe("permission_denied");
  expect(
    (await send("infer", { ...request, endpoint: "https://evil.example" }))
      .status,
  ).toBe("error");
  expect(fetcher).not.toHaveBeenCalled();
});
it("excluded domain refuses capture before extraction", async () => {
  settings.excluded = ["excluded.example"];
  expect((await send("capture", 1)).error.code).toBe("permission_denied");
  expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});
it("inference emits data only without keys", async () => {
  const r = await send("infer", request);
  expect(r.status).toBe("ok");
  expect(JSON.stringify(r)).not.toContain("synthetic");
});
it("cancellation aborts provider transport", async () => {
  fetcher.mockImplementation(
    (_url: any, opts: any) =>
      new Promise((_resolve, reject) =>
        opts.signal.addEventListener("abort", () => reject(opts.signal.reason)),
      ),
  );
  const pending = send("infer", request);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
  await send("cancel", request.requestId);
  expect((await pending).error.code).toBe("cancelled");
});
it("timeout is distinguishable", async () => {
  vi.useFakeTimers();
  try {
    fetcher.mockImplementation(
      (_url: any, opts: any) =>
        new Promise((_resolve, reject) =>
          opts.signal.addEventListener("abort", () =>
            reject(opts.signal.reason),
          ),
        ),
    );
    const pending = send("infer", request);
    await vi.advanceTimersByTimeAsync(21000);
    expect((await pending).error.code).toBe("timeout");
  } finally {
    vi.useRealTimers();
  }
});
it("restart marks pending r1 interrupted without retry", async () => {
  session["job:r1"] = { status: "pending" };
  vi.resetModules();
  await import("../src/background");
  const r = await send("jobs");
  expect(r.data["job:r1"].status).toBe("interrupted");
  expect(fetcher).not.toHaveBeenCalled();
});

it("refuses settings downgrade without overwriting a newer schema", async () => {
  settings.version = 999;
  const reply = await send("saveSettings", { ...settings, version: 1 });
  expect(reply.status).toBe("error");
  expect(settings.version).toBe(999);
});

it("reports transport failures separately from malformed output", async () => {
  fetcher.mockRejectedValue(new TypeError("network failed"));
  expect((await send("infer", request)).error.code).toBe("network_error");
});

it("source navigation aborts its pending request", async () => {
  vi.mocked(chrome.scripting.executeScript).mockResolvedValue([
    { result: { generation: "g1" } },
  ] as any);
  fetcher.mockImplementation(
    (_url: any, opts: any) =>
      new Promise((_resolve, reject) =>
        opts.signal.addEventListener("abort", () => reject(opts.signal.reason)),
      ),
  );
  const pending = send("infer", {
    ...request,
    source: {
      tabId: 1,
      frameId: 0,
      generation: "g1",
      url: "https://excluded.example",
    },
  });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
  navigation(1, { status: "loading" });
  expect((await pending).error.code).toBe("stale_source");
});

it("catalog uses draft credentials without saving the active provider", async () => {
  const previous = { ...settings };
  fetcher.mockResolvedValue(
    new Response('{"data":[{"id":"claude/b"},{"id":"gpt/a"}]}'),
  );
  const response = await send("listModels", {
    endpoint: "http://127.0.0.1:8317/v1",
    key: "draft-secret",
  });
  expect(response.data).toEqual(["claude/b", "gpt/a"]);
  expect(settings).toEqual(previous);
  expect(fetcher).toHaveBeenCalledWith(
    "http://127.0.0.1:8317/v1/models",
    expect.objectContaining({
      headers: { Authorization: "Bearer draft-secret" },
    }),
  );
  expect(JSON.stringify(response)).not.toContain("draft-secret");
});
it("catalog denies missing permission and forged senders without traffic", async () => {
  const draft = { endpoint: "http://127.0.0.1:8317/v1", key: "synthetic" };
  allowed = false;
  expect((await send("listModels", draft)).error.code).toBe(
    "permission_denied",
  );
  allowed = true;
  expect(
    (
      await send("listModels", draft, {
        id: "testid",
        url: "https://evil.example",
        tab: { id: 1 },
      })
    ).error.code,
  ).toBe("permission_denied");
  expect(fetcher).not.toHaveBeenCalled();
});

it("rejects forged direct account actions", async () => {
  for (const type of [
    "chatgptStatus",
    "chatgptBegin",
    "chatgptFinish",
    "chatgptLogout",
  ]) {
    expect(
      (
        await send(type, undefined, {
          id: "testid",
          url: "https://evil.example",
        })
      ).error.code,
    ).toBe("permission_denied");
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it("automatic page widget registration sends no inference and cannot read secrets", async () => {
  const sender = {
    id: "testid",
    url: "https://excluded.example",
    frameId: 0,
    tab: { id: 9 },
  };
  expect((await send("inline", { action: "ready" }, sender)).status).toBe("ok");
  expect((await send("settings", undefined, sender)).error.code).toBe(
    "permission_denied",
  );
  expect((await send("inline", { action: "export" }, sender)).status).toBe(
    "error",
  );
  expect(
    (await send("inline", { action: "extract" }, { ...sender, frameId: 1 }))
      .error.code,
  ).toBe("permission_denied");
  expect(fetcher).not.toHaveBeenCalled();
});
