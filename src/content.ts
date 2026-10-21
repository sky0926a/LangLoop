// Executes only after an explicit extension action, in Chrome's isolated world.
export function pageAction(action: string, payload: any) {
  const scope = globalThis as any;
  const state = (scope.__langloop ??= {
    generation: crypto.randomUUID(),
    blocks: new Map(),
    inserts: [],
    snapshot: null,
    undo: null,
    observer: null,
    url: location.href,
  });
  function restore() {
    state.observer?.disconnect();
    state.observer = null;
    for (const el of state.inserts) el.remove();
    state.inserts = [];
    state.blocks.clear();
    state.generation = crypto.randomUUID();
  }
  if (state.url !== location.href) {
    restore();
    state.url = location.href;
    state.snapshot = null;
    state.undo = null;
  }
  const unsafe =
    'textarea,input,select,[contenteditable]:not([contenteditable="false"]),[autocomplete="current-password"],[autocomplete="new-password"],[data-sensitive],script,style,pre,code,[hidden],[aria-hidden="true"]';
  function sourceText(el: Element) {
    const copy = el.cloneNode(true) as Element;
    copy
      .querySelectorAll("[data-langloop-translation]")
      .forEach((node) => node.remove());
    return copy.textContent?.trim() ?? "";
  }
  function layoutSafe(el: Element, root: Element) {
    if (
      el.namespaceURI !== "http://www.w3.org/1999/xhtml" ||
      el.closest('svg,[role="img"],button,[data-langloop-translation]')
    )
      return false;
    if (/flex|grid/.test(getComputedStyle(el).display)) return false;
    for (
      let node: Element | null = el;
      node && node !== root;
      node = node.parentElement
    ) {
      const css = getComputedStyle(node);
      if (css.position === "absolute" && !el.closest("header,nav"))
        return false;
    }
    return true;
  }
  function visible(el: Element) {
    for (let p: Element | null = el; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (
        s.display === "none" ||
        s.visibility === "hidden" ||
        s.opacity === "0"
      )
        return false;
    }
    return el.getClientRects().length > 0;
  }
  function safeTextarea(el: Element) {
    return (
      el instanceof HTMLTextAreaElement &&
      !el.readOnly &&
      !el.disabled &&
      !el.closest("[data-sensitive]") &&
      !/password|credit|cc-|one-time-code/i.test(
        [el.name, el.id, el.autocomplete].join(" "),
      )
    );
  }
  function editable(el: Element) {
    return (
      safeTextarea(el) ||
      (el instanceof HTMLElement &&
        el.isContentEditable &&
        !el.closest('[data-sensitive],[contenteditable="false"]'))
    );
  }
  function structured(el: HTMLElement) {
    return !(el instanceof HTMLTextAreaElement) && !!el.querySelector(
      'a,img,iframe,video,[contenteditable="false"],[data-mention-id],[data-entity-key],[data-lexical-decorator="true"],[data-slate-void="true"]',
    );
  }
  function valueOf(el: HTMLElement) {
    return el instanceof HTMLTextAreaElement ? el.value : el.innerText;
  }
  function replace(el: HTMLElement, text: string, undo = false) {
    if (el instanceof HTMLTextAreaElement) {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(el, text);
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: undo ? "historyUndo" : "insertReplacementText",
          data: text,
        }),
      );
    } else {
      el.focus();
      const selection = getSelection()!,
        range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      if (!document.execCommand("insertText", false, text))
        throw new Error("This editor does not support direct replacement.");
    }
  }
  if (action === "restore") {
    restore();
    return { ok: true };
  }
  if (action === "generation")
    return { generation: state.generation, url: location.href };
  if (action === "capture") {
    const el = document.activeElement;
    if (el?.matches("input,select") || el?.closest("[data-sensitive]"))
      throw new Error(
        "Sensitive fields are excluded. Paste a non-sensitive draft into LangLoop.",
      );
    let value = "",
      applicable = false;
    if (el instanceof HTMLTextAreaElement) {
      if (!safeTextarea(el)) {
        if (
          /password|credit|cc-|one-time-code/i.test(
            [el.name, el.id, el.autocomplete].join(" "),
          )
        )
          throw new Error("Sensitive field excluded.");
        value = el.value;
      } else {
        value = el.value;
        applicable = true;
        state.snapshot = { el, before: value };
      }
    } else if (el instanceof HTMLElement && editable(el)) {
      value = valueOf(el);
      applicable = true;
      state.snapshot = { el, before: value };
    } else {
      const selection = getSelection();
      const node = selection?.anchorNode;
      const ancestor =
        node?.nodeType === 1 ? (node as Element) : node?.parentElement;
      if (ancestor?.closest("input,[data-sensitive]"))
        throw new Error("Sensitive field excluded.");
      value = selection?.toString() ?? "";
    }
    if (!applicable) state.snapshot = null;
    return {
      text: value.slice(0, 20000),
      applicable,
      canReplace: applicable && !structured(state.snapshot.el),
      generation: state.generation,
      url: location.href,
    };
  }
  if (action === "apply") {
    const snap = state.snapshot;
    if (
      !snap ||
      !editable(snap.el) ||
      !snap.el.isConnected ||
      state.generation !== payload.generation ||
      valueOf(snap.el) !== payload.original ||
      snap.before !== payload.original
    )
      throw new Error(
        "stale_source: The field changed or is unsupported. Capture it again, or copy your result.",
      );
    if (structured(snap.el)) throw new Error("structured_editor: This field contains mentions or rich content. Copy plain text instead; clickable mentions must be kept or reselected in the original editor.");
    const original = valueOf(snap.el);
    replace(snap.el, payload.result);
    state.undo = { el: snap.el, before: original, after: payload.result };
    state.snapshot = { el: snap.el, before: payload.result };
    return { ok: true };
  }
  if (action === "undo") {
    const u = state.undo;
    if (!u || !u.el.isConnected || !editable(u.el) || structured(u.el) || valueOf(u.el) !== u.after)
      throw new Error("stale_source: Undo would overwrite newer edits.");
    replace(u.el, u.before, true);
    state.undo = null;
    state.snapshot = { el: u.el, before: u.before };
    return { ok: true };
  }
  if (action === "extract") {
    restore();
    const root = document.body;
    const blocks: any[] = [];
    let count = 0;
    const selected: Element[] = [];
    const semantic = "p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,a";
    for (const el of root.querySelectorAll(semantic + ",div,span")) {
      if (
        !el.matches(semantic) &&
        (!Array.from(el.childNodes).some(
          (node) =>
            node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
        ) ||
          el.querySelector(semantic + ",div"))
      )
        continue;
      if (selected.some((parent) => parent.contains(el))) continue;
      if (
        el.closest(unsafe) ||
        el.querySelector(unsafe) ||
        !visible(el) ||
        !layoutSafe(el, root) ||
        el.querySelector("p,li,blockquote")
      )
        continue;
      const value = sourceText(el);
      if (value.length < 3 || value.length > 5000) continue;
      selected.push(el);
      const id = `b${count++}`;
      state.blocks.set(id, { el, text: value });
      blocks.push({
        id,
        text: value,
        visible:
          el.getBoundingClientRect().top < innerHeight &&
          el.getBoundingClientRect().bottom > 0,
      });
      if (count >= 200) break;
    }
    state.observer = new MutationObserver(() => {
      for (const [id, b] of state.blocks) {
        if (!b.el.isConnected || sourceText(b.el) !== b.text) {
          b.insert?.remove();
          state.blocks.delete(id);
        }
      }
    });
    state.observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    return { blocks, generation: state.generation, url: location.href };
  }
  if (action === "insert") {
    if (state.generation !== payload.generation) return { inserted: 0 };
    let inserted = 0;
    for (const t of payload.translations) {
      const b = state.blocks.get(t.id);
      if (!b || !b.el.isConnected || sourceText(b.el) !== b.text || b.insert)
        continue;
      const el = document.createElement("span");
      el.dataset.langloopTranslation = "";
      el.textContent = t.translation;
      el.style.cssText =
        "display:block!important;position:static!important;float:none!important;box-sizing:border-box!important;width:auto!important;max-width:100%!important;min-width:0!important;margin:8px 0!important;padding:4px 0!important;border:0!important;background:transparent!important;box-shadow:none!important;color:inherit;font:400 16px/1.7 system-ui!important;white-space:normal!important;overflow-wrap:anywhere!important;word-break:normal!important;text-align:inherit;";
      b.el.append(el);
      b.insert = el;
      state.inserts.push(el);
      inserted++;
    }
    return { inserted };
  }
  throw new Error("Unsupported page action");
}
