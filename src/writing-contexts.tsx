import { translator } from "./i18n";
import React from "react";
import type { Settings } from "./core";
export function WritingContexts({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
}) {
  const t = translator(settings.uiLanguage);
  const profiles = settings.writingProfiles;
  const selected =
    profiles.find((p) => p.id === settings.writingProfileId) ?? profiles[0];
  function update(patch: { name?: string; prompt?: string }) {
    onChange({
      ...settings,
      writingProfiles: profiles.map((p) =>
        p.id === selected.id ? { ...p, ...patch } : p,
      ),
    });
  }
  return (
    <section aria-label={t("寫作情境管理")}>
      <h3>{t("寫作情境")}</h3>
      <label>
        {t("預設寫作情境")}
        <select
          aria-label={t("預設寫作情境")}
          value={selected?.id ?? ""}
          onChange={(e) =>
            onChange({ ...settings, writingProfileId: e.target.value })
          }
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <>
          <label>
            {t("情境名稱")}
            <input
              maxLength={64}
              value={selected.name}
              onChange={(e) => update({ name: e.target.value })}
            />
          </label>
          <label>
            {t("寫作情境／自訂提示詞")}
            <textarea
              maxLength={4000}
              value={selected.prompt}
              onChange={(e) => update({ prompt: e.target.value })}
            />
          </label>
        </>
      )}
      <div className="actions">
        <button
          disabled={profiles.length >= 20}
          onClick={() => {
            const profile = {
              id: crypto.randomUUID(),
              name: "新情境",
              prompt: "",
            };
            onChange({
              ...settings,
              writingProfiles: [...profiles, profile],
              writingProfileId: profile.id,
            });
          }}
        >
          {t("新增情境")}
        </button>
        <button
          disabled={profiles.length <= 1}
          onClick={() => {
            const remaining = profiles.filter((p) => p.id !== selected.id);
            onChange({
              ...settings,
              writingProfiles: remaining,
              writingProfileId: remaining[0].id,
            });
          }}
        >
          {t("刪除此情境")}
        </button>
      </div>
      <label>
        {t("預設寫作輸出語言")}
        <select
          aria-label={t("預設寫作輸出語言")}
          value={settings.writingTarget}
          onChange={(e) =>
            onChange({
              ...settings,
              writingTarget: e.target.value as Settings["writingTarget"],
            })
          }
        >
          <option value="original">{t("保持原文")}</option>
          <option value="en">{t("英文")}</option>
          <option value="zh-TW">繁體中文</option>
        </select>
      </label>
      <p className="caption">
        {t(
          "儲存設定後生效。情境可在輸入框旁切換；提示詞只影響情境建議，基本版本保持忠實。最多 20 組，每組 4,000 字；選定情境會隨寫作請求送至你的 AI 服務。",
        )}
      </p>
    </section>
  );
}
