import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  SettingsStore,
  API_KEY_REDACTED,
  MANAGED_WS_PASSWORD_REDACTED,
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
      deepseekApiKey: null,
      aiModels: {},
      aiBackend: "anthropic",
      aiBackendCommand: null,
      aiLanguage: "zh",
      autoAnalyzeNew: false,
      recordingEnabled: false,
      obsWebsocketUrl: null,
      obsWebsocketPassword: null,
      recordingKeepCount: 50,
      recordingMaxBytes: 80 * 1024 ** 3,
      recordingMode: "managed",
      managedWsPassword: null,
      recordingDirectory: null,
      managedDesktopAudioDevice: "default",
      managedMicDevice: null,
      autoCheckUpdates: true,
      lastSeenVersion: null,
      uiZoom: 1,
    });
  });
  it("save 合并并持久化;文件为合法 JSON", () => {
    const p = join(dir(), "settings.json");
    const s = new SettingsStore(p);
    expect(s.save({ wowDirectory: "/tmp/wow" }).wowDirectory).toBe("/tmp/wow");
    expect(new SettingsStore(p).get().wowDirectory).toBe("/tmp/wow");
    expect(JSON.parse(readFileSync(p, "utf-8")).anthropicApiKey).toBeNull();
  });
  it("autoAnalyzeNew:默认 false;save 往返持久化", () => {
    const p = join(dir(), "settings.json");
    const s = new SettingsStore(p);
    expect(s.get().autoAnalyzeNew).toBe(false);
    expect(s.save({ autoAnalyzeNew: true }).autoAnalyzeNew).toBe(true);
    expect(new SettingsStore(p).get().autoAnalyzeNew).toBe(true);
  });
  it("autoCheckUpdates:默认 true;lastSeenVersion:默认 null;两者 save 往返持久化", () => {
    const p = join(dir(), "settings.json");
    const s = new SettingsStore(p);
    expect(s.get().autoCheckUpdates).toBe(true);
    expect(s.get().lastSeenVersion).toBeNull();
    expect(
      s.save({ autoCheckUpdates: false, lastSeenVersion: "0.1.20" })
        .autoCheckUpdates,
    ).toBe(false);
    const reread = new SettingsStore(p).get();
    expect(reread.autoCheckUpdates).toBe(false);
    expect(reread.lastSeenVersion).toBe("0.1.20");
  });
  it("uiZoom:默认 1;save 往返持久化", () => {
    const p = join(dir(), "settings.json");
    const s = new SettingsStore(p);
    expect(s.get().uiZoom).toBe(1);
    expect(s.save({ uiZoom: 1.3 }).uiZoom).toBe(1.3);
    expect(new SettingsStore(p).get().uiZoom).toBe(1.3);
  });
  it("uiZoom:磁盘上的脏值读出来一律夹回合法区间", () => {
    // 手改 settings.json 的三类脏值。0 是最要命的一类:直接喂给
    // webFrame.setZoomFactor 会把窗口压成点不动的一条,用户连设置页都回不去。
    const cases: Array<[unknown, number]> = [
      [0, 0.5],
      [-2, 0.5],
      [999, 3],
      [Number.NaN, 1],
      ["1.5", 1],
      [null, 1],
      [undefined, 1],
    ];
    for (const [stored, want] of cases) {
      const p = join(dir(), "settings.json");
      writeFileSync(p, JSON.stringify({ uiZoom: stored }));
      expect(new SettingsStore(p).get().uiZoom).toBe(want);
    }
  });
  it("uiZoom:非法 patch 被丢弃(保留磁盘上原来的好值),合法档位透传", () => {
    expect(
      sanitizeSettingsPatch({
        uiZoom: 0,
        wowDirectory: "/x",
      }),
    ).toEqual({ wowDirectory: "/x" });
    expect(
      sanitizeSettingsPatch({ uiZoom: "big" as unknown as number }),
    ).toEqual({});
    expect(sanitizeSettingsPatch({ uiZoom: 1.15 })).toEqual({ uiZoom: 1.15 });
  });
  it("sanitizeSettingsPatch 对这两个字段是透传(黑名单式校验器,无需改)", () => {
    expect(
      sanitizeSettingsPatch({
        autoCheckUpdates: false,
        lastSeenVersion: "1.2.3",
      }),
    ).toEqual({ autoCheckUpdates: false, lastSeenVersion: "1.2.3" });
  });
  it("redactSettings 不动这两个字段(非密字段展开式透传)", () => {
    const s = new SettingsStore(join(dir(), "settings.json")).get();
    const redacted = redactSettings({
      ...s,
      anthropicApiKey: "sk-real",
      autoCheckUpdates: false,
      lastSeenVersion: "0.1.20",
    });
    expect(redacted.autoCheckUpdates).toBe(false);
    expect(redacted.lastSeenVersion).toBe("0.1.20");
    expect(redacted.anthropicApiKey).toBe(API_KEY_REDACTED);
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
      deepseekApiKey: "sk-ds-secret",
      aiModels: {},
      aiBackend: "anthropic" as const,
      aiBackendCommand: null,
      aiLanguage: "zh" as const,
      autoAnalyzeNew: false,
      recordingEnabled: false,
      obsWebsocketUrl: null,
      obsWebsocketPassword: null,
      recordingKeepCount: 50,
      recordingMaxBytes: 80 * 1024 ** 3,
      recordingMode: "managed" as const,
      managedWsPassword: null,
      recordingDirectory: null,
      managedDesktopAudioDevice: "default",
      managedMicDevice: null,
      autoCheckUpdates: true,
      lastSeenVersion: null,
      uiZoom: 1,
    };
    const redacted = redactSettings(base);
    expect(redacted.anthropicApiKey).toBe(API_KEY_REDACTED);
    expect(redacted.anthropicApiKey).not.toContain("sk-real");
    expect(redacted.deepseekApiKey).not.toContain("sk-ds");
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
  // task-6 三件套之二/三(复核 I14):managedWsPassword 照 obsWebsocketPassword
  // 的既有形状处理 —— redact 遮成哨兵,sanitize 剥离哨兵回写。
  it("redactSettings:managedWsPassword 有值 → 哨兵(保真值);无值 → null", () => {
    const base = {
      wowDirectory: null,
      anthropicApiKey: null,
      deepseekApiKey: null,
      aiModels: {},
      aiBackend: "anthropic" as const,
      aiBackendCommand: null,
      aiLanguage: "zh" as const,
      autoAnalyzeNew: false,
      recordingEnabled: false,
      obsWebsocketUrl: null,
      obsWebsocketPassword: null,
      recordingKeepCount: 50,
      recordingMaxBytes: 80 * 1024 ** 3,
      recordingMode: "managed" as const,
      managedWsPassword: "genpw-hex",
      recordingDirectory: null,
      managedDesktopAudioDevice: "default",
      managedMicDevice: null,
      autoCheckUpdates: true,
      lastSeenVersion: null,
      deepDiveSnapshot: false,
      uiZoom: 1,
    };
    const redacted = redactSettings(base);
    expect(redacted.managedWsPassword).toBe(MANAGED_WS_PASSWORD_REDACTED);
    expect(redacted.managedWsPassword).not.toContain("genpw-hex");
    expect(
      redactSettings({ ...base, managedWsPassword: null }).managedWsPassword,
    ).toBeNull();
  });
  it("sanitizeSettingsPatch:managedWsPassword 哨兵回写被丢弃,真值保留", () => {
    expect(
      sanitizeSettingsPatch({
        managedWsPassword: MANAGED_WS_PASSWORD_REDACTED,
        wowDirectory: "/x",
      }),
    ).toEqual({ wowDirectory: "/x" });
    expect(sanitizeSettingsPatch({ managedWsPassword: "genpw-hex" })).toEqual({
      managedWsPassword: "genpw-hex",
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
