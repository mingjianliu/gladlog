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
];
