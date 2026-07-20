import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  SettingsStore,
  API_KEY_REDACTED,
  redactSettings,
  sanitizeSettingsPatch,
} from "../src/main/settingsStore";

const dir = () => mkdtempSync(join(tmpdir(), "gl-settings-"));

describe("SettingsStore", () => {
  it("缺失文件 → 默认值", () => {
    const s = new SettingsStore(join(dir(), "settings.json"));
    expect(s.get()).toEqual({
      wowDirectory: null,
      anthropicApiKey: null,
      aiModels: {},
      aiBackend: "anthropic",
      aiBackendCommand: null,
      aiLanguage: "zh",
    });
  });
  it("save 合并并持久化;文件为合法 JSON", () => {
    const p = join(dir(), "settings.json");
    const s = new SettingsStore(p);
    expect(s.save({ wowDirectory: "/tmp/wow" }).wowDirectory).toBe("/tmp/wow");
    expect(new SettingsStore(p).get().wowDirectory).toBe("/tmp/wow");
    expect(JSON.parse(readFileSync(p, "utf-8")).anthropicApiKey).toBeNull();
  });
  it("损坏 JSON → 回退默认,不抛", () => {
    const p = join(dir(), "settings.json");
    writeFileSync(p, "{not json");
    expect(new SettingsStore(p).get().wowDirectory).toBeNull();
  });
  it("旧版单字段 anthropicModel 迁进 aiModels.anthropic", () => {
    const p = join(dir(), "settings.json");
    writeFileSync(p, JSON.stringify({ anthropicModel: "claude-opus-4-8" }));
    expect(new SettingsStore(p).get().aiModels).toEqual({
      anthropic: "claude-opus-4-8",
    });
  });
  it("旧字段是自由文本,非白名单值丢弃而不是带毒迁移", () => {
    const p = join(dir(), "settings.json");
    writeFileSync(
      p,
      JSON.stringify({ anthropicModel: "claude-3-opus-legacy" }),
    );
    expect(new SettingsStore(p).get().aiModels).toEqual({});
  });
});

describe("settings 脱敏(key 永不出主进程)", () => {
  it("redactSettings:有 key → 哨兵(保真值);无 key → null", () => {
    const base = {
      wowDirectory: "/tmp/wow",
      anthropicApiKey: "sk-real-secret",
      aiModels: {},
      aiBackend: "anthropic" as const,
      aiBackendCommand: null,
      aiLanguage: "zh" as const,
    };
    const redacted = redactSettings(base);
    expect(redacted.anthropicApiKey).toBe(API_KEY_REDACTED);
    expect(redacted.anthropicApiKey).not.toContain("sk-real");
    expect(!!redacted.anthropicApiKey).toBe(true);
    expect(redacted.wowDirectory).toBe("/tmp/wow");
    expect(
      redactSettings({ ...base, anthropicApiKey: null }).anthropicApiKey,
    ).toBeNull();
  });
  it("sanitizeSettingsPatch:哨兵回写被丢弃,真 key 保留", () => {
    expect(
      sanitizeSettingsPatch({
        anthropicApiKey: API_KEY_REDACTED,
        wowDirectory: "/x",
      }),
    ).toEqual({ wowDirectory: "/x" });
    expect(sanitizeSettingsPatch({ anthropicApiKey: "sk-new" })).toEqual({
      anthropicApiKey: "sk-new",
    });
  });
  it("sanitizeSettingsPatch:模型逐格按后端白名单校验,非法格丢弃", () => {
    expect(
      sanitizeSettingsPatch({
        aiModels: {
          anthropic: "claude-opus-4-8", // 合法
          agy: "claude-opus-4-8", // agy 用别名,这是 Anthropic id → 丢
          claudeCli: "claude-sonnet-5", // 合法
        },
      }),
    ).toEqual({
      aiModels: {
        anthropic: "claude-opus-4-8",
        claudeCli: "claude-sonnet-5",
      },
    });
  });
});
