import { beforeEach, expect, it, vi } from "vitest";
import {
  oauthBegin,
  oauthFinish,
  oauthLogout,
  oauthAccessToken,
} from "../src/oauth";
let local: Record<string, any>, session: Record<string, any>;
beforeEach(() => {
  local = {};
  session = {};
  const area = (d: Record<string, any>) => ({
    get: async (k: string) => ({ [k]: d[k] }),
    set: async (v: any) => Object.assign(d, v),
    remove: async (k: string) => {
      delete d[k];
    },
  });
  vi.stubGlobal("chrome", {
    storage: { local: area(local), session: area(session) },
  });
  vi.stubGlobal("fetch", vi.fn());
});
const response = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status });
const device = {
  device_code: "private-code",
  user_code: "ABC",
  verification_uri: "https://auth.kimi.com/activate",
  expires_in: 600,
  interval: 5,
};
it("device flow enforces interval and separates accounts", async () => {
  const id = crypto.randomUUID();
  vi.mocked(fetch).mockResolvedValueOnce(response(device));
  expect(await oauthBegin(id, "kimi")).toMatchObject({ userCode: "ABC" });
  expect(await oauthFinish(id, "kimi")).toEqual({ pending: true });
  expect(fetch).toHaveBeenCalledTimes(1);
  session["oauthPending:" + id].nextPoll = 0;
  vi.mocked(fetch).mockResolvedValueOnce(
    response({
      access_token: "access",
      refresh_token: "refresh",
      expires_in: 3600,
    }),
  );
  await oauthFinish(id, "kimi");
  expect(await oauthAccessToken(id, "kimi")).toBe("access");
  await expect(oauthAccessToken("other", "kimi")).rejects.toThrow();
  await expect(oauthAccessToken(id, "xai")).rejects.toThrow();
});
it("rejects hostile device verification and discovery destinations", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    response({ ...device, verification_uri: "https://evil.example/activate" }),
  );
  await expect(oauthBegin(crypto.randomUUID(), "kimi")).rejects.toThrow(
    "Untrusted",
  );
  vi.mocked(fetch).mockResolvedValueOnce(
    response({
      device_authorization_endpoint: "https://evil.example/device",
      token_endpoint: "https://auth.x.ai/token",
    }),
  );
  await expect(oauthBegin(crypto.randomUUID(), "xai")).rejects.toThrow(
    "Untrusted",
  );
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("late slow_down cannot resurrect cancelled pending login", async () => {
  const id = crypto.randomUUID();
  vi.mocked(fetch).mockResolvedValueOnce(response(device));
  await oauthBegin(id, "kimi");
  session["oauthPending:" + id].nextPoll = 0;
  let finish!: (r: Response) => void;
  vi.mocked(fetch).mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  const pending = oauthFinish(id, "kimi");
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  await oauthLogout(id);
  finish(response({ error: "slow_down" }, 400));
  await expect(pending).rejects.toThrow("cancelled");
  expect(session["oauthPending:" + id]).toBeUndefined();
});
