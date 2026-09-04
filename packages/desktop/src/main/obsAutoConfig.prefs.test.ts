import { describe, expect, it } from "vitest";

import {
  detectObsRecordingPrefs,
  importedPrefsPatch,
  obsConfigRootCandidates,
  parseObsIni,
} from "./obsAutoConfig";

/** A fake user OBS tree keyed by absolute path. Paths are built with the
 * same `join` the detector uses, so the fixture stays platform-neutral. */
function fakeFs(files: Record<string, string>) {
  return (p: string): string => {
    const hit = Object.entries(files).find(([k]) => p.endsWith(k));
    if (!hit) throw new Error(`ENOENT ${p}`);
    return hit[1];
  };
}

const USER_INI = [
  "[General]",
  "Pre31Migrated=true",
  "",
  "[Basic]",
  "Profile=My Profile",
  "ProfileDir=My_Profile",
  "SceneCollection=Arena",
  "SceneCollectionFile=Arena",
  "",
].join("\n");

const BASIC_INI_ADVANCED = [
  "[Output]",
  "Mode=Advanced",
  "",
  "[SimpleOutput]",
  "FilePath=C:/Users/me/Videos/simple",
  "",
  "[AdvOut]",
  "RecFilePath=D:/Recordings/WoW",
  "RecFormat2=hybrid_mp4",
  "",
].join("\n");

const SCENE_JSON = JSON.stringify({
  name: "Arena",
  sources: [],
  DesktopAudioDevice1: {
    name: "Desktop Audio",
    id: "wasapi_output_capture",
    muted: false,
    settings: { device_id: "{0.0.0.00000000}.{out-guid}" },
  },
  AuxAudioDevice1: {
    name: "Mic/Aux",
    id: "wasapi_input_capture",
    muted: true,
    settings: { device_id: "{0.0.1.00000000}.{mic-guid}" },
  },
});

describe("obsConfigRootCandidates", () => {
  it("win32 → %APPDATA%/obs-studio;无 APPDATA → 空", () => {
    expect(
      obsConfigRootCandidates({ platform: "win32", appData: "C:\\AppData" })[0],
    ).toMatch(/obs-studio$/);
    expect(
      obsConfigRootCandidates({ platform: "win32", appData: undefined }),
    ).toEqual([]);
  });
});

describe("parseObsIni", () => {
  it("段 + key=value,值里的 = 保留,空行/注释忽略", () => {
    const ini = parseObsIni("[A]\nk=v=w\n; c\n\n[B]\nx = 1\n");
    expect(ini).toEqual({ A: { k: "v=w" }, B: { x: "1" } });
  });
});

describe("detectObsRecordingPrefs", () => {
  it("Advanced 模式读 AdvOut.RecFilePath;音频两路含 muted 位", () => {
    const d = detectObsRecordingPrefs(
      ["/root/obs-studio"],
      fakeFs({
        "obs-studio/user.ini": USER_INI,
        "profiles/My_Profile/basic.ini": BASIC_INI_ADVANCED,
        "scenes/Arena.json": SCENE_JSON,
      }),
    );
    expect(d).toEqual({
      found: true,
      configRoot: "/root/obs-studio",
      recordingDirectory: "D:/Recordings/WoW",
      sceneRead: true,
      desktopAudio: { deviceId: "{0.0.0.00000000}.{out-guid}", muted: false },
      mic: { deviceId: "{0.0.1.00000000}.{mic-guid}", muted: true },
    });
  });

  it("Simple 模式读 SimpleOutput.FilePath", () => {
    const d = detectObsRecordingPrefs(
      ["/root/obs-studio"],
      fakeFs({
        "obs-studio/user.ini": USER_INI,
        "profiles/My_Profile/basic.ini": BASIC_INI_ADVANCED.replace(
          "Mode=Advanced",
          "Mode=Simple",
        ),
        "scenes/Arena.json": SCENE_JSON,
      }),
    );
    expect(d.recordingDirectory).toBe("C:/Users/me/Videos/simple");
  });

  it("OBS ≤30:user.ini 不存在时退回 global.ini 的 [Basic]", () => {
    const d = detectObsRecordingPrefs(
      ["/root/obs-studio"],
      fakeFs({
        "obs-studio/global.ini": USER_INI,
        "profiles/My_Profile/basic.ini": BASIC_INI_ADVANCED,
        "scenes/Arena.json": SCENE_JSON,
      }),
    );
    expect(d.found).toBe(true);
    expect(d.recordingDirectory).toBe("D:/Recordings/WoW");
  });

  it("更老的 OBS:只有 Profile / SceneCollection 显示名(无 *Dir / *File 键)→ 用显示名当文件名", () => {
    const d = detectObsRecordingPrefs(
      ["/root/obs-studio"],
      fakeFs({
        "obs-studio/global.ini":
          "[Basic]\nProfile=Untitled\nSceneCollection=Untitled\n",
        "profiles/Untitled/basic.ini": BASIC_INI_ADVANCED,
        "scenes/Untitled.json": SCENE_JSON,
      }),
    );
    expect(d.found).toBe(true);
    expect(d.recordingDirectory).toBe("D:/Recordings/WoW");
    expect(d.mic?.deviceId).toBe("{0.0.1.00000000}.{mic-guid}");
  });

  it("场景集合缺少某路音频键 → 该路 null;场景 JSON 损坏 → 音频全 null 但目录仍导入", () => {
    const noMic = detectObsRecordingPrefs(
      ["/root/obs-studio"],
      fakeFs({
        "obs-studio/user.ini": USER_INI,
        "profiles/My_Profile/basic.ini": BASIC_INI_ADVANCED,
        "scenes/Arena.json": JSON.stringify({
          DesktopAudioDevice1: { settings: { device_id: "default" } },
        }),
      }),
    );
    expect(noMic.desktopAudio).toEqual({ deviceId: "default", muted: false });
    expect(noMic.mic).toBeNull();

    const corrupt = detectObsRecordingPrefs(
      ["/root/obs-studio"],
      fakeFs({
        "obs-studio/user.ini": USER_INI,
        "profiles/My_Profile/basic.ini": BASIC_INI_ADVANCED,
        "scenes/Arena.json": "{not json",
      }),
    );
    expect(corrupt.found).toBe(true);
    expect(corrupt.recordingDirectory).toBe("D:/Recordings/WoW");
    expect(corrupt.sceneRead).toBe(false);
    expect(corrupt.desktopAudio).toBeNull();
    expect(corrupt.mic).toBeNull();
    // (agy review #2) unreadable scene ≠ "no desktop audio": the import
    // patch must not touch either audio field, only the directory.
    expect(importedPrefsPatch(corrupt)).toEqual({
      recordingDirectory: "D:/Recordings/WoW",
    });
  });

  it("没有任何候选根 / 根下没有 [Basic] → found=false", () => {
    expect(detectObsRecordingPrefs([], fakeFs({})).found).toBe(false);
    expect(
      detectObsRecordingPrefs(
        ["/root/obs-studio"],
        fakeFs({ "obs-studio/user.ini": "[General]\nx=1\n" }),
      ).found,
    ).toBe(false);
  });
});

describe("importedPrefsPatch", () => {
  it("静音的麦克风 → 不录(null);未静音桌面声音 → 原 id;目录照抄", () => {
    const d = detectObsRecordingPrefs(
      ["/root/obs-studio"],
      fakeFs({
        "obs-studio/user.ini": USER_INI,
        "profiles/My_Profile/basic.ini": BASIC_INI_ADVANCED,
        "scenes/Arena.json": SCENE_JSON,
      }),
    );
    expect(importedPrefsPatch(d)).toEqual({
      recordingDirectory: "D:/Recordings/WoW",
      managedDesktopAudioDevice: "{0.0.0.00000000}.{out-guid}",
      managedMicDevice: null,
    });
  });

  it("profile 读不到目录 → patch 不含 recordingDirectory(保留用户现值);found=false → 空 patch", () => {
    const d = detectObsRecordingPrefs(
      ["/root/obs-studio"],
      fakeFs({
        "obs-studio/user.ini": USER_INI,
        "scenes/Arena.json": SCENE_JSON,
      }),
    );
    expect(importedPrefsPatch(d)).not.toHaveProperty("recordingDirectory");
    expect(importedPrefsPatch(d)).toHaveProperty("managedDesktopAudioDevice");
    expect(
      importedPrefsPatch({
        found: false,
        recordingDirectory: null,
        sceneRead: false,
        desktopAudio: null,
        mic: null,
      }),
    ).toEqual({});
  });
});
