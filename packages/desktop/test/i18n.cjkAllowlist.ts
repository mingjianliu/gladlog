// Permanent exceptions to §6.9 check 1 (test/i18n.noCjkLiterals.test.ts): a
// CJK literal that is never shown to the user. Each entry matches the hits in
// `file` whose literal text (a whole template, `${…}` included) EQUALS
// `snippet` (exact, not a substring: a new message never rides on an old
// entry), and must say why it is not user-facing. Shrink-only (§6.9 只允许
// 减少): the test fails on an entry that no longer matches anything, and on
// an entry missing from FROZEN_CJK_ALLOWLIST below.
//
// Removing an entry: when you delete an entry from CJK_ALLOWLIST (its literal
// moved into the dictionary or went away), also prune the same [file, snippet]
// pair from FROZEN_CJK_ALLOWLIST and re-pin the sha256 in
// i18n.noCjkLiterals.test.ts. Otherwise the frozen list keeps a dead pair, and
// the literal could later come back under that pair without failing the test.
export const CJK_ALLOWLIST: ReadonlyArray<{
  file: string;
  snippet: string;
  reason: string;
}> = [
  {
    file: "packages/desktop/src/main/ai.ts",
    snippet:
      'Respond entirely in Simplified Chinese (简体中文). Keep spell/ability names in English exactly as written in the data — never translate them into Chinese, even inline; you may explain them in Chinese, but the name token itself must stay English. Every other fact string quoted from the data (facts.postKick such as "pressed 3x but rejected (Not yet recovered)", lockout / reach / DR labels, [BURST ANSWERED] extras) must be rendered in Chinese in your own words — never paste an English phrase other than a spell name into the reply (reliability round 3 N12: English postKick text appeared verbatim in Chinese replies).',
    reason:
      "model instruction, zh prompt bytes frozen (§7): the coach system prompt's zh language sentence, sent to the model, never rendered",
  },
  {
    file: "packages/desktop/src/main/corpusLoader.ts",
    snippet: "形状粗验失败(缺 cells 数组或 wowPatchVersion 字符串)",
    reason:
      "skip reason for a broken corpus file; only reaches log.warn via onSkipped (main/index.ts), never rendered",
  },
  {
    file: "packages/desktop/src/main/e2eEnv.ts",
    snippet: "GLADLOG_E2E=1 需要 GLADLOG_E2E_USER_DATA 指向一个绝对路径",
    reason:
      "developer-only startup assert for the E2E test switch (GLADLOG_E2E env vars); end users never set it",
  },
  {
    file: "packages/desktop/src/main/recordingsStore.ts",
    snippet:
      "`[recordings] ${count} 个未入索引文件,共 ${(bytes / 1_000_000).toFixed(1)}MB —— `",
    reason:
      "recordings visibility log line (this.log → main.log); developer log only, never rendered",
  },
  {
    file: "packages/desktop/src/main/recordingsStore.ts",
    snippet: "可能是 OBS 崩溃孤儿或用户手动录像,不会自动删除,需人工核查",
    reason:
      "continuation of the same recordings visibility log line; developer log only",
  },
  {
    file: "packages/desktop/src/main/recordingsStore.ts",
    snippet:
      "`[recordings] 清理 ${deleted} 个过期录像,释放 ${(freedBytes / 1_000_000).toFixed(1)}MB`",
    reason:
      "retention prune log line (this.log → main.log); developer log only, never rendered",
  },
  {
    file: "packages/desktop/src/main/settingsStore.ts",
    snippet:
      "safeStorage.isEncryptionAvailable() === false,密钥/密码将以明文存储",
    reason:
      "SettingsStoreWarning.detail; onWarn only writes it to log.warn (main/index.ts onSettingsWarn), never rendered",
  },
  {
    file: "packages/desktop/src/main/settingsStore.ts",
    snippet: "已加密存储但当前环境 safeStorage 不可用,无法解密",
    reason:
      "SettingsStoreWarning.detail; onWarn only writes it to log.warn (main/index.ts onSettingsWarn), never rendered",
  },
  {
    file: "packages/desktop/src/main/updater.ts",
    snippet:
      "`GLADLOG_UPDATER_TEST_FEED 需要 <owner>/<repo> 形式,收到:${env.testFeed}`",
    reason:
      "developer-only assert for the dummy-release test feed env var; end users never set it",
  },
  {
    file: "packages/desktop/src/main/managedObsBackend.ts",
    snippet:
      '`[recorder] 托管 OBS 会话未配好(采集源没建上),暂不开录:${lastError ?? "unknown"}`',
    reason:
      "console.warn in the main process (recorder diagnostics); developer log only, never rendered",
  },
  {
    file: "packages/desktop/src/main/recorder.ts",
    snippet:
      "[recorder] 单分片超 40 分钟但仍在对局中,推迟到对局结束后分片(斗内绝不切)",
    reason:
      "console.warn in the main process (recorder diagnostics); developer log only, never rendered",
  },
  {
    file: "packages/desktop/src/main/recorder.ts",
    snippet:
      "`[recorder] 单场对局超过 ${STUCK_MATCH_MAX_CHUNK_MS / 60_000} 分钟仍未结束(疑似卡死/日志流中断)—— 数据完整性优先于连续性,强制分片`",
    reason:
      "console.warn in the main process (recorder diagnostics); developer log only, never rendered",
  },
  {
    file: "packages/desktop/src/main/recorder.ts",
    snippet: "`[recorder] splitChunk 未产出新分片,跳过(reason=${reason})`",
    reason:
      "console.warn in the main process (recorder diagnostics); developer log only, never rendered",
  },
  {
    file: "packages/desktop/src/main/recorder.ts",
    snippet: "[recorder] 单分片超 40 分钟,已强制分片",
    reason:
      "console.warn in the main process (recorder diagnostics); developer log only, never rendered",
  },
  {
    file: "packages/desktop/src/main/recorder.ts",
    snippet:
      "`[recorder] 开局分片跳过:日志滞后 ${Math.round(logLagMs)}ms 超出 ${MATCH_OPEN_SPLIT_MAX_LAG_MS}ms —— `",
    reason:
      "console.warn in the main process (recorder diagnostics); developer log only, never rendered",
  },
  {
    file: "packages/desktop/src/main/recorder.ts",
    snippet:
      "`此刻切会把开场前 ${Math.round(logLagMs)}ms 的开手留在上一个文件里,本场按连续录制处理(头部场外不超过 ${IDLE_SPLIT_MS / 1000}s)`",
    reason:
      "console.warn in the main process (recorder diagnostics); developer log only, never rendered (continuation of the match-open split message)",
  },
  {
    file: "packages/desktop/src/main/recorder.ts",
    snippet: "[recorder] 对局结束,执行此前因 MAX_CHUNK_MS 推迟的分片",
    reason:
      "console.warn in the main process (recorder diagnostics); developer log only, never rendered",
  },
  {
    file: "packages/desktop/src/main/recorder.ts",
    snippet:
      "`[recorder] associate: meta.startTime(${meta.startTime}) < chunk.startedAt(${hit.startedAt}) -- 负 headroom`",
    reason:
      "console.warn in the main process (recorder diagnostics); developer log only, never rendered",
  },
  {
    file: "packages/desktop/src/main/analysis.ts",
    snippet:
      '`[analysis] deepen: 槽 "${preDoc!.lastSlotKey}" 的后端 "${targetSplit.backend}" 不是已知 AiBackend,回退到 settings 默认后端`',
    reason:
      "console.warn in the main process (deepen falls back from an unknown slot backend); developer log only, never rendered",
  },
  {
    file: "packages/desktop/src/renderer/src/fixtureBridge.ts",
    snippet: "相对同 spec/comp 分档,你的进攻输出与防御 CD 利用都偏低。",
    reason:
      "fixture-mode stand-in for a stored compare report (model output, not UI copy); VITE_FIXTURE_MODE only, pinned by visual baselines",
  },
  {
    file: "packages/desktop/src/renderer/src/fixtureBridge.ts",
    snippet: "（fixture）分析请求 prompt 正文…",
    reason:
      "fixture-mode stand-in for logged AI prompt bodies on the dev page (data, not UI copy); VITE_FIXTURE_MODE only",
  },
  {
    file: "packages/desktop/src/renderer/src/fixtureBridge.ts",
    snippet: "（fixture）对比请求 prompt 正文…",
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
    snippet: "开大时目标挂着 40% 减伤墙。",
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
    snippet: "击杀窗口内 40% 伤害打在副目标。",
    reason:
      "fixture-mode stand-in for a stored finding explanation (model output); VITE_FIXTURE_MODE only, pinned by visual baselines",
  },
  {
    file: "packages/desktop/src/renderer/src/fixtureBridge.ts",
    snippet: "第二轮我为什么会被秒?",
    reason:
      "fixture-mode stand-in for a user's coach-chat message (user content); VITE_FIXTURE_MODE only, pinned by visual baselines",
  },
  {
    file: "packages/desktop/src/renderer/src/fixtureBridge.ts",
    snippet:
      "0:36 那波 Frozen Orb 落地后你还站在原地读了一次治疗,盾也没提前给。下次看到法师交 Frozen Orb 先拉视线再补。",
    reason:
      "fixture-mode stand-in for a coach-chat reply (model output); VITE_FIXTURE_MODE only, pinned by visual baselines",
  },
  {
    file: "packages/desktop/src/renderer/src/fixtureBridge.ts",
    snippet: "(fixture 桩:不真调模型)",
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
    snippet:
      "敌方双 DPS 进攻 CD 对齐时,你在没有减伤/位移的情况下于 1.4s 内掉血 82% 后阵亡;此前贴在开阔地带、离掩体较远。",
    reason:
      "canned demo AI analysis (a stand-in for a model reply: finding explanation), shown by the AI card's demo button and served as the report-ai visual-baseline payload; data, not UI copy",
  },
  {
    file: "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    snippet:
      "在 2:08 你的治疗吃了 4 秒恐惧且饰品在 CD;2:10 敌方战士开天神下凡;你的 HP 从 T-15s 的 86% 一路掉到 T-5s 的 41%。下次看到治疗被控且无解时,提前一个 GCD 交墙或拉向立柱。",
    reason:
      "canned demo AI analysis (a stand-in for a model reply: deep-dive text), shown by the AI card's demo button and served as the report-ai visual-baseline payload; data, not UI copy",
  },
  {
    file: "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    snippet: "恐惧 → 治疗(4.0s)",
    reason:
      "canned demo AI analysis (a stand-in for a model reply: deep-dive evidence chip label), shown by the AI card's demo button and served as the report-ai visual-baseline payload; data, not UI copy",
  },
  {
    file: "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    snippet: "敌 天神下凡(Warr)",
    reason:
      "canned demo AI analysis (a stand-in for a model reply: deep-dive evidence chip label), shown by the AI card's demo button and served as the report-ai visual-baseline payload; data, not UI copy",
  },
  {
    file: "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    snippet: "防御 CD 留手:Tranquility 未使用",
    reason:
      "canned demo AI analysis (a stand-in for a model reply: finding title), shown by the AI card's demo button and served as the report-ai visual-baseline payload; data, not UI copy",
  },
  {
    file: "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    snippet:
      "整场保留了 Tranquility 未用即阵亡——对面 Restoration Druid 在 0:33 交出 Ironbark 后,你本应在承伤窗口用 Power Word: Shield 或 Renew's 持续回复顶住并读出 Tranquility。",
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
    snippet: "多数时间停留在中场开阔区,较少利用立柱拉视线。",
    reason:
      "canned demo AI analysis (a stand-in for a model reply: finding explanation), shown by the AI card's demo button and served as the report-ai visual-baseline payload; data, not UI copy",
  },
  {
    file: "packages/desktop/src/renderer/src/report/components/StructuredAnalysisPanel.tsx",
    snippet:
      '`[analysis] onDone slotKey(${d.slotKey}) != 刷新后 activeKey(${ak})—— 违反"完成槽即激活槽"不变式,仍按 activeKey 展示`',
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
 * add pairs to make a migration pass: move the text into the dictionary.
 * Re-pinned 2026-11-23 when matching became exact: each snippet is now the
 * full literal it used to match as a substring (the "（fixture）" pair split
 * into its two literals); the set of allowed literals is unchanged. */
export const FROZEN_CJK_ALLOWLIST: ReadonlyArray<readonly [string, string]> = [
  [
    "packages/desktop/src/main/ai.ts",
    'Respond entirely in Simplified Chinese (简体中文). Keep spell/ability names in English exactly as written in the data — never translate them into Chinese, even inline; you may explain them in Chinese, but the name token itself must stay English. Every other fact string quoted from the data (facts.postKick such as "pressed 3x but rejected (Not yet recovered)", lockout / reach / DR labels, [BURST ANSWERED] extras) must be rendered in Chinese in your own words — never paste an English phrase other than a spell name into the reply (reliability round 3 N12: English postKick text appeared verbatim in Chinese replies).',
  ],
  [
    "packages/desktop/src/main/analysis.ts",
    '`[analysis] deepen: 槽 "${preDoc!.lastSlotKey}" 的后端 "${targetSplit.backend}" 不是已知 AiBackend,回退到 settings 默认后端`',
  ],
  [
    "packages/desktop/src/main/corpusLoader.ts",
    "形状粗验失败(缺 cells 数组或 wowPatchVersion 字符串)",
  ],
  [
    "packages/desktop/src/main/e2eEnv.ts",
    "GLADLOG_E2E=1 需要 GLADLOG_E2E_USER_DATA 指向一个绝对路径",
  ],
  [
    "packages/desktop/src/main/managedObsBackend.ts",
    '`[recorder] 托管 OBS 会话未配好(采集源没建上),暂不开录:${lastError ?? "unknown"}`',
  ],
  [
    "packages/desktop/src/main/recorder.ts",
    "[recorder] 单分片超 40 分钟,已强制分片",
  ],
  [
    "packages/desktop/src/main/recorder.ts",
    "[recorder] 单分片超 40 分钟但仍在对局中,推迟到对局结束后分片(斗内绝不切)",
  ],
  [
    "packages/desktop/src/main/recorder.ts",
    "[recorder] 对局结束,执行此前因 MAX_CHUNK_MS 推迟的分片",
  ],
  [
    "packages/desktop/src/main/recorder.ts",
    "`[recorder] associate: meta.startTime(${meta.startTime}) < chunk.startedAt(${hit.startedAt}) -- 负 headroom`",
  ],
  [
    "packages/desktop/src/main/recorder.ts",
    "`[recorder] splitChunk 未产出新分片,跳过(reason=${reason})`",
  ],
  [
    "packages/desktop/src/main/recorder.ts",
    "`[recorder] 单场对局超过 ${STUCK_MATCH_MAX_CHUNK_MS / 60_000} 分钟仍未结束(疑似卡死/日志流中断)—— 数据完整性优先于连续性,强制分片`",
  ],
  [
    "packages/desktop/src/main/recorder.ts",
    "`[recorder] 开局分片跳过:日志滞后 ${Math.round(logLagMs)}ms 超出 ${MATCH_OPEN_SPLIT_MAX_LAG_MS}ms —— `",
  ],
  [
    "packages/desktop/src/main/recorder.ts",
    "`此刻切会把开场前 ${Math.round(logLagMs)}ms 的开手留在上一个文件里,本场按连续录制处理(头部场外不超过 ${IDLE_SPLIT_MS / 1000}s)`",
  ],
  [
    "packages/desktop/src/main/recordingsStore.ts",
    "`[recordings] ${count} 个未入索引文件,共 ${(bytes / 1_000_000).toFixed(1)}MB —— `",
  ],
  [
    "packages/desktop/src/main/recordingsStore.ts",
    "`[recordings] 清理 ${deleted} 个过期录像,释放 ${(freedBytes / 1_000_000).toFixed(1)}MB`",
  ],
  [
    "packages/desktop/src/main/recordingsStore.ts",
    "可能是 OBS 崩溃孤儿或用户手动录像,不会自动删除,需人工核查",
  ],
  [
    "packages/desktop/src/main/settingsStore.ts",
    "safeStorage.isEncryptionAvailable() === false,密钥/密码将以明文存储",
  ],
  [
    "packages/desktop/src/main/settingsStore.ts",
    "已加密存储但当前环境 safeStorage 不可用,无法解密",
  ],
  [
    "packages/desktop/src/main/updater.ts",
    "`GLADLOG_UPDATER_TEST_FEED 需要 <owner>/<repo> 形式,收到:${env.testFeed}`",
  ],
  [
    "packages/desktop/src/renderer/src/fixtureBridge.ts",
    "(fixture 桩:不真调模型)",
  ],
  [
    "packages/desktop/src/renderer/src/fixtureBridge.ts",
    "0:36 那波 Frozen Orb 落地后你还站在原地读了一次治疗,盾也没提前给。下次看到法师交 Frozen Orb 先拉视线再补。",
  ],
  [
    "packages/desktop/src/renderer/src/fixtureBridge.ts",
    "击杀窗口内 40% 伤害打在副目标。",
  ],
  [
    "packages/desktop/src/renderer/src/fixtureBridge.ts",
    "开大时目标挂着 40% 减伤墙。",
  ],
  ["packages/desktop/src/renderer/src/fixtureBridge.ts", "爆发打进减伤"],
  ["packages/desktop/src/renderer/src/fixtureBridge.ts", "目标选择"],
  [
    "packages/desktop/src/renderer/src/fixtureBridge.ts",
    "相对同 spec/comp 分档,你的进攻输出与防御 CD 利用都偏低。",
  ],
  [
    "packages/desktop/src/renderer/src/fixtureBridge.ts",
    "第二轮我为什么会被秒?",
  ],
  ["packages/desktop/src/renderer/src/fixtureBridge.ts", "脱火过多"],
  [
    "packages/desktop/src/renderer/src/fixtureBridge.ts",
    "（fixture）分析请求 prompt 正文…",
  ],
  [
    "packages/desktop/src/renderer/src/fixtureBridge.ts",
    "（fixture）对比请求 prompt 正文…",
  ],
  [
    "packages/desktop/src/renderer/src/report/components/StructuredAnalysisPanel.tsx",
    '`[analysis] onDone slotKey(${d.slotKey}) != 刷新后 activeKey(${ak})—— 违反"完成槽即激活槽"不变式,仍按 activeKey 展示`',
  ],
  [
    "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    "在 2:08 你的治疗吃了 4 秒恐惧且饰品在 CD;2:10 敌方战士开天神下凡;你的 HP 从 T-15s 的 86% 一路掉到 T-5s 的 41%。下次看到治疗被控且无解时,提前一个 GCD 交墙或拉向立柱。",
  ],
  [
    "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    "多数时间停留在中场开阔区,较少利用立柱拉视线。",
  ],
  [
    "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    "恐惧 → 治疗(4.0s)",
  ],
  [
    "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    "敌 天神下凡(Warr)",
  ],
  [
    "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    "敌方双 DPS 进攻 CD 对齐时,你在没有减伤/位移的情况下于 1.4s 内掉血 82% 后阵亡;此前贴在开阔地带、离掩体较远。",
  ],
  [
    "packages/desktop/src/renderer/src/report/data/demoAnalysis.ts",
    "整场保留了 Tranquility 未用即阵亡——对面 Restoration Druid 在 0:33 交出 Ironbark 后,你本应在承伤窗口用 Power Word: Shield 或 Renew's 持续回复顶住并读出 Tranquility。",
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
    "防御 CD 留手:Tranquility 未使用",
  ],
  ["packages/desktop/src/shared/chatProtocol.ts", "已停止"],
];
