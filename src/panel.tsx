import { subscriptions, isSubscription } from "./subscriptions";
import type { Connection } from "./connections";
import { articleBatches } from "./article";
import { translator } from "./i18n";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  defaults,
  wordDifferences,
  originPattern,
  type Inference,
  type Operation,
  type Result,
  type Settings,
  type Source,
} from "./core";
import { WritingContexts } from "./writing-contexts";
import type { Card } from "./storage";
import "./style.css";
async function transport(
  type: string,
  payload?: unknown,
  connectionId?: string,
): Promise<any> {
  let response;
  try {
    response = await chrome.runtime.sendMessage({
      type,
      payload,
      ...(connectionId ? { connectionId } : {}),
    });
  } catch {
    throw new Error(
      "interrupted: Request interrupted. Retry explicitly when the extension is ready.",
    );
  }
  if (!response) throw new Error("interrupted: No response. Retry explicitly.");
  if (
    response.status !== "ok" &&
    type.startsWith("chatgpt") &&
    response.error?.message === "Unsupported action"
  )
    throw new Error(
      "update_required: Chrome is still running LangLoop's previous background version. Reload the extension to finish updating, then sign in again. Copy any unsaved draft first.",
    );
  if (response.status !== "ok")
    throw new Error(`${response.error.code}: ${response.error.message}`);
  return response.data;
}
function App() {
  const [tab, setTab] = useState(
      location.search.includes("settings") ? "settings" : "assist",
    ),
    [settings, setSettingsState] = useState<Settings>(defaults),
    [activeSettings, setActiveSettings] = useState<Settings>(defaults),
    [draft, setDraft] = useState(""),
    [result, setResult] = useState<Result | null>(null),
    [writingPair, setWritingPair] = useState<{
      baseline: Result;
      suggestion: Result;
      sourceLanguage: string;
    } | null>(null),
    [writingProfile, setWritingProfile] = useState("general"),
    [writingOutput, setWritingOutput] = useState("original"),
    [original, setOriginal] = useState(""),
    [source, setSource] = useState<Source>(),
    [applicable, setApplicable] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState<Card[]>([]),
    [includeUrl, setIncludeUrl] = useState(false),
    [showKey, setShowKey] = useState(false),
    [articleTab, setArticleTab] = useState<number>(),
    [canUndo, setCanUndo] = useState(false);
  const requestId = useRef<string | undefined>(undefined),
    cancelled = useRef(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [connectionName, setConnectionName] = useState("");
  const [newProvider, setNewProvider] =
    useState<Settings["setupKind"]>("chatgpt");
  const [settingsSection, setSettingsSection] = useState("ai");
  async function switchConnection(id: string) {
    await action(async () => {
      await rpc("saveSettings", settingsRef.current);
      const next = await rpc("selectConnection", id);
      setSettings(next);
      setActiveSettings(next);
      setModels(null);
      setVerification("");
      setResult(null);
      setWritingPair(null);
      setCanUndo(false);
      setAccount(
        await rpc(
          isSubscription(settingsRef.current.setupKind)
            ? "subscriptionStatus"
            : "chatgptStatus",
        ),
      );
      setConnections(await rpc("connections"));
    });
  }
  const [models, setModels] = useState<string[] | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogMessage, setCatalogMessage] = useState("");
  const [verification, setVerification] = useState("");
  const [testing, setTesting] = useState(false);
  const testPending = useRef(false);
  const [account, setAccount] = useState<{
    signedIn: boolean;
    userCode?: string;
    waiting?: boolean;
    error?: string;
  }>({ signedIn: false });
  const generation = useRef(0),
    settingsRef = useRef(settings),
    catalogPending = useRef(false);
  async function rpc(type: string, payload?: unknown): Promise<any> {
    const bound = type.startsWith("chatgpt") || type.startsWith("subscription");
    const id = settingsRef.current.connectionId;
    const result = await transport(type, payload, bound ? id : undefined);
    if (bound && id !== settingsRef.current.connectionId)
      throw new Error("Connection changed. Retry for the selected account.");
    return result;
  }
  const t = translator(settings.uiLanguage);
  function setSettings(next: Settings) {
    const previous = settingsRef.current;
    if (
      previous.connectionId !== next.connectionId ||
      previous.endpoint !== next.endpoint ||
      previous.key !== next.key ||
      previous.setupKind !== next.setupKind
    ) {
      setModels(null);
      setAccount({ signedIn: false });
      setCatalogMessage("");
    }
    generation.current++;
    if (verification) setMessage("");
    setVerification("");
    settingsRef.current = next;
    setSettingsState(next);
  }
  async function loadModels(automatic = false) {
    if (catalogPending.current) return;
    catalogPending.current = true;
    setCatalogBusy(true);
    setCatalogMessage("");
    const revision = generation.current,
      snapshot = settingsRef.current;
    try {
      const granted = await chrome.permissions[
        automatic ? "contains" : "request"
      ]({
        origins:
          snapshot.setupKind === "chatgpt"
            ? ["https://auth.openai.com/*", "https://chatgpt.com/*"]
            : [originPattern(snapshot.endpoint)],
      });
      if (!granted)
        throw new Error(
          "permission_denied: Service access declined. You can edit settings or enter a model manually.",
        );
      if (revision !== generation.current) return;
      const ids = await rpc(
        snapshot.setupKind === "chatgpt"
          ? "chatgptModels"
          : isSubscription(snapshot.setupKind)
            ? "subscriptionModels"
            : "listModels",
        {
          endpoint: snapshot.endpoint,
          key: snapshot.key,
        },
      );
      if (revision !== generation.current) return;
      setModels(ids);
      setCatalogMessage(
        ids.length
          ? settings.uiLanguage === "en"
            ? `${ids.length} models listed. Test your selection to verify inference.`
            : `已列出 ${ids.length} 個模型，請測試選擇的模型以確認可用。`
          : t("No models listed. Enter a model manually or check the service."),
      );
    } catch (error) {
      if (revision === generation.current) {
        setModels(null);
        setCatalogMessage(String(error));
      }
    } finally {
      catalogPending.current = false;
      setCatalogBusy(false);
    }
  }
  useEffect(() => {
    if (account.signedIn && settings.setupKind === "chatgpt")
      void loadModels(true);
  }, [account.signedIn, settings.setupKind]);
  const refreshCards = async () => setSaved(await rpc("cards"));
  function loadCapture(c: any) {
    if (!c) return;
    cancelled.current = true;
    if (requestId.current)
      void rpc("cancel", requestId.current).catch(() => {});
    if (c.error) {
      setMessage(c.error.message);
      return;
    }
    setDraft(c.text);
    setSource(c.source);
    setApplicable(c.applicable);
    setResult(null);
    setWritingPair(null);
    setCanUndo(false);
    setMessage(
      c.text
        ? t("Selection captured. Choose an action.")
        : t(
            "Select text on the page, then click LangLoop again. You can also paste here.",
          ),
    );
  }
  useEffect(() => {
    void (async () => {
      try {
        setConnections(await rpc("connections"));
        const stored = await rpc("settings");
        setSettings(stored);
        setActiveSettings(stored);
        setWritingProfile(stored.writingProfileId);
        setWritingOutput(stored.writingTarget);
        setAccount(
          await rpc(
            isSubscription(settingsRef.current.setupKind)
              ? "subscriptionStatus"
              : "chatgptStatus",
          ),
        );
        await refreshCards();
        const state = await chrome.storage.session.get("capture");
        loadCapture(state.capture);
        const jobs = await rpc("jobs");
        if (
          Object.entries(jobs).some(
            ([k, v]: [string, any]) =>
              k.startsWith("job:") && v.status === "interrupted",
          )
        )
          setMessage(
            t("A previous request was interrupted. Choose an action to retry."),
          );
      } catch (e) {
        setMessage(String(e));
      }
    })();
    const listener = (changes: any, area: string) => {
      const locale = changes.settings?.newValue?.uiLanguage;
      if (area === "local" && (locale === "en" || locale === "zh-TW")) {
        setSettingsState((current) => ({ ...current, uiLanguage: locale }));
      }
      if (area === "session" && changes.capture)
        loadCapture(changes.capture.newValue);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);
  async function action(fn: () => Promise<void>) {
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage(String(e));
    }
  }
  async function run(
    operation: Operation,
    input = draft,
    context = "",
    blocks?: Inference["blocks"],
    origin: Source | null | undefined = source,
    language = activeSettings.target,
  ): Promise<any> {
    const id = crypto.randomUUID();
    requestId.current = id;
    return rpc("infer", {
      requestId: id,
      operation,
      writingProfileId: operation === "writing" ? writingProfile : undefined,
      providerId: "configured",
      text: input,
      context,
      blocks,
      source: origin ?? undefined,
      sourceLanguage: "auto",
      targetLanguage: language,
    });
  }
  async function process(operation: Operation) {
    await action(async () => {
      if (!draft.trim()) throw new Error(t("Select or paste some text first."));
      setBusy(true);
      cancelled.current = false;
      setResult(null);
      setWritingPair(null);
      setOriginal(draft);
      try {
        const data = await run(
          operation,
          draft,
          "",
          undefined,
          source,
          operation === "writing" ? writingOutput : activeSettings.target,
        );
        if (!cancelled.current) {
          if (operation === "writing") setWritingPair(data);
          else setResult(data);
        }
      } finally {
        setBusy(false);
        requestId.current = undefined;
      }
    });
  }
  async function stop() {
    cancelled.current = true;
    if (requestId.current) await rpc("cancel", requestId.current);
  }
  async function translateArticle() {
    await action(async () => {
      const [current] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const id = source?.tabId ?? current?.id;
      if (id === undefined)
        throw new Error(t("Open a web page and click LangLoop first."));
      setArticleTab(id);
      setBusy(true);
      cancelled.current = false;
      try {
        const extracted = await rpc("page", { tabId: id, action: "extract" });
        if (!extracted.blocks.length)
          throw new Error(
            t(
              "No supported article paragraphs found. Select text or paste it here.",
            ),
          );
        const origin: Source = {
          tabId: id,
          frameId: 0,
          generation: extracted.generation,
          url: extracted.url,
        };
        const all = extracted.blocks as {
          id: string;
          text: string;
          visible: boolean;
        }[];
        const groups = articleBatches(all).map((blocks) => ({
          blocks,
          context: "",
        }));
        groups.sort(
          (a, b) =>
            Number(b.blocks.some((x) => x.visible)) -
            Number(a.blocks.some((x) => x.visible)),
        );
        let count = 0;
        for (const group of groups) {
          if (cancelled.current) break;
          const data = await run(
            "article",
            "Translate these article blocks.",
            group.context,
            group.blocks.map(({ id, text }) => ({ id, text })),
            origin,
          );
          if (cancelled.current) break;
          const inserted = await rpc("page", {
            tabId: id,
            action: "insert",
            data: {
              generation: origin.generation,
              translations: data.translations,
            },
          });
          count += inserted.inserted;
          setMessage(
            settings.uiLanguage === "en"
              ? `${count} of ${all.length} paragraphs translated.`
              : `已翻譯 ${count} / ${all.length} 個段落。`,
          );
        }
        if (cancelled.current)
          setMessage(
            t(
              "Translation cancelled. Completed paragraphs remain until Restore.",
            ),
          );
      } finally {
        setBusy(false);
        requestId.current = undefined;
      }
    });
  }
  async function restore() {
    await action(async () => {
      await stop();
      const id = articleTab ?? source?.tabId;
      if (id !== undefined) await rpc("page", { tabId: id, action: "restore" });
      setMessage(t("Original page restored."));
    });
  }
  async function connect() {
    if (testPending.current) return;
    testPending.current = true;
    setTesting(true);
    setBusy(true);
    const snapshot = settingsRef.current,
      revision = generation.current;
    setMessage("");
    setVerification(t("Preparing connection test…"));
    let persisted = false;
    try {
      const granted = await chrome.permissions.request({
        origins:
          snapshot.setupKind === "chatgpt"
            ? ["https://auth.openai.com/*", "https://chatgpt.com/*"]
            : [originPattern(snapshot.endpoint)],
      });
      if (revision !== generation.current) return;
      if (!granted)
        throw new Error(
          "permission_denied: Provider access declined. Settings remain editable.",
        );
      setBusy(true);
      const saved = await rpc("saveSettings", snapshot);
      persisted = true;
      setActiveSettings(saved);
      setWritingProfile(saved.writingProfileId);
      setWritingOutput(saved.writingTarget);
      if (revision !== generation.current) return;
      setVerification(
        settings.uiLanguage === "en"
          ? `Testing ${saved.model} · translating “Hello, world.”…`
          : `正在測試 ${saved.model}・翻譯「Hello, world.」…`,
      );
      const data = await run(
        "test",
        "Hello, world.",
        "",
        undefined,
        null,
        saved.target,
      );
      if (revision === generation.current) {
        setVerification(
          settings.uiLanguage === "en"
            ? `Setup complete · ${saved.model} · Test translation: ${data.result}`
            : `設定完成・${saved.model}・測試翻譯：${data.result}`,
        );
        setMessage(
          settings.uiLanguage === "en"
            ? `Connected to ${saved.model} at ${saved.endpoint}: ${data.result}`
            : `已連接 ${saved.model}（${saved.endpoint}）：${data.result}`,
        );
      }
    } catch (error) {
      if (revision === generation.current) {
        setVerification(
          `${persisted ? t("Settings saved. Test failed") : t("Test could not start")}: ${String(error).replace(/^Error: /, "")}`,
        );
        setMessage(String(error));
      }
    } finally {
      testPending.current = false;
      setTesting(false);
      setBusy(false);
      requestId.current = undefined;
    }
  }
  const pairedSameLanguage =
    writingOutput === "original" ||
    (writingOutput === "en" && writingPair?.sourceLanguage === "en") ||
    (writingOutput === "zh-TW" && writingPair?.sourceLanguage === "zh");
  const displayedResults = writingPair
    ? [
        {
          value: writingPair.baseline,
          title: pairedSameLanguage ? t("基本校正") : t("忠實翻譯"),
          diff: pairedSameLanguage,
        },
        {
          value: writingPair.suggestion,
          title:
            (activeSettings.writingProfiles.find((p) => p.id === writingProfile)
              ?.name ?? t("情境")) +
            (settings.uiLanguage === "en" ? " suggestion" : "建議"),
          diff: pairedSameLanguage,
        },
      ]
    : result
      ? [{ value: result, title: t("Suggested text"), diff: true }]
      : [];
  return (
    <>
      <header>
        <img className="mark" src="/icon.png" alt="LangLoop" />
        <div>
          <h1>LangLoop</h1>
          <p>{t("Read. Write. Make it yours.")}</p>
        </div>
        <small>v{chrome.runtime.getManifest().version}</small>
      </header>
      <nav aria-label={t("Main navigation")}>
        {[
          ["assist", t("Assist")],
          ["cards", t("My learning")],
          ["settings", t("Settings")],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <main>
        {message && (
          <div role="status" className="notice">
            {t(message)}
            {message.includes("update_required:") && (
              <p>
                <button onClick={() => chrome.runtime.reload()}>
                  {t("Reload LangLoop")}
                </button>
              </p>
            )}
          </div>
        )}
        {tab === "assist" && (
          <>
            <div className="eyebrow">{t("WRITE WITH CONTEXT")}</div>
            <h2>{t("寫得清楚，也寫得得體。")}</h2>
            <p className="muted">{t("保留原意，並比較符合情境的建議版本。")}</p>
            <label>
              {t("Selected text or draft")}
              <textarea
                aria-label={t("Selected text or draft")}
                value={draft}
                maxLength={20000}
                placeholder="I look forward to hear from you."
                onChange={(e) => {
                  cancelled.current = true;
                  if (requestId.current)
                    void rpc("cancel", requestId.current).catch(() => {});
                  setDraft(e.target.value);
                  setSource(undefined);
                  setApplicable(false);
                  setResult(null);
                  setWritingPair(null);
                  setCanUndo(false);
                }}
              />
            </label>
            <div className="writing-selectors">
              <label>
                {t("情境")}
                <select
                  aria-label={t("寫作情境")}
                  disabled={busy}
                  value={writingProfile}
                  onChange={(e) => {
                    setWritingProfile(e.target.value);
                    setWritingPair(null);
                    setResult(null);
                  }}
                >
                  {activeSettings.writingProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("輸出語言")}
                <select
                  aria-label={t("寫作輸出語言")}
                  disabled={busy}
                  value={writingOutput}
                  onChange={(e) => {
                    setWritingOutput(e.target.value);
                    setWritingPair(null);
                    setResult(null);
                  }}
                >
                  <option value="original">{t("保持原文")}</option>
                  <option value="en">{t("英文")}</option>
                  <option value="zh-TW">繁體中文</option>
                </select>
              </label>
            </div>
            <div className="writing-manage">
              <button onClick={() => setTab("settings")}>
                {t("管理情境")}
              </button>
            </div>
            <button
              className="primary generate-writing"
              disabled={busy || !draft.trim()}
              onClick={() => void process("writing")}
            >
              {busy
                ? t("正在處理…")
                : writingPair
                  ? t("重新產生建議")
                  : t("產生建議")}
            </button>
            <details className="selection-tools">
              <summary>{t("選取文字工具")}</summary>
              <div className="actions">
                {(
                  ["translate", "explain", "correct", "rewrite"] as Operation[]
                ).map((op) => (
                  <button
                    disabled={busy || !draft.trim()}
                    key={op}
                    onClick={() => void process(op)}
                  >
                    {op === "correct"
                      ? t("Correct grammar")
                      : op === "rewrite"
                        ? t("Rewrite style")
                        : t(op[0].toUpperCase() + op.slice(1))}
                  </button>
                ))}
              </div>
            </details>
            <p className="caption">
              {t("Text is sent to")}{" "}
              {activeSettings.model || t("Your selected model")} ·{" "}
              {activeSettings.endpoint}
              {t(". Only when you ask.")}
            </p>
            {busy && (
              <button className="secondary" onClick={() => void action(stop)}>
                {t("Cancel request")}
              </button>
            )}
            {displayedResults.map(
              ({ value: result, title, diff: showDiff }, index) => {
                const diff = wordDifferences(original, result.result);
                return (
                  <section
                    className={
                      index === 1 ? "result paired-polished" : "result"
                    }
                    key={index}
                    aria-label={title}
                  >
                    <h3>{title}</h3>
                    {showDiff ? (
                      <details open>
                        <summary>{t("What changed")}</summary>
                        <p className="diff">
                          {diff.segments.map((part, i) =>
                            part.kind === "removed" ? (
                              <del key={i}>{part.text}</del>
                            ) : part.kind === "added" ? (
                              <ins key={i}>{part.text}</ins>
                            ) : (
                              <React.Fragment key={i}>
                                {part.text}
                              </React.Fragment>
                            ),
                          )}
                        </p>
                      </details>
                    ) : (
                      <p className="muted">
                        {t("原文：")}
                        {original}
                      </p>
                    )}
                    <h3>{t("Full suggestion")}</h3>
                    <p className="output">{result.result}</p>
                    <h3>{result.rule || t("Why it works")}</h3>
                    <p>{result.explanation}</p>
                    <div className="actions">
                      <button
                        onClick={() =>
                          void action(async () => {
                            await navigator.clipboard.writeText(result.result);
                            setMessage(t("Copied."));
                          })
                        }
                      >
                        {writingPair ? t("複製") : t("Copy")}
                      </button>
                      {applicable && source && (
                        <button
                          onClick={() =>
                            void action(async () => {
                              await rpc("page", {
                                tabId: source.tabId,
                                action: "apply",
                                data: {
                                  generation: source.generation,
                                  original,
                                  result: result.result,
                                },
                              });
                              setCanUndo(true);
                              setMessage(
                                t(
                                  "Applied. Undo is available until you edit the field.",
                                ),
                              );
                            })
                          }
                        >
                          {writingPair
                            ? t("套用至輸入框")
                            : t("Apply to field")}
                        </button>
                      )}
                      {canUndo && source && (
                        <button
                          onClick={() =>
                            void action(async () => {
                              await rpc("page", {
                                tabId: source.tabId,
                                action: "undo",
                              });
                              setCanUndo(false);
                              setMessage(t("Original draft restored."));
                            })
                          }
                        >
                          {t("Undo")}
                        </button>
                      )}
                      <button
                        className="primary"
                        onClick={() =>
                          void action(async () => {
                            await rpc("saveCard", {
                              id: crypto.randomUUID(),
                              original,
                              ...result,
                              createdAt: Date.now(),
                              ...(includeUrl && source
                                ? { sourceUrl: source.url }
                                : {}),
                            });
                            await refreshCards();
                            setMessage(t("Saved to My learning."));
                          })
                        }
                      >
                        {writingPair
                          ? t("儲存學習卡")
                          : t("Save learning card")}
                      </button>
                    </div>
                    {source && (
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={includeUrl}
                          onChange={(e) => setIncludeUrl(e.target.checked)}
                        />{" "}
                        {t("Include source URL in this card")}
                      </label>
                    )}
                  </section>
                );
              },
            )}
            <section className="article">
              <h3>{t("Keep reading, in two languages.")}</h3>
              <p className="muted">
                {t(
                  "Translate ordinary article paragraphs alongside the original.",
                )}
              </p>
              <div className="actions">
                <button disabled={busy} onClick={() => void translateArticle()}>
                  {t("Translate article")}
                </button>
                <button onClick={() => void restore()}>
                  {t("Restore original")}
                </button>
              </div>
            </section>
          </>
        )}
        {tab === "cards" && (
          <>
            <div className="eyebrow">{t("YOUR PERSONAL COLLECTION")}</div>
            <h2>{t("Small discoveries, kept.")}</h2>
            <p className="muted">
              {saved.length}
              {t("learning cards · stored on this device")}
            </p>
            {!saved.length && (
              <section className="empty">
                <h3>{t("Your next discovery belongs here.")}</h3>
                <p>
                  {t(
                    "Save an explanation or correction from Assist. Nothing is collected automatically.",
                  )}
                </p>
              </section>
            )}
            {saved
              .slice()
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((card) => (
                <section className="card" key={card.id}>
                  <h3>{card.rule || t("Language note")}</h3>
                  <p>{card.original}</p>
                  <details>
                    <summary>{t("Reveal explanation")}</summary>
                    <p className="output">{card.result}</p>
                    <p>{card.explanation}</p>
                    {card.sourceUrl && (
                      <p className="caption">
                        {t("Source:")}
                        {card.sourceUrl}
                      </p>
                    )}
                  </details>
                  <button
                    className="textbutton"
                    onClick={() =>
                      void action(async () => {
                        await rpc("deleteCard", card.id);
                        await refreshCards();
                      })
                    }
                  >
                    {t("Delete card")}
                  </button>
                </section>
              ))}
          </>
        )}
        {tab === "settings" && (
          <>
            <div
              className="settings-tabs"
              role="tablist"
              aria-label={t("Settings categories")}
            >
              {[
                ["general", "General"],
                ["ai", "AI connections"],
                ["writing", "Writing contexts"],
                ["privacy", "Data and privacy"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={settingsSection === id}
                  onClick={() => setSettingsSection(id)}
                >
                  {t(label)}
                </button>
              ))}
            </div>
            {settingsSection === "general" && (
              <div>
                {" "}
                <label>
                  {t("Interface language")}
                  <select
                    aria-label={t("Interface language")}
                    value={settings.uiLanguage}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        uiLanguage: e.target.value as Settings["uiLanguage"],
                      })
                    }
                  >
                    <option value="zh-TW">繁體中文</option>
                    <option value="en">English</option>
                  </select>
                </label>
                <p className="caption">
                  {t(
                    "Interface language is independent of translation output.",
                  )}
                </p>
                <label>
                  {t("Translation and explanation language")}
                  <select
                    value={settings.target}
                    onChange={(e) =>
                      setSettings({ ...settings, target: e.target.value })
                    }
                  >
                    <option value="zh-TW">繁體中文</option>
                    <option value="zh-CN">简体中文</option>
                    <option value="en">{t("English")}</option>
                    <option value="ja">日本語</option>
                    <option value="ko">한국어</option>
                  </select>
                </label>
                <label>
                  {t("Excluded domains (one per line)")}
                  <textarea
                    rows={3}
                    value={settings.excluded.join("\n")}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        excluded: e.target.value.split("\n"),
                      })
                    }
                  />
                </label>
              </div>
            )}
            {settingsSection === "writing" && (
              <WritingContexts settings={settings} onChange={setSettings} />
            )}
            <div hidden={settingsSection !== "ai"}>
              <h2>{t("AI connections")}</h2>
              <p className="muted">
                {t(
                  "Save multiple accounts for the same provider. Switching keeps other accounts signed in.",
                )}
              </p>
              <label>
                {t("Active connection")}
                <select
                  aria-label={t("Active connection")}
                  value={settings.connectionId}
                  disabled={busy}
                  onChange={(e) => void switchConnection(e.target.value)}
                >
                  {connections.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name} · {entry.setupKind}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("Connection name")}
                <input
                  value={connectionName}
                  maxLength={64}
                  onChange={(e) => setConnectionName(e.target.value)}
                />
              </label>
              <label htmlFor="new-provider">
                {t("New connection provider")}
                <select
                  id="new-provider"
                  aria-label={t("New connection provider")}
                  value={newProvider}
                  onChange={(e) =>
                    setNewProvider(e.target.value as Settings["setupKind"])
                  }
                >
                  <option value="chatgpt">ChatGPT</option>
                  {Object.entries(subscriptions).map(([id, p]) => (
                    <option key={id} value={id}>
                      {p.name}
                    </option>
                  ))}
                  <option value="custom">
                    {t("Custom OpenAI-compatible")}
                  </option>
                  <option value="ollama">Ollama</option>
                </select>
              </label>
              <div className="actions">
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const entry = await rpc("createConnection", {
                        setupKind: newProvider,
                      });
                      await switchConnection(entry.id);
                      setConnectionName("");
                    })
                  }
                >
                  {t("Add account connection")}
                </button>
                <button
                  disabled={busy || !connectionName.trim()}
                  onClick={() =>
                    void action(async () => {
                      await rpc("renameConnection", {
                        id: settings.connectionId,
                        name: connectionName,
                      });
                      setConnections(await rpc("connections"));
                      setConnectionName("");
                    })
                  }
                >
                  {t("Rename connection")}
                </button>
                <button
                  disabled={busy || connections.length < 2}
                  onClick={() =>
                    void action(async () => {
                      const name =
                        connections.find((e) => e.id === settings.connectionId)
                          ?.name || "";
                      if (
                        !window.confirm(
                          `${t("Remove this connection?")}\n\n${name}\n\n${t("This clears its saved login and settings. Other connections are kept.")}`,
                        )
                      )
                        return;
                      const next = await rpc(
                        "deleteConnection",
                        settings.connectionId,
                      );
                      setSettings(next);
                      setActiveSettings(next);
                      setAccount({ signedIn: false });
                      setConnections(await rpc("connections"));
                      setAccount(
                        await rpc(
                          isSubscription(next.setupKind)
                            ? "subscriptionStatus"
                            : "chatgptStatus",
                        ),
                      );
                    })
                  }
                >
                  {t("Remove connection")}
                </button>
              </div>
              <div className="eyebrow">{t("MAKE YOURSELF AT HOME")}</div>
              <h2>{t("Your model. Your choice.")}</h2>
              <p className="muted">
                {t(
                  "Choose how to connect your model. LangLoop has no account or server.",
                )}
              </p>
              <label>
                {t("Preset")}
                <select
                  value={settings.setupKind}
                  onChange={(e) => {
                    const kind = e.target.value as Settings["setupKind"];
                    setSettings({
                      ...settings,
                      setupKind: kind,
                      key: "",
                      endpoint:
                        kind === "chatgpt"
                          ? "https://chatgpt.com/backend-api/codex"
                          : kind === "ollama"
                            ? "http://localhost:11434/v1"
                            : isSubscription(kind)
                              ? subscriptions[kind].api
                              : settings.endpoint,
                    });
                  }}
                >
                  {Object.entries(subscriptions).map(([id, provider]) => (
                    <option key={id} value={id}>
                      {provider.name} · OAuth (experimental)
                    </option>
                  ))}
                  <option value="custom">
                    {t("Custom OpenAI-compatible")}
                  </option>
                  <option value="ollama">{t("Ollama on this computer")}</option>
                  <option value="chatgpt">
                    {t("ChatGPT · direct login (experimental)")}
                  </option>
                </select>
              </label>
              {isSubscription(settings.setupKind) && (
                <section className="setup-guide">
                  <h3>{subscriptions[settings.setupKind].name}</h3>
                  {account.error && <p role="alert">{account.error}</p>}
                  <p>
                    {account.signedIn
                      ? t("Account connected")
                      : t("Not signed in")}
                  </p>
                  <p className="caption">
                    {t(
                      "Direct subscription login is experimental. Account authorization and model availability must be tested separately.",
                    )}
                  </p>
                  <div className="actions">
                    {!account.signedIn && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            await rpc("saveSettings", settings);
                            const status = await rpc("subscriptionBegin");
                            if (
                              settingsRef.current.connectionId !==
                              settings.connectionId
                            )
                              return;
                            if (
                              settingsRef.current.connectionId !==
                              settings.connectionId
                            )
                              return;
                            setAccount(status);
                            setCallbackUrl("");
                          })
                        }
                      >
                        {t("Sign in")}
                      </button>
                    )}
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          const status = await rpc(
                            "subscriptionFinish",
                            callbackUrl ? { callback: callbackUrl } : {},
                          );
                          if (
                            settingsRef.current.connectionId !==
                            settings.connectionId
                          )
                            return;
                          setAccount(status);
                          if (status.signedIn) {
                            setCallbackUrl("");
                            await loadModels();
                          }
                        })
                      }
                    >
                      {t("Check sign-in")}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await rpc("subscriptionLogout");
                          setAccount({ signedIn: false });
                          setCallbackUrl("");
                          setModels(null);
                        })
                      }
                    >
                      {t("Sign out")}
                    </button>
                  </div>
                  {account.userCode && (
                    <p>
                      {t("Authorization code")}:{" "}
                      <strong>{account.userCode}</strong>
                    </p>
                  )}
                  {account.waiting && (
                    <label>
                      {t("Callback URL (only if automatic capture fails)")}
                      <input
                        autoComplete="off"
                        type="password"
                        value={callbackUrl}
                        onChange={(e) => setCallbackUrl(e.target.value)}
                      />
                    </label>
                  )}
                </section>
              )}
              {settings.setupKind === "chatgpt" && (
                <section className="setup-guide">
                  <h3>
                    {account.signedIn
                      ? t("ChatGPT account")
                      : t("Connect your ChatGPT account")}
                  </h3>
                  {!account.signedIn && (
                    <>
                      <p>
                        {t(
                          "Sign in directly from this extension. No local app or proxy service is required.",
                        )}
                      </p>
                      <p className="caption">
                        {t(
                          "Experimental: browser authorization and model access depend on your account and OpenAI. Signing in does not verify translation.",
                        )}
                      </p>
                    </>
                  )}
                  <p>
                    {account.signedIn
                      ? t("Account connected")
                      : t("Not signed in")}
                  </p>
                  {!account.signedIn && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          const allowed = await chrome.permissions.request({
                            origins: [
                              "https://auth.openai.com/*",
                              "https://chatgpt.com/*",
                            ],
                          });
                          if (!allowed)
                            throw new Error(
                              "permission_denied: Allow OpenAI access to sign in.",
                            );
                          setBusy(true);
                          try {
                            const login = await rpc("chatgptBegin");
                            setAccount({
                              signedIn: false,
                              userCode: login.userCode,
                            });
                            await chrome.tabs.create({ url: login.url });
                          } finally {
                            setBusy(false);
                          }
                        })
                      }
                    >
                      {t("Sign in to ChatGPT")}
                    </button>
                  )}
                  {!account.signedIn && account.userCode && (
                    <>
                      <p>
                        {t("Enter this code on the OpenAI page:")}{" "}
                        <strong>{account.userCode}</strong>
                      </p>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            setBusy(true);
                            try {
                              const result = await rpc("chatgptFinish");
                              setAccount(
                                await rpc(
                                  isSubscription(settingsRef.current.setupKind)
                                    ? "subscriptionStatus"
                                    : "chatgptStatus",
                                ),
                              );
                              setMessage(
                                result.pending
                                  ? t(
                                      "Waiting for authorization. Complete sign-in, then check again.",
                                    )
                                  : t(
                                      "Account connected. Choose a model and test translation.",
                                    ),
                              );
                            } finally {
                              setBusy(false);
                            }
                          })
                        }
                      >
                        {t("Check sign-in")}
                      </button>
                    </>
                  )}
                  {(account.signedIn || account.userCode) && (
                    <button
                      onClick={() =>
                        void action(async () => {
                          await rpc("chatgptLogout");
                          setSettings(settingsRef.current);
                          setAccount({ signedIn: false });
                          setModels(null);
                          setCatalogMessage("");
                          setVerification("");
                        })
                      }
                    >
                      {account.signedIn ? t("Sign out") : t("Cancel login")}
                    </button>
                  )}
                  <p className="caption">
                    {t("Choose a model below, then test the connection.")}
                  </p>
                </section>
              )}
              {settings.setupKind !== "chatgpt" &&
                !isSubscription(settings.setupKind) && (
                  <label>
                    {t("API base URL")}
                    <input
                      value={settings.endpoint}
                      onChange={(e) =>
                        setSettings({ ...settings, endpoint: e.target.value })
                      }
                    />
                  </label>
                )}
              {(settings.setupKind !== "chatgpt" || account.signedIn) && (
                <section className="model-picker">
                  <button
                    disabled={catalogBusy}
                    onClick={() => void loadModels()}
                  >
                    {catalogBusy
                      ? t("Loading models…")
                      : t("Load / refresh models")}
                  </button>
                  <p className="caption" aria-live="polite">
                    {catalogMessage}
                  </p>
                  {models !== null && (
                    <>
                      <label>
                        {t("Search models")}
                        <input
                          value={modelSearch}
                          onChange={(e) => setModelSearch(e.target.value)}
                        />
                      </label>
                      <label>
                        {t("Available models")}
                        <select
                          value={
                            models.includes(settings.model) &&
                            settings.model
                              .toLowerCase()
                              .includes(modelSearch.toLowerCase())
                              ? settings.model
                              : ""
                          }
                          onChange={(e) => {
                            if (e.target.value)
                              setSettings({
                                ...settings,
                                model: e.target.value,
                              });
                          }}
                        >
                          <option value="">{t("Choose a model")}</option>
                          {models
                            .filter((id) =>
                              id
                                .toLowerCase()
                                .includes(modelSearch.toLowerCase()),
                            )
                            .map((id) => (
                              <option key={id} value={id}>
                                {id}
                              </option>
                            ))}
                        </select>
                      </label>
                      {settings.model && !models.includes(settings.model) && (
                        <p className="caption">
                          {t(
                            "Selected model is absent from the latest catalog. You can still edit or test it.",
                          )}
                        </p>
                      )}
                    </>
                  )}
                  <p className="caption">
                    {t(
                      "You can always enter a model manually below. Listed models have not yet been verified.",
                    )}
                  </p>
                </section>
              )}
              <details
                open={settings.setupKind !== "chatgpt" || !models?.length}
              >
                <summary>{t("Enter a model manually")}</summary>
                <label>
                  {t("Model")}
                  <input
                    placeholder={t(
                      "Enter the model installed or offered by your provider",
                    )}
                    value={settings.model}
                    onChange={(e) =>
                      setSettings({ ...settings, model: e.target.value })
                    }
                  />
                </label>
              </details>
              {settings.setupKind !== "chatgpt" &&
                !isSubscription(settings.setupKind) && (
                  <>
                    <label>
                      {t("API key (optional for local models)")}
                      <input
                        autoComplete="off"
                        type={showKey ? "text" : "password"}
                        value={settings.key}
                        onChange={(e) =>
                          setSettings({ ...settings, key: e.target.value })
                        }
                      />
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={showKey}
                        onChange={(e) => setShowKey(e.target.checked)}
                      />{" "}
                      {t("Show key")}
                    </label>
                  </>
                )}

              <p
                className="verification"
                role="status"
                aria-label={t("Connection test result")}
                aria-live="polite"
              >
                {(verification && t(verification)) ||
                  t("Configuration not verified in this session.")}
              </p>
            </div>
            <div className="actions">
              <button
                className="primary"
                hidden={settingsSection !== "ai"}
                disabled={busy}
                onClick={() => void connect()}
              >
                {testing
                  ? t("Testing connection…")
                  : t("Save & test connection")}
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const committed = await rpc("saveSettings", settings);
                    setSettings(committed);
                    setActiveSettings(committed);
                    setWritingProfile(committed.writingProfileId);
                    setWritingOutput(committed.writingTarget);
                    setWritingPair(null);
                    setMessage(
                      t(
                        "Settings saved. Connect to allow provider access before inference.",
                      ),
                    );
                  })
                }
              >
                {t("Save settings")}
              </button>
            </div>
            <p className="caption">
              {t(
                "Keys stay in local extension storage, not encrypted vault storage. Cloud services receive requested text under their own policies. Ollama requires a running model and permission for this extension origin.",
              )}
            </p>
            <section hidden={settingsSection !== "privacy"}>
              <h3>{t("Backup & privacy")}</h3>
              <div className="actions">
                <button
                  onClick={() =>
                    void action(async () => {
                      const data = await rpc("export");
                      const url = URL.createObjectURL(
                        new Blob([JSON.stringify(data, null, 2)], {
                          type: "application/json",
                        }),
                      );
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "langloop-backup.json";
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                      setMessage(t("Backup exported without API keys."));
                    })
                  }
                >
                  {t("Export backup")}
                </button>
                <button
                  onClick={() =>
                    void action(async () => {
                      await rpc("clearCache");
                      setMessage(t("Translation cache cleared."));
                    })
                  }
                >
                  {t("Clear translation cache")}
                </button>
              </div>
              <label>
                {t("Import backup")}
                <input
                  type="file"
                  accept="application/json"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file)
                      void action(async () => {
                        if (file.size > 10000000)
                          throw new Error(t("Backup is too large."));
                        const report = await rpc(
                          "import",
                          JSON.parse(await file.text()),
                        );
                        await refreshCards();
                        setMessage(
                          settings.uiLanguage === "en"
                            ? `Imported ${report.added}; skipped ${report.skipped}. Imported preferences are shown below; Save settings to apply them.`
                            : `已匯入 ${report.added} 筆，略過 ${report.skipped} 筆。匯入偏好已顯示，請儲存設定以套用。`,
                        );
                        setSettings({
                          ...report.preferences,
                          connectionId: settings.connectionId,
                          key: "",
                          version: 1,
                        });
                      });
                  }}
                />
              </label>
            </section>
          </>
        )}
      </main>
      <footer>{t("READ BETTER · WRITE BETTER · LEARN FROM BOTH")}</footer>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
