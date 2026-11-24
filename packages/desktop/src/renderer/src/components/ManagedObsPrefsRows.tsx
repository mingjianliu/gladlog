import { useEffect, useState } from "react";

import type { ObsAudioDevice } from "../../../main/managedObsBackend";
import type { GladlogSettings } from "../../../main/settingsStore";
import type { MessageKey, TFn } from "../../../shared/i18n";
import {
  DEFAULT_AUDIO_DEVICE_ID,
  type ManagedObsPrefs,
} from "../../../shared/managedObsPrefs";
import { bridge } from "../bridge";
import { useT } from "../i18n/LangProvider";

/** `<select>` value for "don't record this channel" — settings store it as
 * null, which an option value cannot be. */
const NONE = "__none__";

interface Props {
  settings: Pick<GladlogSettings, keyof ManagedObsPrefs>;
  save: (partial: Partial<ManagedObsPrefs>, note: string) => Promise<void>;
  /** Re-read settings after a main-side import wrote them. */
  reload: () => Promise<void>;
}

/** Options for one audio channel: the system default, every enumerated
 * device, the current value if it is not in the list (a device imported
 * while the managed OBS was not running, or unplugged since), and "don't
 * record". Ids are what gets saved; names are what the user sees. */
function audioOptions(
  devices: ObsAudioDevice[],
  current: string | null,
  t: TFn,
): Array<{ value: string; label: string }> {
  const opts: Array<{ value: string; label: string }> = [
    {
      value: DEFAULT_AUDIO_DEVICE_ID,
      label: t("recorder.prefs.audio.systemDefault"),
    },
  ];
  for (const d of devices) {
    if (d.id === DEFAULT_AUDIO_DEVICE_ID) continue;
    opts.push({ value: d.id, label: d.name });
  }
  if (
    current !== null &&
    current !== DEFAULT_AUDIO_DEVICE_ID &&
    !devices.some((d) => d.id === current)
  ) {
    opts.push({
      value: current,
      label: t("recorder.prefs.audio.savedDevice", { id: current }),
    });
  }
  opts.push({ value: NONE, label: t("recorder.prefs.audio.none") });
  return opts;
}

/** A setting "import from my OBS" applied, and its dictionary label. */
type ImportedPart = "directory" | "desktopAudio" | "mic";
const IMPORTED_PART_KEY = {
  directory: "recorder.prefs.import.part.directory",
  desktopAudio: "recorder.prefs.import.part.desktopAudio",
  mic: "recorder.prefs.import.part.mic",
} as const satisfies Record<ImportedPart, MessageKey>;

/**
 * Managed-OBS prefs (2026-09-04): three settings rows rendered inside the
 * recording card when the managed instance is installed — desktop audio
 * device, microphone device, recording directory — plus "import from my
 * OBS". Each row is label | control | action, matching the parent grid.
 */
export function ManagedObsPrefsRows({ settings, save, reload }: Props) {
  const { t } = useT();
  // The save note every prefs row uses: honest about WHEN it applies (user
  // ruling 2026-09-04 — restart now, or after the current recording).
  const prefsSavedNote = t("recorder.prefs.savedNote");
  const [devices, setDevices] = useState<{
    output: ObsAudioDevice[];
    input: ObsAudioDevice[];
  }>({ output: [], input: [] });
  // The import outcome, worded at render time so a language switch re-words
  // a result already on screen (`error` is the raw message, kept as is).
  const [importResult, setImportResult] = useState<
    | { kind: "notFound" }
    | { kind: "done"; parts: ImportedPart[] }
    | { kind: "failed"; error: string }
    | null
  >(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    // Enumeration needs the managed instance running; an empty answer just
    // leaves "系统默认设备 / 不录" (plus any saved id) as the choices.
    try {
      const api = bridge().recorder;
      if (!api?.listAudioDevices) return;
      let stale = false;
      void api
        .listAudioDevices()
        .then((r) => {
          if (!stale && r) setDevices(r);
        })
        .catch(() => undefined);
      return () => {
        stale = true;
      };
    } catch {
      /* degraded / fixture bridge */
    }
  }, []);

  async function runImport(): Promise<void> {
    setImporting(true);
    setImportResult(null);
    try {
      const r = await bridge().recorder.importObsPrefs();
      if (!r.found) {
        setImportResult({ kind: "notFound" });
        return;
      }
      await reload();
      const parts: ImportedPart[] = [];
      const a = r.applied ?? {};
      if ("recordingDirectory" in a) parts.push("directory");
      if ("managedDesktopAudioDevice" in a) parts.push("desktopAudio");
      if ("managedMicDevice" in a) parts.push("mic");
      setImportResult({ kind: "done", parts });
    } catch (e) {
      setImportResult({
        kind: "failed",
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setImporting(false);
    }
  }

  const importMsg =
    importResult === null
      ? null
      : importResult.kind === "notFound"
        ? t("recorder.prefs.import.notFound")
        : importResult.kind === "done"
          ? t("recorder.prefs.import.done", {
              items:
                importResult.parts
                  .map((p) => t(IMPORTED_PART_KEY[p]))
                  .join(t("recorder.prefs.import.listSeparator")) ||
                t("recorder.prefs.import.nothing"),
              note: prefsSavedNote,
            })
          : `✗ ${importResult.error}`;

  async function pickDirectory(): Promise<void> {
    const dir = await bridge().recorder.selectRecordingDirectory();
    if (dir) await reload();
  }

  const desktopValue = settings.managedDesktopAudioDevice ?? NONE;
  const micValue = settings.managedMicDevice ?? NONE;

  return (
    <>
      <span className="settings-k">{t("recorder.prefs.import.label")}</span>
      <span className="settings-v">{t("recorder.prefs.import.note")}</span>
      <span className="settings-actions">
        <button disabled={importing} onClick={() => void runImport()}>
          {importing
            ? t("recorder.prefs.import.busy")
            : t("recorder.prefs.import.button")}
        </button>
      </span>
      {importMsg && (
        <>
          <span className="settings-k" />
          <span className="settings-v">{importMsg}</span>
          <span />
        </>
      )}

      <span className="settings-k">
        {t("recorder.prefs.desktopAudio.label")}
      </span>
      <select
        aria-label={t("recorder.prefs.desktopAudio.aria")}
        value={desktopValue}
        onChange={(e) =>
          void save(
            {
              managedDesktopAudioDevice:
                e.target.value === NONE ? null : e.target.value,
            },
            prefsSavedNote,
          )
        }
      >
        {audioOptions(
          devices.output,
          settings.managedDesktopAudioDevice,
          t,
        ).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span />

      <span className="settings-k">{t("recorder.prefs.mic.label")}</span>
      <select
        aria-label={t("recorder.prefs.mic.aria")}
        value={micValue}
        onChange={(e) =>
          void save(
            {
              managedMicDevice: e.target.value === NONE ? null : e.target.value,
            },
            prefsSavedNote,
          )
        }
      >
        {audioOptions(devices.input, settings.managedMicDevice, t).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span />

      <span className="settings-k">{t("recorder.prefs.directory.label")}</span>
      <span className="settings-v">
        {settings.recordingDirectory ?? t("recorder.prefs.directory.default")}
      </span>
      <span className="settings-actions">
        <button onClick={() => void pickDirectory()}>
          {t("settings.chooseFolder")}
        </button>
        {settings.recordingDirectory && (
          <button
            onClick={() =>
              void save({ recordingDirectory: null }, prefsSavedNote)
            }
          >
            {t("recorder.prefs.directory.reset")}
          </button>
        )}
      </span>
    </>
  );
}
