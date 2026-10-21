import {
  isSubscription,
  subscriptionModels,
  subscriptionStatus,
  subscriptionBegin,
  subscriptionFinish,
  subscriptionLogout,
} from "./subscriptions";
import { receiveCodeCallback } from "./oauth-code";
import {
  listConnections,
  createConnection,
  selectConnection,
  renameConnection,
  saveConnectionSettings,
  deleteConnection,
} from "./connections";
import { articleBatches } from "./article";
import { messages } from "./i18n";
import { mountWidget } from "./widget";
import {
  beginLogin,
  finishLogin,
  loginStatus,
  logout,
  listAccountModels,
  CODEX,
} from "./chatgpt";
import { z } from "zod";
import {
  settingsSchema,
  writingTargetSchema,
  writingSameLanguage,
  defaults,
  wordDifferences,
  discoverySchema,
  excluded,
  Fault,
  fault,
  inferenceSchema,
  isTrusted,
  originPattern,
  type Inference,
  type Source,
} from "./core";
import { infer, cacheIdentity, listModels } from "./provider";
import {
  cacheGet,
  cachePut,
  cards,
  clearCache,
  deleteCard,
  exportBackup,
  importBackup,
  importedPreferences,
  readSettings,
  saveCard,
} from "./storage";
import { pageAction } from "./content";
const active = new Map<string, AbortController>();
const sources = new Map<string, number>();
const startup = (async () => {
  await chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  await chrome.storage.session.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  const all = await chrome.storage.session.get(null);
  const update: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith("job:") && (value as any).status === "pending")
      update[key] = { status: "interrupted" };
  }
  if (Object.keys(update).length) await chrome.storage.session.set(update);
})();
async function tabAllowed(tabId: number) {
  const tab = await chrome.tabs.get(tabId);
  const s = await readSettings();
  if (!tab.url || !/^https?:/.test(tab.url))
    throw new Fault(
      "permission_denied",
      "This page is protected. Paste text in the side panel instead.",
    );
  if (excluded(tab.url, s.excluded))
    throw new Fault("permission_denied", "This site is excluded in Settings.");
  return tab;
}
async function page(tabId: number, action: string, payload: unknown = {}) {
  if (action !== "restore" && action !== "undo") await tabAllowed(tabId);
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: pageAction,
      args: [action, payload],
    });
    if (!res.result) throw new Error("Empty page result");
    return res.result;
  } catch {
    throw new Fault(
      "stale_source",
      "Page access or field state changed. Click the extension icon on this page, capture again, or paste text here.",
    );
  }
}
async function sourceCurrent(source: Source) {
  const tab = await tabAllowed(source.tabId);
  if (tab.url !== source.url)
    throw new Fault(
      "stale_source",
      "The source page changed. Capture it again.",
    );
  const state = await page(source.tabId, "generation");
  if (state.generation !== source.generation)
    throw new Fault("stale_source", "The source changed. Capture it again.");
}
async function run(value: unknown) {
  const r = inferenceSchema.parse(value);
  const s = await readSettings();
  if (r.source) await sourceCurrent(r.source);
  if (
    !(await chrome.permissions.contains({
      origins: [originPattern(s.setupKind === "chatgpt" ? CODEX : s.endpoint)],
    }))
  )
    throw new Fault(
      "permission_denied",
      "Connect this provider in Settings to allow access.",
    );
  if (active.size >= 2)
    throw new Fault(
      "rate_limited",
      "Two requests are already running. Wait or cancel before retrying.",
    );
  if (active.has(r.requestId))
    throw new Fault("invalid_response", "Duplicate request.");
  const controller = new AbortController();
  active.set(r.requestId, controller);
  if (r.source) sources.set(r.requestId, r.source.tabId);
  await chrome.storage.session.set({
    ["job:" + r.requestId]: { status: "pending" },
  });
  const timeout = setTimeout(
    () =>
      controller.abort(
        new Fault("timeout", "Request timed out. Retry or use a faster model."),
      ),
    r.operation === "article" ? 90000 : 20000,
  );
  try {
    const key = cacheIdentity(r, s);
    let data = r.operation === "article" ? await cacheGet(key) : undefined;
    if (!data) {
      data = await infer(r, s, controller.signal);
      if (r.operation === "article") await cachePut(key, data);
    }
    if (controller.signal.aborted) throw controller.signal.reason;
    if (r.source) await sourceCurrent(r.source);
    await chrome.storage.session.set({
      ["job:" + r.requestId]: { status: "done" },
    });
    return data;
  } finally {
    clearTimeout(timeout);
    active.delete(r.requestId);
    sources.delete(r.requestId);
    await chrome.storage.session.remove("job:" + r.requestId);
  }
}
chrome.tabs.onUpdated.addListener((id, info) => {
  if (info.url) void receiveCodeCallback(id, info.url).catch(() => {});
  if (info.status === "loading" || info.url)
    for (const [requestId, controller] of active)
      if (sources.get(requestId) === id)
        controller.abort(
          new Fault(
            "stale_source",
            "The source page navigated. Retry with the current page.",
          ),
        );
});
chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    await chrome.contextMenus.removeAll();
    const s = await readSettings();
    chrome.contextMenus.create({
      id: "capture",
      title:
        s.uiLanguage === "en" ? "Explain with LangLoop" : "使用 LangLoop 解釋",
      contexts: ["selection", "editable"],
    });
    chrome.contextMenus.create({
      id: "translate-page",
      title:
        s.uiLanguage === "en"
          ? "LangLoop: Translate page"
          : "LangLoop：翻譯整頁",
      contexts: ["page", "selection", "editable", "link", "image"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
    });
  })();
});
async function capture(tabId: number) {
  const data = await page(tabId, "capture");
  const source = {
    tabId,
    frameId: 0,
    generation: data.generation,
    url: data.url,
  };
  await chrome.storage.session.set({ capture: { ...data, source } });
  return { ...data, source };
}
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    void chrome.sidePanel.open({ tabId: tab.id });
    void capture(tab.id).catch(() => {});
  }
  if (tab.id)
    void (async () => {
      try {
        await tabAllowed(tab.id!);
        await chrome.scripting.executeScript({
          target: { tabId: tab.id! },
          func: mountWidget,
          args: [(await readSettings()).uiLanguage, messages],
        });
      } catch (e) {
        await chrome.storage.session.set({ capture: { error: fault(e) } });
        await chrome.runtime.openOptionsPage();
      }
    })();
});
chrome.contextMenus.onClicked.addListener((_info, tab) => {
  if (_info.menuItemId === "translate-page" && tab?.id) {
    void (async () => {
      await tabAllowed(tab.id!);
      await chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        func: mountWidget,
        args: [(await readSettings()).uiLanguage, messages, true],
      });
    })().catch((e) =>
      chrome.storage.session.set({ capture: { error: fault(e) } }),
    );
    return;
  }
  if (tab?.id) {
    void chrome.sidePanel.open({ tabId: tab.id });
    void capture(tab.id).catch((e) =>
      chrome.storage.session.set({ capture: { error: fault(e) } }),
    );
  }
});
const message = z
  .object({
    type: z.string(),
    payload: z.unknown().optional(),
    connectionId: z.string().min(1).max(64).optional(),
  })
  .strict();
async function handle(raw: unknown, sender: chrome.runtime.MessageSender) {
  await startup;
  const envelope = message.parse(raw);
  if (envelope.type === "inline") {
    const tabId = sender.tab?.id;
    if (
      sender.id !== chrome.runtime.id ||
      tabId === undefined ||
      sender.frameId !== 0 ||
      !sender.url
    )
      throw new Fault(
        "permission_denied",
        "Click the LangLoop toolbar icon to enable this page.",
      );
    const current = await tabAllowed(tabId);
    if (current.url !== sender.url)
      throw new Fault("stale_source", "Page changed. Refresh this page.");
    const p = z
      .object({
        action: z.enum([
          "ready",
          "writingOptions",
          "writing",
          "extract",
          "article",
          "insert",
          "restore",
          "correct",
          "apply",
          "undo",
          "stop",
          "settings",
        ]),
        data: z.unknown().optional(),
      })
      .strict()
      .parse(envelope.payload);
    if (p.action === "extract") {
      const extracted = await page(tabId, "extract");
      return { ...extracted, groups: articleBatches(extracted.blocks ?? []) };
    }
    if (p.action === "ready")
      return { uiLanguage: (await readSettings()).uiLanguage };
    if (p.action === "writingOptions") {
      const s = await readSettings();
      return {
        profiles: s.writingProfiles.map(({ id, name }) => ({ id, name })),
        profileId: s.writingProfileId,
        target: s.writingTarget,
      };
    }
    if (p.action === "writing") {
      const options = z
        .object({
          profileId: z.string().min(1).max(64),
          draft: z.string().trim().min(1).max(20000).optional(),
          target: writingTargetSchema,
        })
        .strict()
        .parse(p.data);
      const captured = await page(tabId, "capture");
      if (!captured.applicable || !captured.text.trim())
        throw new Fault("stale_source", "請先在可編輯的輸入框輸入文字。");
      const result: any = await run({
        requestId: crypto.randomUUID(),
        operation: "writing",
        providerId: "configured",
        text: options.draft ?? captured.text,
        context: "",
        sourceLanguage: "auto",
        targetLanguage: options.target,
        writingProfileId: options.profileId,
        source: {
          tabId,
          frameId: 0,
          url: sender.url,
          generation: captured.generation,
        },
      });
      const sameLanguage = writingSameLanguage(options.target, result.sourceLanguage);
      const variant = (value: any) => ({
        ...value,
        original: captured.text,
        generation: captured.generation,
        changes: wordDifferences(options.draft ?? captured.text, value.result),
        draft: options.draft ?? captured.text,
      });
      return {
        baseline: variant(result.baseline),
        suggestion: variant(result.suggestion),
        sameLanguage,
        canReplace: captured.canReplace !== false,
        replacementMode: captured.replacementMode,
      };
    }
    if (p.action === "settings") {
      await chrome.runtime.openOptionsPage();
      return true;
    }
    if (p.action === "stop") {
      for (const [id, controller] of active)
        if (sources.get(id) === tabId)
          controller.abort(new Fault("cancelled", "Stopped."));
      return true;
    }
    if (p.action === "correct" || p.action === "article") {
      const settings = await readSettings();
      const captured =
        p.action === "correct" ? await page(tabId, "capture") : null;
      if (captured && (!captured.applicable || !captured.text.trim()))
        throw new Fault(
          "stale_source",
          "Focus a supported, non-empty text editor first.",
        );
      const blocks =
        p.action === "article"
          ? z
              .object({
                blocks: inferenceSchema.shape.blocks,
                generation: z.string(),
              })
              .strict()
              .parse(p.data)
          : null;
      const mode =
        p.action === "correct"
          ? z
              .object({
                mode: z
                  .enum(["correct", "translate", "rewrite"])
                  .default("correct"),
              })
              .strict()
              .parse(p.data ?? {}).mode
          : "article";
      const generation = captured?.generation ?? blocks!.generation;
      const result = await run({
        requestId: crypto.randomUUID(),
        operation: mode,
        providerId: "configured",
        text: captured?.text ?? "Translate these page paragraphs.",
        context: "",
        sourceLanguage: "auto",
        targetLanguage: mode === "translate" ? "en" : settings.target,
        blocks: blocks?.blocks,
        source: { tabId, frameId: 0, url: sender.url, generation },
      });
      return captured
        ? {
            ...(result as Record<string, unknown>),
            changes: wordDifferences(
              captured.text,
              (result as { result: string }).result,
            ),
            original: captured.text,
            generation,
          }
        : result;
    }
    return page(tabId, p.action, p.data);
  }
  if (!isTrusted(sender, chrome.runtime.id))
    throw new Fault("permission_denied", "Untrusted request.");
  const { type, payload } = message.parse(raw);
  // Capture account identity before awaiting permissions or network operations.
  const selectedConnection = await readSettings();
  if (
    envelope.connectionId &&
    envelope.connectionId !== selectedConnection.connectionId
  )
    throw new Fault(
      "stale_source",
      "Connection changed. Reload settings before continuing.",
    );
  switch (type) {
    case "subscriptionModels": {
      if (!isSubscription(selectedConnection.setupKind))
        throw new Fault(
          "configuration_required",
          "Select a subscription connection.",
        );
      return subscriptionModels(
        selectedConnection.connectionId,
        selectedConnection.setupKind,
      );
    }
    case "subscriptionStatus": {
      if (!isSubscription(selectedConnection.setupKind))
        throw new Fault(
          "configuration_required",
          "Select a subscription connection.",
        );
      return subscriptionStatus(
        selectedConnection.connectionId,
        selectedConnection.setupKind,
      );
    }
    case "subscriptionBegin":
    case "subscriptionFinish":
    case "subscriptionLogout": {
      const kind = selectedConnection.setupKind;
      if (!isSubscription(kind))
        throw new Fault(
          "configuration_required",
          "Select a subscription connection.",
        );
      const callback = z
        .object({ callback: z.string().max(8192).optional() })
        .strict()
        .parse(payload ?? {}).callback;
      if (type === "subscriptionBegin") {
        const result = await subscriptionBegin(
          selectedConnection.connectionId,
          kind,
        );
        if ("url" in result) await chrome.tabs.create({ url: result.url });
        return result;
      }
      if (type === "subscriptionLogout") {
        for (const controller of active.values())
          controller.abort(new Fault("cancelled", "Signed out."));
        return subscriptionLogout(selectedConnection.connectionId, kind);
      }
      return subscriptionFinish(
        selectedConnection.connectionId,
        kind,
        callback,
      );
    }
    case "enableInline": {
      const tabId = z.number().int().parse(payload);
      await tabAllowed(tabId);
      await chrome.scripting.executeScript({
        target: { tabId },
        func: mountWidget,
        args: [(await readSettings()).uiLanguage, messages],
      });
      return true;
    }
    case "chatgptStatus":
      return loginStatus(selectedConnection.connectionId);
    case "chatgptLogout":
      for (const controller of active.values())
        controller.abort(new Fault("cancelled", "Signed out."));
      return logout(selectedConnection.connectionId);
    case "chatgptBegin":
    case "chatgptFinish":
    case "chatgptModels": {
      if (
        !(await chrome.permissions.contains({
          origins: ["https://auth.openai.com/*", "https://chatgpt.com/*"],
        }))
      )
        throw new Fault("permission_denied", "Allow OpenAI access to sign in.");
      return type === "chatgptModels"
        ? listAccountModels(selectedConnection.connectionId)
        : type === "chatgptBegin"
          ? beginLogin(selectedConnection.connectionId)
          : finishLogin(selectedConnection.connectionId);
    }
    case "connections":
      return listConnections();
    case "createConnection":
      return createConnection(payload);
    case "deleteConnection":
      for (const controller of active.values())
        controller.abort(new Fault("cancelled", "Connection removed."));
      return deleteConnection(payload);
    case "renameConnection":
      return renameConnection(payload);
    case "selectConnection": {
      for (const controller of active.values())
        controller.abort(new Fault("cancelled", "Connection changed."));
      return selectConnection(payload);
    }
    case "settings":
      return readSettings();
    case "saveSettings": {
      const saved = await saveConnectionSettings(settingsSchema.parse(payload));
      void chrome.contextMenus
        .update("capture", {
          title:
            saved.uiLanguage === "en"
              ? "Explain with LangLoop"
              : "使用 LangLoop 解釋",
        })
        .catch(() => {});
      void chrome.contextMenus
        .update("translate-page", {
          title:
            saved.uiLanguage === "en"
              ? "LangLoop: Translate page"
              : "LangLoop：翻譯整頁",
        })
        .catch(() => {});
      const tabs = await chrome.tabs.query({});
      await Promise.allSettled(
        tabs
          .filter((tab) => tab.id !== undefined)
          .map((tab) =>
            chrome.tabs.sendMessage(tab.id!, {
              type: "uiLanguage",
              language: saved.uiLanguage,
            }),
          ),
      );
      return saved;
    }
    case "listModels": {
      const draft = discoverySchema.parse(payload);
      if (
        !(await chrome.permissions.contains({
          origins: [originPattern(draft.endpoint)],
        }))
      )
        throw new Fault(
          "permission_denied",
          "Allow proxy access before loading models.",
        );
      return listModels(draft);
    }
    case "infer":
      return run(payload);
    case "cancel": {
      const id = z.string().uuid().parse(payload);
      active.get(id)?.abort(new Fault("cancelled", "Request cancelled."));
      return true;
    }
    case "jobs":
      return chrome.storage.session.get(null);
    case "capture":
      return capture(z.number().int().parse(payload));
    case "page": {
      const p = z
        .object({
          tabId: z.number().int(),
          action: z.enum(["extract", "insert", "restore", "apply", "undo"]),
          data: z.unknown().optional(),
        })
        .strict()
        .parse(payload);
      return page(p.tabId, p.action, p.data);
    }
    case "cards":
      return cards();
    case "saveCard":
      await saveCard(payload);
      return true;
    case "deleteCard":
      await deleteCard(z.string().parse(payload));
      return true;
    case "export":
      return exportBackup(await readSettings());
    case "import": {
      const report = await importBackup(payload);
      return { ...report, preferences: await importedPreferences() };
    }
    case "clearCache":
      await clearCache();
      return true;
    case "defaults":
      return defaults;
    default:
      throw new Fault("permission_denied", "Unsupported action");
  }
}
chrome.runtime.onMessage.addListener((raw, sender, reply) => {
  void handle(raw, sender)
    .then((data) =>
      reply({ requestId: raw?.payload?.requestId, status: "ok", data }),
    )
    .catch((error) =>
      reply({
        requestId: raw?.payload?.requestId,
        status: "error",
        error: fault(error),
      }),
    );
  return true;
});
export type { Inference };
