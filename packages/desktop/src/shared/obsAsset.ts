/**
 * Managed-OBS asset identity: pinned release version, download URL, expected
 * SHA-256, and expected byte size. Verified against the real GitHub release
 * and a real Windows machine on 2026-08-04 — do not bump without re-verifying
 * both. Single source: gate scripts (task 3/7) import these instead of
 * hardcoding copies (shared-predicate rule, CLAUDE.md).
 */
export const OBS_VERSION = "32.2.1";
export const OBS_ZIP_URL = `https://github.com/obsproject/obs-studio/releases/download/${OBS_VERSION}/OBS-Studio-${OBS_VERSION}-Windows-x64.zip`;
export const OBS_ZIP_SHA256 =
  "db64a2934f8261f85b1410b84be011207a0afda5400d008289f1f1e211bcc7de";
export const OBS_ZIP_BYTES = 187_817_017;
/** Managed instance's websocket port. 4466 (design doc 2.4): far from the
 * user's own OBS default 4455, verified free on the real machine. */
export const MANAGED_WS_PORT = 4466;

/** Pinned recording VIDEO encoder: no websocket encoder-enumeration API exists
 * for stage 1, so this is written into basic.ini (obsConfigWriter) and asserted
 * against the live profile (managedObsBackend). Single source (shared-predicate
 * rule, CLAUDE.md). */
export const PINNED_ENCODER = "obs_x264";

/**
 * Pinned recording AUDIO encoder. This is an encoder **id**, not a codec name,
 * and the distinction is the whole point — it cost a real machine "启动录像失败 /
 * 启动输出失败" on 2026-09-09 (真机症状 2026-09-09 ②).
 *
 * `[AdvOut] RecAudioEncoder` is passed STRAIGHT to `obs_audio_encoder_create()`
 * (`frontend/utility/AdvancedOutput.cpp:157` at tag 32.2.1). The bare codec
 * name `"aac"` is legal ONLY in the `[SimpleOutput]` section, which resolves it
 * through `FindAudioEncoderFromCodec()`; in `[AdvOut]` it is looked up as an id,
 * no encoder is registered under it (obs-ffmpeg registers `ffmpeg_aac` /
 * `ffmpeg_opus` / `ffmpeg_pcm_*` / `ffmpeg_alac` / `ffmpeg_flac`), and the
 * failure is silent by construction: `create_encoder()` logs `Encoder ID 'aac'
 * not found` but still returns a PLACEHOLDER encoder object
 * (`libobs/obs-encoder.c:126`), so AdvancedOutput's own `if (!recordTrack[i])
 * throw` never fires. It only breaks later, at Start Recording, where the
 * placeholder has no `create` callback, `obs_encoder_initialize_internal()`
 * returns false, and `obs_output_start()` fails with a NULL last-error — which
 * is exactly the generic "启动输出失败,请检查日志" modal, the one that names
 * NVENC/AMD drivers and has nothing to do with either.
 *
 * `ffmpeg_aac` is OBS's own fallback default (`frontend/widgets/OBSBasic.cpp:
 * 891`, which prefers `CoreAudio_AAC`/`libfdk_aac` only when
 * `EncoderAvailable()` says so — a runtime probe a config generator cannot do)
 * and ships inside obs-ffmpeg, which `shouldExtract` always keeps.
 */
export const PINNED_AUDIO_ENCODER = "ffmpeg_aac";

/**
 * OBS's own encoding of a version number: `MAKE_SEMANTIC_VERSION(major, minor,
 * patch) = (major << 24) | (minor << 16) | patch` (`libobs/obs-config.h:46`).
 * Exported for the test that pins the rule below.
 */
export function makeSemanticVersion(
  major: number,
  minor: number,
  patch: number,
): number {
  return (major << 24) | (minor << 16) | patch;
}

/**
 * `[General] LastVersion` as OBS itself writes it: an INTEGER
 * (`config_set_int(appConfig, "General", "LastVersion", LIBOBS_API_VER)` —
 * `frontend/widgets/OBSBasic.cpp:1905`), never the dotted string.
 *
 * 真机症状 2026-09-09 ①("不让我 migrate configuration"): we used to write
 * `LastVersion=32.2.1`, and OBS reads this key with `config_get_int`, i.e.
 * `strtoll("32.2.1", …, 10)` = **32**. 32 is nonzero and far below
 * `MAKE_SEMANTIC_VERSION(31,0,0)` = 520093696, so every launch took the
 * pre-31 branch in `OBSApp::InitGlobalConfig` (`frontend/OBSApp.cpp:555`) and
 * tried to migrate global.ini → user.ini. We write user.ini ourselves, so
 * `MigrateGlobalSettings()` hit its "already exists" guard and threw up a
 * BLOCKING English `QMessageBox::critical` ("Unable to migrate global
 * configuration - user configuration file already exists.") before the
 * websocket ever bound — every single launch, since OBS's `Pre31Migrated=false`
 * marker lands in the global.ini we regenerate on the next spawn anyway.
 * The same wrong number also made `MigrateLegacySettings()` stamp
 * Pre19/Pre21/Pre23/Pre24.1Defaults=true into user.ini.
 */
export const OBS_API_VERSION = ((): number => {
  const [major, minor, patch] = OBS_VERSION.split(".").map(Number);
  return makeSemanticVersion(major ?? 0, minor ?? 0, patch ?? 0);
})();

/** true = extract this zip entry. Blacklist style: default-extract, skip only
 * the known-big, known-unneeded payloads (CEF, pdb, scripting, extra locales).
 * ACCEPTS BOTH SEPARATORS — callers hand it paths from a directory walk, which
 * on win32 uses backslashes. */
export function shouldExtract(entryPath: string): boolean {
  const p = entryPath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (/\.pdb$/i.test(p)) return false;
  if (/^obs-plugins\/64bit\/locales\//.test(p)) return false;
  if (
    /^obs-plugins\/64bit\/(libcef\.dll|chrome_elf\.dll|libEGL\.dll|libGLESv2\.dll|snapshot_blob\.bin|v8_context_snapshot\.bin|icudtl\.dat|vk_swiftshader.*|vulkan-1\.dll|.*\.pak)$/i.test(
      p,
    )
  )
    return false;
  if (/^obs-plugins\/64bit\/obs-browser/i.test(p)) return false;
  if (/^bin\/64bit\/obs-browser-page\.exe$/i.test(p)) return false;
  if (/^data\/obs-scripting\//.test(p)) return false;
  const loc = /^data\/obs-studio\/locale\/(.+)\.ini$/.exec(p);
  if (loc) return loc[1] === "en-US" || loc[1] === "zh-CN";
  return true;
}
