import { it, expect, vi } from "vitest";
import { listModels } from "../src/provider";
const draft = {
  endpoint: "http://127.0.0.1:8317/v1",
  key: "synthetic-client-key",
};
it("loads catalog with scoped headers, no cookies and no redirects", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "gpt/a" }] })),
    );
  expect(await listModels(draft, fetcher)).toEqual(["gpt/a"]);
  expect(fetcher).toHaveBeenCalledWith(
    draft.endpoint + "/models",
    expect.objectContaining({
      method: "GET",
      redirect: "error",
      credentials: "omit",
      headers: { Authorization: "Bearer synthetic-client-key" },
    }),
  );
});
it.each([
  [401, "authentication_failed"],
  [403, "authentication_failed"],
  [429, "rate_limited"],
  [500, "provider_error"],
])("maps HTTP %s without leaking bodies", async (status, code) => {
  await expect(
    listModels(
      draft,
      vi
        .fn()
        .mockResolvedValue(
          new Response("synthetic-secret-body", { status: status as number }),
        ),
    ),
  ).rejects.toMatchObject({ code });
});
it("rejects oversized and invalid catalog responses", async () => {
  for (const raw of [
    "x".repeat(250001),
    "<html>error</html>",
    '{"data":[{}]}',
  ]) {
    await expect(
      listModels(draft, vi.fn().mockResolvedValue(new Response(raw))),
    ).rejects.toMatchObject({ code: "invalid_response" });
  }
});
it("maps fetch or redirect failures without leaking transport text", async () => {
  await expect(
    listModels(draft, vi.fn().mockRejectedValue(new Error("synthetic-secret"))),
  ).rejects.toMatchObject({
    code: "network_error",
    message: expect.not.stringContaining("synthetic-secret"),
  });
});
it("bounds a hanging request at ten seconds", async () => {
  vi.useFakeTimers();
  try {
    const fetcher = vi.fn(
      (_url, options) =>
        new Promise<Response>((_resolve, reject) =>
          options.signal.addEventListener("abort", () =>
            reject(options.signal.reason),
          ),
        ),
    );
    const result = expect(listModels(draft, fetcher)).rejects.toMatchObject({
      code: "timeout",
    });
    await vi.advanceTimersByTimeAsync(10000);
    await result;
  } finally {
    vi.useRealTimers();
  }
});
