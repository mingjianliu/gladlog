import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MANAGED_CANVAS,
  clearSentinels,
  writeObsConfig,
  type ObsConfigSpec,
} from "./obsConfigWriter";

let dir: string;
let obsRoot: string;
let recDir: string;
let spec: ObsConfigSpec;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gladlog-obs-config-"));
  obsRoot = join(dir, "obs", "32.2.1");
  recDir = join(dir, "recordings");
  spec = {
    obsRoot,
    recDir,
    wsPort: 4466,
    wsPassword: "s3cr3t-pw",
    bitrateKbps: 8000,
    desktopAudioDeviceId: "default",
    micDeviceId: null,
  };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function cfgRoot(): string {
  return join(obsRoot, "config", "obs-studio");
}

describe("writeObsConfig", () => {
  it("writes the portable marker file (empty)", () => {
    writeObsConfig(spec);
    const p = join(obsRoot, "portable_mode.txt");
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, "utf-8")).toBe("");
  });

  it("writes user.ini with FirstRun + Basic profile/scene identity", () => {
    writeObsConfig(spec);
    const txt = readFileSync(join(cfgRoot(), "user.ini"), "utf-8");
    expect(txt).toMatch(/\[General\]/);
    expect(txt).toMatch(/FirstRun=true/);
    expect(txt).toMatch(/\[Basic\]/);
    expect(txt).toMatch(/Profile=gladlog/);
    expect(txt).toMatch(/ProfileDir=gladlog/);
    expect(txt).toMatch(/SceneCollection=gladlog/);
    expect(txt).toMatch(/SceneCollectionFile=gladlog/);
  });

  it("writes global.ini with LastVersion", () => {
    writeObsConfig(spec);
    const txt = readFileSync(join(cfgRoot(), "global.ini"), "utf-8");
    expect(txt).toMatch(/\[General\]/);
    expect(txt).toMatch(/LastVersion=32\.2\.1/);
  });

  it("writes obs-websocket config.json with exact keys", () => {
    writeObsConfig(spec);
    const raw = readFileSync(
      join(cfgRoot(), "plugin_config", "obs-websocket", "config.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toEqual({
      first_load: false,
      server_enabled: true,
      server_port: 4466,
      server_password: "s3cr3t-pw",
      auth_required: true,
      alerts_enabled: false,
    });
  });

  it("creates recDir before writing it into basic.ini", () => {
    expect(existsSync(recDir)).toBe(false);
    writeObsConfig(spec);
    expect(existsSync(recDir)).toBe(true);
  });

  it("writes basic.ini with the manual-split invariant explicitly zeroed", () => {
    writeObsConfig(spec);
    const txt = readFileSync(
      join(cfgRoot(), "basic", "profiles", "gladlog", "basic.ini"),
      "utf-8",
    );
    expect(txt).toMatch(/\[General\]/);
    expect(txt).toMatch(/Name=gladlog/);
    expect(txt).toMatch(/\[Output\]/);
    expect(txt).toMatch(/Mode=Advanced/);
    expect(txt).toMatch(/\[AdvOut\]/);
    expect(txt).toMatch(/RecType=Standard/);
    expect(txt).toMatch(/RecFormat2=hybrid_mp4/);
    expect(txt).toMatch(/RecEncoder=obs_x264/);
    expect(txt).toMatch(/RecTracks=1/);
    expect(txt).toMatch(/RecSplitFile=true/);
    expect(txt).toMatch(/RecSplitFileType=Manual/);
    // The hard invariant: both auto-split thresholds explicitly zeroed, so a
    // misread of RecSplitFileType can never fall back to time/size splitting
    // and cut a match mid-fight.
    expect(txt).toMatch(/RecSplitFileTime=0/);
    expect(txt).toMatch(/RecSplitFileSize=0/);
  });

  it("writes the recording audio pipeline explicitly, never inheriting OBS defaults", () => {
    // 真机症状 2026-09-05:录像完全没有声音。Advanced 输出的录制音频编码器是
    // 一个独立的键,而且合法取值里就有 "none"(= 不录音频);profile 是我们
    // 全权生成的,不能有任何一段靠 OBS 内建默认值撑着。
    writeObsConfig(spec);
    const txt = readFileSync(
      join(cfgRoot(), "basic", "profiles", "gladlog", "basic.ini"),
      "utf-8",
    );
    expect(txt).toMatch(/RecAudioEncoder=aac/);
    expect(txt).not.toMatch(/RecAudioEncoder=none/);
    expect(txt).toMatch(/RecTracks=1/);
    expect(txt).toMatch(/Track1Bitrate=160/);
    expect(txt).toMatch(/\[Audio\]/);
    expect(txt).toMatch(/SampleRate=48000/);
    expect(txt).toMatch(/ChannelSetup=Stereo/);
  });

  it("[Video] Base/Output resolution comes from the exported canvas constants (one source with the backend's bounds fit)", () => {
    writeObsConfig(spec);
    const txt = readFileSync(
      join(cfgRoot(), "basic", "profiles", "gladlog", "basic.ini"),
      "utf-8",
    );
    expect(txt).toMatch(new RegExp(`BaseCX=${MANAGED_CANVAS.width}\\b`));
    expect(txt).toMatch(new RegExp(`BaseCY=${MANAGED_CANVAS.height}\\b`));
    expect(txt).toMatch(new RegExp(`OutputCX=${MANAGED_CANVAS.width}\\b`));
    expect(txt).toMatch(new RegExp(`OutputCY=${MANAGED_CANVAS.height}\\b`));
  });

  it("writes RecFilePath with forward slashes even from a backslash-shaped recDir", () => {
    const winSpec: ObsConfigSpec = {
      ...spec,
      recDir: join(dir, "rec-win"),
    };
    // Simulate what a win32 path would look like by asserting the writer
    // itself normalizes separators regardless of platform join() behavior.
    writeObsConfig(winSpec);
    const txt = readFileSync(
      join(cfgRoot(), "basic", "profiles", "gladlog", "basic.ini"),
      "utf-8",
    );
    const m = /RecFilePath=(.+)/.exec(txt);
    expect(m).not.toBeNull();
    expect(m?.[1]).not.toMatch(/\\/);
    expect(m?.[1]?.replace(/\/$/, "")).toBe(
      winSpec.recDir.replace(/\\/g, "/").replace(/\/$/, ""),
    );
  });

  it("writes [Video] with all six keys including AutoRemux=false", () => {
    writeObsConfig(spec);
    const txt = readFileSync(
      join(cfgRoot(), "basic", "profiles", "gladlog", "basic.ini"),
      "utf-8",
    );
    expect(txt).toMatch(/\[Video\]/);
    expect(txt).toMatch(/BaseCX=1920/);
    expect(txt).toMatch(/BaseCY=1080/);
    expect(txt).toMatch(/OutputCX=1920/);
    expect(txt).toMatch(/OutputCY=1080/);
    expect(txt).toMatch(/FPSType=0/);
    expect(txt).toMatch(/FPSCommon=60/);
    expect(txt).toMatch(/AutoRemux=false/);
  });

  it("writes recordEncoder.json with keyint_sec=1 and spec bitrate", () => {
    writeObsConfig(spec);
    const raw = readFileSync(
      join(cfgRoot(), "basic", "profiles", "gladlog", "recordEncoder.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toEqual({
      rate_control: "CBR",
      bitrate: 8000,
      keyint_sec: 1,
    });
  });

  it("honors a non-default bitrateKbps in recordEncoder.json", () => {
    writeObsConfig({ ...spec, bitrateKbps: 12000 });
    const raw = readFileSync(
      join(cfgRoot(), "basic", "profiles", "gladlog", "recordEncoder.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw) as { bitrate: number };
    expect(parsed.bitrate).toBe(12000);
  });

  it("writes a scene collection with desktop audio wired and no mic/aux keys", () => {
    writeObsConfig(spec);
    const raw = readFileSync(
      join(cfgRoot(), "basic", "scenes", "gladlog.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Desktop audio (channel 1) wired to a real wasapi_output_capture source
    // with device_id "default" — confirmed from obs-studio 32.2.1 source
    // (see comment in obsConfigWriter.ts for file:line citations).
    expect(parsed["DesktopAudioDevice1"]).toMatchObject({
      id: "wasapi_output_capture",
      settings: { device_id: "default" },
    });
    // No AuxAudioDevice1..4 keys — LoadAudioDevice() no-ops on an absent key,
    // so channels 3-6 (mic/aux) stay unassigned: no mic gets recorded.
    expect(parsed).not.toHaveProperty("AuxAudioDevice1");
    expect(parsed).not.toHaveProperty("AuxAudioDevice2");
    expect(parsed).not.toHaveProperty("AuxAudioDevice3");
    expect(parsed).not.toHaveProperty("AuxAudioDevice4");
    // No DesktopAudioDevice2 either (single desktop-audio device is enough).
    expect(parsed).not.toHaveProperty("DesktopAudioDevice2");
    // The scene itself: one "scene"-type source named gladlog with zero
    // scene items (empty scene; capture sources get added at runtime via
    // websocket, see design doc §5.4).
    expect(parsed["sources"]).toEqual([
      { id: "scene", name: "gladlog", settings: { items: [] } },
    ]);
    expect(parsed["current_scene"]).toBe("gladlog");
    expect(parsed["scene_order"]).toEqual([{ name: "gladlog" }]);
  });

  it("managed-OBS prefs: a specific desktop device id + a mic → both channel keys, verbatim ids", () => {
    writeObsConfig({
      ...spec,
      desktopAudioDeviceId: "{0.0.0.00000000}.{out-guid}",
      micDeviceId: "{0.0.1.00000000}.{mic-guid}",
    });
    const parsed = JSON.parse(
      readFileSync(join(cfgRoot(), "basic", "scenes", "gladlog.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(parsed["DesktopAudioDevice1"]).toEqual({
      name: "Desktop Audio",
      id: "wasapi_output_capture",
      settings: { device_id: "{0.0.0.00000000}.{out-guid}" },
    });
    expect(parsed["AuxAudioDevice1"]).toEqual({
      name: "Mic/Aux",
      id: "wasapi_input_capture",
      settings: { device_id: "{0.0.1.00000000}.{mic-guid}" },
    });
  });

  it("managed-OBS prefs: null desktop device → DesktopAudioDevice1 omitted (channel unassigned), mic can still be present", () => {
    writeObsConfig({
      ...spec,
      desktopAudioDeviceId: null,
      micDeviceId: "default",
    });
    const parsed = JSON.parse(
      readFileSync(join(cfgRoot(), "basic", "scenes", "gladlog.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("DesktopAudioDevice1");
    expect(parsed["AuxAudioDevice1"]).toMatchObject({
      id: "wasapi_input_capture",
      settings: { device_id: "default" },
    });
  });

  it("is idempotent: writing twice produces byte-identical files", () => {
    writeObsConfig(spec);
    const before = {
      userIni: readFileSync(join(cfgRoot(), "user.ini")),
      globalIni: readFileSync(join(cfgRoot(), "global.ini")),
      ws: readFileSync(
        join(cfgRoot(), "plugin_config", "obs-websocket", "config.json"),
      ),
      basicIni: readFileSync(
        join(cfgRoot(), "basic", "profiles", "gladlog", "basic.ini"),
      ),
      recordEncoder: readFileSync(
        join(cfgRoot(), "basic", "profiles", "gladlog", "recordEncoder.json"),
      ),
      scene: readFileSync(join(cfgRoot(), "basic", "scenes", "gladlog.json")),
      portable: readFileSync(join(obsRoot, "portable_mode.txt")),
    };

    writeObsConfig(spec);
    expect(readFileSync(join(cfgRoot(), "user.ini"))).toEqual(before.userIni);
    expect(readFileSync(join(cfgRoot(), "global.ini"))).toEqual(
      before.globalIni,
    );
    expect(
      readFileSync(
        join(cfgRoot(), "plugin_config", "obs-websocket", "config.json"),
      ),
    ).toEqual(before.ws);
    expect(
      readFileSync(
        join(cfgRoot(), "basic", "profiles", "gladlog", "basic.ini"),
      ),
    ).toEqual(before.basicIni);
    expect(
      readFileSync(
        join(cfgRoot(), "basic", "profiles", "gladlog", "recordEncoder.json"),
      ),
    ).toEqual(before.recordEncoder);
    expect(
      readFileSync(join(cfgRoot(), "basic", "scenes", "gladlog.json")),
    ).toEqual(before.scene);
    expect(readFileSync(join(obsRoot, "portable_mode.txt"))).toEqual(
      before.portable,
    );
  });
});

describe("clearSentinels", () => {
  function sentinelDir(): string {
    return join(cfgRoot(), ".sentinel");
  }

  it("deletes only run_* files under config/obs-studio/.sentinel", () => {
    const sd = sentinelDir();
    mkdirSync(sd, { recursive: true });
    writeFileSync(join(sd, "run_20260804_120000"), "1");
    writeFileSync(join(sd, "run_20260804_130000"), "1");
    writeFileSync(join(sd, "keep_me.txt"), "1");

    clearSentinels(obsRoot);

    expect(existsSync(join(sd, "run_20260804_120000"))).toBe(false);
    expect(existsSync(join(sd, "run_20260804_130000"))).toBe(false);
    expect(existsSync(join(sd, "keep_me.txt"))).toBe(true);
  });

  it("is a no-op (does not throw) when the sentinel dir does not exist", () => {
    expect(() => clearSentinels(obsRoot)).not.toThrow();
  });
});
