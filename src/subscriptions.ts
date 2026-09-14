import { boundedText } from "./chatgpt";
import {
  oauthProviders,
  oauthStatus,
  oauthBegin,
  oauthFinish,
  oauthLogout,
  oauthAccessToken,
  type OAuthProvider,
} from "./oauth";
import {
  codeProviders,
  codeStatus,
  codeBegin,
  codeComplete,
  codeLogout,
  codeAccessToken,
  type CodeProvider,
} from "./oauth-code";
export const subscriptions = { ...oauthProviders, ...codeProviders };
export type Subscription = keyof typeof subscriptions;
export function isSubscription(value: string): value is Subscription {
  return Object.hasOwn(subscriptions, value);
}
export const subscriptionStatus = (id: string, p: Subscription) =>
  p in oauthProviders ? oauthStatus(id) : codeStatus(id);
export const subscriptionBegin = (id: string, p: Subscription) =>
  p in oauthProviders
    ? oauthBegin(id, p as OAuthProvider)
    : codeBegin(id, p as CodeProvider);
export const subscriptionFinish = (
  id: string,
  p: Subscription,
  callback?: string,
) =>
  p in oauthProviders
    ? oauthFinish(id, p as OAuthProvider)
    : callback
      ? codeComplete(id, callback)
      : codeStatus(id);
export const subscriptionLogout = (id: string, p: Subscription) =>
  p in oauthProviders ? oauthLogout(id) : codeLogout(id);
export const subscriptionToken = (id: string, p: Subscription) =>
  p in oauthProviders
    ? oauthAccessToken(id, p as OAuthProvider)
    : codeAccessToken(id, p as CodeProvider);
export async function subscriptionModels(
  id: string,
  p: Subscription,
): Promise<string[]> {
  if (p === "devin") return [];
  const token = await subscriptionToken(id, p);
  const response = await fetch(
    subscriptions[p].api +
      (p === "antigravity" ? "/v1internal:fetchAvailableModels" : "/models"),
    {
      method: p === "antigravity" ? "POST" : "GET",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(p === "claude"
          ? {
              "anthropic-version": "2023-06-01",
              "anthropic-beta": "oauth-2025-04-20",
            }
          : {}),
      },
      ...(p === "antigravity" ? { body: "{}" } : {}),
    },
  );
  if (!response.ok)
    throw new Error(`Model lookup returned HTTP ${response.status}.`);
  const data = JSON.parse(await boundedText(response, 1000000));
  const ids =
    p === "antigravity"
      ? Object.keys(data.models ?? {})
      : (data.data ?? []).map((m: any) => m.id);
  if (
    !Array.isArray(ids) ||
    ids.length > 2000 ||
    ids.some((id: any) => typeof id !== "string" || id.length > 256)
  )
    throw new Error("Invalid model catalog.");
  return [...new Set(ids)] as string[];
}
