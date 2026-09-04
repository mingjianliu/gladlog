import { useEffect, useState } from "react";

import type { AiLanguage, GladlogSettings } from "../../../main/settingsStore";
import type { UpdateState } from "../../../main/updater";
import {
  AI_MODELS,
  type AiBackend,
  BACKEND_CLI_TOOL,
  resolveAiModel,
} from "../../../shared/aiModels";
import {
  API_KEY_REDACTED,
  DEEPSEEK_KEY_REDACTED,
  DEFAULT_OBS_WS_URL,
  OBS_PASSWORD_REDACTED,
} from "../../../shared/protocol";
import { clampUiZoom, UI_ZOOM_LEVELS } from "../../../shared/uiZoom";
import { OBS_ZIP_BYTES, OBS_ZIP_URL } from "../../../shared/obsAsset";
import type { ObsInstallProgress } from "../../../main/obsAssets";
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
} from "../../../shared/updateSchedule";
import { bridge } from "../bridge";
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

type SettingsGroup = "game" | "ui" | "ai" | "recording" | "about";

/** Relative wall-clock text. Deliberately NOT toLocaleString(): the visual
 *  baseline pins Date.now() (qa/visual/scenes.spec.ts:62 page.clock
 *  .setFixedTime) but pins neither the timezone nor the locale, so an absolute
 *  timestamp would drift between environments while a relative one only
 *  depends on the pinned clock. */
function relTime(at: number, now: number): string {
  const d = Math.max(0, now - at);
  if (d < 60_000) return "刚刚";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} 小时前`;
  return `${Math.floor(d / 86_400_000)} 天前`;
}

/** One line of copy per update state. An exhaustive switch: a new phase in
 *  main/updater.ts fails typecheck here instead of silently rendering "". */
function describeUpdate(
  s: UpdateState,
  checkedOnce: boolean,
  now: number,
): string {
  switch (s.phase) {
    case "disabled":
      return s.reason === "platform"
        ? "仅 Windows 安装版支持自动更新"
        : s.reason === "portable"
          ? "绿色版(zip)不自动更新,请改用安装版"
          : "开发模式不检查更新";
    case "checking":
      return "正在检查…";
    case "downloading":
      return `正在下载 ${s.version} · ${Math.round(s.percent)}%`;
    case "ready":
      return `新版 ${s.version} 已就绪,退出时安装`;
    case "error":
      // No "检查失败:" prefix: this message also covers the install watchdog
      // (src/main/updater.ts's "更新安装器未能接管…"), which is not a check
      // failure and would read as self-contradictory with that prefix on.
      return s.message;
    case "idle":
      return s.lastCheckedAt == null
        ? "从未检查"
        : `${checkedOnce ? "已是最新 · " : ""}上次检查:${relTime(s.lastCheckedAt, now)}`;
  }
}

/**
 * Settings page (1i redesign): a three-column grid inside each group card
 * (label | value/input | action), save feedback shown in place on the group
 * heading row (disappearing after 2s), and an "already set" pill in front of
 * the API key.
 */
export function SettingsPanel() {
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
        setInstallError(r.error ?? "安装失败");
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
    if (!s.enabled) return "未启用";
    if (s.recording) return "正在录制";
    if (!s.connected) return "未连接";
    return "已就绪";
  }

  function installPhaseLabel(phase: ObsInstallProgress["phase"]): string {
    switch (phase) {
      case "downloading":
        return "下载中";
      case "verifying":
        return "校验中";
      case "extracting":
        return "解压中";
      case "done":
        return "完成";
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

  if (!settings) return <div className="settings">加载中…</div>;

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
      {saved?.group === group && (
        <span className="settings-saved-inline">✓ {saved.note}</span>
      )}
    </span>
  );

  const updateAvailable = hasUpdateSurface();
  const updateNote = !updateAvailable
    ? "此环境不提供自动更新"
    : update == null
      ? "…"
      : describeUpdate(update, checkedOnce, Date.now());
  // Computed from the single source of truth (shared/updateSchedule.ts) rather
  // than hand-written numbers: renderer may only *value*-import a leaf module,
  // because main/updater.ts is a main-process module and renderer code must
  // stay on its side of that layer boundary — and main/updater.ts builds its
  // setTimeout/setInterval pair from these same two constants — so this
  // sentence can never drift from what the timer actually does.
  const scheduleNote = `启动 ${FIRST_CHECK_DELAY_MS / 1000} 秒后检查一次,之后每 ${CHECK_INTERVAL_MS / 3_600_000} 小时一次;下载在后台进行,退出时安装。`;

  return (
    <div className="settings" data-testid="settings-panel">
      <h2>设置</h2>

      <section className="dash-card">
        {groupHead("游戏", "game")}
        <div className="settings-grid">
          <span className="settings-k">WoW 目录</span>
          <span className="settings-v" title={settings.wowDirectory ?? ""}>
            {settings.wowDirectory ?? "未设置 —— 选择后自动开始监控战斗日志"}
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
            选择目录…
          </button>

          <span className="settings-k">历史日志</span>
          <span className="settings-v">重复导入按场次自动去重</span>
          <ImportButton />
        </div>
      </section>

      <section className="dash-card">
        {groupHead("界面", "ui")}
        <div className="settings-grid">
          <span className="settings-k">界面缩放</span>
          {/* Deliberately short: .settings-v is nowrap + ellipsis, and at the
              1280 tier this column is only ~265px, so a longer sentence is
              simply cut off. title restores the rest on hover — same reason
              the 更新 row below carries one. The "why zoom and not a rem
              migration" reasoning belongs in shared/uiZoom.ts, not in copy. */}
          <span
            className="settings-v"
            title="文字与布局同比放大,点击即生效,无需重启。"
          >
            文字与布局同比放大,4K/高分屏按需调大
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
                    void save({ uiZoom: z }, "界面缩放已保存", "ui");
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
        {groupHead("AI 分析", "ai")}
        <div className="settings-grid">
          {settings.aiBackend === "anthropic" && (
            <>
              <span className="settings-k">Anthropic API key</span>
              <span className="settings-key-cell">
                {keySet ? (
                  <span className="settings-pill-ok">已设置</span>
                ) : (
                  <span className="settings-v">
                    未设置(没有 key 时分析走确定性回退)
                  </span>
                )}
                <input
                  type="password"
                  placeholder={keySet ? "输入以更换" : "sk-ant-…"}
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
                      "API key 已保存",
                    );
                    setKeyInput("");
                  }}
                >
                  保存
                </button>
                {keySet && (
                  <button
                    className="settings-danger"
                    onClick={() =>
                      void save({ anthropicApiKey: null }, "已清除 key")
                    }
                  >
                    清除
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
                  <span className="settings-pill-ok">已设置</span>
                ) : (
                  <span className="settings-v">
                    未设置(没有 key 时分析走确定性回退;数据会发送到
                    api.deepseek.com)
                  </span>
                )}
                <input
                  type="password"
                  placeholder={dsKeySet ? "输入以更换" : "sk-…"}
                  value={dsKeyInput}
                  onChange={(e) => setDsKeyInput(e.target.value)}
                />
              </span>
              <span className="settings-actions">
                <button
                  aria-label="保存 DeepSeek key"
                  disabled={!dsKeyInput.trim()}
                  onClick={() => {
                    void save(
                      { deepseekApiKey: dsKeyInput.trim() },
                      "DeepSeek key 已保存",
                    );
                    setDsKeyInput("");
                  }}
                >
                  保存
                </button>
                {dsKeySet && (
                  <button
                    className="settings-danger"
                    onClick={() =>
                      void save({ deepseekApiKey: null }, "已清除 key")
                    }
                  >
                    清除
                  </button>
                )}
              </span>
            </>
          )}

          <span className="settings-k">后端</span>
          <span>
            <select
              aria-label="AI 后端"
              value={settings.aiBackend}
              onChange={(e) =>
                void save(
                  { aiBackend: e.target.value as AiBackend },
                  "后端已切换",
                )
              }
            >
              <option value="anthropic">Anthropic API</option>
              <option value="claudeCli">Claude CLI(本地)</option>
              <option value="agy">agy / Gemini(本地)</option>
              <option value="codex">Codex(本地)</option>
              <option value="codebuddy">CodeBuddy CLI(本地)</option>
              <option value="deepseek">DeepSeek API</option>
            </select>
            <span className="settings-note">
              本地 CLI(Claude/agy/Codex/CodeBuddy)不走网络;DeepSeek 为官方
              API,需 key 且数据出机
            </span>
          </span>
          <span />

          <span className="settings-k">模型</span>
          <select
            aria-label="模型"
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
                "模型已保存",
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
              <span className="settings-k">命令路径</span>
              <span>
                <input
                  placeholder={
                    settings.aiBackend === "agy"
                      ? "留空自动检测;或填 agy 可执行文件完整路径(.mjs 走旧包装脚本)"
                      : `留空自动检测;或填 ${BACKEND_CLI_TOOL[settings.aiBackend]} 可执行文件完整路径`
                  }
                  value={cmdInput}
                  onChange={(e) => setCmdInput(e.target.value)}
                  onBlur={() =>
                    void save(
                      { aiBackendCommand: cmdInput.trim() || null },
                      "命令路径已保存",
                    )
                  }
                />
                {!cmdInput.trim() &&
                  detected?.backend === settings.aiBackend && (
                    <span className="settings-note">
                      {detected.path
                        ? `已检测到:${detected.path}`
                        : `未检测到 ${BACKEND_CLI_TOOL[settings.aiBackend]},请安装后重开设置页,或填写完整路径`}
                    </span>
                  )}
              </span>
              <span />
            </>
          )}

          <span className="settings-k">教练回复语言</span>
          <div className="rpt-mode-seg settings-seg">
            {(["zh", "en"] as AiLanguage[]).map((l) => (
              <button
                key={l}
                className={settings.aiLanguage === l ? "active" : ""}
                onClick={() => void save({ aiLanguage: l }, "语言已切换")}
              >
                {l === "zh" ? "中文" : "EN"}
              </button>
            ))}
          </div>
          <span />

          <span className="settings-k">自动分析新对局</span>
          <span className="settings-v">
            实时监听到新对局入库后,自动用当前默认模型分析(历史导入不触发)。
          </span>
          <span className="settings-actions">
            <button
              aria-label="自动分析新对局"
              onClick={() =>
                void save(
                  { autoAnalyzeNew: !settings.autoAnalyzeNew },
                  settings.autoAnalyzeNew ? "已停用自动分析" : "已启用自动分析",
                )
              }
            >
              {settings.autoAnalyzeNew ? "停用" : "启用"}
            </button>
          </span>
        </div>
      </section>

      <section className="dash-card">
        {groupHead("对局录像(OBS)", "recording")}
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

          <span className="settings-k">录像模式</span>
          <div
            className="rpt-mode-seg settings-seg"
            role="radiogroup"
            aria-label="录像模式"
          >
            <button
              type="button"
              role="radio"
              aria-checked={recMode === "managed"}
              className={recMode === "managed" ? "active" : ""}
              disabled={!platformSupported}
              title={platformSupported ? undefined : "托管录像仅支持 Windows"}
              onClick={() =>
                platformSupported &&
                void save(
                  { recordingMode: "managed" },
                  "已切换为托管 OBS",
                  "recording",
                )
              }
            >
              自动下载并管理 OBS,无需安装
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={recMode === "external"}
              className={recMode === "external" ? "active" : ""}
              onClick={() =>
                void save(
                  { recordingMode: "external" },
                  "已切换为自有 OBS",
                  "recording",
                )
              }
            >
              使用我自己的 OBS
            </button>
          </div>
          <span />
          {!platformSupported && (
            <>
              <span />
              <span className="settings-note">托管录像仅支持 Windows</span>
              <span />
            </>
          )}

          <span className="settings-k">自动录像</span>
          <span className="settings-v">
            {recMode === "managed"
              ? "托管 OBS 由 gladlog 自动下载、配置并跟随对局开关录制,无需手动设置。"
              : "需 OBS 28+ 并开启 WebSocket 服务器(工具 → WebSocket 服务器设置);录制格式建议 Hybrid MP4。开场自动起录、结束自动停录并关联到对局。"}
          </span>
          <span className="settings-actions">
            <button
              onClick={() =>
                void save(
                  { recordingEnabled: !settings.recordingEnabled },
                  settings.recordingEnabled
                    ? "已停用自动录像"
                    : "已启用自动录像",
                  "recording",
                )
              }
            >
              {settings.recordingEnabled ? "停用" : "启用"}
            </button>
            {recMode === "external" && (
              <button
                title="读取本机 OBS 的 WebSocket 配置,自动填好地址与密码并试连"
                onClick={() =>
                  void bridge()
                    .recorder.autoConfig()
                    .then(async (r) => {
                      if (!r.found) {
                        setObsTest("✗ 未找到本机 OBS 配置(装了 OBS 28+ 吗?)");
                        return;
                      }
                      // Address/password are already persisted on the main side —
                      // read back to refresh the masked pill and the address box
                      const next = await bridge().settings.get();
                      setSettings(next);
                      setObsUrlInput(next.obsWebsocketUrl ?? "");
                      setObsTest(
                        !r.enabled
                          ? "已读到配置并保存;但 OBS 的 WebSocket 服务器未启用 —— 去 OBS:工具 → WebSocket 服务器设置 → 勾选启用,再点测试连接"
                          : r.ok
                            ? "✓ 已自动配置并连接成功"
                            : `✗ ${r.error ?? "连接失败"}`,
                      );
                    })
                }
              >
                自动检测 OBS
              </button>
            )}
          </span>

          {recMode === "external" && (
            <>
              <span className="settings-k">WebSocket 地址</span>
              <input
                aria-label="OBS WebSocket 地址"
                placeholder={DEFAULT_OBS_WS_URL}
                value={obsUrlInput}
                onChange={(e) => setObsUrlInput(e.target.value)}
                onBlur={() =>
                  void save(
                    { obsWebsocketUrl: obsUrlInput.trim() || null },
                    "地址已保存",
                    "recording",
                  )
                }
              />
              <span />

              <span className="settings-k">WebSocket 密码</span>
              <span className="settings-key-cell">
                {settings.obsWebsocketPassword === OBS_PASSWORD_REDACTED ? (
                  <span className="settings-pill-ok">已设置</span>
                ) : (
                  <span className="settings-v">未设置(OBS 未开鉴权则留空)</span>
                )}
                <input
                  type="password"
                  placeholder="输入以更换"
                  value={obsPwInput}
                  onChange={(e) => setObsPwInput(e.target.value)}
                />
              </span>
              <span className="settings-actions">
                <button
                  aria-label="保存 OBS 密码"
                  disabled={!obsPwInput.trim()}
                  onClick={() => {
                    void save(
                      { obsWebsocketPassword: obsPwInput.trim() },
                      "密码已保存",
                      "recording",
                    );
                    setObsPwInput("");
                  }}
                >
                  保存
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
                          r.ok ? "✓ 连接成功" : `✗ ${r.error ?? "连接失败"}`,
                        ),
                      )
                  }
                >
                  测试连接
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
              <span className="settings-k">托管 OBS</span>
              {obsInstall?.installed ? (
                <>
                  <span className="settings-v">
                    已安装并自动管理,录制状态见上方状态行。
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
                    首次启用需下载 OBS Studio(约 {OBS_DOWNLOAD_MB}MB,来自{" "}
                    <button
                      type="button"
                      className="settings-link"
                      onClick={() =>
                        void bridge().app.openExternal(OBS_ZIP_URL)
                      }
                    >
                      obsproject 官方发布页
                    </button>
                    ,GPL-2.0)。
                  </span>
                  <span className="settings-actions">
                    <button
                      type="button"
                      disabled={installing}
                      onClick={() => void runInstall()}
                    >
                      {installing
                        ? "下载中…"
                        : installError
                          ? "重试"
                          : "下载并启用"}
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

          <span className="settings-k">保留录像</span>
          <span>
            <input
              type="number"
              aria-label="保留录像场数"
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
                  "保留策略已保存",
                  "recording",
                );
              }}
            />
            <span className="settings-note">
              最近 N 场。设为 0 只关闭场数上限,总容量上限(默认
              80GB)仍然生效,超限时连视频文件一并删除。
            </span>
          </span>
          <span />
        </div>
      </section>

      <section className="dash-card">
        {groupHead("关于", "about")}
        <div className="settings-grid">
          <span className="settings-k">版本</span>
          <span className="settings-v">{version ?? "…"}</span>
          <span />

          <span className="settings-k">更新</span>
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
                {update?.phase === "checking" ? "检查中…" : "检查更新"}
              </button>
            )}
          </span>

          <span className="settings-k">自动检查更新</span>
          <span className="settings-v">{scheduleNote}</span>
          <span className="settings-actions">
            <button
              aria-label="自动检查更新"
              onClick={() =>
                void save(
                  { autoCheckUpdates: !settings.autoCheckUpdates },
                  settings.autoCheckUpdates
                    ? "已停用自动检查"
                    : "已启用自动检查",
                  "about",
                )
              }
            >
              {settings.autoCheckUpdates ? "停用" : "启用"}
            </button>
          </span>
        </div>
      </section>
    </div>
  );
}
