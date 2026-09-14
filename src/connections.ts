import { logout } from "./chatgpt";
import { oauthLogout } from "./oauth";
import { codeLogout } from "./oauth-code";
import { subscriptions, isSubscription } from "./subscriptions";
import { z } from "zod";
import {
  defaults,
  validateDomains,
  endpointUrl,
  managementUrl,
  settingsSchema,
  type Settings,
} from "./core";
import { readSettings } from "./storage";
const fields = settingsSchema
  .pick({
    setupKind: true,
    endpoint: true,
    model: true,
    key: true,
    managementPath: true,
  })
  .strip();
export const connectionSchema = fields.extend({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(64),
});
export type Connection = z.infer<typeof connectionSchema>;
let initialization: Promise<Connection[]> | undefined;
export async function listConnections(): Promise<Connection[]> {
  const { connections } = await chrome.storage.local.get("connections");
  if (connections)
    return z
      .array(connectionSchema)
      .min(1)
      .max(50)
      .refine(
        (xs) => new Set(xs.map((x) => x.id)).size === xs.length,
        "Duplicate connection IDs",
      )
      .parse(connections);
  if (!initialization)
    initialization = initializeConnections().finally(() => {
      initialization = undefined;
    });
  return initialization;
}
async function initializeConnections(): Promise<Connection[]> {
  const { connections } = await chrome.storage.local.get("connections");
  if (connections) return z.array(connectionSchema).max(50).parse(connections);
  const s = await readSettings();
  const initial = [
    connectionSchema.parse({
      ...fields.parse(s),
      id: s.connectionId,
      name: "My connection",
    }),
  ];
  await chrome.storage.local.set({ connections: initial });
  return initial;
}
async function saveConnectionSettingsImpl(settings: Settings) {
  settings = settingsSchema.parse(settings);
  settings.excluded = validateDomains(settings.excluded);
  endpointUrl(settings.endpoint);
  managementUrl(settings.endpoint, settings.managementPath);
  if ((await readSettings()).connectionId !== settings.connectionId)
    throw new Error(
      "Active connection changed. Reload settings before saving.",
    );
  const entries = await listConnections();
  const next = entries.map((entry) =>
    entry.id === settings.connectionId
      ? { ...entry, ...fields.parse(settings) }
      : entry,
  );
  if (!next.some((e) => e.id === settings.connectionId))
    throw new Error("Connection no longer exists.");
  await chrome.storage.local.set({ connections: next, settings });
  return settings;
}
async function createConnectionImpl(value: unknown) {
  const input = z
    .object({
      name: z.string().trim().max(64).optional(),
      setupKind: settingsSchema.shape.setupKind,
    })
    .strict()
    .parse(value);
  const entries = await listConnections();
  if (entries.length >= 50) throw new Error("Maximum 50 connections.");
  let number = 1;
  while (entries.some((e) => e.name === `Agent ${number}`)) number++;
  const item = connectionSchema.parse({
    ...fields.parse(defaults),
    ...input,
    name: input.name || `Agent ${number}`,
    id: crypto.randomUUID(),
    model: "",
    key: "",
    endpoint:
      input.setupKind === "ollama"
        ? "http://localhost:11434/v1"
        : input.setupKind === "custom"
          ? "https://api.openai.com/v1"
          : isSubscription(input.setupKind)
            ? subscriptions[input.setupKind].api
            : defaults.endpoint,
  });
  await chrome.storage.local.set({ connections: [...entries, item] });
  return item;
}
async function selectConnectionImpl(id: unknown) {
  const valid = z.string().min(1).max(64).parse(id);
  const entry = (await listConnections()).find((e) => e.id === valid);
  if (!entry) throw new Error("Connection no longer exists.");
  const settings = {
    ...(await readSettings()),
    ...fields.parse(entry),
    connectionId: entry.id,
  };
  endpointUrl(settings.endpoint);
  managementUrl(settings.endpoint, settings.managementPath);
  await chrome.storage.local.set({ settings });
  return settings;
}
async function renameConnectionImpl(value: unknown) {
  const { id, name } = connectionSchema
    .pick({ id: true, name: true })
    .parse(value);
  const entries = await listConnections();
  if (!entries.some((e) => e.id === id))
    throw new Error("Connection no longer exists.");
  await chrome.storage.local.set({
    connections: entries.map((e) => (e.id === id ? { ...e, name } : e)),
  });
}

let mutations: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = mutations.then(fn, fn);
  mutations = next.catch(() => {});
  return next;
}
export const saveConnectionSettings = (s: Settings) =>
  serialize(() => saveConnectionSettingsImpl(s));
export const createConnection = (v: unknown) =>
  serialize(() => createConnectionImpl(v));
export const selectConnection = (v: unknown) =>
  serialize(() => selectConnectionImpl(v));
export const renameConnection = (v: unknown) =>
  serialize(() => renameConnectionImpl(v));

export const deleteConnection = (value: unknown) =>
  serialize(async () => {
    const id = z.string().min(1).max(64).parse(value);
    const entries = await listConnections();
    if (!entries.some((e) => e.id === id))
      throw new Error("Connection no longer exists.");
    if (entries.length === 1) throw new Error("Keep at least one connection.");
    await Promise.all([logout(id), oauthLogout(id), codeLogout(id)]);
    const remaining = entries.filter((e) => e.id !== id);
    const current = await readSettings();
    const next =
      current.connectionId === id
        ? {
            ...current,
            ...fields.parse(remaining[0]),
            connectionId: remaining[0].id,
          }
        : current;
    await chrome.storage.local.set({ connections: remaining, settings: next });
    return next;
  });
