import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { OBS_VERSION, PINNED_ENCODER } from "../shared/obsAsset";

/** Spec for the entire portable-OBS config tree we own (design doc §5.2:
 * "我们写自己的,永不碰用户的" — this writes OUR managed instance's config,
 * never the user's own OBS install; see obsAutoConfig.ts for the read-only
 * rule that governs the latter). */
export interface ObsConfigSpec {
  obsRoot: string;
  /** Recording output directory. Callers pass an already-decided path; this
   * module mkdirSync's it before writing it into basic.ini — the real
   * machine showed OBS fails "bad output path" when the directory is
   * unwritable/absent (2026-08-04 verification). */
  recDir: string;
  /** Managed instance's websocket port — pass MANAGED_WS_PORT from
   * shared/obsAsset.ts. */
  wsPort: number;
  wsPassword: string;
  /** Recording bitrate in kbps. Default 8000 per design doc U2. */
  bitrateKbps: number;
  /** Desktop-audio (output) device to record on channel 1: a WASAPI endpoint
   * id, `"default"` for the system default, or null to record no desktop
   * audio (DesktopAudioDevice1 omitted from the scene collection). Feed it
   * from settings.managedDesktopAudioDevice (shared/managedObsPrefs.ts). */
  desktopAudioDeviceId: string | null;
  /** Microphone (input) device to record on channel 3 (AuxAudioDevice1):
   * same value space as desktopAudioDeviceId; null = no mic recorded, which
   * is the product default (design doc U4). */
  micDeviceId: string | null;
}

const PROFILE_NAME = "gladlog";
/**
 * The managed canvas. Exported because TWO consumers must agree on this one
 * fact (shared-predicate rule, CLAUDE.md): the profile's Base/Output
 * resolution written into basic.ini here, and the bounding box
 * `managedObsBackend.fitCaptureToCanvas()` scales the game capture into. They
 * used to disagree by construction — the canvas was 1920x1080 and the capture
 * source had no transform at all, so anything above 1080p was recorded as its
 * top-left 1920x1080 crop (真机症状 2026-09-05, 4K 显示器:录像只剩左上角
 * 1/4 面积). The backend prefers the LIVE canvas from GetVideoSettings and
 * only falls back to this constant, so a profile that drifted still gets a
 * correct fit.
 */
export const MANAGED_CANVAS = { width: 1920, height: 1080 } as const;
/** Exported: managedObsBackend.ts's configureSession() creates the
 * game_capture input inside this scene via CreateInput({sceneName}) — same
 * fact, shared-predicate rule (CLAUDE.md), not a second "gladlog" literal. */
export const SCENE_NAME = "gladlog";

function cfgRoot(obsRoot: string): string {
  return join(obsRoot, "config", "obs-studio");
}

/** Path-only normalization for values written into .ini files — OBS accepts
 * forward slashes on Windows and this keeps generation platform-independent
 * (design doc §5.2 / review M3: "路径一律正斜杠写入 ini"). */
function toForwardSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

function renderIni(sections: Record<string, Record<string, string>>): string {
  const lines: string[] = [];
  for (const [section, kv] of Object.entries(sections)) {
    lines.push(`[${section}]`);
    for (const [key, value] of Object.entries(kv)) {
      lines.push(`${key}=${value}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function writeJson(path: string, value: unknown): void {
  // Stable key order (object literals below are written in a fixed order) +
  // no timestamps anywhere in the payload => byte-identical across repeated
  // calls with the same spec (idempotency requirement).
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function writeUserIni(obsRoot: string): void {
  const txt = renderIni({
    General: { FirstRun: "true" },
    Basic: {
      Profile: PROFILE_NAME,
      ProfileDir: PROFILE_NAME,
      SceneCollection: SCENE_NAME,
      SceneCollectionFile: SCENE_NAME,
    },
  });
  writeFileSync(join(cfgRoot(obsRoot), "user.ini"), txt);
}

function writeGlobalIni(obsRoot: string): void {
  const txt = renderIni({
    General: { LastVersion: OBS_VERSION },
  });
  writeFileSync(join(cfgRoot(obsRoot), "global.ini"), txt);
}

function writeWebsocketConfig(spec: ObsConfigSpec): void {
  const dir = join(cfgRoot(spec.obsRoot), "plugin_config", "obs-websocket");
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, "config.json"), {
    first_load: false,
    server_enabled: true,
    server_port: spec.wsPort,
    server_password: spec.wsPassword,
    auth_required: true,
    alerts_enabled: false,
  });
}

function writeBasicIni(spec: ObsConfigSpec): void {
  const dir = join(cfgRoot(spec.obsRoot), "basic", "profiles", PROFILE_NAME);
  mkdirSync(dir, { recursive: true });
  const txt = renderIni({
    General: { Name: PROFILE_NAME },
    Output: { Mode: "Advanced" },
    AdvOut: {
      RecType: "Standard",
      RecFilePath: toForwardSlashes(spec.recDir),
      RecFormat2: "hybrid_mp4",
      RecEncoder: PINNED_ENCODER,
      RecSplitFile: "true",
      RecSplitFileType: "Manual",
      // The one hard invariant of the whole recording design (复核 I8): both
      // auto-split thresholds explicitly zeroed, belt-and-braces alongside
      // RecSplitFileType=Manual. If OBS ever misreads the type token and
      // falls back to time/size-based splitting, a nonzero threshold here
      // would silently cut a match mid-fight.
      RecSplitFileTime: "0",
      RecSplitFileSize: "0",
      // 真机症状(2026-09-05):录像完全没有声音。Since OBS 30 the advanced
      // output's RECORDING audio encoder is its own config key, and one of
      // its legal values is literally "none" (= record no audio at all); we
      // had never written it, leaving the entire audio side of a generated,
      // fully-owned portable profile riding on OBS's built-in defaults. A
      // generated config must not bet on defaults it never asserts — the
      // encoder, the track bitmask and that track's bitrate are all written
      // explicitly now. (RecTracks is a BITMASK, "1" = track 1 only.)
      RecAudioEncoder: "aac",
      RecTracks: "1",
      Track1Bitrate: "160",
      Track1Name: "Track1",
    },
    Video: {
      BaseCX: String(MANAGED_CANVAS.width),
      BaseCY: String(MANAGED_CANVAS.height),
      OutputCX: String(MANAGED_CANVAS.width),
      OutputCY: String(MANAGED_CANVAS.height),
      FPSType: "0",
      FPSCommon: "60",
      // OBS silently renames files after the fact otherwise, with no
      // completion event we could hook (real-machine finding, 2026-08-04).
      AutoRemux: "false",
    },
    // Same reasoning as RecAudioEncoder above: assert the audio pipeline
    // instead of inheriting it. 48kHz stereo is OBS's own default; writing it
    // down makes the profile self-describing and removes one more way a
    // future OBS default change can silently mute every recording.
    Audio: {
      SampleRate: "48000",
      ChannelSetup: "Stereo",
    },
  });
  writeFileSync(join(dir, "basic.ini"), txt);
}

function writeRecordEncoder(spec: ObsConfigSpec): void {
  const dir = join(cfgRoot(spec.obsRoot), "basic", "profiles", PROFILE_NAME);
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, "recordEncoder.json"), {
    rate_control: "CBR",
    bitrate: spec.bitrateKbps,
    keyint_sec: 1,
  });
}

/**
 * Audio device wiring (design doc U4: "默认只录桌面音,不录麦克风").
 *
 * These keys are NOT in basic.ini — confirmed by reading obs-studio 32.2.1
 * source (cloned at tag 32.2.1, commit 0052d024). The global per-channel
 * audio devices (desktop audio = channels 1-2, mic/aux = channels 3-6) are
 * persisted as top-level keys in the *scene collection* JSON, not the
 * profile:
 *
 * - Key names: `frontend/widgets/OBSBasic_SceneCollections.cpp:798-803`
 *   (`DesktopAudioDevice1`, `DesktopAudioDevice2`, `AuxAudioDevice1..4`).
 * - Save path: `OBSBasic_SceneCollections.cpp:818-831` (`SaveAudioDevice`) —
 *   `obs_data_set_obj(saveData, key, obs_save_source(source))` per channel,
 *   channel 1 = DesktopAudioDevice1.
 * - Load path: `OBSBasic_SceneCollections.cpp:1007-1019` (`LoadAudioDevice`)
 *   + `:1263-1268` (called unconditionally from `LoadData`, which runs for
 *   *any* scene collection file we ship — not gated behind FirstRun/
 *   CreateFirstRunSources). A missing key is a safe no-op: `obs_data_get_obj`
 *   returns null, the function returns immediately, channel stays unset —
 *   confirming that simply omitting `AuxAudioDevice1..4` is sufficient to
 *   leave mic/aux unrecorded, no "disabled" sentinel value needed.
 * - Source id + settings key: `frontend/widgets/OBSBasic_SceneItems.cpp:
 *   230-256` (`ResetAudioDevice`) — settings key is `device_id`, value
 *   `"default"`; `frontend/OBSApp.cpp:1379-1391` — source ids
 *   `wasapi_output_capture` (desktop) / `wasapi_input_capture` (mic), Windows
 *   only (matches managed-OBS being win32-only, 复核 M12).
 * - Defaults for omitted source fields (volume, mixers routing, enabled):
 *   `libobs/obs.c:2300-2322` (`obs_load_source_type`) — a minimal
 *   `{name, id, settings}` object loads with sane recording defaults
 *   (volume 1.0, all 6 mixer tracks, enabled true), so no extra fields are
 *   required here.
 */
/** Source names for the two global audio channels. Exported: the managed
 * backend's device enumeration (listAudioDevices) creates its temporary
 * probe inputs under names derived from these so they can never collide
 * with the real channel sources. */
export const DESKTOP_AUDIO_INPUT_NAME = "Desktop Audio";
export const MIC_AUDIO_INPUT_NAME = "Mic/Aux";
/** Source kinds (Windows only — matches managed OBS being win32-only). */
export const DESKTOP_AUDIO_INPUT_KIND = "wasapi_output_capture";
export const MIC_AUDIO_INPUT_KIND = "wasapi_input_capture";

function desktopAudioDeviceEntry(deviceId: string): Record<string, unknown> {
  return {
    name: DESKTOP_AUDIO_INPUT_NAME,
    id: DESKTOP_AUDIO_INPUT_KIND,
    settings: { device_id: deviceId },
  };
}

function micAudioDeviceEntry(deviceId: string): Record<string, unknown> {
  return {
    name: MIC_AUDIO_INPUT_NAME,
    id: MIC_AUDIO_INPUT_KIND,
    settings: { device_id: deviceId },
  };
}

function writeSceneCollection(spec: ObsConfigSpec): void {
  const dir = join(cfgRoot(spec.obsRoot), "basic", "scenes");
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, `${SCENE_NAME}.json`), {
    current_scene: SCENE_NAME,
    current_program_scene: SCENE_NAME,
    scene_order: [{ name: SCENE_NAME }],
    name: SCENE_NAME,
    // Empty scene: capture sources get added at runtime via websocket
    // (design doc §5.4), not written here.
    sources: [{ id: "scene", name: SCENE_NAME, settings: { items: [] } }],
    // Audio channels: a null device id OMITS the key, which is exactly how
    // OBS expresses "channel unassigned" (LoadAudioDevice no-ops on an
    // absent key — see the doc comment above for the source citations).
    // Product default (spec from MANAGED_OBS_PREF_DEFAULTS): desktop audio
    // on the system default device, no mic.
    ...(spec.desktopAudioDeviceId !== null
      ? {
          DesktopAudioDevice1: desktopAudioDeviceEntry(
            spec.desktopAudioDeviceId,
          ),
        }
      : {}),
    ...(spec.micDeviceId !== null
      ? { AuxAudioDevice1: micAudioDeviceEntry(spec.micDeviceId) }
      : {}),
  });
}

/**
 * Writes the entire portable-OBS config tree. Pure and idempotent: the same
 * spec always produces byte-identical files (no timestamps, no random
 * content) — callers may call this on every spawn without special-casing
 * "first run".
 */
export function writeObsConfig(spec: ObsConfigSpec): void {
  mkdirSync(spec.obsRoot, { recursive: true });
  writeFileSync(join(spec.obsRoot, "portable_mode.txt"), "");

  mkdirSync(cfgRoot(spec.obsRoot), { recursive: true });
  writeUserIni(spec.obsRoot);
  writeGlobalIni(spec.obsRoot);
  writeWebsocketConfig(spec);

  // Real machine (2026-08-04) showed OBS fails "bad output path" when the
  // recording directory is unwritable/absent — create it before it is
  // referenced from basic.ini.
  mkdirSync(spec.recDir, { recursive: true });
  writeBasicIni(spec);
  writeRecordEncoder(spec);
  writeSceneCollection(spec);
}

/**
 * Deletes only the unclean-shutdown sentinel files
 * (`config/obs-studio/.sentinel/run_*`) — the modal-killer. Must be called
 * before every spawn (design doc §5.2/§2.3.2: an unattended spawn that hits
 * a crash-recovery or first-run modal steals focus, which stops rendering
 * in an exclusive-fullscreen game and can ruin the match being recorded).
 * Leaves any other file under `.sentinel/` untouched, and is a no-op if the
 * directory does not exist.
 */
export function clearSentinels(obsRoot: string): void {
  const dir = join(cfgRoot(obsRoot), ".sentinel");
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith("run_")) {
      rmSync(join(dir, entry), { force: true });
    }
  }
}
