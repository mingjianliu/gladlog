import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { OBS_PASSWORD_REDACTED } from "../shared/protocol";
import {
  redactSettings,
  sanitizeSettingsPatch,
  SettingsStore,
} from "./settingsStore";

describe("recording settings", () => {
  it("旧配置文件读回带默认值", () => {
    const s = new SettingsStore(
      join(mkdtempSync(join(tmpdir(), "gl-")), "settings.json"),
    );
    const v = s.get();
    expect(v.recordingEnabled).toBe(false);
    expect(v.recordingKeepCount).toBe(50);
    expect(v.obsWebsocketUrl).toBeNull();
  });

  // task-6: recordingMode default is "managed" even off Windows -- the same
  // settings.json should pick up managed recording the day it runs on
  // Windows, without the user having to re-pick a mode (design doc §8's
  // "force recordingEnabled=false on non-win32" is deliberately NOT mirrored
  // onto recordingMode -- see GladlogSettings's own field comment, 复核 I15).
  it("recordingMode 默认 managed;managedWsPassword 默认 null", () => {
    const s = new SettingsStore(
      join(mkdtempSync(join(tmpdir(), "gl-")), "settings.json"),
    );
    const v = s.get();
    expect(v.recordingMode).toBe("managed");
    expect(v.managedWsPassword).toBeNull();
  });

  it("redact:密码替换为哨兵;null 保持 null", () => {
    const base = new SettingsStore(
      join(mkdtempSync(join(tmpdir(), "gl-")), "s.json"),
    ).get();
    expect(
      redactSettings({ ...base, obsWebsocketPassword: "hunter2" })
        .obsWebsocketPassword,
    ).toBe(OBS_PASSWORD_REDACTED);
    expect(redactSettings(base).obsWebsocketPassword).toBeNull();
  });

  it("sanitize:哨兵不回写;keepCount 非法值丢弃", () => {
    expect(
      sanitizeSettingsPatch({ obsWebsocketPassword: OBS_PASSWORD_REDACTED }),
    ).not.toHaveProperty("obsWebsocketPassword");
    expect(
      sanitizeSettingsPatch({ recordingKeepCount: -3 }),
    ).not.toHaveProperty("recordingKeepCount");
    expect(
      sanitizeSettingsPatch({ recordingKeepCount: Number.NaN }),
    ).not.toHaveProperty("recordingKeepCount");
    expect(sanitizeSettingsPatch({ recordingKeepCount: 10 })).toEqual({
      recordingKeepCount: 10,
    });
  });

  it("recordingMaxBytes 默认 80GB;非法值丢弃(含 0 —— 与 recordingKeepCount 不同,0 不是合法的「关闭」值)", () => {
    const s = new SettingsStore(
      join(mkdtempSync(join(tmpdir(), "gl-")), "settings.json"),
    );
    expect(s.get().recordingMaxBytes).toBe(80 * 1024 ** 3);
    expect(sanitizeSettingsPatch({ recordingMaxBytes: -1 })).not.toHaveProperty(
      "recordingMaxBytes",
    );
    expect(sanitizeSettingsPatch({ recordingMaxBytes: 0 })).not.toHaveProperty(
      "recordingMaxBytes",
    );
    expect(
      sanitizeSettingsPatch({ recordingMaxBytes: Number.NaN }),
    ).not.toHaveProperty("recordingMaxBytes");
    expect(sanitizeSettingsPatch({ recordingMaxBytes: 1024 })).toEqual({
      recordingMaxBytes: 1024,
    });
  });
});

describe("managed-OBS prefs (2026-09-04)", () => {
  it("默认值:目录 null、桌面声音 default、麦克风 null", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-settings-"));
    const s = new SettingsStore(join(dir, "settings.json")).get();
    expect(s.recordingDirectory).toBeNull();
    expect(s.managedDesktopAudioDevice).toBe("default");
    expect(s.managedMicDevice).toBeNull();
  });

  it("sanitize:非字符串非 null 丢弃;空白串归一成 null;正常值原样", () => {
    expect(
      sanitizeSettingsPatch({
        recordingDirectory: 42 as unknown as string,
      }),
    ).not.toHaveProperty("recordingDirectory");
    expect(sanitizeSettingsPatch({ managedMicDevice: "   " })).toEqual({
      managedMicDevice: null,
    });
    expect(sanitizeSettingsPatch({ managedDesktopAudioDevice: null })).toEqual({
      managedDesktopAudioDevice: null,
    });
    expect(
      sanitizeSettingsPatch({
        recordingDirectory: "D:\\rec",
        managedDesktopAudioDevice: "{0.0.0.00000000}.{abc}",
        managedMicDevice: "default",
      }),
    ).toEqual({
      recordingDirectory: "D:\\rec",
      managedDesktopAudioDevice: "{0.0.0.00000000}.{abc}",
      managedMicDevice: "default",
    });
  });

  it("往返:save 三字段后 get 原样读回", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-settings-"));
    const store = new SettingsStore(join(dir, "settings.json"));
    store.save({
      recordingDirectory: "D:\\rec",
      managedDesktopAudioDevice: null,
      managedMicDevice: "{mic}",
    });
    const s = store.get();
    expect(s.recordingDirectory).toBe("D:\\rec");
    expect(s.managedDesktopAudioDevice).toBeNull();
    expect(s.managedMicDevice).toBe("{mic}");
  });
});
