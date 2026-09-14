import { describe, it, expect } from "vitest";
import { translator, messages } from "../src/i18n";
import { defaults, settingsSchema } from "../src/core";
describe("interface preferences", () => {
  it("migrates missing locale without changing output language", () => {
    const { uiLanguage: _, ...legacy } = defaults;
    void _;
    const settings = settingsSchema.parse({
      ...legacy,
      target: "ja",
      writingTarget: "en",
    });
    expect(settings.uiLanguage).toBe("zh-TW");
    expect(settings.target).toBe("ja");
    expect(settings.writingTarget).toBe("en");
    expect(
      settingsSchema.safeParse({ ...settings, uiLanguage: "invalid" }).success,
    ).toBe(false);
  });
  it("maps both source languages and retains unknown diagnostic text", () => {
    for (const [en, zh] of messages) {
      expect(translator("en")(zh)).toBe(en);
      expect(translator("zh-TW")(en)).toBe(zh);
    }
    expect(translator("zh-TW")("HTTP 429: provider detail")).toBe(
      "HTTP 429: provider detail",
    );
  });
});
