import { beforeEach, expect, it, vi } from "vitest";
import { defaults } from "../src/core";
import {
  createConnection,
  deleteConnection,
  listConnections,
  selectConnection,
  saveConnectionSettings,
} from "../src/connections";
let local: Record<string, any>;
beforeEach(() => {
  local = { settings: { ...defaults, model: "old-model", key: "old-key" } };
  vi.stubGlobal("chrome", {
    storage: {
      session: { remove: async () => {} },
      local: {
        get: async (k: string) => ({ [k]: local[k] }),
        set: async (v: any) => Object.assign(local, v),
        remove: async (key: string) => {
          delete local[key];
        },
      },
    },
  });
});
it("concurrent additions preserve independent same-provider accounts and active credentials", async () => {
  await listConnections();
  const [a, b] = await Promise.all(
    ["Private", "Work"].map((name) =>
      createConnection({ name, setupKind: "chatgpt" }),
    ),
  );
  expect(a.id).not.toBe(b.id);
  expect(await listConnections()).toHaveLength(3);
  expect(local.settings.key).toBe("old-key");
  const s = await selectConnection(a.id);
  await saveConnectionSettings({ ...s, key: "a-key", model: "a-model" });
  const other = await selectConnection(b.id);
  expect(other.key).toBe("");
  expect(other.model).toBe("");
  const restored = await selectConnection(a.id);
  expect(restored.key).toBe("a-key");
  expect(restored.model).toBe("a-model");
});
it("stale settings cannot overwrite a newly selected account", async () => {
  await listConnections();
  const old = { ...local.settings };
  const b = await createConnection({ name: "Work", setupKind: "chatgpt" });
  await selectConnection(b.id);
  await expect(saveConnectionSettings(old)).rejects.toThrow(
    "Active connection changed",
  );
  expect(local.settings.connectionId).toBe(b.id);
});

it("removal clears only the selected connection's authentication namespaces", async () => {
  await listConnections();
  const a = await createConnection({ name: "a", setupKind: "chatgpt" });
  const b = await createConnection({ name: "b", setupKind: "chatgpt" });
  for (const prefix of ["codexAuth:", "oauth:", "codeAuth:"]) {
    local[prefix + a.id] = { access_token: "a" };
    local[prefix + b.id] = { access_token: "b" };
  }
  await selectConnection(a.id);
  await deleteConnection(a.id);
  expect(local.settings.connectionId).not.toBe(a.id);
  for (const prefix of ["codexAuth:", "oauth:", "codeAuth:"]) {
    expect(local[prefix + a.id]).toBeUndefined();
    expect(local[prefix + b.id].access_token).toBe("b");
  }
});

it("initial migration and concurrent additions cannot overwrite each other", async () => {
  const [, a, b] = await Promise.all([
    listConnections(),
    createConnection({ name: "a", setupKind: "chatgpt" }),
    createConnection({ name: "b", setupKind: "chatgpt" }),
  ]);
  expect((await listConnections()).map((e) => e.id).sort()).toEqual(
    ["legacy", a.id, b.id].sort(),
  );
});

it("assigns distinct Agent names for concurrent unnamed additions", async () => {
  const [a, b] = await Promise.all([
    createConnection({ setupKind: "chatgpt" }),
    createConnection({ setupKind: "chatgpt", name: "   " }),
  ]);
  expect([a.name, b.name]).toEqual(["Agent 1", "Agent 2"]);
});
