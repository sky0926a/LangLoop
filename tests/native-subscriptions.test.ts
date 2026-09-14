import { expect, it } from "vitest";
import { decodeDevin, devinText } from "../src/native-subscriptions";
function frame(flag: number, bytes: Uint8Array) {
  const result = new Uint8Array(bytes.length + 5);
  result[0] = flag;
  new DataView(result.buffer).setUint32(1, bytes.length);
  result.set(bytes, 5);
  return result;
}
const encode = (s: string) => new TextEncoder().encode(s);
it("assembles text frames only after a successful terminal frame", async () => {
  const text = encode('{"ok":true}');
  const proto = new Uint8Array([26, text.length, ...text]);
  const a = frame(0, proto),
    b = frame(2, encode("{}"));
  expect(await decodeDevin(new Response(new Uint8Array([...a, ...b])))).toEqual(
    { ok: true },
  );
  await expect(decodeDevin(new Response(a))).rejects.toThrow("Incomplete");
  await expect(
    decodeDevin(
      new Response(
        new Uint8Array([
          ...a,
          ...frame(2, encode('{"error":{"message":"private"}}')),
        ]),
      ),
    ),
  ).rejects.toThrow("terminal error");
});
it("rejects truncated frames and malformed protobuf fields", async () => {
  await expect(
    decodeDevin(new Response(new Uint8Array([0, 0, 0, 1, 0]))),
  ).rejects.toThrow();
  expect(() => devinText(new Uint8Array([26, 127]))).toThrow();
  expect(() =>
    devinText(
      new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255, 255, 255]),
    ),
  ).toThrow();
});

it("Antigravity uses a provisioned project and rejects incomplete output", async () => {
  const { nativeInference } = await import("../src/native-subscriptions");
  const { vi } = await import("vitest");
  const run = async (finishReason: string) => {
    const fetcher = vi.fn<typeof fetch>();
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ cloudaicompanionProject: { id: "project" } }),
      ),
    );
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          response: {
            candidates: [
              { finishReason, content: { parts: [{ text: '{"ok":true}' }] } },
            ],
          },
        }),
      ),
    );
    const result = nativeInference(
      "antigravity",
      "test-token",
      "account",
      "model",
      "system",
      "prompt",
      new AbortController().signal,
      fetcher,
    );
    if (finishReason === "STOP") {
      expect(await result).toEqual({ ok: true });
      expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string).project).toBe(
        "project",
      );
    } else await expect(result).rejects.toThrow("did not finish");
    expect(
      fetcher.mock.calls.every(
        ([url, options]) =>
          String(url).startsWith("https://cloudcode-pa.googleapis.com/") &&
          options?.redirect === "error" &&
          options?.credentials === "omit",
      ),
    ).toBe(true);
  };
  await run("STOP");
  await run("MAX_TOKENS");
});
