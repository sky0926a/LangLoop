// Injected on explicit toolbar click; no page scripts or credentials are exposed.
export function mountWidget(
  language: "en" | "zh-TW" = "zh-TW",
  messages: [string, string][] = [],
  translateImmediately = false,
) {
  const translations = new Map(
    messages.flatMap(([en, zh]) => [
      [en, language === "en" ? en : zh],
      [zh, language === "en" ? en : zh],
    ]),
  );
  const t = (value: string) => translations.get(value) ?? value;
  function refreshLanguage(next: "en" | "zh-TW") {
    if (language === next) return;
    language = next;
    translations.clear();
    for (const [en, zh] of messages) {
      translations.set(en, next === "en" ? en : zh);
      translations.set(zh, next === "en" ? en : zh);
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.parentElement?.closest("[data-user-content],style"))
        node.textContent = t(node.textContent ?? "");
    }
    for (const el of root.querySelectorAll("[title],[aria-label]")) {
      for (const attr of ["title", "aria-label"]) {
        const value = el.getAttribute(attr);
        if (value) el.setAttribute(attr, t(value));
      }
    }
    clampPosition();
  }
  const scope = globalThis as any;
  if (scope.__langloopWidget) {
    scope.__langloopWidget.hidden = false;
    if (translateImmediately) scope.__langloopTranslate?.();
    return;
  }
  const host = document.createElement("div");
  scope.__langloopWidget = host;
  host.style.cssText =
    "position:fixed;right:20px;bottom:20px;z-index:2147483647";
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `:host{all:initial}section{box-sizing:border-box;max-height:calc(100vh - 16px);overflow:auto;width:328px;max-width:calc(100vw - 16px);padding:14px;background:#f8f9ff;color:#28314d;border:1px solid #cdd5ee;border-radius:14px;box-shadow:0 6px 28px #0003;font:14px/1.5 system-ui}button{font:inherit;background:#fff;color:#4b4f94;border:1px solid #cdd5ee;border-radius:7px;padding:7px 10px;margin:3px;cursor:pointer}button:disabled{opacity:.5}button:not([hidden]){display:inline-flex;align-items:center}button:focus-visible{outline:2px solid #7770df;outline-offset:2px}p{white-space:pre-wrap;max-height:200px;overflow:auto;margin:8px 0}strong{display:block}.heading{display:flex;align-items:center;gap:8px;margin-bottom:12px}.heading strong{flex:1}.writing-heading{position:sticky;top:-14px;z-index:2;background:#f8f9ff;margin:-14px -14px 12px;padding:14px;border-bottom:1px solid #dfe3f0}.heading button{margin:0;padding:5px 8px}.hint{font-size:12px;color:#6b7391}button[aria-pressed=true]{background:#ecebff;border-color:#827add}.primary{background:#5659bd;color:white;border-color:#5659bd}.page-actions{display:flex;flex-wrap:wrap;gap:4px}section>p[role=status]{font-size:12px;color:#646e89;border-top:1px solid #e1e5f3;padding-top:12px}del{color:#962a2a;background:#fce7e7;text-decoration:line-through}ins{color:#4059a6;background:#e8edff;text-decoration:none}del+ins{margin-left:4px}.writing-selectors{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0 8px}.writing-selectors label{font-size:12px;color:#69728c}.writing-selectors select{display:block;width:100%;margin-top:5px;padding:8px;border:1px solid #cdd5ee;border-radius:8px;background:#fff;color:#28314d;font:14px system-ui}.writing-result{border-top:1px solid #dfe3f0;margin-top:16px;padding-top:12px}.writing-result.polished{background:#f0efff;border:0;border-radius:10px;padding:12px}.writing-result .heading{margin-bottom:8px}.writing-result p{max-height:none}.generate{width:100%;justify-content:center;margin:12px 0 0}.writing-tools{display:flex;justify-content:flex-end}.full-label{font-size:12px;color:#69728c;margin-top:10px}h4{font:600 13px system-ui;margin:12px 0 6px}`;
  const mini = document.createElement("button");
  function brandIcon(size: number) {
    const img = document.createElement("img");
    img.src = chrome.runtime.getURL("icon.png");
    img.alt = "";
    img.style.cssText = `width:${size}px;height:${size}px;display:block;border-radius:7px;pointer-events:none`;
    return img;
  }
  mini.append(brandIcon(28));
  mini.title = t("校正這個輸入框");
  mini.setAttribute("aria-label", t("LangLoop 校正此輸入框"));
  mini.style.cssText =
    "position:fixed;box-sizing:border-box;width:28px;height:28px;padding:0;margin:0;border:0;border-radius:7px;background:#eef1ff;overflow:hidden;box-shadow:0 1px 4px #0002";
  mini.hidden = true;
  mini.addEventListener("mousedown", (e) => e.preventDefault());
  const suggestion = document.createElement("section");
  suggestion.hidden = true;
  suggestion.style.cssText =
    "position:fixed;width:410px;z-index:1;resize:vertical;min-height:180px;height:min(400px,50vh)";
  suggestion.setAttribute("role", "dialog");
  suggestion.setAttribute("aria-label", t("輸入框校正建議"));
  const suggestionTitle = document.createElement("strong");
  suggestionTitle.textContent = t("寫作建議");
  suggestion.append(suggestionTitle);
  const box = document.createElement("section");
  const title = document.createElement("strong");
  title.textContent = "LangLoop";
  title.style.cssText = "cursor:move;touch-action:none;user-select:none";
  title.title = t("拖曳移動 LangLoop");
  const heading = document.createElement("div");
  heading.className = "heading";
  heading.append(title);
  box.append(heading);
  const description = document.createElement("p");
  description.className = "hint";
  description.textContent = t("保留原文，在段落下方顯示翻譯。");
  box.append(description);
  const launcher = document.createElement("button");
  launcher.append(brandIcon(28), document.createTextNode("LangLoop"));
  launcher.setAttribute("aria-label", t("開啟 LangLoop 網頁工具"));
  box.hidden = true;
  launcher.style.cssText =
    "cursor:grab;touch-action:none;user-select:none;align-items:center;gap:7px";
  let dragged = false;
  launcher.addEventListener("mousedown", (e) => e.preventDefault());
  launcher.addEventListener("click", (e) => {
    if (e.isTrusted && !dragged) {
      box.hidden = false;
      launcher.hidden = true;
      clampPosition();
    }
  });
  root.append(style, launcher, box, mini, suggestion);
  document.documentElement.append(host);
  let dockSide: "left" | "right" = "right";
  let dockY = Math.max(8, innerHeight - 70);
  function clampPosition() {
    const rect = host.getBoundingClientRect();
    host.style.bottom = "auto";
    host.style.left = dockSide === "left" ? "8px" : "auto";
    host.style.right = dockSide === "right" ? "8px" : "auto";
    host.style.top = `${Math.max(8, Math.min(innerHeight - rect.height - 8, dockY))}px`;
  }
  clampPosition();
  for (const grip of [launcher, title]) {
    let start: { x: number; y: number; left: number; top: number } | null =
      null;
    grip.addEventListener("pointerdown", (e) => {
      if (!e.isTrusted || e.button !== 0) return;
      dragged = false;
      const rect = host.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
      grip.setPointerCapture(e.pointerId);
    });
    grip.addEventListener("pointermove", (e) => {
      if (!start) return;
      const dx = e.clientX - start.x,
        dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) > 5) dragged = true;
      if (!dragged) return;
      const rect = host.getBoundingClientRect();
      host.style.right = "auto";
      host.style.bottom = "auto";
      host.style.left = `${Math.max(8, Math.min(innerWidth - rect.width - 8, start.left + dx))}px`;
      host.style.top = `${Math.max(8, Math.min(innerHeight - rect.height - 8, start.top + dy))}px`;
    });
    const finish = () => {
      if (start && dragged) {
        const rect = host.getBoundingClientRect();
        dockSide =
          rect.left + rect.width / 2 < innerWidth / 2 ? "left" : "right";
        dockY = rect.top;
        clampPosition();
      }
      start = null;
    };
    grip.addEventListener("pointerup", finish);
    grip.addEventListener("pointercancel", finish);
  }
  window.addEventListener("resize", clampPosition);
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id || message?.type !== "uiLanguage")
      return;
    const next = message.language;
    if (next === "en" || next === "zh-TW") refreshLanguage(next);
  });
  let busy = false,
    stopped = false,
    editor: HTMLElement | null = null;
  let translating = false,
    translated = false,
    canUndo = false,
    invalidated = false;
  const pageStatus = document.createElement("p");
  pageStatus.setAttribute("role", "status");
  pageStatus.textContent = t("按下翻譯才會開始處理此頁。");
  const writingStatus = document.createElement("p");
  writingStatus.setAttribute("role", "status");
  let status = pageStatus;
  const preview = document.createElement("div");
  const buttons: HTMLButtonElement[] = [];
  async function rpc(action: string, data?: unknown): Promise<any> {
    if (!chrome.runtime.id) {
      invalidated = true;
      throw new Error(t("擴充功能已更新，請重新整理此頁後再使用 LangLoop。"));
    }
    const r = await chrome.runtime.sendMessage({
      type: "inline",
      payload: { action, data },
    });
    if (r.status !== "ok") throw new Error(r.error.message);
    return r.data;
  }
  async function perform(fn: () => Promise<void>) {
    if (busy) return;
    busy = true;
    stopped = false;
    buttons.forEach((b) => (b.disabled = true));
    try {
      await fn();
    } catch (e) {
      const message = String(e).replace(/^Error: /, "");
      invalidated ||= /Extension context invalidated/i.test(message);
      status.textContent = invalidated
        ? t("擴充功能已更新，請重新整理此頁後再使用 LangLoop。")
        : stopped
          ? t("已停止，可還原已翻譯的內容。")
          : message;
    } finally {
      busy = false;
      translating = false;
      updateControls();
      positionMini();
    }
  }
  function button(label: string, fn: () => void, lock = true) {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", (e) => {
      if (e.isTrusted) fn();
    });
    box.append(b);
    if (lock) buttons.push(b);
    return b;
  }
  const startTranslation = () =>
    void perform(async () => {
      translating = true;
      status = pageStatus;
      updateControls();
      suggestion.hidden = true;
      status.textContent = t("正在讀取頁面…");
      const extracted = await rpc("extract");
      if (!extracted.blocks.length)
        throw new Error(t("此頁沒有可翻譯的段落。"));
      let count = 0;
      for (const group of extracted.groups) {
        if (stopped) break;
        status.textContent =
          language === "en"
            ? `Translating ${count} / ${extracted.blocks.length} paragraphs…`
            : `正在翻譯 ${count} / ${extracted.blocks.length} 段…`;
        const data = await rpc("article", {
          blocks: group.map(({ id, text }: any) => ({ id, text })),
          generation: extracted.generation,
        });
        if (stopped) break;
        const inserted = (
          await rpc("insert", {
            generation: extracted.generation,
            translations: data.translations,
          })
        ).inserted;
        count += inserted;
        translated ||= inserted > 0;
      }
      status.textContent = stopped
        ? t("已停止。可還原已翻譯的內容。")
        : language === "en"
          ? `Translated ${count} paragraphs.`
          : `已翻譯 ${count} 段。`;
    });
  const translate = button(t("翻譯網頁"), startTranslation);
  scope.__langloopTranslate = () => {
    box.hidden = false;
    launcher.hidden = true;
    clampPosition();
    startTranslation();
  };
  const restore = button(
    t("還原網頁"),
    () =>
      void perform(async () => {
        suggestion.hidden = true;
        status = pageStatus;
        await rpc("restore");
        translated = false;
        status.textContent = t("已還原網頁。");
      }),
  );
  let pair: any = null;
  let optionsLoaded = false;
  let draftSnapshot = "";
  let applying = false;
  let stale = false;
  let localDraftDirty = false;
  const draftLabel = document.createElement("label");
  draftLabel.textContent = t("Original draft");
  const draftInput = document.createElement("textarea");
  draftInput.setAttribute("aria-label", t("Original draft"));
  draftInput.dataset.userContent = "";
  draftInput.maxLength = 20000;
  draftInput.rows = 3;
  draftInput.style.cssText =
    "box-sizing:border-box;width:100%;resize:vertical;padding:10px;margin-top:6px;border:1px solid #cdd5ee;border-radius:8px;font:14px/1.5 system-ui;color:#28314d;background:white";
  draftLabel.append(draftInput);
  draftInput.addEventListener("input", () => {
    localDraftDirty = true;
    stale = true;
    writingStatus.textContent = t(
      "Draft changed. Generate again to update suggestions.",
    );
    updateControls();
  });
  function draftText() {
    return editor
      ? editor instanceof HTMLTextAreaElement
        ? editor.value
        : editor.innerText
      : "";
  }
  const selectors = document.createElement("div");
  selectors.className = "writing-selectors";
  function selectField(label: string) {
    const wrapper = document.createElement("label");
    wrapper.textContent = label;
    const select = document.createElement("select");
    select.setAttribute("aria-label", label);
    wrapper.append(select);
    selectors.append(wrapper);
    return select;
  }
  const profileSelect = selectField(t("情境"));
  const outputSelect = selectField(t("輸出語言"));
  for (const [value, label] of [
    ["auto", t("Auto-detect (keep input language)")],
    ["original", t("保持原文")],
    ["en", t("英文")],
    ["zh-TW", "繁體中文"],
    ["ja", "日本語"],
    ["ko", "한국어"],
  ]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    outputSelect.append(option);
  }
  function discardResults() {
    pair = null;

    preview.replaceChildren();
    generate.textContent = t("產生建議");
    updateControls();
  }
  for (const select of [profileSelect, outputSelect])
    select.addEventListener("change", () => {
      stale = true;
      updateControls();
      writingStatus.textContent = t("已切換選項，按下產生建議後更新。");
      positionMini();
    });
  async function applyVariant(value: any) {
    applying = true;
    try {
      await rpc("apply", value);
      canUndo = true;
      draftSnapshot = draftText();
      pair.baseline.original = pair.suggestion.original = draftSnapshot;
      writingStatus.textContent = t("已套用至輸入框，尚未送出。");
    } finally {
      applying = false;
    }
  }
  const apply = button(
    t("套用"),
    () => void perform(() => applyVariant(pair.baseline)),
  );
  apply.setAttribute("aria-label", t("套用基本版本"));
  const applySuggested = button(
    t("套用"),
    () => void perform(() => applyVariant(pair.suggestion)),
  );
  applySuggested.setAttribute("aria-label", t("套用情境建議"));
  apply.hidden = applySuggested.hidden = true;
  const undo = button(
    t("復原套用"),
    () =>
      void perform(async () => {
        applying = true;
        try {
          await rpc("undo");
          draftSnapshot = draftText();
          if (pair)
            pair.baseline.original = pair.suggestion.original = draftSnapshot;
          canUndo = false;
        } finally {
          applying = false;
        }
        writingStatus.textContent = t("已復原輸入內容。");
      }),
  );
  const closeSuggestion = button(
    t("關閉建議"),
    () => {
      suggestion.hidden = true;
    },
    false,
  );
  closeSuggestion.style.cssText = "margin-left:auto";
  const writingHeading = document.createElement("div");
  writingHeading.className = "heading writing-heading";
  const toggleHeight = button(
    t("Expand height"),
    () => {
      const compact = Math.min(400, innerHeight * 0.5);
      const expanded = suggestion.getBoundingClientRect().height > compact + 1;
      suggestion.style.height = `${expanded ? compact : compact * 2}px`;
      toggleHeight.textContent = t(
        expanded ? "Expand height" : "Compact height",
      );
      positionMini();
    },
    false,
  );
  writingHeading.append(suggestionTitle, toggleHeight, closeSuggestion);
  suggestionTitle.textContent = t("LangLoop 寫作助手");
  const manage = button(
    t("管理情境"),
    () =>
      void rpc("settings").catch(
        (e) => (writingStatus.textContent = String(e)),
      ),
  );
  const writingTools = document.createElement("div");
  writingTools.className = "writing-tools";
  writingTools.append(manage);
  function renderVariant(value: any, label: string, primary: boolean) {
    const card = document.createElement("div");
    card.className = "writing-result" + (primary ? "" : " polished");
    const row = document.createElement("div");
    row.className = "heading";
    const title = document.createElement("strong");
    title.textContent = label;
    row.append(title, primary ? apply : applySuggested);
    card.append(row);
    if (pair.sameLanguage) {
      const comparison = document.createElement("p");
      comparison.dataset.userContent = "";
      if (primary) comparison.dataset.correctionDiff = "";
      else comparison.dataset.suggestionDiff = "";
      for (const part of value.changes.segments) {
        if (part.kind === "equal")
          comparison.append(document.createTextNode(part.text));
        else {
          const node = document.createElement(
            part.kind === "removed" ? "del" : "ins",
          );
          node.textContent = part.text;
          comparison.append(node);
        }
      }
      card.append(comparison);
    } else if (primary) {
      const original = document.createElement("p");
      original.className = "hint";
      original.dataset.userContent = "";
      original.textContent = t("原文：") + (value.draft ?? value.original);
      card.append(original);
    }
    const fullLabel = document.createElement("div");
    fullLabel.className = "full-label";
    fullLabel.textContent = t("完整建議");
    const full = document.createElement("p");
    full.dataset.userContent = "";
    full.textContent = value.result;
    full.dataset.writingOutput = primary ? "baseline" : "suggestion";
    const why = document.createElement("p");
    why.className = "hint";
    why.dataset.userContent = "";
    why.textContent = value.explanation;
    card.append(fullLabel, full, why);
    preview.append(card);
  }
  const generate = button(
    t("產生建議"),
    () =>
      void perform(async () => {
        status = writingStatus;
        discardResults();
        if (!editor || !editable(editor) || !draftInput.value.trim())
          throw new Error(t("請先在輸入框輸入文字。"));
        const target = editor;
        const original = draftText();
        draftSnapshot = original;
        editor.focus();
        writingStatus.textContent = t("正在產生兩個版本…");
        const response = await rpc("writing", {
          profileId: profileSelect.value,
          target: outputSelect.value,
          draft: draftInput.value,
        });
        if (
          target !== editor ||
          !target.isConnected ||
          original !== draftText()
        )
          throw new Error(t("文字已變更，請重新產生建議。"));
        pair = response;
        stale = false;

        renderVariant(
          pair.baseline,
          pair.sameLanguage ? t("基本校正") : t("忠實翻譯"),
          true,
        );
        renderVariant(
          pair.suggestion,
          (profileSelect.selectedOptions[0]?.textContent ?? t("情境")) +
            (language === "en" ? " suggestion" : "建議"),
          false,
        );
        generate.textContent = t("重新產生建議");
        writingStatus.textContent = t("選一個版本套用，不會自動送出訊息。");
        // Scroll only the assistant, keeping the page and editor in place.
        const firstResult = preview.firstElementChild;
        if (!suggestion.hidden && firstResult) {
          suggestion.scrollTop +=
            firstResult.getBoundingClientRect().top -
            writingHeading.getBoundingClientRect().bottom - 8;
        }
      }),
  );
  generate.className = "primary generate";
  suggestion.replaceChildren(
    writingHeading,
    draftLabel,
    selectors,
    writingTools,
    generate,
    preview,
    writingStatus,
    undo,
  );
  mini.addEventListener("click", (e) => {
    if (!e.isTrusted || busy || !draftText().trim()) return;
    box.hidden = true;
    launcher.hidden = false;
    clampPosition();
    suggestion.hidden = false;
    status = writingStatus;
    void perform(async () => {
      const target = editor;
      const options = await rpc("writingOptions");
      if (target !== editor || !draftText().trim()) {
        suggestion.hidden = true;
        return;
      }
      const selected = optionsLoaded ? profileSelect.value : options.profileId;
      const oldChoices = Array.from(profileSelect.options)
        .map((o) => o.value + ":" + o.textContent)
        .join("|");
      profileSelect.replaceChildren();
      for (const item of options.profiles) {
        const option = document.createElement("option");
        option.value = item.id;
        option.dataset.userContent = "";
        option.textContent = item.name;
        profileSelect.append(option);
      }
      profileSelect.value = options.profiles.some((p: any) => p.id === selected)
        ? selected
        : options.profileId;
      if (!optionsLoaded) outputSelect.value = options.target;
      if (
        oldChoices !==
        Array.from(profileSelect.options)
          .map((o) => o.value + ":" + o.textContent)
          .join("|")
      )
        discardResults();
      optionsLoaded = true;
      writingStatus.textContent = pair
        ? t("選一個版本套用，不會自動送出訊息。")
        : t("選擇情境與語言，按下產生建議。");
    });
    positionMini();
  });
  const stop = button(
    t("停止"),
    () => {
      if (!translating || stopped) return;
      stopped = true;
      stop.disabled = true;
      pageStatus.textContent = t("正在停止…");
      void rpc("stop").catch(() => {});
    },
    false,
  );
  const settings = button(
    t("設定"),
    () => void rpc("settings").catch((e) => (status.textContent = String(e))),
  );
  const collapse = button(
    t("收起"),
    () => {
      box.hidden = true;
      launcher.hidden = false;
      clampPosition();
    },
    false,
  );
  heading.append(settings, collapse);
  const pageActions = document.createElement("div");
  pageActions.className = "page-actions";
  translate.className = "primary";
  pageActions.append(translate, restore, stop);
  box.append(pageActions, pageStatus);
  function updateControls() {
    buttons.forEach((b) => (b.disabled = busy || invalidated));
    mini.disabled = busy || invalidated;
    restore.disabled ||= !translated;
    stop.hidden = !translating;
    stop.disabled = !translating || stopped || invalidated;
    apply.hidden = applySuggested.hidden = !pair || invalidated;
    profileSelect.disabled = outputSelect.disabled = busy || invalidated;
    generate.disabled ||= !optionsLoaded || !draftInput.value.trim();
    draftInput.disabled = busy || invalidated;
    apply.disabled ||= stale;
    applySuggested.disabled ||= stale;
    undo.hidden = !canUndo || invalidated;
  }
  updateControls();
  function editable(field: HTMLElement) {
    return (
      field.isConnected &&
      !field.closest(
        '[inert],[data-sensitive],[aria-disabled="true"],[aria-readonly="true"]',
      ) &&
      !field.matches(":disabled") &&
      (field instanceof HTMLTextAreaElement
        ? !field.readOnly
        : field.isContentEditable) &&
      getComputedStyle(field).pointerEvents !== "none"
    );
  }
  let restoreEditorStyle: (() => void) | undefined;
  function releaseEditor() {
    restoreEditorStyle?.();
    restoreEditorStyle = undefined;
    if (editor) resizeObserver.unobserve(editor);
    const form = editor?.closest("form");
    if (form) resizeObserver.unobserve(form);
  }
  function trackFocus(target: HTMLElement) {
    if (target === host) return;
    const field = target.closest(
      "textarea,[contenteditable]",
    ) as HTMLElement | null;
    if (
      !field ||
      !editable(field) ||
      field.closest("[data-sensitive]") ||
      (field instanceof HTMLTextAreaElement &&
        (field.disabled ||
          field.readOnly ||
          /password|credit|cc-|one-time-code/i.test(
            [field.id, field.name, field.autocomplete].join(" "),
          )))
    ) {
      if (!busy) {
        releaseEditor();
        editor = null;
        mini.hidden = true;
        suggestion.hidden = true;
      }
      return;
    }
    if (editor !== field) {
      releaseEditor();
      editor = field;
      // Reserve a text-free lane while focused. Restore only our own values.
      const saved = ["padding-right", "box-sizing"].map((name) => ({
        name,
        value: field.style.getPropertyValue(name),
        priority: field.style.getPropertyPriority(name),
      }));
      const padding = `${parseFloat(getComputedStyle(field).paddingRight) + 36}px`;
      field.style.setProperty("padding-right", padding, "important");
      field.style.setProperty("box-sizing", "border-box", "important");
      restoreEditorStyle = () => {
        for (const item of saved) {
          const ours = item.name === "padding-right" ? padding : "border-box";
          if (field.style.getPropertyValue(item.name) === ours) {
            if (item.value)
              field.style.setProperty(item.name, item.value, item.priority);
            else field.style.removeProperty(item.name);
          }
        }
      };
      resizeObserver.observe(field);
      const form = field.closest("form");
      if (form) resizeObserver.observe(form);
      suggestion.hidden = true;

      canUndo = false;
      draftSnapshot = draftText();
      draftInput.value = draftSnapshot;
      localDraftDirty = false;
      stale = false;
      discardResults();
    }
    positionMini();
  }
  function positionMini() {
    if (invalidated) {
      mini.hidden = true;
      return;
    }
    if (!editor || !editable(editor) || !draftText().trim() || invalidated) {
      mini.hidden = true;
      suggestion.hidden = true;
      return;
    }
    const rect = editor.getBoundingClientRect();
    mini.hidden =
      rect.width < 1 ||
      rect.height < 1 ||
      rect.bottom < 0 ||
      rect.top > innerHeight;
    // Keep the badge within both the text field and the composer, never beside it.
    const form = editor.closest("form");
    // Draft.js exposes a one-line text node region, not the visible input shell.
    const draftRoot = editor.closest(".DraftEditor-root");
    const draftShell = draftRoot?.closest(".editor");
    const shellRect = draftShell?.getBoundingClientRect();
    const anchor =
      shellRect &&
      shellRect.width >= rect.width &&
      shellRect.height >= rect.height &&
      shellRect.height <= rect.height + 100
        ? shellRect
        : (form?.getBoundingClientRect() ?? rect);
    const right = Math.min(rect.right, anchor.right, innerWidth) - 4;
    const singleLine = anchor.height <= 80;
    const top = Math.max(
      singleLine ? anchor.top : Math.max(rect.top, anchor.top),
      0,
    );
    const bottom = Math.min(
      singleLine ? anchor.bottom : Math.min(rect.bottom, anchor.bottom),
      innerHeight,
    );
    const size = Math.min(28, Math.floor(bottom - top - 2));
    mini.style.width = mini.style.height = `${Math.max(18, size)}px`;
    const icon = mini.querySelector("img")!;
    icon.style.width = icon.style.height = `${Math.max(18, size)}px`;
    const x = right - size;
    const desired = singleLine
      ? anchor.top + (anchor.height - size) / 2
      : bottom - size - 2;
    const y = Math.max(top, Math.min(bottom - size, desired));
    const blocked = Array.from(
      form?.querySelectorAll("button,[role=button]") ?? [],
    ).some((control) => {
      const r = control.getBoundingClientRect();
      return (
        r.width > 0 &&
        r.height > 0 &&
        x < r.right &&
        x + size > r.left &&
        y < r.bottom &&
        y + size > r.top
      );
    });
    mini.hidden ||= x < rect.left || size < 18 || blocked;
    mini.style.top = `${y}px`;
    mini.style.left = `${x}px`;
    if (!suggestion.hidden) {
      const width = suggestion.getBoundingClientRect().width;
      const compact = Math.min(400, innerHeight * 0.5);
      const desired = Math.min(
        parseFloat(suggestion.style.height) || compact,
        innerHeight - 16,
      );
      const below = innerHeight - anchor.bottom - 12;
      const above = anchor.top - 12;
      const useBelow = below >= desired || below >= above;
      const top = Math.max(
        8,
        Math.min(
          innerHeight - desired - 8,
          useBelow ? anchor.bottom + 8 : anchor.top - desired - 8,
        ),
      );
      suggestion.style.minHeight = `${Math.min(180, innerHeight - 16)}px`;
      suggestion.style.maxHeight = `${Math.max(80, innerHeight - top - 8)}px`;
      suggestion.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, anchor.right - width))}px`;
      suggestion.style.top = `${top}px`;
      toggleHeight.textContent = t(
        suggestion.getBoundingClientRect().height > compact + 1
          ? "Compact height"
          : "Expand height",
      );
    }
  }
  document.addEventListener("scroll", positionMini, true);
  window.addEventListener("resize", positionMini);
  function draftChanged() {
    if (!applying && editor && draftText() !== draftSnapshot) {
      draftSnapshot = draftText();
      if (!localDraftDirty) draftInput.value = draftSnapshot;
      stale = true;
      canUndo = false;
      updateControls();
      if (!busy) writingStatus.textContent = t("文字已變更，請重新產生建議。");
    }
    positionMini();
  }
  document.addEventListener("input", draftChanged, true);
  const resizeObserver = new ResizeObserver(positionMini);
  resizeObserver.observe(document.documentElement);
  const editorStateObserver = new MutationObserver(() => {
    if (editor) draftChanged();
    if (editor && !editable(editor)) {
      releaseEditor();
      editor = null;
      mini.hidden = true;
      suggestion.hidden = true;
    }
  });
  editorStateObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      "readonly",
      "disabled",
      "contenteditable",
      "aria-disabled",
      "aria-readonly",
      "inert",
    ],
  });
  document.addEventListener("focusin", (e) =>
    trackFocus(e.target as HTMLElement),
  );
  if (document.activeElement instanceof HTMLElement)
    trackFocus(document.activeElement);
  if (translateImmediately) scope.__langloopTranslate();
}
