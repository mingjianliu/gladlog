import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUDIO_DEVICE_ID,
  MANAGED_OBS_PREF_DEFAULTS,
  managedObsPrefsChanged,
  resolveRecordingDir,
} from "./managedObsPrefs";

describe("managedObsPrefsChanged", () => {
  it("三个字段全等 → false;任一不等 → true", () => {
    const a = { ...MANAGED_OBS_PREF_DEFAULTS };
    expect(managedObsPrefsChanged(a, { ...a })).toBe(false);
    expect(
      managedObsPrefsChanged(a, { ...a, recordingDirectory: "D:\\rec" }),
    ).toBe(true);
    expect(
      managedObsPrefsChanged(a, { ...a, managedDesktopAudioDevice: null }),
    ).toBe(true);
    expect(managedObsPrefsChanged(a, { ...a, managedMicDevice: "{mic}" })).toBe(
      true,
    );
  });

  it("默认值:桌面声音 = 系统默认设备,麦克风不录,目录走应用默认", () => {
    expect(MANAGED_OBS_PREF_DEFAULTS).toEqual({
      recordingDirectory: null,
      managedDesktopAudioDevice: DEFAULT_AUDIO_DEVICE_ID,
      managedMicDevice: null,
    });
  });
});

describe("resolveRecordingDir", () => {
  it("null / 空白 → 默认目录;非空 → 用户目录(去掉首尾空白)", () => {
    expect(
      resolveRecordingDir("/ud/recordings", { recordingDirectory: null }),
    ).toBe("/ud/recordings");
    expect(
      resolveRecordingDir("/ud/recordings", { recordingDirectory: "  " }),
    ).toBe("/ud/recordings");
    expect(
      resolveRecordingDir("/ud/recordings", {
        recordingDirectory: " D:\\rec ",
      }),
    ).toBe("D:\\rec");
  });
});
