import { beforeEach, expect, it, vi } from "vitest";
import {
  codeBegin,
  codeComplete,
  codeLogout,
  codeAccessToken,
  codeProviders,
} from "../src/oauth-code";
let local: Record<string, any>, session: Record<string, any>;
beforeEach(() => {
  local = {};
  session = {};
  const area = (d: Record<string, any>) => ({
    get: async (k: string | null) => (k ? { [k]: d[k] } : d),
    set: async (v: any) => Object.assign(d, v),
    remove: async (k: string) => {
      delete d[k];
    },
  });
  vi.stubGlobal("chrome", {
    storage: { local: area(local), session: area(session) },
    tabs: {
      create: vi.fn(async () => ({ id: 42 })),
      update: vi.fn(async () => ({})),
      get: vi.fn(async () => ({ url: "about:blank" })),
      remove: vi.fn(async () => {}),
    },
  });
  vi.stubGlobal("fetch", vi.fn());
});
for (const provider of ["claude", "antigravity", "devin"] as const) {
  it(`${provider} uses PKCE and bound single-use callbacks without a server`, async () => {
    const id = crypto.randomUUID();
    await codeBegin(id, provider);
    const p = session["codePending:" + id];
    const auth = new URL(vi.mocked(chrome.tabs.update).mock.calls[0][1]!.url!);
    expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
    expect(auth.searchParams.get("code_challenge")).not.toBe(p.verifier);
    const callback =
      codeProviders[provider].redirect + "?code=test&state=" + p.state;
    await expect(
      codeComplete(id, callback.replace(p.state, "wrong"), 42),
    ).rejects.toThrow("did not match");
    await expect(codeComplete(id, callback, 43)).rejects.toThrow(
      "did not match",
    );
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          provider === "devin"
            ? { token: "test-access" }
            : {
                access_token: "test-access",
                refresh_token: "test-refresh",
                expires_in: 3600,
              },
        ),
      ),
    );
    await codeComplete(id, callback, 42);
    expect(await codeAccessToken(id, provider)).toBe("test-access");
    await expect(codeComplete(id, callback, 42)).rejects.toThrow("expired");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      codeProviders[provider].token,
    );
  });
}
it("logout while token exchange is in flight cannot restore credentials", async () => {
  const id = crypto.randomUUID();
  await codeBegin(id, "claude");
  const p = session["codePending:" + id];
  let finish!: (r: Response) => void;
  vi.mocked(fetch).mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  const done = codeComplete(
    id,
    codeProviders.claude.redirect + "?code=test&state=" + p.state,
    42,
  );
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  await codeLogout(id);
  finish(
    new Response(
      JSON.stringify({
        access_token: "late",
        refresh_token: "late",
        expires_in: 3600,
      }),
    ),
  );
  await expect(done).rejects.toThrow("cancelled");
  expect(local["codeAuth:" + id]).toBeUndefined();
});
