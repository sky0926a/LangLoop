import "fake-indexeddb/auto";
import { it, expect, beforeEach } from "vitest";
import { defaults } from "../src/core";
import {
  cards,
  saveCard,
  deleteCard,
  exportBackup,
  importBackup,
  openDB,
} from "../src/storage";
const c1 = {
  id: "c1",
  original: "interested to buy",
  result: "interested in buying",
  explanation: "in + V-ing",
  rule: "interested in",
  createdAt: 1,
};
beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const r = indexedDB.deleteDatabase("langloop");
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
});
it("manual collection persists and deletes", async () => {
  expect(await cards()).toEqual([]);
  await saveCard(c1);
  expect(await cards()).toEqual([c1]);
  await deleteCard("c1");
  expect(await cards()).toEqual([]);
});
it("imports c1,c2 as added=1 skipped=1 and never exports keys", async () => {
  await saveCard(c1);
  const backup = await exportBackup({ ...defaults, key: "SYNTHETIC_SECRET" });
  expect(JSON.stringify(backup)).not.toContain("SYNTHETIC_SECRET");
  expect(
    await importBackup({ ...backup, cards: [c1, { ...c1, id: "c2" }] }),
  ).toEqual({ added: 1, skipped: 1 });
  expect((await cards()).map((c) => c.id)).toEqual(["c1", "c2"]);
});
it("invalid/newer schema leaves c1 unchanged", async () => {
  await saveCard(c1);
  await expect(
    importBackup({ schemaVersion: 999, cards: [] }),
  ).rejects.toThrow();
  expect(await cards()).toEqual([c1]);
});
it("aborted migration retains previous data", async () => {
  await saveCard(c1);
  const db = await openDB();
  await new Promise<void>((resolve) => {
    const tx = db.transaction("cards", "readwrite");
    tx.objectStore("cards").delete("c1");
    tx.onabort = () => resolve();
    tx.abort();
  });
  db.close();
  expect(await cards()).toEqual([c1]);
});

it("reads legacy preferences and preserves cards through proxy preference backup", async () => {
  const { settingsSchema } = await import("../src/core");
  const { importedPreferences } = await import("../src/storage");
  const {
    setupKind: _,
    managementPath: __,
    ...legacy
  } = {
    ...defaults,
    model: "legacy",
    key: "synthetic",
    excluded: ["private.example"],
  };
  void _;
  void __;
  const migrated = settingsSchema.parse(legacy);
  expect(migrated).toEqual({
    ...legacy,
    setupKind: "custom",
    managementPath: "/management.html",
  });
  await saveCard(c1);
  const backup = await exportBackup({
    ...migrated,
    setupKind: "cliproxyapi",
    managementPath: "/proxy/admin",
  });
  expect(JSON.stringify(backup)).not.toContain("synthetic");
  await importBackup(backup);
  expect(await importedPreferences()).toMatchObject({
    setupKind: "cliproxyapi",
    managementPath: "/proxy/admin",
  });
  expect(await cards()).toEqual([c1]);
});

it("migrates the existing prompt into a named profile without changing stored data", async () => {
  const { vi } = await import("vitest");
  const { readSettings } = await import("../src/storage");
  const {
    writingProfiles: _,
    writingProfileId: __,
    writingTarget: ___,
    ...old
  } = defaults;
  void _;
  void __;
  void ___;
  const legacy = { ...old, writingContext: "商務溝通偏好" };
  vi.stubGlobal("chrome", {
    storage: { local: { get: async () => ({ settings: legacy }) } },
  });
  try {
    const migrated = await readSettings();
    expect(migrated.writingProfiles).toEqual([
      { id: "legacy", name: "原有寫作情境", prompt: "商務溝通偏好" },
    ]);
    expect(migrated.writingProfileId).toBe("legacy");
    expect(migrated.writingTarget).toBe("original");
    expect(legacy).not.toHaveProperty("writingProfiles");
  } finally {
    vi.unstubAllGlobals();
  }
});
