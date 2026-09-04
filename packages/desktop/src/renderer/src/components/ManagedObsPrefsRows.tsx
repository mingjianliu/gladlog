import { useEffect, useState } from "react";

import type { GladlogSettings } from "../../../main/settingsStore";
import type { ObsAudioDevice } from "../../../main/managedObsBackend";
import {
  DEFAULT_AUDIO_DEVICE_ID,
  type ManagedObsPrefs,
} from "../../../shared/managedObsPrefs";
import { bridge } from "../bridge";

/** `<select>` value for "don't record this channel" — settings store it as
 * null, which an option value cannot be. */
const NONE = "__none__";

/** The save note every prefs row uses: honest about WHEN it applies (user
 * ruling 2026-09-04 — restart now, or after the current recording). */
export const PREFS_SAVED_NOTE =
  "已保存,托管 OBS 重启后生效(正在录制则本场结束后自动重启)";

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
): Array<{ value: string; label: string }> {
  const opts: Array<{ value: string; label: string }> = [
    { value: DEFAULT_AUDIO_DEVICE_ID, label: "系统默认设备" },
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
    opts.push({ value: current, label: `已保存的设备(${current})` });
  }
  opts.push({ value: NONE, label: "不录" });
  return opts;
}

/**
 * Managed-OBS prefs (2026-09-04): three settings rows rendered inside the
 * recording card when the managed instance is installed — desktop audio
 * device, microphone device, recording directory — plus "import from my
 * OBS". Each row is label | control | action, matching the parent grid.
 */
export function ManagedObsPrefsRows({ settings, save, reload }: Props) {
  const [devices, setDevices] = useState<{
    output: ObsAudioDevice[];
    input: ObsAudioDevice[];
  }>({ output: [], input: [] });
  const [importMsg, setImportMsg] = useState<string | null>(null);
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
    setImportMsg(null);
    try {
      const r = await bridge().recorder.importObsPrefs();
      if (!r.found) {
        setImportMsg("✗ 未找到本机 OBS 配置(装了 OBS 吗?)");
        return;
      }
      await reload();
      const parts: string[] = [];
      const a = r.applied ?? {};
      if ("recordingDirectory" in a) parts.push("录像目录");
      if ("managedDesktopAudioDevice" in a) parts.push("桌面声音");
      if ("managedMicDevice" in a) parts.push("麦克风");
      setImportMsg(
        `✓ 已导入 ${parts.join("、") || "(无变化)"};${PREFS_SAVED_NOTE}`,
      );
    } catch (e) {
      setImportMsg(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImporting(false);
    }
  }

  async function pickDirectory(): Promise<void> {
    const dir = await bridge().recorder.selectRecordingDirectory();
    if (dir) await reload();
  }

  const desktopValue = settings.managedDesktopAudioDevice ?? NONE;
  const micValue = settings.managedMicDevice ?? NONE;

  return (
    <>
      <span className="settings-k">导入配置</span>
      <span className="settings-v">
        把你自己 OBS 里当前 profile
        的录像目录、桌面声音和麦克风设备复制过来(只读取,不改动你的 OBS)。
      </span>
      <span className="settings-actions">
        <button disabled={importing} onClick={() => void runImport()}>
          {importing ? "导入中…" : "从本机 OBS 导入"}
        </button>
      </span>
      {importMsg && (
        <>
          <span className="settings-k" />
          <span className="settings-v">{importMsg}</span>
          <span />
        </>
      )}

      <span className="settings-k">桌面声音</span>
      <select
        aria-label="桌面声音设备"
        value={desktopValue}
        onChange={(e) =>
          void save(
            {
              managedDesktopAudioDevice:
                e.target.value === NONE ? null : e.target.value,
            },
            PREFS_SAVED_NOTE,
          )
        }
      >
        {audioOptions(devices.output, settings.managedDesktopAudioDevice).map(
          (o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ),
        )}
      </select>
      <span />

      <span className="settings-k">麦克风</span>
      <select
        aria-label="麦克风设备"
        value={micValue}
        onChange={(e) =>
          void save(
            {
              managedMicDevice: e.target.value === NONE ? null : e.target.value,
            },
            PREFS_SAVED_NOTE,
          )
        }
      >
        {audioOptions(devices.input, settings.managedMicDevice).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span />

      <span className="settings-k">录像目录</span>
      <span className="settings-v">
        {settings.recordingDirectory ??
          "默认(应用数据目录下的 recordings 文件夹)"}
      </span>
      <span className="settings-actions">
        <button onClick={() => void pickDirectory()}>选择目录…</button>
        {settings.recordingDirectory && (
          <button
            onClick={() =>
              void save({ recordingDirectory: null }, PREFS_SAVED_NOTE)
            }
          >
            恢复默认
          </button>
        )}
      </span>
    </>
  );
}
