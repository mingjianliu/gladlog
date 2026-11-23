import { useEffect, useState } from "react";

import type { ObsInstallProgress } from "../../../main/obsAssets";
import type { GladlogSettings } from "../../../main/settingsStore";
import type { UpdateState } from "../../../main/updater";
import {
  AI_MODELS,
  type AiBackend,
  BACKEND_CLI_TOOL,
  resolveAiModel,
} from "../../../shared/aiModels";
import {
  bilingual,
  type Language,
  type TFn,
  translate,
} from "../../../shared/i18n";
import { OBS_ZIP_BYTES, OBS_ZIP_URL } from "../../../shared/obsAsset";
import {
  API_KEY_REDACTED,
  DEEPSEEK_KEY_REDACTED,
  DEFAULT_OBS_WS_URL,
  OBS_PASSWORD_REDACTED,
} from "../../../shared/protocol";
import { clampUiZoom, UI_ZOOM_LEVELS } from "../../../shared/uiZoom";
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
} from "../../../shared/updateSchedule";
import { bridge } from "../bridge";
import { useT } from "../i18n/LangProvider";
import { LanguageSegment } from "../i18n/LanguagePicker";
import { applyUiZoom } from "../uiZoom";
import {
  fetchUpdateState,
  hasUpdateSurface,
  requestUpdateCheck,
  subscribeUpdateState,
} from "../update/updateBridge";
import { ImportButton } from "./ImportButton";
import { ManagedObsPrefsRows } from "./ManagedObsPrefsRows";

// 179MB (binary MiB rounding) -- matches the existing "179MB" copy used
// elsewhere in this codebase (index.ts/obsAssets.ts comments); brief point 7.
const OBS_DOWNLOAD_MB = Math.round(OBS_ZIP_BYTES / 1024 / 1024);

type SettingsGroup = "general" | "game" | "ui" | "ai" | "recording" | "about";

/** Relative wall-clock text. Deliberately NOT toLocaleString(): the visual
 *  baseline pins Date.now() (qa/visual/scenes.spec.ts:62 page.clock
 *  .setFixedTime) but pins neither the timezone nor the locale, so an absolute
 *  timestamp would drift between environments while a relative one only
 *  depends on the pinned clock. */
function relTime(at: number, now: number, t: TFn): string {
  const d = Math.max(0, now - at);
  if (d < 60_000) return t("update.rel.justNow");
  if (d < 3_600_000)
    return t("update.rel.minutes", { n: Math.floor(d / 60_000) });
  if (d < 86_400_000)
    return t("update.rel.hours", { n: Math.floor(d / 3_600_000) });
  return t("update.rel.days", { n: Math.floor(d / 86_400_000) });
}

/** One line of copy per update state. An exhaustive switch: a new phase in
 *  main/updater.ts fails typecheck here instead of silently rendering "". */
function describeUpdate(
  s: UpdateState,
  checkedOnce: boolean,
  now: number,
  t: TFn,
): string {
  switch (s.phase) {
    case "disabled":
      return s.reason === "platform"
        ? t("update.disabled.platform")
        : s.reason === "portable"
          ? t("update.disabled.portable")
          : t("update.disabled.dev");
    case "checking":
      return t("update.checking");
    case "downloading":
      return t("update.downloading", {
        version: s.version,
        percent: Math.round(s.percent),
      });
    case "ready":
      return t("update.readyOnQuit", { version: s.version });
    case "error":
      // No "检查失败:" prefix: this message also covers the install watchdog
      // (src/main/updater.ts's "更新安装器未能接管…"), which is not a check
      // failure and would read as self-contradictory with that prefix on.
      return s.message;
    case "idle":
      return s.lastCheckedAt == null
        ? t("update.neverChecked")
        : (checkedOnce ? t("update.upToDatePrefix") : "") +
            t("update.lastChecked", {
              when: relTime(s.lastCheckedAt, now, t),
            });
  }
}

/**
 * Settings page (1i redesign): a three-column grid inside each group card
 * (label | value/input | action), save feedback shown in place on the group
 * heading row (disappearing after 2s), and an "already set" pill in front of
 * the API key.
 */
export function SettingsPanel() {
  const { t, lang, setLang } = useT();
  const [settings, setSettings] = useState<GladlogSettings | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [dsKeyInput, setDsKeyInput] = useState("");
  const [cmdInput, setCmdInput] = useState("");
  const [obsUrlInput, setObsUrlInput] = useState("");
  const [obsPwInput, setObsPwInput] = useState("");
  const [obsTest, setObsTest] = useState<string | null>(null);
  const [keepInput, setKeepInput] = useState("");
  const [saved, setSaved] = useState<{
    group: SettingsGroup;
    note: string;
    /** The save did not persist: shown as an error, not a ✓. */
    failed?: boolean;
  } | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [checkedOnce, setCheckedOnce] = useState(false);

  useEffect(() => {
    void bridge()
      .settings.get()
      .then((s) => {
        setSettings(s);
        setCmdInput(s.aiBackendCommand ?? "");
        setObsUrlInput(s.obsWebsocketUrl ?? "");
        setKeepInput(String(s.recordingKeepCount));
      });
  }, []);

  const [recStatus, setRecStatus] = useState<{
    enabled: boolean;
    connected: boolean;
    recording: boolean;
    lastError: string | null;
  } | null>(null);

  useEffect(() => {
    try {
      const api = bridge().recorder;
      if (!api?.getStatus) return;
      void api.getStatus().then(setRecStatus);
      return api.onStatus?.(setRecStatus);
    } catch {
      /* degraded / fixture bridge -- the row simply does not render */
    }
  }, []);

  // Task 6: managed-OBS install state (复核 I4/I12) -- a durable, pollable
  // query fetched on mount, so a fresh launch renders 待安装 immediately
  // instead of only reacting to a status push that may have already fired
  // before this component subscribed. `platformSupported` drives the
  // non-win32 disabled-with-explanation presentation (复核 NEW-7).
  const [obsInstall, setObsInstall] = useState<{
    installed: boolean;
    platformSupported: boolean;
  } | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installProgress, setInstallProgress] =
    useState<ObsInstallProgress | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const api = bridge().recorder;
      if (!api?.getObsInstallState) return;
      void api.getObsInstallState().then(setObsInstall);
      return api.onInstallProgress?.(setInstallProgress);
    } catch {
      /* degraded / fixture bridge -- managed section falls back to "unknown
       * install state", which the render logic below treats as "assume this
       * machine supports managed" (platformSupported defaults true) so the
       * mode selector still shows the mode the user actually saved. */
    }
  }, []);

  async function runInstall(): Promise<void> {
    setInstalling(true);
    setInstallError(null);
    setInstallProgress(null);
    try {
      const r = await bridge().recorder.installObs();
      if (!r.ok) {
        setInstallError(r.error ?? t("recorder.install.failed"));
        return;
      }
      const state = await bridge().recorder.getObsInstallState();
      setObsInstall(state);
    } catch (e) {
      setInstallError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(false);
    }
  }

  function recStatusText(s: {
    enabled: boolean;
    connected: boolean;
    recording: boolean;
  }): string {
    if (!s.enabled) return t("recorder.status.disabled");
    if (s.recording) return t("recorder.status.recording");
    if (!s.connected) return t("recorder.status.notConnected");
    return t("recorder.status.ready");
  }

  function installPhaseLabel(phase: ObsInstallProgress["phase"]): string {
    switch (phase) {
      case "downloading":
        return t("recorder.install.phase.downloading");
      case "verifying":
        return t("recorder.install.phase.verifying");
      case "extracting":
        return t("recorder.install.phase.extracting");
      case "done":
        return t("recorder.install.phase.done");
    }
  }

  // When the command path is left empty, auto-detect the local CLI and show the
  // result in place — so the user doesn't discover it isn't installed only when
  // an analysis runs. Stubs frequently lack the ai surface (component tests /
  // old fixtures), hence the optional chaining plus catch.
  const backend = settings?.aiBackend;
  const cmdSaved = settings?.aiBackendCommand;
  const [detected, setDetected] = useState<{
    backend: AiBackend;
    path: string | null;
  } | null>(null);
  useEffect(() => {
    setDetected(null);
    if (!backend || !BACKEND_CLI_TOOL[backend] || cmdSaved) return;
    let stale = false;
    try {
      void bridge()
        .ai?.detectCli?.(backend)
        ?.then((r) => {
          if (!stale) setDetected({ backend, path: r?.path ?? null });
        })
        ?.catch(() => undefined);
    } catch {
      // The stub has no ai surface: don't render the detection status row
    }
    return () => {
      stale = true;
    };
  }, [backend, cmdSaved]);

  useEffect(() => {
    // Old stubs have no app surface at all; the settings page must still open.
    try {
      void bridge()
        .app.getVersion()
        .then(setVersion)
        .catch(() => undefined);
    } catch {
      // No app surface: the version row keeps its "…" placeholder
    }
  }, []);

  // update/updateBridge.ts owns every defensive read of bridge().update — this
  // component never touches that surface directly (see Task 7's note).
  useEffect(() => {
    void fetchUpdateState().then((s) => {
      if (s) setUpdate(s);
    });
    return subscribeUpdateState(setUpdate);
  }, []);

  if (!settings) return <div className="settings">{t("settings.loading")}</div>;

  const save = async (
    partial: Partial<GladlogSettings>,
    note: string,
    group: SettingsGroup = "ai",
  ) => {
    const next = await bridge().settings.save(partial);
    setSettings(next);
    setSaved({ group, note });
    setTimeout(() => setSaved(null), 2000);
  };

  const pickLang = async (l: Language) => {
    // Through the provider: every consumer switches at once, and setLang
    // persists the choice itself.
    const persisted = await setLang(l);
    if (persisted) setSettings((s) => (s ? { ...s, language: l } : s));
    setSaved({
      group: "general",
      note: translate(
        l,
        persisted ? "settings.language.saved" : "settings.language.saveFailed",
      ),
      failed: !persisted,
    });
    setTimeout(() => setSaved(null), 2000);
  };

  const keySet =
    settings.anthropicApiKey === API_KEY_REDACTED ||
    (!!settings.anthropicApiKey && settings.anthropicApiKey.length > 0);
  const dsKeySet =
    settings.deepseekApiKey === DEEPSEEK_KEY_REDACTED ||
    (!!settings.deepseekApiKey && settings.deepseekApiKey.length > 0);

  // Task 6, 复核 NEW-7: on a non-win32 machine the managed radio is disabled
  // and the EFFECTIVE/displayed selection falls to external, even though the
  // stored default (`settings.recordingMode`) stays "managed" -- so the same
  // settings.json picks up managed automatically the day it runs on Windows.
  // Before the async install-state query resolves (or on a degraded/fixture
  // bridge with no recorder surface), platformSupported defaults to true so
  // the mode selector shows the user's actual saved choice rather than
  // flashing "forced external" during the brief loading window.
  const platformSupported = obsInstall?.platformSupported ?? true;
  const recMode: "managed" | "external" =
    platformSupported && settings.recordingMode === "managed"
      ? "managed"
      : "external";

  const groupHead = (label: string, group: SettingsGroup) => (
    <span className="settings-group-head">
      <span className="rpt-card-label">{label}</span>
      {saved?.group === group &&
        (saved.failed ? (
          <span className="settings-saved-inline settings-saved-failed">
            ✗ {saved.note}
          </span>
        ) : (
          <span className="settings-saved-inline">✓ {saved.note}</span>
        ))}
    </span>
  );

  const updateAvailable = hasUpdateSurface();
  const updateNote = !updateAvailable
    ? t("settings.update.unavailable")
    : update == null
      ? "…"
      : describeUpdate(update, checkedOnce, Date.now(), t);
  // Computed from the single source of truth (shared/updateSchedule.ts) rather
  // than hand-written numbers: renderer may only *value*-import a leaf module,
  // because main/updater.ts is a main-process module and renderer code must
  // stay on its side of that layer boundary — and main/updater.ts builds its
  // setTimeout/setInterval pair from these same two constants — so this
  // sentence can never drift from what the timer actually does.
  const scheduleNote = t("settings.update.schedule", {
    delayS: FIRST_CHECK_DELAY_MS / 1000,
    hours: CHECK_INTERVAL_MS / 3_600_000,
  });

  return (
    <div className="settings" data-testid="settings-panel">
      <h2>{t("settings.title")}</h2>

      {/* Language sits on top as a general setting (spec §6.11b); its label
          and options read in both languages so a user who landed in the
          wrong one can still find it. */}
      <section className="dash-card" data-testid="settings-language">
        {groupHead(t("settings.group.general"), "general")}
        <div className="settings-grid">
          <span className="settings-k">
            {bilingual("settings.language.label")}
          </span>
          <span className="settings-v" title={t("settings.language.hint")}>
            {t("settings.language.hint")}
          </span>
          <span className="settings-actions">
            <LanguageSegment value={lang} onPick={(l) => void pickLang(l)} />
          </span>
        </div>
      </section>

      <section className="dash-card">
        {groupHead(t("settings.group.game"), "game")}
        <div className="settings-grid">
          <span className="settings-k">{t("settings.wowDir.label")}</span>
          <span className="settings-v" title={settings.wowDirectory ?? ""}>
            {settings.wowDirectory ?? t("settings.wowDir.unset")}
          </span>
          <button
            onClick={() =>
              void bridge()
                .app.selectDirectory()
                .then((dir) => {
                  if (dir)
                    setSettings((s) => (s ? { ...s, wowDirectory: dir } : s));
                })
            }
          >
            {t("settings.chooseFolder")}
          </button>

          <span className="settings-k">{t("settings.history.label")}</span>
          <span className="settings-v">{t("settings.history.note")}</span>
          <ImportButton />
        </div>
      </section>

      <section className="dash-card">
        {groupHead(t("settings.group.ui"), "ui")}
        <div className="settings-grid">
          <span className="settings-k">{t("settings.uiZoom.label")}</span>
          {/* Deliberately short: .settings-v is nowrap + ellipsis, and at the
              1280 tier this column is only ~265px, so a longer sentence is
              simply cut off. title restores the rest on hover — same reason
              the 更新 row below carries one. The "why zoom and not a rem
              migration" reasoning belongs in shared/uiZoom.ts, not in copy. */}
          <span className="settings-v" title={t("settings.uiZoom.hint")}>
            {t("settings.uiZoom.note")}
          </span>
          <span className="settings-actions">
            <div className="rpt-mode-seg settings-seg">
              {UI_ZOOM_LEVELS.map((z) => (
                <button
                  key={z}
                  // Compared through the shared clamp, not against the raw
                  // field: an older settings.json has no uiZoom at all and a
                  // hand-edited one can be out of range — both must light up
                  // 100% rather than leave every segment looking unselected.
                  className={clampUiZoom(settings.uiZoom) === z ? "active" : ""}
                  onClick={() => {
                    // Applied before the IPC round trip so the segment the user
                    // just clicked previews itself instead of waiting on a disk
                    // write. Every value here comes from UI_ZOOM_LEVELS, so
                    // sanitizeSettingsPatch can never drop it and leave the
                    // window zoomed to something that was not persisted.
                    applyUiZoom(z);
                    void save({ uiZoom: z }, t("settings.uiZoom.saved"), "ui");
                  }}
                >
                  {Math.round(z * 100)}%
                </button>
              ))}
            </div>
          </span>
        </div>
      </section>

      <section className="dash-card">
        {groupHead(t("settings.group.ai"), "ai")}
        <div className="settings-grid">
          {settings.aiBackend === "anthropic" && (
            <>
              <span className="settings-k">Anthropic API key</span>
              <span className="settings-key-cell">
                {keySet ? (
                  <span className="settings-pill-ok">{t("settings.key.set")}</span>
                ) : (
                  <span className="settings-v">
                    {t("settings.anthropicKey.unset")}
                  </span>
                )}
                <input
                  type="password"
                  placeholder={keySet ? t("settings.key.replacePlaceholder") : "sk-ant-…"}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                />
              </span>
              <span className="settings-actions">
                <button
                  disabled={!keyInput.trim()}
                  onClick={() => {
                    void save(
                      { anthropicApiKey: keyInput.trim() },
                      t("settings.anthropicKey.saved"),
                    );
                    setKeyInput("");
                  }}
                >
                  {t("common.save")}
                </button>
                {keySet && (
                  <button
                    className="settings-danger"
                    onClick={() =>
                      void save({ anthropicApiKey: null }, t("settings.key.cleared"))
                    }
                  >
                    {t("settings.key.clear")}
                  </button>
                )}
              </span>
            </>
          )}

          {settings.aiBackend === "deepseek" && (
            <>
              <span className="settings-k">DeepSeek API key</span>
              <span className="settings-key-cell">
                {dsKeySet ? (
                  <span className="settings-pill-ok">{t("settings.key.set")}</span>
                ) : (
                  <span className="settings-v">
                    {t("settings.deepseekKey.unset")}
                  </span>
                )}
                <input
                  type="password"
                  placeholder={dsKeySet ? t("settings.key.replacePlaceholder") : "sk-…"}
                  value={dsKeyInput}
                  onChange={(e) => setDsKeyInput(e.target.value)}
                />
              </span>
              <span className="settings-actions">
                <button
                  aria-label={t("settings.deepseekKey.saveAria")}
                  disabled={!dsKeyInput.trim()}
                  onClick={() => {
                    void save(
                      { deepseekApiKey: dsKeyInput.trim() },
                      t("settings.deepseekKey.saved"),
                    );
                    setDsKeyInput("");
                  }}
                >
                  {t("common.save")}
                </button>
                {dsKeySet && (
                  <button
                    className="settings-danger"
                    onClick={() =>
                      void save({ deepseekApiKey: null }, t("settings.key.cleared"))
                    }
                  >
                    {t("settings.key.clear")}
                  </button>
                )}
              </span>
            </>
          )}

          <span className="settings-k">{t("settings.backend.label")}</span>
          <span>
            <select
              aria-label={t("settings.backend.aria")}
              value={settings.aiBackend}
              onChange={(e) =>
                void save(
                  { aiBackend: e.target.value as AiBackend },
                  t("settings.backend.saved"),
                )
              }
            >
              <option value="anthropic">Anthropic API</option>
              <option value="claudeCli">
                {t("settings.backend.claudeCli")}
              </option>
              <option value="agy">{t("settings.backend.agy")}</option>
              <option value="codex">{t("settings.backend.codex")}</option>
              <option value="codebuddy">
                {t("settings.backend.codebuddy")}
              </option>
              <option value="deepseek">DeepSeek API</option>
            </select>
            <span className="settings-note">{t("settings.backend.note")}</span>
          </span>
          <span />

          <span className="settings-k">{t("settings.model.label")}</span>
          <select
            aria-label={t("settings.model.label")}
            value={resolveAiModel(settings)}
            onChange={(e) =>
              void save(
                {
                  // Written into a per-backend slot: switching back to the
                  // previous backend still finds its own selection
                  aiModels: {
                    ...settings.aiModels,
                    [settings.aiBackend]: e.target.value,
                  },
                },
                t("settings.model.saved"),
              )
            }
          >
            {AI_MODELS[settings.aiBackend ?? "anthropic"].map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <span />

          {BACKEND_CLI_TOOL[settings.aiBackend] != null && (
            <>
              <span className="settings-k">{t("settings.command.label")}</span>
              <span>
                <input
                  placeholder={
                    settings.aiBackend === "agy"
                      ? t("settings.command.placeholderAgy")
                      : t("settings.command.placeholder", {
                          tool: BACKEND_CLI_TOOL[settings.aiBackend] ?? "",
                        })
                  }
                  value={cmdInput}
                  onChange={(e) => setCmdInput(e.target.value)}
                  onBlur={() =>
                    void save(
                      { aiBackendCommand: cmdInput.trim() || null },
                      t("settings.command.saved"),
                    )
                  }
                />
                {!cmdInput.trim() &&
                  detected?.backend === settings.aiBackend && (
                    <span className="settings-note">
                      {detected.path
                        ? t("settings.command.detected", {
                            path: detected.path,
                          })
                        : t("settings.command.notDetected", {
                            tool: BACKEND_CLI_TOOL[settings.aiBackend] ?? "",
                          })}
                    </span>
                  )}
              </span>
              <span />
            </>
          )}

          <span className="settings-k">{t("settings.autoAnalyze.label")}</span>
          <span className="settings-v">{t("settings.autoAnalyze.note")}</span>
          <span className="settings-actions">
            <button
              aria-label={t("settings.autoAnalyze.label")}
              onClick={() =>
                void save(
                  { autoAnalyzeNew: !settings.autoAnalyzeNew },
                  settings.autoAnalyzeNew
                    ? t("settings.autoAnalyze.offSaved")
                    : t("settings.autoAnalyze.onSaved"),
                )
              }
            >
              {settings.autoAnalyzeNew
                ? t("settings.toggle.disable")
                : t("settings.toggle.enable")}
            </button>
          </span>

          <span className="settings-k">{t("settings.selfReview.label")}</span>
          <span className="settings-v">{t("settings.selfReview.note")}</span>
          <span className="settings-actions">
            <button
              aria-label={t("settings.selfReview.label")}
              onClick={() =>
                void save(
                  { aiSelfReview: !settings.aiSelfReview },
                  settings.aiSelfReview
                    ? t("settings.selfReview.offSaved")
                    : t("settings.selfReview.onSaved"),
                )
              }
            >
              {settings.aiSelfReview
                ? t("settings.toggle.turnOff")
                : t("settings.toggle.turnOn")}
            </button>
          </span>
        </div>
      </section>

      <section className="dash-card">
        {groupHead(t("settings.group.recording"), "recording")}
        <div className="settings-grid">
          {recStatus && (
            <div className="set-rec-status">
              <span
                className={`set-rec-dot set-rec-dot--${
                  recStatus.recording
                    ? "rec"
                    : recStatus.connected
                      ? "ok"
                      : "off"
                }`}
              />
              {recStatusText(recStatus)}
              {recStatus.lastError && (
                <span className="set-rec-error">{recStatus.lastError}</span>
              )}
            </div>
          )}

          <span className="settings-k">{t("recorder.mode.label")}</span>
          <div
            className="rpt-mode-seg settings-seg"
            role="radiogroup"
            aria-label={t("recorder.mode.label")}
          >
            <button
              type="button"
              role="radio"
              aria-checked={recMode === "managed"}
              className={recMode === "managed" ? "active" : ""}
              disabled={!platformSupported}
              title={
                platformSupported
                  ? undefined
                  : t("recorder.mode.managedWindowsOnly")
              }
              onClick={() =>
                platformSupported &&
                void save(
                  { recordingMode: "managed" },
                  t("recorder.mode.managedSaved"),
                  "recording",
                )
              }
            >
              {t("recorder.mode.managed")}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={recMode === "external"}
              className={recMode === "external" ? "active" : ""}
              onClick={() =>
                void save(
                  { recordingMode: "external" },
                  t("recorder.mode.externalSaved"),
                  "recording",
                )
              }
            >
              {t("recorder.mode.external")}
            </button>
          </div>
          <span />
          {!platformSupported && (
            <>
              <span />
              <span className="settings-note">
                {t("recorder.mode.managedWindowsOnly")}
              </span>
              <span />
            </>
          )}

          <span className="settings-k">{t("recorder.autoRecord.label")}</span>
          <span className="settings-v">
            {recMode === "managed"
              ? t("recorder.autoRecord.managedNote")
              : t("recorder.autoRecord.externalNote")}
          </span>
          <span className="settings-actions">
            <button
              onClick={() =>
                void save(
                  { recordingEnabled: !settings.recordingEnabled },
                  settings.recordingEnabled
                    ? t("recorder.autoRecord.offSaved")
                    : t("recorder.autoRecord.onSaved"),
                  "recording",
                )
              }
            >
              {settings.recordingEnabled
                ? t("settings.toggle.disable")
                : t("settings.toggle.enable")}
            </button>
            {recMode === "external" && (
              <button
                title={t("recorder.autoConfig.hint")}
                onClick={() =>
                  void bridge()
                    .recorder.autoConfig()
                    .then(async (r) => {
                      if (!r.found) {
                        setObsTest(t("recorder.autoConfig.notFound"));
                        return;
                      }
                      // Address/password are already persisted on the main side —
                      // read back to refresh the masked pill and the address box
                      const next = await bridge().settings.get();
                      setSettings(next);
                      setObsUrlInput(next.obsWebsocketUrl ?? "");
                      setObsTest(
                        !r.enabled
                          ? t("recorder.autoConfig.wsDisabled")
                          : r.ok
                            ? t("recorder.autoConfig.ok")
                            : `✗ ${r.error ?? t("recorder.connectFailed")}`,
                      );
                    })
                }
              >
                {t("recorder.autoConfig.button")}
              </button>
            )}
          </span>

          {recMode === "external" && (
            <>
              <span className="settings-k">{t("recorder.ws.urlLabel")}</span>
              <input
                aria-label={t("recorder.ws.urlAria")}
                placeholder={DEFAULT_OBS_WS_URL}
                value={obsUrlInput}
                onChange={(e) => setObsUrlInput(e.target.value)}
                onBlur={() =>
                  void save(
                    { obsWebsocketUrl: obsUrlInput.trim() || null },
                    t("recorder.ws.urlSaved"),
                    "recording",
                  )
                }
              />
              <span />

              <span className="settings-k">{t("recorder.ws.passwordLabel")}</span>
              <span className="settings-key-cell">
                {settings.obsWebsocketPassword === OBS_PASSWORD_REDACTED ? (
                  <span className="settings-pill-ok">{t("settings.key.set")}</span>
                ) : (
                  <span className="settings-v">
                    {t("recorder.ws.passwordUnset")}
                  </span>
                )}
                <input
                  type="password"
                  placeholder={t("settings.key.replacePlaceholder")}
                  value={obsPwInput}
                  onChange={(e) => setObsPwInput(e.target.value)}
                />
              </span>
              <span className="settings-actions">
                <button
                  aria-label={t("recorder.ws.passwordSaveAria")}
                  disabled={!obsPwInput.trim()}
                  onClick={() => {
                    void save(
                      { obsWebsocketPassword: obsPwInput.trim() },
                      t("recorder.ws.passwordSaved"),
                      "recording",
                    );
                    setObsPwInput("");
                  }}
                >
                  {t("common.save")}
                </button>
                <button
                  onClick={() =>
                    // Pass the current input (possibly unsaved): a real-machine trap
                    // — typing the password and hitting Test without saving used to
                    // connect with an empty password and report "missing
                    // authentication string"
                    void bridge()
                      .recorder.testConnection({
                        url: obsUrlInput.trim() || null,
                        ...(obsPwInput.trim()
                          ? { password: obsPwInput.trim() }
                          : {}),
                      })
                      .then((r) =>
                        setObsTest(
                          r.ok
                            ? t("recorder.test.ok")
                            : `✗ ${r.error ?? t("recorder.connectFailed")}`,
                        ),
                      )
                  }
                >
                  {t("recorder.test.button")}
                </button>
              </span>

              {obsTest && (
                <>
                  <span className="settings-k" />
                  <span className="settings-v">{obsTest}</span>
                  <span />
                </>
              )}
            </>
          )}

          {recMode === "managed" && (
            <>
              <span className="settings-k">{t("recorder.managed.label")}</span>
              {obsInstall?.installed ? (
                <>
                  <span className="settings-v">
                    {t("recorder.managed.installed")}
                  </span>
                  <span />
                  <ManagedObsPrefsRows
                    settings={settings}
                    save={(partial, note) => save(partial, note, "recording")}
                    reload={async () => {
                      const next = await bridge().settings.get();
                      setSettings(next);
                    }}
                  />
                </>
              ) : (
                <>
                  <span className="settings-v">
                    {t("recorder.managed.downloadBefore", {
                      mb: OBS_DOWNLOAD_MB,
                    })}{" "}
                    <button
                      type="button"
                      className="settings-link"
                      onClick={() =>
                        void bridge().app.openExternal(OBS_ZIP_URL)
                      }
                    >
                      {t("recorder.managed.downloadLink")}
                    </button>
                    {t("recorder.managed.downloadAfter")}
                  </span>
                  <span className="settings-actions">
                    <button
                      type="button"
                      disabled={installing}
                      onClick={() => void runInstall()}
                    >
                      {installing
                        ? t("recorder.install.downloadingButton")
                        : installError
                          ? t("recorder.install.retry")
                          : t("recorder.install.downloadAndEnable")}
                    </button>
                  </span>
                </>
              )}

              {installing && installProgress && (
                <>
                  <span />
                  <span className="settings-v">
                    <progress
                      className="settings-install-progress"
                      value={installProgress.loaded ?? 0}
                      max={installProgress.total ?? OBS_ZIP_BYTES}
                    />{" "}
                    {installPhaseLabel(installProgress.phase)}
                    {installProgress.loaded != null && installProgress.total
                      ? ` ${Math.round(
                          (installProgress.loaded / installProgress.total) *
                            100,
                        )}%`
                      : ""}
                  </span>
                  <span />
                </>
              )}

              {installError && (
                <>
                  <span />
                  <span className="set-rec-error">{installError}</span>
                  <span />
                </>
              )}
            </>
          )}

          <span className="settings-k">{t("recorder.keep.label")}</span>
          <span>
            <input
              type="number"
              aria-label={t("recorder.keep.aria")}
              min={0}
              style={{ width: "5em" }}
              value={keepInput}
              onChange={(e) => setKeepInput(e.target.value)}
              onBlur={() => {
                // onBlur rather than onChange: saving per keystroke would mean
                // one IPC round trip and disk write per key (agy flash review #6)
                const n = Math.max(0, Number(keepInput) || 0);
                setKeepInput(String(n));
                void save(
                  { recordingKeepCount: n },
                  t("recorder.keep.saved"),
                  "recording",
                );
              }}
            />
            <span className="settings-note">{t("recorder.keep.note")}</span>
          </span>
          <span />
        </div>
      </section>

      <section className="dash-card">
        {groupHead(t("settings.group.about"), "about")}
        <div className="settings-grid">
          <span className="settings-k">{t("settings.version.label")}</span>
          <span className="settings-v">{version ?? "…"}</span>
          <span />

          <span className="settings-k">{t("settings.update.label")}</span>
          {/* title: CSS(.settings-v) truncates this with an ellipsis, and
              for an error phase updateNote is the only place the user can
              see the failure reason — hover restores the full text. */}
          <span className="settings-v" title={updateNote}>
            {updateNote}
          </span>
          <span className="settings-actions">
            {updateAvailable && update?.phase !== "disabled" && (
              <button
                // Deliberately NOT gated on autoCheckUpdates: a user who turns
                // the periodic check off still needs a way in, otherwise that
                // switch kills the whole feature (spec §4.2).
                disabled={update?.phase === "checking"}
                onClick={() => {
                  setCheckedOnce(true);
                  void requestUpdateCheck();
                }}
              >
                {update?.phase === "checking"
                  ? t("settings.update.checking")
                  : t("settings.update.check")}
              </button>
            )}
          </span>

          <span className="settings-k">{t("settings.autoCheck.label")}</span>
          <span className="settings-v">{scheduleNote}</span>
          <span className="settings-actions">
            <button
              aria-label={t("settings.autoCheck.label")}
              onClick={() =>
                void save(
                  { autoCheckUpdates: !settings.autoCheckUpdates },
                  settings.autoCheckUpdates
                    ? t("settings.autoCheck.offSaved")
                    : t("settings.autoCheck.onSaved"),
                  "about",
                )
              }
            >
              {settings.autoCheckUpdates
                ? t("settings.toggle.disable")
                : t("settings.toggle.enable")}
            </button>
          </span>
        </div>
      </section>
    </div>
  );
}
