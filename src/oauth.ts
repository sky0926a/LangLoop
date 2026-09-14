// Protocol reference: CLIProxyAPI 7fa443dc8bf8ca2f1ffd81c2472deb31b097b697 (MIT).
// Fixed provider endpoints. No caller-supplied token endpoint or credential redirect.
import { z } from "zod";
import { Fault } from "./core";
import { boundedText } from "./chatgpt";
export const oauthProviders = {
  kimi: {
    name: "Kimi Code",
    client: "17e5f671-d194-4dfb-9706-5516cb48c098",
    device: "https://auth.kimi.com/api/oauth/device_authorization",
    token: "https://auth.kimi.com/api/oauth/token",
    scope: "",
    api: "https://api.kimi.com/coding/v1",
    allowed: ["auth.kimi.com", "www.kimi.com", "kimi.com"],
  },
  xai: {
    name: "Grok",
    client: "b1a00492-073a-47ea-816f-4c329264a828",
    device: "https://auth.x.ai/oauth2/device_authorization",
    token: "https://auth.x.ai/oauth2/token",
    scope: "openid profile email offline_access grok-cli:access api:access",
    api: "https://cli-chat-proxy.grok.com/v1",
    allowed: ["auth.x.ai"],
  },
} as const;
export type OAuthProvider = keyof typeof oauthProviders;
const tokenSchema = z.object({
  access_token: z.string().min(1).max(20000),
  refresh_token: z.string().min(1).max(20000),
  expires_in: z.number().positive().max(31536000),
});
const states = new Map<
  string,
  { epoch: number; checking: boolean; refresh?: Promise<string> }
>();
function state(id: string) {
  if (!states.has(id)) states.set(id, { epoch: 0, checking: false });
  return states.get(id)!;
}
const key = (id: string) => "oauth:" + id;
const pendingKey = (id: string) => "oauthPending:" + id;
async function post(
  url: string,
  data: Record<string, string>,
  id: string,
  provider: OAuthProvider,
) {
  const target = new URL(url);
  if (
    target.origin !== new URL(oauthProviders[provider].token).origin ||
    target.username ||
    target.password
  )
    throw new Fault("authentication_failed", "Untrusted OAuth endpoint.");
  const response = await fetch(url, {
    method: "POST",
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      ...(provider === "kimi"
        ? { "X-Msh-Platform": "LangLoop", "X-Msh-Device-Id": id }
        : {}),
    },
    body: new URLSearchParams(data).toString(),
  });
  const raw = await boundedText(response, 100000);
  try {
    return { ok: response.ok, status: response.status, data: JSON.parse(raw) };
  } catch {
    throw new Fault(
      "authentication_failed",
      "The authorization service returned an invalid response.",
    );
  }
}
export async function oauthStatus(id: string) {
  const auth = (await chrome.storage.local.get(key(id)))[key(id)];
  const pending = (await chrome.storage.session.get(pendingKey(id)))[
    pendingKey(id)
  ];
  return {
    signedIn: !!auth?.access_token,
    userCode: pending?.expiresAt > Date.now() ? pending.userCode : undefined,
  };
}
export async function oauthBegin(id: string, provider: OAuthProvider) {
  const revision = ++state(id).epoch,
    config = oauthProviders[provider];
  await chrome.storage.session.remove(pendingKey(id));
  let device: string = config.device;
  let token: string = config.token;
  if (provider === "xai") {
    const r = await fetch(
      "https://auth.x.ai/.well-known/openid-configuration",
      {
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!r.ok)
      throw new Fault(
        "authentication_failed",
        "Could not discover Grok authorization endpoints.",
      );
    const discovered = z
      .object({
        device_authorization_endpoint: z.string().url(),
        token_endpoint: z.string().url(),
      })
      .parse(JSON.parse(await boundedText(r, 100000)));
    for (const endpoint of [
      discovered.device_authorization_endpoint,
      discovered.token_endpoint,
    ]) {
      const u = new URL(endpoint);
      if (u.origin !== "https://auth.x.ai" || u.username || u.password)
        throw new Fault(
          "authentication_failed",
          "Untrusted OAuth discovery endpoint.",
        );
    }
    device = discovered.device_authorization_endpoint;
    token = discovered.token_endpoint;
  }
  const r = await post(
    device,
    {
      client_id: config.client,
      ...(config.scope ? { scope: config.scope } : {}),
    },
    id,
    provider,
  );
  if (!r.ok)
    throw new Fault(
      "authentication_failed",
      `Device authorization returned HTTP ${r.status}.`,
    );
  const v = z
    .object({
      device_code: z.string().min(1).max(20000),
      user_code: z.string().min(1).max(256),
      verification_uri: z.string().url(),
      verification_uri_complete: z.string().url().optional(),
      expires_in: z.number().positive().max(1800),
      interval: z.number().positive().optional(),
    })
    .parse(r.data);
  const url = new URL(v.verification_uri_complete || v.verification_uri);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !(config.allowed as readonly string[]).includes(url.hostname)
  )
    throw new Fault("authentication_failed", "Untrusted authorization page.");
  if (revision !== state(id).epoch)
    throw new Fault("cancelled", "Login cancelled.");
  const interval = Math.max(5000, Math.min(60000, (v.interval || 5) * 1000));
  await chrome.storage.session.set({
    [pendingKey(id)]: {
      provider,
      deviceCode: v.device_code,
      userCode: v.user_code,
      token,
      expiresAt: Date.now() + v.expires_in * 1000,
      interval,
      nextPoll: Date.now() + interval,
    },
  });
  return { userCode: v.user_code, url: url.href };
}
export async function oauthFinish(id: string, provider: OAuthProvider) {
  const st = state(id),
    revision = st.epoch;
  if (st.checking)
    throw new Fault("rate_limited", "A login check is already running.");
  st.checking = true;
  try {
    const p = (await chrome.storage.session.get(pendingKey(id)))[
      pendingKey(id)
    ];
    if (!p || p.provider !== provider || p.expiresAt < Date.now())
      throw new Fault("authentication_failed", "Login expired. Start again.");
    if (p.nextPoll > Date.now()) return { pending: true };
    await chrome.storage.session.set({
      [pendingKey(id)]: { ...p, nextPoll: Date.now() + p.interval },
    });
    const r = await post(
      p.token,
      {
        client_id: oauthProviders[provider].client,
        device_code: p.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      },
      id,
      provider,
    );
    if (revision !== st.epoch) throw new Fault("cancelled", "Login cancelled.");
    if (["authorization_pending", "slow_down"].includes(r.data.error)) {
      if (r.data.error === "slow_down")
        await chrome.storage.session.set({
          [pendingKey(id)]: {
            ...p,
            interval: p.interval + 5000,
            nextPoll: Date.now() + p.interval + 5000,
          },
        });
      return { pending: true };
    }
    if (!r.ok)
      throw new Fault(
        "authentication_failed",
        `Login check returned HTTP ${r.status}. Start again.`,
      );
    const t = tokenSchema.parse(r.data);
    if (revision !== st.epoch) throw new Fault("cancelled", "Login cancelled.");
    await chrome.storage.local.set({
      [key(id)]: {
        ...t,
        provider,
        tokenEndpoint: p.token,
        expiresAt: Date.now() + t.expires_in * 1000,
      },
    });
    await chrome.storage.session.remove(pendingKey(id));
    return { pending: false, signedIn: true };
  } finally {
    st.checking = false;
  }
}
export async function oauthLogout(id: string) {
  state(id).epoch++;
  await chrome.storage.session.remove(pendingKey(id));
  await chrome.storage.local.remove(key(id));
}
export async function oauthAccessToken(id: string, provider: OAuthProvider) {
  const st = state(id);
  const revision = st.epoch;
  const saved = (await chrome.storage.local.get(key(id)))[key(id)];
  if (revision !== st.epoch) throw new Fault("cancelled", "Signed out.");
  if (!saved || saved.provider !== provider)
    throw new Fault(
      "authentication_failed",
      "Sign in to this connection first.",
    );
  if (saved.expiresAt > Date.now() + 60000) return saved.access_token as string;
  if (!st.refresh) {
    st.refresh = (async () => {
      const endpoint = new URL(saved.tokenEndpoint);
      if (
        endpoint.origin !== new URL(oauthProviders[provider].token).origin ||
        endpoint.username ||
        endpoint.password
      )
        throw new Fault("authentication_failed", "Untrusted token endpoint.");
      const r = await post(
        endpoint.href,
        {
          client_id: oauthProviders[provider].client,
          refresh_token: saved.refresh_token,
          grant_type: "refresh_token",
        },
        id,
        provider,
      );
      if (!r.ok)
        throw new Fault(
          "authentication_failed",
          "Session expired. Sign in again.",
        );
      const t = tokenSchema.parse({
        ...r.data,
        refresh_token: r.data.refresh_token || saved.refresh_token,
      });
      if (revision !== st.epoch) throw new Fault("cancelled", "Signed out.");
      await chrome.storage.local.set({
        [key(id)]: {
          ...saved,
          ...t,
          expiresAt: Date.now() + t.expires_in * 1000,
        },
      });
      return t.access_token;
    })().finally(() => {
      st.refresh = undefined;
    });
  }
  return st.refresh;
}
