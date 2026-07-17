import { useEffect, useState } from "react";

import type {
  AiBackend,
  AiLanguage,
  GladlogSettings,
} from "../../../main/settingsStore";
import { API_KEY_REDACTED } from "../../../shared/protocol";
import { bridge } from "../bridge";
import { ImportButton } from "./ImportButton";

/**
 * 设置页(phase3 #2a):用户项的正式家 —— WoW 目录、API key(哨兵掩码)、
 * 模型、AI 后端、回复语言。DevPanel 保留调试项(索引重建/监控明细)。
 */
export function SettingsPanel() {
  const [settings, setSettings] = useState<GladlogSettings | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [modelInput, setModelInput] = useState("");
  const [saved, setSaved] = useState<string>("");

  useEffect(() => {
    void bridge()
      .settings.get()
      .then((s) => {
        setSettings(s);
        setModelInput(s.anthropicModel ?? "");
      });
  }, []);

  if (!settings) return <div className="settings">加载中…</div>;

  const save = async (partial: Partial<GladlogSettings>, note: string) => {
    const next = await bridge().settings.save(partial);
    setSettings(next);
    setSaved(note);
    setTimeout(() => setSaved(""), 2000);
  };

  const keySet =
    settings.anthropicApiKey === API_KEY_REDACTED ||
    (!!settings.anthropicApiKey && settings.anthropicApiKey.length > 0);

  return (
    <div className="settings" data-testid="settings-panel">
      <h2>设置</h2>
      {saved && <div className="settings-saved">✓ {saved}</div>}

      <section className="dash-card">
        <span className="rpt-card-label">游戏</span>
        <div className="settings-row">
          <span className="settings-k">WoW 目录</span>
          <span className="settings-v">
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
        </div>
        <div className="settings-row">
          <span className="settings-k">历史日志</span>
          <ImportButton />
        </div>
      </section>

      <section className="dash-card">
        <span className="rpt-card-label">AI 分析</span>
        <div className="settings-row">
          <span className="settings-k">Anthropic API key</span>
          <span className="settings-v">
            {keySet ? "已设置" : "未设置(没有 key 时分析走确定性回退)"}
          </span>
          <input
            type="password"
            placeholder={keySet ? "输入以更换" : "sk-ant-…"}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
          />
          <button
            disabled={!keyInput.trim()}
            onClick={() => {
              void save({ anthropicApiKey: keyInput.trim() }, "API key 已保存");
              setKeyInput("");
            }}
          >
            保存
          </button>
          {keySet && (
            <button
              onClick={() => void save({ anthropicApiKey: null }, "已清除 key")}
            >
              清除
            </button>
          )}
        </div>
        <div className="settings-row">
          <span className="settings-k">模型</span>
          <input
            placeholder="claude-sonnet-5(默认)"
            value={modelInput}
            onChange={(e) => setModelInput(e.target.value)}
            onBlur={() =>
              void save(
                { anthropicModel: modelInput.trim() || null },
                "模型已保存",
              )
            }
          />
        </div>
        <div className="settings-row">
          <span className="settings-k">后端</span>
          <select
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
          </select>
        </div>
        <div className="settings-row">
          <span className="settings-k">教练回复语言</span>
          <div className="rpt-mode-seg">
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
        </div>
      </section>
    </div>
  );
}
