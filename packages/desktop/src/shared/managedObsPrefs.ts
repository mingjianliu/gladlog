/**
 * Managed-OBS user preferences (2026-09-04): the three settings a user can
 * change about the portable OBS instance gladlog runs for them — where the
 * mp4 chunks go, which desktop-audio device is recorded, which microphone
 * (if any) is recorded. Electron-free so main and renderer can both import
 * it (CLAUDE.md shared-predicate rule: one fact, one predicate).
 *
 * All three are read by OBS at process start (RecFilePath from basic.ini;
 * the audio devices from the scene collection JSON), so changing any of them
 * requires a managed-instance restart — `managedObsPrefsChanged` is the one
 * predicate deciding "does this settings patch need that restart".
 */

export interface ManagedObsPrefs {
  /** null → the app default (userData/recordings). Whitespace-only is
   * treated as null by `resolveRecordingDir`, never as a directory. */
  recordingDirectory: string | null;
  /** WASAPI endpoint id of the desktop-audio (output) device to record.
   * `DEFAULT_AUDIO_DEVICE_ID` = the system default; null = record no
   * desktop audio at all. */
  managedDesktopAudioDevice: string | null;
  /** WASAPI endpoint id of the microphone (input) device to record.
   * `DEFAULT_AUDIO_DEVICE_ID` = the system default; null = record no mic
   * (the product default — design doc U4 "默认只录桌面音,不录麦克风"). */
  managedMicDevice: string | null;
}

/** OBS's own sentinel for "the system default device" (settings key
 * `device_id`, see obsConfigWriter.ts's source citations). */
export const DEFAULT_AUDIO_DEVICE_ID = "default";

export const MANAGED_OBS_PREF_KEYS = [
  "recordingDirectory",
  "managedDesktopAudioDevice",
  "managedMicDevice",
] as const satisfies readonly (keyof ManagedObsPrefs)[];

export const MANAGED_OBS_PREF_DEFAULTS: ManagedObsPrefs = {
  recordingDirectory: null,
  managedDesktopAudioDevice: DEFAULT_AUDIO_DEVICE_ID,
  managedMicDevice: null,
};

/** True when any of the three managed-OBS prefs differs between two settings
 * snapshots — the restart trigger. */
export function managedObsPrefsChanged(
  prev: ManagedObsPrefs,
  next: ManagedObsPrefs,
): boolean {
  return MANAGED_OBS_PREF_KEYS.some((k) => prev[k] !== next[k]);
}

/** The effective recording directory: the user's choice when set to a
 * non-blank string, else the app default. Single source for BOTH consumers
 * (the OBS profile's RecFilePath and the recordings store's video-dir scan)
 * so they can never disagree about where chunks land. */
export function resolveRecordingDir(
  defaultDir: string,
  prefs: Pick<ManagedObsPrefs, "recordingDirectory">,
): string {
  const chosen = prefs.recordingDirectory?.trim();
  return chosen ? chosen : defaultDir;
}
