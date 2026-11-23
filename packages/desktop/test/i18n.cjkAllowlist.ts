// Permanent exceptions to §6.9 check 1 (test/i18n.noCjkLiterals.test.ts): a
// CJK literal that is never shown to the user. Each entry matches the hits in
// `file` whose literal text (a whole template, `${…}` included) contains
// `snippet`, and must say why it is not user-facing. Shrink-only (§6.9 只允许
// 减少): the test fails on an entry that no longer matches anything, and on
// an entry missing from FROZEN_CJK_ALLOWLIST below.
export const CJK_ALLOWLIST: ReadonlyArray<{
  file: string;
  snippet: string;
  reason: string;
}> = [
  {
    file: "packages/desktop/src/main/ai.ts",
    snippet: "Respond entirely in Simplified Chinese (简体中文)",
    reason:
      "model instruction, zh prompt bytes frozen (§7): the coach system prompt's zh language sentence, sent to the model, never rendered",
  },
  {
    file: "packages/desktop/src/main/corpusLoader.ts",
    snippet: "形状粗验失败",
    reason:
      "skip reason for a broken corpus file; only reaches log.warn via onSkipped (main/index.ts), never rendered",
  },
  {
    file: "packages/desktop/src/main/e2eEnv.ts",
    snippet: "GLADLOG_E2E=1 需要",
    reason:
      "developer-only startup assert for the E2E test switch (GLADLOG_E2E env vars); end users never set it",
  },
  {
    file: "packages/desktop/src/main/recordingsStore.ts",
    snippet: "个未入索引文件",
    reason:
      "recordings visibility log line (this.log → main.log); developer log only, never rendered",
  },
  {
    file: "packages/desktop/src/main/recordingsStore.ts",
    snippet: "可能是 OBS 崩溃孤儿或用户手动录像",
    reason:
      "continuation of the same recordings visibility log line; developer log only",
  },
  {
    file: "packages/desktop/src/main/recordingsStore.ts",
    snippet: "个过期录像,释放",
    reason:
      "retention prune log line (this.log → main.log); developer log only, never rendered",
  },
  {
    file: "packages/desktop/src/main/settingsStore.ts",
    snippet: "密钥/密码将以明文存储",
    reason:
      "SettingsStoreWarning.detail; onWarn only writes it to log.warn (main/index.ts onSettingsWarn), never rendered",
  },
  {
    file: "packages/desktop/src/main/settingsStore.ts",
    snippet: "无法解密",
    reason:
      "SettingsStoreWarning.detail; onWarn only writes it to log.warn (main/index.ts onSettingsWarn), never rendered",
  },
  {
    file: "packages/desktop/src/main/updater.ts",
    snippet: "GLADLOG_UPDATER_TEST_FEED 需要",
    reason:
      "developer-only assert for the dummy-release test feed env var; end users never set it",
  },
  {
    file: "packages/desktop/src/main/managedObsBackend.ts",
    snippet: "托管 OBS 会话未配好",
    reason:
      "console.warn in the main process (recorder diagnostics); developer log only, never rendered",
  },
  {
    file: "packages/desktop/src/main/recorder.ts",
    snippet: "推迟到对局结束后分片",
    reason:
      "console.warn in the main process (recorder diagnostics); developer log only, never rendered",
  },
  {
    file: "packages/desktop/src/main/recorder.ts",
    snippet: "仍未结束(疑似卡死/日志流中断)",
    reason:
      "console.warn in the main process (recorder diagnostics); developer log only, never rendered",
  },
  {
    file: "packages/desktop/src/main/recorder.ts",
    snippet: "未产出新分片,跳过",
    reason:
      "console.warn in the main process (recorder diagnostics); developer log only, never rendered",
  },
  {
    file: "packages/desktop/src/main/recorder.ts",
    snippet: "单分片超 40 分钟,已强制分片",
    reason:
      "console.warn in the main process (recorder diagnostics); developer log only, never rendered",
  },
  {
    file: "packages/desktop/src/main/recorder.ts",
    snippet: "开局分片跳过",
    reason:
      "console.warn in the main process (recorder diagnostics); developer log only, never rendered",
  },
  {
    file: "packages/desktop/src/main/recorder.ts",
    snippet: "的开手留在上一个文件里",
    reason:
      "console.warn in the main process (recorder diagnostics); developer log only, never rendered (continuation of the match-open split message)",
  },
  {
    file: "packages/desktop/src/main/recorder.ts",
    snippet: "执行此前因 MAX_CHUNK_MS 推迟的分片",
    reason:
      "console.warn in the main process (recorder diagnostics); developer log only, never rendered",
  },
  {
    file: "packages/desktop/src/main/recorder.ts",
    snippet: "负 headroom",
    reason:
      "console.warn in the main process (recorder diagnostics); developer log only, never rendered",
  },
  {
    file: "packages/desktop/src/main/analysis.ts",
    snippet: "回退到 settings 默认后端",
    reason:
      "console.warn in the main process (deepen falls back from an unknown slot backend); developer log only, never rendered",
  },
  {
    file: "packages/desktop/src/renderer/src/fixtureBridge.ts",
    snippet: "相对同 spec/comp 分档",
    reason:
      "fixture-mode stand-in for a stored compare report (model output, not UI copy); VITE_FIXTURE_MODE only, pinned by visual baselines",
  },
  {
    file: "packages/desktop/src/renderer/src/fixtureBridge.ts",
    snippet: "（fixture）",
    reason:
      "fixture-mode stand-in for logged AI prompt bodies on the dev page (data, not UI copy); VITE_FIXTURE_MODE only",
  },
  {
    file: "packages/desktop/src/renderer/src/fixtureBridge.ts",
    snippet: "目标选择",
    reason:
      "fixture-mode stand-in for a notebook category, which is the model's finding category (model output); VITE_FIXTURE_MODE only, pinned by visual baselines and qa/e2e/coachLoop.spec.ts",
  },
  {
    file: "packages/desktop/src/renderer/src/fixtureBridge.ts",
    snippet: "爆发打进减伤",
    reason:
      "fixture-mode stand-in for a stored finding title (model output); VITE_FIXTURE_MODE only, pinned by visual baselines",
  },
  {
    file: "packages/desktop/src/renderer/src/fixtureBridge.ts",
    snippet: "开大时目标挂着",
    reason:
      "fixture-mode stand-in for a stored finding explanation (model output); VITE_FIXTURE_MODE only, pinned by visual baselines",
  },
  {
    file: "packages/desktop/src/renderer/src/fixtureBridge.ts",
    snippet: "脱火过多",
    reason:
      "fixture-mode stand-in for a stored finding title (model output); VITE_FIXTURE_MODE only, pinned by visual baselines",
  },
  {
    file: "packages/desktop/src/renderer/src/fixtureBridge.ts",
    snippet: "击杀窗口内 40%",
    reason:
      "fixture-mode stand-in for a stored finding explanation (model output); VITE_FIXTURE_MODE only, pinned by visual baselines",
  },
  {
    file: "packages/desktop/src/renderer/src/fixtureBridge.ts",
    snippet: "第二轮我为什么会被秒",
    reason:
      "fixture-mode stand-in for a user's coach-chat message (user content); VITE_FIXTURE_MODE only, pinned by visual baselines",
  },
  {
    file: "packages/desktop/src/renderer/src/fixtureBridge.ts",
    snippet: "那波 Frozen Orb 落地后",
    reason:
      "fixture-mode stand-in for a coach-chat reply (model output); VITE_FIXTURE_MODE only, pinned by visual baselines",
  },
  {
    file: "packages/desktop/src/renderer/src/fixtureBridge.ts",
    snippet: "fixture 桩:不真调模型",
    reason:
      "fixture-mode stand-in for a coach-chat reply (model output); VITE_FIXTURE_MODE only",
  },
  {
    file: "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    snippet: "被集火秒杀",
    reason:
      "canned demo AI analysis (a stand-in for a model reply: finding title), shown by the AI card's demo button and served as the report-ai visual-baseline payload; data, not UI copy",
  },
  {
    file: "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    snippet: "敌方双 DPS 进攻 CD 对齐时",
    reason:
      "canned demo AI analysis (a stand-in for a model reply: finding explanation), shown by the AI card's demo button and served as the report-ai visual-baseline payload; data, not UI copy",
  },
  {
    file: "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    snippet: "在 2:08 你的治疗吃了 4 秒恐惧",
    reason:
      "canned demo AI analysis (a stand-in for a model reply: deep-dive text), shown by the AI card's demo button and served as the report-ai visual-baseline payload; data, not UI copy",
  },
  {
    file: "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    snippet: "恐惧 → 治疗",
    reason:
      "canned demo AI analysis (a stand-in for a model reply: deep-dive evidence chip label), shown by the AI card's demo button and served as the report-ai visual-baseline payload; data, not UI copy",
  },
  {
    file: "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    snippet: "敌 天神下凡",
    reason:
      "canned demo AI analysis (a stand-in for a model reply: deep-dive evidence chip label), shown by the AI card's demo button and served as the report-ai visual-baseline payload; data, not UI copy",
  },
  {
    file: "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    snippet: "防御 CD 留手",
    reason:
      "canned demo AI analysis (a stand-in for a model reply: finding title), shown by the AI card's demo button and served as the report-ai visual-baseline payload; data, not UI copy",
  },
  {
    file: "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    snippet: "整场保留了 Tranquility 未用即阵亡",
    reason:
      "canned demo AI analysis (a stand-in for a model reply: finding explanation), shown by the AI card's demo button and served as the report-ai visual-baseline payload; data, not UI copy",
  },
  {
    file: "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    snippet: "站位偏开阔",
    reason:
      "canned demo AI analysis (a stand-in for a model reply: finding title), shown by the AI card's demo button and served as the report-ai visual-baseline payload; data, not UI copy",
  },
  {
    file: "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    snippet: "多数时间停留在中场开阔区",
    reason:
      "canned demo AI analysis (a stand-in for a model reply: finding explanation), shown by the AI card's demo button and served as the report-ai visual-baseline payload; data, not UI copy",
  },
  {
    file: "packages/desktop/src/renderer/src/report/components/StructuredAnalysisPanel.tsx",
    snippet: "刷新后 activeKey",
    reason:
      "developer-only console.warn for a broken main-side invariant (onDone slotKey != refreshed activeKey); never rendered to the user",
  },
  {
    file: "packages/desktop/src/shared/chatProtocol.ts",
    snippet: "已停止",
    reason:
      "protocol sentinel: the coach-chat result message main returns on a user cancel, compared by CoachChatCard to tell a cancel from a failure; never rendered (the card drops the bubble instead)",
  },
];

/** The allowlist as frozen when the migration finished (Task 7 fix round 1),
 * as [file, snippet] pairs sorted by `file + "\u0000" + snippet`. Every
 * CJK_ALLOWLIST entry must be one of these, so entries can be removed freely
 * but a new one fails the test. Adding one is a deliberate act: append the
 * pair here AND update the sha256 pinned in i18n.noCjkLiterals.test.ts. Do not
 * add pairs to make a migration pass: move the text into the dictionary. */
export const FROZEN_CJK_ALLOWLIST: ReadonlyArray<readonly [string, string]> = [
  [
    "packages/desktop/src/main/ai.ts",
    "Respond entirely in Simplified Chinese (简体中文)",
  ],
  ["packages/desktop/src/main/analysis.ts", "回退到 settings 默认后端"],
  ["packages/desktop/src/main/corpusLoader.ts", "形状粗验失败"],
  ["packages/desktop/src/main/e2eEnv.ts", "GLADLOG_E2E=1 需要"],
  ["packages/desktop/src/main/managedObsBackend.ts", "托管 OBS 会话未配好"],
  ["packages/desktop/src/main/recorder.ts", "仍未结束(疑似卡死/日志流中断)"],
  ["packages/desktop/src/main/recorder.ts", "单分片超 40 分钟,已强制分片"],
  ["packages/desktop/src/main/recorder.ts", "开局分片跳过"],
  [
    "packages/desktop/src/main/recorder.ts",
    "执行此前因 MAX_CHUNK_MS 推迟的分片",
  ],
  ["packages/desktop/src/main/recorder.ts", "推迟到对局结束后分片"],
  ["packages/desktop/src/main/recorder.ts", "未产出新分片,跳过"],
  ["packages/desktop/src/main/recorder.ts", "的开手留在上一个文件里"],
  ["packages/desktop/src/main/recorder.ts", "负 headroom"],
  ["packages/desktop/src/main/recordingsStore.ts", "个未入索引文件"],
  ["packages/desktop/src/main/recordingsStore.ts", "个过期录像,释放"],
  [
    "packages/desktop/src/main/recordingsStore.ts",
    "可能是 OBS 崩溃孤儿或用户手动录像",
  ],
  ["packages/desktop/src/main/settingsStore.ts", "密钥/密码将以明文存储"],
  ["packages/desktop/src/main/settingsStore.ts", "无法解密"],
  ["packages/desktop/src/main/updater.ts", "GLADLOG_UPDATER_TEST_FEED 需要"],
  [
    "packages/desktop/src/renderer/src/fixtureBridge.ts",
    "fixture 桩:不真调模型",
  ],
  ["packages/desktop/src/renderer/src/fixtureBridge.ts", "击杀窗口内 40%"],
  ["packages/desktop/src/renderer/src/fixtureBridge.ts", "开大时目标挂着"],
  ["packages/desktop/src/renderer/src/fixtureBridge.ts", "爆发打进减伤"],
  ["packages/desktop/src/renderer/src/fixtureBridge.ts", "目标选择"],
  [
    "packages/desktop/src/renderer/src/fixtureBridge.ts",
    "相对同 spec/comp 分档",
  ],
  [
    "packages/desktop/src/renderer/src/fixtureBridge.ts",
    "第二轮我为什么会被秒",
  ],
  ["packages/desktop/src/renderer/src/fixtureBridge.ts", "脱火过多"],
  [
    "packages/desktop/src/renderer/src/fixtureBridge.ts",
    "那波 Frozen Orb 落地后",
  ],
  ["packages/desktop/src/renderer/src/fixtureBridge.ts", "（fixture）"],
  [
    "packages/desktop/src/renderer/src/report/components/StructuredAnalysisPanel.tsx",
    "刷新后 activeKey",
  ],
  [
    "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    "在 2:08 你的治疗吃了 4 秒恐惧",
  ],
  [
    "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    "多数时间停留在中场开阔区",
  ],
  [
    "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    "恐惧 → 治疗",
  ],
  [
    "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    "敌 天神下凡",
  ],
  [
    "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    "敌方双 DPS 进攻 CD 对齐时",
  ],
  [
    "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    "整场保留了 Tranquility 未用即阵亡",
  ],
  [
    "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    "站位偏开阔",
  ],
  [
    "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    "被集火秒杀",
  ],
  [
    "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    "防御 CD 留手",
  ],
  ["packages/desktop/src/shared/chatProtocol.ts", "已停止"],
];
