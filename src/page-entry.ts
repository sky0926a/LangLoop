import { messages } from "./i18n";
import { mountWidget } from "./widget";
// Register only UI. No page text is read or inferred during startup.
void chrome.runtime
  .sendMessage({ type: "inline", payload: { action: "ready" } })
  .then((response) => {
    if (response?.status === "ok")
      mountWidget(response.data.uiLanguage, messages);
  })
  .catch(() => {});
