// Permanent exceptions to §6.9 check 1 (test/i18n.noCjkLiterals.test.ts): a
// CJK literal that is never shown to the user. Each entry matches the hits in
// `file` whose literal text (a whole template, `${…}` included) contains
// `snippet`, and must say why it is not user-facing. Shrink-only; the test
// fails on an entry that no longer matches anything.
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
    file: "packages/desktop/src/main/localAiBackends.ts",
    snippet: "内部错误:传给",
    reason:
      "developer-only assert (assertNoWindowsCmdMetacharacters): an argv invariant that is expected to always pass; it guards gladlog's own spawn wrapper, not user input",
  },
  {
    file: "packages/desktop/src/main/localAiBackends.ts",
    snippet: "元字符(& | ^ % < > 之一)",
    reason:
      "continuation of the developer-only assertNoWindowsCmdMetacharacters message (same assert as above)",
  },
  {
    file: "packages/desktop/src/main/localAiBackends.ts",
    snippet: "语法而非字面文本,已拒绝执行",
    reason:
      "continuation of the developer-only assertNoWindowsCmdMetacharacters message (same assert as above)",
  },
  {
    file: "packages/desktop/src/main/localAiBackends.ts",
    snippet: "双引号——cmd.exe 重新解析时",
    reason:
      "continuation of the developer-only assertNoWindowsCmdMetacharacters message (unbalanced-quote branch, same assert as above)",
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
