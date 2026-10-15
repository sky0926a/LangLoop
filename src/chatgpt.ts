import { z } from "zod";
import { Fault, contextLimitFault } from "./core";
const AUTH = "https://auth.openai.com";
const CLIENT = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CODEX = "https://chatgpt.com/backend-api/codex";
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
});
const states = new Map<
  string,
  { epoch: number; checking: boolean; refreshing?: Promise<string> }
>();
function stateFor(id: string) {
  if (!states.has(id)) states.set(id, { epoch: 0, checking: false });
  return states.get(id)!;
}
function authKey(id: string) {
  return id === "legacy" ? "codexAuth" : "codexAuth:" + id;
}
function pendingKey(id: string) {
  return id === "legacy" ? "codexPending" : "codexPending:" + id;
}
export async function boundedText(response: Response, limit = 250000) {
  const reader = response.body?.getReader();
  if (!reader) throw new Fault("invalid_response", "Empty response.");
  let bytes = 0,
    raw = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > limit)
        throw new Fault(
          "invalid_response",
          "Response exceeded the size limit.",
        );
      raw += decoder.decode(value, { stream: true });
    }
    return raw + decoder.decode();
  } finally {
    void reader.cancel().catch(() => {});
  }
}
async function authRequest(path: string, body: unknown, form = false) {
  try {
    const response = await fetch(AUTH + path, {
      method: "POST",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        "Content-Type": form
          ? "application/x-www-form-urlencoded"
          : "application/json",
      },
      body: form
        ? new URLSearchParams(body as Record<string, string>).toString()
        : JSON.stringify(body),
    });
    const raw = await boundedText(response);
    if (!response.ok) return { status: response.status, data: null };
    return { status: response.status, data: JSON.parse(raw) };
  } catch {
    throw new Fault(
      "authentication_failed",
      "Direct ChatGPT authorization could not complete. The service may reject browser access; no local proxy is used.",
    );
  }
}
export async function loginStatus(id = "legacy") {
  const { [authKey(id)]: codexAuth } = await chrome.storage.local.get(
    authKey(id),
  );
  const { [pendingKey(id)]: codexPending } = await chrome.storage.session.get(
    pendingKey(id),
  );
  return {
    signedIn: !!codexAuth?.access_token,
    userCode:
      codexPending?.expiresAt > Date.now() ? codexPending.userCode : undefined,
  };
}
export async function beginLogin(id = "legacy") {
  const revision = ++stateFor(id).epoch;
  await chrome.storage.session.remove(pendingKey(id));
  const r = await authRequest("/api/accounts/deviceauth/usercode", {
    client_id: CLIENT,
  });
  if (r.status !== 200)
    throw new Fault(
      "authentication_failed",
      `ChatGPT device authorization returned HTTP ${r.status}. Direct login is unavailable in this environment.`,
    );
  const v = z
    .object({
      device_auth_id: z.string().min(1),
      user_code: z.string().optional(),
      usercode: z.string().optional(),
      interval: z.union([z.string(), z.number()]).optional(),
    })
    .parse(r.data);
  const userCode = v.user_code || v.usercode;
  if (!userCode)
    throw new Fault("invalid_response", "No device code returned.");
  if (revision !== stateFor(id).epoch)
    throw new Fault("cancelled", "Login cancelled.");
  const interval = Math.min(60, Math.max(5, Number(v.interval) || 5)) * 1000;
  await chrome.storage.session.set({
    [pendingKey(id)]: {
      id: v.device_auth_id,
      userCode,
      interval,
      nextPoll: Date.now() + interval,
      expiresAt: Date.now() + 900000,
    },
  });
  return { userCode, url: AUTH + "/codex/device" };
}
export async function finishLogin(id = "legacy") {
  if (stateFor(id).checking)
    throw new Fault("rate_limited", "A login check is already running.");
  stateFor(id).checking = true;
  const revision = stateFor(id).epoch;
  try {
    const { [pendingKey(id)]: p } = await chrome.storage.session.get(
      pendingKey(id),
    );
    if (!p || p.expiresAt <= Date.now())
      throw new Fault("authentication_failed", "Login expired. Start again.");
    if (p.nextPoll > Date.now()) return { pending: true };
    await chrome.storage.session.set({
      [pendingKey(id)]: { ...p, nextPoll: Date.now() + p.interval },
    });
    const r = await authRequest("/api/accounts/deviceauth/token", {
      device_auth_id: p.id,
      user_code: p.userCode,
    });
    if (r.status === 403 || r.status === 404) return { pending: true };
    if (r.status !== 200)
      throw new Fault(
        "authentication_failed",
        `Login check returned HTTP ${r.status}. Start again.`,
      );
    const v = z
      .object({
        authorization_code: z.string().min(1),
        code_verifier: z.string().min(1),
      })
      .parse(r.data);
    const exchanged = await authRequest(
      "/oauth/token",
      {
        grant_type: "authorization_code",
        client_id: CLIENT,
        code: v.authorization_code,
        code_verifier: v.code_verifier,
        redirect_uri: AUTH + "/deviceauth/callback",
      },
      true,
    );
    if (exchanged.status !== 200)
      throw new Fault(
        "authentication_failed",
        "Token exchange failed. Start login again.",
      );
    const tokens = tokenSchema.parse(exchanged.data);
    if (revision !== stateFor(id).epoch)
      throw new Fault("cancelled", "Login cancelled.");
    await chrome.storage.local.set({
      [authKey(id)]: {
        ...tokens,
        expiresAt: Date.now() + tokens.expires_in * 1000,
      },
    });
    await chrome.storage.session.remove(pendingKey(id));
    return { pending: false, signedIn: true };
  } finally {
    stateFor(id).checking = false;
  }
}
export async function logout(id = "legacy") {
  stateFor(id).epoch++;
  await chrome.storage.local.remove(authKey(id));
  await chrome.storage.session.remove(pendingKey(id));
  return true;
}
export async function accessToken(id = "legacy"): Promise<string> {
  const revision = stateFor(id).epoch;
  const { [authKey(id)]: t } = await chrome.storage.local.get(authKey(id));
  if (revision !== stateFor(id).epoch)
    throw new Fault("cancelled", "Signed out.");
  if (!t) throw new Fault("authentication_failed", "Sign in to ChatGPT first.");
  if (t.expiresAt > Date.now() + 60000) return t.access_token;
  if (!stateFor(id).refreshing) {
    stateFor(id).refreshing = (async () => {
      const r = await authRequest(
        "/oauth/token",
        {
          grant_type: "refresh_token",
          client_id: CLIENT,
          refresh_token: t.refresh_token,
        },
        true,
      );
      if (r.status !== 200)
        throw new Fault(
          "authentication_failed",
          "ChatGPT session expired. Sign in again.",
        );
      const tokens = tokenSchema.parse({
        ...r.data,
        refresh_token: r.data?.refresh_token || t.refresh_token,
      });
      if (revision !== stateFor(id).epoch)
        throw new Fault("cancelled", "Signed out.");
      await chrome.storage.local.set({
        [authKey(id)]: {
          ...tokens,
          expiresAt: Date.now() + tokens.expires_in * 1000,
        },
      });
      return tokens.access_token;
    })().finally(() => {
      stateFor(id).refreshing = undefined;
    });
  }
  return stateFor(id).refreshing!;
}
export function accountHeader(token: string): Record<string, string> {
  try {
    const payload = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    const account = payload["https://api.openai.com/auth"]?.chatgpt_account_id;
    return typeof account === "string" ? { "ChatGPT-Account-Id": account } : {};
  } catch {
    return {};
  }
}
export function decodeCodexStream(raw: string): unknown {
  const completedItems = new Map<string | number, any>();
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const value = line.slice(5).trim();
    if (value === "[DONE]") continue;
    let event;
    try {
      event = JSON.parse(value);
    } catch {
      throw new Fault("invalid_response", "Invalid response event.");
    }
    if (
      ["error", "response.failed", "response.incomplete"].includes(event.type)
    ) {
      const limit = contextLimitFault(event.response?.error ?? event.error ?? event);
      if (limit) throw limit;
      throw new Fault(
        "invalid_response",
        "ChatGPT did not complete the response. Retry explicitly.",
      );
    }
    if (event.type === "response.output_item.done" && event.item) {
      completedItems.set(
        event.item.id ?? event.output_index ?? completedItems.size,
        event.item,
      );
    }
    if (event.type === "response.completed") {
      if (event.response?.status && event.response.status !== "completed")
        throw new Fault("invalid_response", "Incomplete response.");
      // Codex sends content in output_item.done; completion can contain only usage.
      const items = event.response?.output?.length
        ? event.response.output
        : [...completedItems.values()];
      const output = items
        .flatMap((item: any) => item.content || [])
        .filter((item: any) => item.type === "output_text")
        .map((item: any) => item.text)
        .join("");
      try {
        return JSON.parse(output);
      } catch {
        throw new Fault(
          "invalid_response",
          output
            ? "ChatGPT returned an unexpected language result. The response was not valid JSON."
            : "ChatGPT completed without language output. Retry or choose another model.",
        );
      }
    }
  }
  throw new Fault(
    "invalid_response",
    "No completed ChatGPT response received.",
  );
}

// Codex model discovery uses the upstream catalog protocol compatibility version.
export async function listAccountModels(id = "legacy"): Promise<string[]> {
  const revision = stateFor(id).epoch;
  const token = await accessToken(id);
  try {
    const response = await fetch(CODEX + "/models?client_version=0.149.0", {
      headers: { Authorization: `Bearer ${token}`, ...accountHeader(token) },
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 401 || response.status === 403)
      throw new Fault(
        "authentication_failed",
        "ChatGPT model access was denied. Sign out and sign in again.",
      );
    if (!response.ok)
      throw new Fault(
        "invalid_response",
        `Model discovery returned HTTP ${response.status}. Retry loading models.`,
      );
    const data = z
      .object({
        models: z
          .array(
            z.object({
              slug: z.string().min(1).max(256),
              visibility: z.string(),
              priority: z.number().optional(),
            }),
          )
          .max(2000),
      })
      .parse(JSON.parse(await boundedText(response, 5000000)));
    if (revision !== stateFor(id).epoch)
      throw new Fault("cancelled", "Account changed. Reload models.");
    return [
      ...new Set(
        data.models
          .filter((m) => m.visibility === "list")
          .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
          .map((m) => m.slug),
      ),
    ];
  } catch (error) {
    if (error instanceof Fault) throw error;
    throw new Fault(
      "invalid_response",
      "Could not load ChatGPT models. Retry or enter a model manually.",
    );
  }
}
