import { z } from "zod";
import { Fault } from "./core";
import { boundedText } from "./chatgpt";
// Public installed-client protocol constants from the pinned CLIProxyAPI MIT reference.
export const codeProviders = {
  claude: {
    name: "Claude",
    authorize: "https://claude.ai/oauth/authorize",
    token: "https://platform.claude.com/v1/oauth/token",
    client: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    redirect: "http://localhost:54545/callback",
    scope:
      "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
    secret: "",
    api: "https://api.anthropic.com/v1",
  },
  antigravity: {
    name: "Antigravity",
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    client:
      "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
    redirect: "http://localhost:51121/oauth-callback",
    scope:
      "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
    secret: "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",
    api: "https://cloudcode-pa.googleapis.com",
  },
  devin: {
    name: "Devin",
    authorize: "https://app.devin.ai/auth/cli/continue",
    token: "https://api.devin.ai/auth/cli/token",
    client: "",
    redirect: "http://localhost:53427/callback",
    scope: "",
    secret: "",
    api: "https://server.codeium.com",
  },
} as const;
export type CodeProvider = keyof typeof codeProviders;
const epoch = new Map<string, number>();
const running = new Set<string>();
const refreshing = new Map<string, Promise<string>>();
const tokenKey = (id: string) => "codeAuth:" + id;
const pendingKey = (id: string) => "codePending:" + id;
const revision = (id: string) => epoch.get(id) || 0;
function random() {
  return btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
async function request(provider: CodeProvider, data: Record<string, string>) {
  const form = provider === "antigravity";
  const response = await fetch(codeProviders[provider].token, {
    method: "POST",
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers: {
      "Content-Type": form
        ? "application/x-www-form-urlencoded"
        : "application/json",
    },
    body: form ? new URLSearchParams(data).toString() : JSON.stringify(data),
  });
  if (!response.ok)
    throw new Fault(
      "authentication_failed",
      `Token exchange returned HTTP ${response.status}.`,
    );
  try {
    return JSON.parse(await boundedText(response, 100000));
  } catch {
    throw new Fault("authentication_failed", "Invalid token response.");
  }
}
export async function codeStatus(id: string) {
  const auth = (await chrome.storage.local.get(tokenKey(id)))[tokenKey(id)];
  const pending = (await chrome.storage.session.get(pendingKey(id)))[
    pendingKey(id)
  ];
  return {
    signedIn: !!auth?.access_token,
    waiting: pending?.expiresAt > Date.now(),
    error: (await chrome.storage.session.get("codeError:" + id))[
      "codeError:" + id
    ],
  };
}
export async function codeLogout(id: string) {
  epoch.set(id, revision(id) + 1);
  await chrome.storage.session.remove("codeError:" + id);
  await chrome.storage.session.remove(pendingKey(id));
  await chrome.storage.local.remove(tokenKey(id));
}
export async function codeBegin(id: string, provider: CodeProvider) {
  epoch.set(id, revision(id) + 1);
  const rev = revision(id);
  await chrome.storage.session.remove("codeError:" + id);
  const config = codeProviders[provider],
    state = random(),
    verifier = random();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const url = new URL(config.authorize);
  for (const [k, v] of Object.entries({
    redirect_uri: config.redirect,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    response_type: "code",
    ...(config.client ? { client_id: config.client } : {}),
    ...(config.scope ? { scope: config.scope } : {}),
    ...(provider === "antigravity"
      ? { access_type: "offline", prompt: "consent" }
      : { prompt: "select_account" }),
  }))
    url.searchParams.set(k, v);
  const tab = await chrome.tabs.create({ url: "about:blank", active: true });
  if (tab.id === undefined || rev !== revision(id))
    throw new Fault("cancelled", "Login cancelled.");
  await chrome.storage.session.set({
    [pendingKey(id)]: {
      provider,
      state,
      verifier,
      tabId: tab.id,
      expiresAt: Date.now() + 900000,
    },
  });
  await chrome.tabs.update(tab.id, { url: url.href });
  return { waiting: true };
}
export async function codeComplete(
  id: string,
  callback: string,
  tabId?: number,
) {
  const rev = revision(id);
  const p = (await chrome.storage.session.get(pendingKey(id)))[pendingKey(id)];
  if (rev !== revision(id)) throw new Fault("cancelled", "Login cancelled.");
  if (!p || p.expiresAt < Date.now() || !(p.provider in codeProviders))
    throw new Fault("authentication_failed", "Login expired. Start again.");
  const provider = p.provider as CodeProvider,
    config = codeProviders[provider],
    url = new URL(callback),
    redirect = new URL(config.redirect);
  if (
    url.origin !== redirect.origin ||
    url.pathname !== redirect.pathname ||
    url.username ||
    url.password ||
    url.searchParams.get("state") !== p.state ||
    (tabId !== undefined && tabId !== p.tabId)
  )
    throw new Fault(
      "authentication_failed",
      "Authorization callback did not match this login.",
    );
  const code = url.searchParams.get("code");
  if (!code || url.searchParams.has("error"))
    throw new Fault(
      "authentication_failed",
      "Authorization was not completed.",
    );
  if (running.has(id)) return { pending: true };
  running.add(id);
  try {
    // Consume the callback before exchanging: failed/duplicate callbacks require a new login.
    await chrome.storage.session.remove(pendingKey(id));
    const data = await request(
      provider,
      provider === "devin"
        ? { code, code_verifier: p.verifier }
        : {
            grant_type: "authorization_code",
            code,
            code_verifier: p.verifier,
            redirect_uri: config.redirect,
            client_id: config.client,
            state: p.state,
            ...(config.secret ? { client_secret: config.secret } : {}),
          },
    );
    const auth =
      provider === "devin"
        ? {
            access_token: z.string().min(1).max(20000).parse(data.token),
            refresh_token: "",
            expires_in: 3600,
          }
        : z
            .object({
              access_token: z.string().min(1).max(20000),
              refresh_token: z.string().min(1).max(20000),
              expires_in: z.number().positive().max(31536000),
            })
            .parse(data);
    if (rev !== revision(id)) throw new Fault("cancelled", "Login cancelled.");
    await chrome.storage.local.set({
      [tokenKey(id)]: {
        ...auth,
        provider,
        expiresAt: Date.now() + auth.expires_in * 1000,
      },
    });
    // Do not close a tab that the user has navigated away from the callback.
    const tab = await chrome.tabs.get(p.tabId).catch(() => null);
    if (tab?.url === callback) await chrome.tabs.remove(p.tabId);
    return { signedIn: true };
  } catch (error) {
    if (rev === revision(id))
      await chrome.storage.session.set({
        ["codeError:" + id]: "Authorization failed. Start sign-in again.",
      });
    throw error;
  } finally {
    running.delete(id);
  }
}
export async function receiveCodeCallback(tabId: number, url: string) {
  const parsed = new URL(url);
  if (
    !Object.values(codeProviders).some(
      (p) => parsed.origin + parsed.pathname === p.redirect,
    )
  )
    return;
  const all = await chrome.storage.session.get(null);
  for (const [key, p] of Object.entries(all)) {
    if (!key.startsWith("codePending:") || p.tabId !== tabId) continue;
    await codeComplete(key.slice("codePending:".length), url, tabId);
  }
}
export async function codeAccessToken(
  id: string,
  provider: CodeProvider,
): Promise<string> {
  const rev = revision(id);
  const saved = (await chrome.storage.local.get(tokenKey(id)))[tokenKey(id)];
  if (rev !== revision(id)) throw new Fault("cancelled", "Signed out.");
  if (!saved || saved.provider !== provider)
    throw new Fault(
      "authentication_failed",
      "Sign in to this connection first.",
    );
  if (saved.expiresAt > Date.now() + 60000) return saved.access_token;
  if (!saved.refresh_token)
    throw new Fault("authentication_failed", "Session expired. Sign in again.");
  if (!refreshing.has(id)) {
    const config = codeProviders[provider];
    refreshing.set(
      id,
      (async () => {
        const data = await request(provider, {
          grant_type: "refresh_token",
          refresh_token: saved.refresh_token,
          client_id: config.client,
          ...(config.secret ? { client_secret: config.secret } : {}),
        });
        const next = z
          .object({
            access_token: z.string().min(1).max(20000),
            refresh_token: z.string().min(1).max(20000),
            expires_in: z.number().positive().max(31536000),
          })
          .parse({
            ...data,
            refresh_token: data.refresh_token || saved.refresh_token,
          });
        if (rev !== revision(id)) throw new Fault("cancelled", "Signed out.");
        await chrome.storage.local.set({
          [tokenKey(id)]: {
            ...saved,
            ...next,
            expiresAt: Date.now() + next.expires_in * 1000,
          },
        });
        return next.access_token;
      })().finally(() => refreshing.delete(id)),
    );
  }
  return refreshing.get(id)!;
}
