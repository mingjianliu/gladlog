import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

import type { ManagedObsPrefs } from "../shared/managedObsPrefs";

/** OBS (28+, with obs-websocket built in) stores its server configuration in a
 * fixed local JSON file: port, password, and whether it is enabled. Reading it
 * directly saves the user from copying the password out of OBS by hand (real-
 * machine feedback). Read-only, never write — OBS rewrites the whole file on
 * exit, so any external write gets silently clobbered. */
export interface ObsWsDetected {
  found: boolean;
  configPath?: string;
  enabled?: boolean;
  /**
   * Honest tri-state modeling (2026-07-31 audit #21 item5): `true`/`false` =
   * explicitly read from the config file; `"unknown"` = the field is missing
   * or not a boolean (schema drift across OBS versions, etc.), which must NOT
   * be treated as "password required" — the old `!== false` implementation
   * misread a missing field as "password required". For how the consumer
   * (the autoConfig handler in ipc.ts) treats unknown, see
   * resolveAutoConfigPassword / authUnknownHint.
   */
  authRequired?: boolean | "unknown";
  port?: number;
  password?: string | null;
}

export function obsWebsocketConfigCandidates(opts?: {
  platform?: NodeJS.Platform;
  appData?: string | undefined;
  home?: string;
}): string[] {
  const platform = opts?.platform ?? process.platform;
  const home = opts?.home ?? homedir();
  const rel = join(
    "obs-studio",
    "plugin_config",
    "obs-websocket",
    "config.json",
  );
  if (platform === "win32") {
    const appData = opts ? opts.appData : (process.env["APPDATA"] ?? undefined);
    return appData ? [join(appData, rel)] : [];
  }
  if (platform === "darwin")
    return [join(home, "Library", "Application Support", rel)];
  return [join(home, ".config", rel)];
}

export function detectObsWebsocket(
  candidates: string[] = obsWebsocketConfigCandidates(),
  read: (p: string) => string = (p) => readFileSync(p, "utf-8"),
): ObsWsDetected {
  for (const p of candidates) {
    try {
      const raw = JSON.parse(read(p)) as {
        server_enabled?: boolean;
        auth_required?: boolean;
        server_port?: number;
        server_password?: string;
      };
      const authRequired: boolean | "unknown" =
        raw.auth_required === true
          ? true
          : raw.auth_required === false
            ? false
            : "unknown";
      return {
        found: true,
        configPath: p,
        enabled: raw.server_enabled === true,
        authRequired,
        port: typeof raw.server_port === "number" ? raw.server_port : 4455,
        password: raw.server_password ?? null,
      };
    } catch {
      /* try the next candidate */
    }
  }
  return { found: false };
}

/**
 * The least-surprising choice in the unknown state: connect with whatever
 * password we read rather than forcing it empty. The basis is that
 * obs-websocket-js's identify() only hashes with this password when the
 * server's Hello actually carries an authentication challenge (see
 * `if (authentication && password)` in the obs-websocket-js dist sources under
 * node_modules) — so when auth is off, an extra password field is simply
 * ignored and cannot cause the perverse "auth wasn't even on, yet we can't
 * connect" outcome. Only when `auth_required === false` is read explicitly do
 * we definitively clear the password (there, sending one is pure surplus, and
 * omitting it is the honest "this genuinely needs no password").
 */
export function resolveAutoConfigPassword(d: ObsWsDetected): string | null {
  if (d.authRequired === false) return null;
  return d.password ?? null;
}

/**
 * When a connection fails in the unknown state, hand the user a plain-language
 * clue — we never managed to read the auth state, and a bare "connection
 * failed / auth error" easily makes people think the address is wrong. The
 * true/false states need no such hint (either a password is definitely
 * required and was sent, or it is definitely not needed).
 */
// -- Managed-OBS prefs import (2026-09-04) ----------------------------------
//
// The user's own OBS install already knows the three things the managed
// instance asks for (recording folder, desktop-audio device, mic device), in
// the same files the managed writer produces — so "import from my OBS" is a
// read of the SAME keys obsConfigWriter.ts writes. Read-only, like the
// websocket detection above: OBS rewrites all of these on exit.
//
// Layout (OBS 31+, confirmed against obs-studio 32.2.1):
//   <root>/user.ini                          [Basic] ProfileDir / SceneCollectionFile
//   <root>/global.ini                        same keys on OBS ≤30 (fallback)
//   <root>/basic/profiles/<ProfileDir>/basic.ini
//                                            [Output] Mode=Simple|Advanced
//                                            [SimpleOutput] FilePath=…
//                                            [AdvOut] RecFilePath=…
//   <root>/basic/scenes/<SceneCollectionFile>.json
//                                            DesktopAudioDevice1 / AuxAudioDevice1
//                                            → settings.device_id, muted

export interface ObsAudioDeviceDetected {
  deviceId: string;
  /** The source is muted (or disabled) in the user's OBS — they have the
   * device configured but do not actually record it. Import maps this to
   * "don't record" rather than copying a device the user silenced. */
  muted: boolean;
}

export interface ObsRecordingPrefsDetected {
  found: boolean;
  configRoot?: string;
  /** The profile's recording folder, or null when the profile could not be
   * read / has no folder set. */
  recordingDirectory: string | null;
  /** The scene collection was found and parsed — only then do the two audio
   * fields below mean "unassigned" when null. false = unreadable/corrupt,
   * and the import must not touch the audio settings (agy review #2: a
   * null read as "unassigned" would silently switch desktop audio OFF). */
  sceneRead: boolean;
  /** Channel 1 (DesktopAudioDevice1); null = unassigned in the user's OBS
   * (meaningful only when sceneRead). */
  desktopAudio: ObsAudioDeviceDetected | null;
  /** Channel 3 (AuxAudioDevice1); null = unassigned (only when sceneRead). */
  mic: ObsAudioDeviceDetected | null;
}

/** Directories that may hold a user OBS config tree (the parent of
 * user.ini / basic/). Same platform mapping as obsWebsocketConfigCandidates. */
export function obsConfigRootCandidates(opts?: {
  platform?: NodeJS.Platform;
  appData?: string | undefined;
  home?: string;
}): string[] {
  const platform = opts?.platform ?? process.platform;
  const home = opts?.home ?? homedir();
  if (platform === "win32") {
    const appData = opts ? opts.appData : (process.env["APPDATA"] ?? undefined);
    return appData ? [join(appData, "obs-studio")] : [];
  }
  if (platform === "darwin")
    return [join(home, "Library", "Application Support", "obs-studio")];
  return [join(home, ".config", "obs-studio")];
}

/** Minimal ini reader for OBS's own files: `[Section]` headers, `key=value`
 * lines, first `=` splits, no quoting/escaping (OBS writes none). */
export function parseObsIni(
  txt: string,
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let section = "";
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith(";") || line.startsWith("#")) continue;
    const head = /^\[(.+)\]$/.exec(line);
    if (head) {
      section = head[1]!;
      out[section] ??= {};
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    (out[section] ??= {})[key] = value;
  }
  return out;
}

function audioDeviceFromSceneEntry(v: unknown): ObsAudioDeviceDetected | null {
  if (typeof v !== "object" || v === null) return null;
  const entry = v as {
    settings?: { device_id?: unknown };
    muted?: unknown;
    enabled?: unknown;
  };
  const id = entry.settings?.device_id;
  if (typeof id !== "string" || id === "") return null;
  return {
    deviceId: id,
    muted: entry.muted === true || entry.enabled === false,
  };
}

const NOT_FOUND: ObsRecordingPrefsDetected = {
  found: false,
  recordingDirectory: null,
  sceneRead: false,
  desktopAudio: null,
  mic: null,
};

export function detectObsRecordingPrefs(
  candidates: string[] = obsConfigRootCandidates(),
  read: (p: string) => string = (p) => readFileSync(p, "utf-8"),
): ObsRecordingPrefsDetected {
  const tryRead = (p: string): string | null => {
    try {
      return read(p);
    } catch {
      return null;
    }
  };
  for (const root of candidates) {
    // Which profile / scene collection is current. user.ini is the OBS 31+
    // location; global.ini carried the same [Basic] keys before that.
    let basic: Record<string, string> | undefined;
    for (const ini of ["user.ini", "global.ini"]) {
      const txt = tryRead(join(root, ini));
      if (txt === null) continue;
      const parsed = parseObsIni(txt)["Basic"];
      if (
        parsed &&
        (parsed["ProfileDir"] ||
          parsed["SceneCollectionFile"] ||
          parsed["Profile"] ||
          parsed["SceneCollection"])
      ) {
        basic = parsed;
        break;
      }
    }
    if (!basic) continue;

    let recordingDirectory: string | null = null;
    // ProfileDir / SceneCollectionFile are the on-disk names (OBS 30+). Older
    // installs only wrote the display names, which OBS derived the file names
    // from by replacing unsafe characters — for the common case (no such
    // characters) the two are identical, so the display name is the best
    // available fallback rather than giving up on the whole import.
    const profileDir = basic["ProfileDir"] || basic["Profile"];
    if (profileDir) {
      const txt = tryRead(
        join(root, "basic", "profiles", profileDir, "basic.ini"),
      );
      if (txt !== null) {
        const ini = parseObsIni(txt);
        const mode = ini["Output"]?.["Mode"];
        const dir =
          mode === "Advanced"
            ? ini["AdvOut"]?.["RecFilePath"]
            : ini["SimpleOutput"]?.["FilePath"];
        recordingDirectory = dir && dir.trim() !== "" ? dir : null;
      }
    }

    let sceneRead = false;
    let desktopAudio: ObsAudioDeviceDetected | null = null;
    let mic: ObsAudioDeviceDetected | null = null;
    const sceneFile = basic["SceneCollectionFile"] || basic["SceneCollection"];
    if (sceneFile) {
      const txt = tryRead(join(root, "basic", "scenes", `${sceneFile}.json`));
      if (txt !== null) {
        try {
          const scene = JSON.parse(txt) as Record<string, unknown>;
          desktopAudio = audioDeviceFromSceneEntry(
            scene["DesktopAudioDevice1"],
          );
          mic = audioDeviceFromSceneEntry(scene["AuxAudioDevice1"]);
          sceneRead = true;
        } catch {
          /* corrupt scene JSON: audio stays unknown, folder import still works */
        }
      }
    }
    return {
      found: true,
      configRoot: root,
      recordingDirectory,
      sceneRead,
      desktopAudio,
      mic,
    };
  }
  return NOT_FOUND;
}

/** The settings patch an import produces. A muted/disabled source becomes
 * "don't record" (null) — copying a device the user silenced would start
 * recording something they deliberately turned off. An unassigned channel
 * is also null — but only when the scene collection was actually read;
 * an unreadable scene leaves both audio fields out of the patch. Likewise
 * the recording folder is copied only when the profile actually had one.
 * Anything left out keeps the user's existing choice. */
export function importedPrefsPatch(
  d: ObsRecordingPrefsDetected,
): Partial<ManagedObsPrefs> {
  if (!d.found) return {};
  const patch: Partial<ManagedObsPrefs> = {};
  if (d.sceneRead) {
    patch.managedDesktopAudioDevice =
      d.desktopAudio && !d.desktopAudio.muted ? d.desktopAudio.deviceId : null;
    patch.managedMicDevice = d.mic && !d.mic.muted ? d.mic.deviceId : null;
  }
  if (d.recordingDirectory !== null)
    patch.recordingDirectory = d.recordingDirectory;
  return patch;
}

export function authUnknownHint(
  authRequired: ObsWsDetected["authRequired"],
  ok: boolean,
): string | undefined {
  return authRequired === "unknown" && !ok
    ? "OBS 鉴权状态未知(配置字段缺失或格式有变),可能需要密码;已尝试携带读到的密码连接"
    : undefined;
}
