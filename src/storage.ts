import { z } from "zod";
import {
  defaults,
  Fault,
  endpointUrl,
  managementUrl,
  settingsSchema,
  validateDomains,
  type Settings,
} from "./core";
export const cardSchema = z
  .object({
    id: z.string().min(1).max(100),
    original: z.string().max(20000),
    result: z.string().max(20000),
    explanation: z.string().max(20000),
    rule: z.string().max(1000),
    createdAt: z.number().int().nonnegative(),
    sourceUrl: z.string().url().max(4096).optional(),
  })
  .strict();
export type Card = z.infer<typeof cardSchema>;
const prefs = settingsSchema.omit({ key: true });
export const backupSchema = z
  .object({
    schemaVersion: z.literal(1),
    cards: z.array(cardSchema).max(10000),
    preferences: prefs,
  })
  .strict();
export async function readSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get("settings");
  if (settings === undefined) return { ...defaults };
  const parsed = settingsSchema.safeParse(settings);
  if (!parsed.success)
    throw new Fault(
      "storage_error",
      "Saved settings use an unsupported or invalid schema. Open a compatible build; existing data has not been changed.",
    );
  if (parsed.data.setupKind === "cliproxyapi") parsed.data.setupKind = "custom";
  if (!parsed.data.writingProfiles.length) {
    parsed.data.writingProfiles = parsed.data.writingContext.trim()
      ? [
          {
            id: "legacy",
            name: "原有寫作情境",
            prompt: parsed.data.writingContext,
          },
        ]
      : defaults.writingProfiles.map((item) => ({ ...item }));
  }
  if (
    !parsed.data.writingProfiles.some(
      (item) => item.id === parsed.data.writingProfileId,
    )
  )
    parsed.data.writingProfileId = parsed.data.writingProfiles[0].id;
  return parsed.data;
}
export async function writeSettings(value: unknown) {
  await readSettings();
  const settings = settingsSchema.parse(value);
  settings.excluded = validateDomains(settings.excluded);
  endpointUrl(settings.endpoint);
  managementUrl(settings.endpoint, settings.managementPath);
  await chrome.storage.local.set({ settings });
  return settings;
}
export function publicPreferences(s: Settings) {
  const { key: _, ...rest } = s;
  void _;
  return rest;
}
export function openDB() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("langloop", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("cards", { keyPath: "id" });
      r.result.createObjectStore("cache");
      r.result.createObjectStore("meta");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () =>
      reject(
        new Fault(
          "storage_error",
          "Storage version or migration failed. Restore a compatible backup with a compatible build.",
        ),
      );
  });
}
async function transaction<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore, set: (x: T) => void) => void,
): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    let value: T;
    tx.oncomplete = () => {
      db.close();
      resolve(value);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(
        new Fault(
          "storage_error",
          "Storage transaction failed; previous data was preserved. Retry or restore a compatible backup.",
        ),
      );
    };
    try {
      run(tx.objectStore(store), (v) => {
        value = v;
      });
    } catch (error) {
      tx.abort();
      reject(error);
    }
  });
}
export const cards = () =>
  transaction<Card[]>("cards", "readonly", (s, set) => {
    s.getAll().onsuccess = (e) => set((e.target as IDBRequest<Card[]>).result);
  });
export const saveCard = (value: unknown) => {
  const card = cardSchema.parse(value);
  return transaction<void>("cards", "readwrite", (s) => {
    s.put(card);
  });
};
export const deleteCard = (id: string) =>
  transaction<void>("cards", "readwrite", (s) => {
    s.delete(id);
  });
export async function exportBackup(s: Settings) {
  return {
    schemaVersion: 1,
    cards: await cards(),
    preferences: publicPreferences(s),
  };
}
export async function importBackup(value: unknown) {
  const parsed = backupSchema.safeParse(value);
  if (!parsed.success)
    throw new Fault(
      "invalid_backup",
      "Invalid or unsupported backup version. Existing data was not changed. Use a compatible LangLoop backup.",
    );
  const backup = parsed.data;
  validateDomains(backup.preferences.excluded);
  endpointUrl(backup.preferences.endpoint);
  managementUrl(backup.preferences.endpoint, backup.preferences.managementPath);
  const db = await openDB();
  return new Promise<{ added: number; skipped: number }>((resolve, reject) => {
    const tx = db.transaction(["cards", "meta"], "readwrite");
    let added = 0,
      skipped = 0;
    tx.oncomplete = () => {
      db.close();
      resolve({ added, skipped });
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(
        new Fault(
          "storage_error",
          "Import failed. Existing data was preserved. Retry with a compatible backup.",
        ),
      );
    };
    const s = tx.objectStore("cards");
    const seen = new Set<string>();
    for (const c of backup.cards) {
      if (seen.has(c.id)) {
        skipped++;
        continue;
      }
      seen.add(c.id);
      const r = s.get(c.id);
      r.onsuccess = () => {
        if (r.result) skipped++;
        else {
          s.add(c);
          added++;
        }
      };
    }
    tx.objectStore("meta").put(backup.preferences, "importedPreferences");
  });
}
export const importedPreferences = () =>
  transaction<z.infer<typeof prefs> | undefined>(
    "meta",
    "readonly",
    (s, set) => {
      s.get("importedPreferences").onsuccess = (e) =>
        set((e.target as IDBRequest).result);
    },
  );
export const cacheGet = (key: string) =>
  transaction<unknown>("cache", "readonly", (s, set) => {
    s.get(key).onsuccess = (e) => set((e.target as IDBRequest).result);
  });
export const cachePut = (key: string, value: unknown) =>
  transaction<void>("cache", "readwrite", (s) => {
    s.put(value, key);
    const r = s.count();
    r.onsuccess = () => {
      if (r.result > 200)
        s.openCursor().onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
          cursor?.delete();
        };
    };
  });
export const clearCache = () =>
  transaction<void>("cache", "readwrite", (s) => {
    s.clear();
  });
