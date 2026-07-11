# 子项目 4b:eval 工具链 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 旧工作仓 eval 方法论(基线环 / A/B 环 / judge 校准)落为 `@gladlog/eval` 包 + 三条工作流文档;语料与 run 产物走私有姊妹仓(`GLADLOG_EVAL_HOME`)。

**Architecture:** 移植类任务沿用**控制器提取 + 实现方机械改造**(实现方永不接触旧 fork);语料构建器是唯一整体适配件(旧件绑死旧 parser+web API,按 4a `collectBenchmarks` 模式由控制器重写解析链)。统计/抽样/rubric 语义零逻辑改动。Spec:`docs/specs/2026-07-11-eval-tooling-design.md`。

**Tech Stack:** TypeScript ESM、vitest、fs-extra、`@gladlog/parser` + `parser-compat` + `analysis`、tsx CLI;工作流 = `.claude/commands` 薄指针 + `docs/commands/` 全文。

## Global Constraints

- **合规(硬性)**:实现者(agy/subagent)不得访问 `/Users/mingjianliu/code/wowarenalogs`;每个待提取文件控制器先对照子项目 0 合规审计确认 CLEAN 才复制;无法证明自有的不移植、按方法论重写(spec debate 条款 1)。
- **移植零逻辑改动**:统计/抽样/rubric 语义以旧源为准;只允许 (a) import 面改写(`@wowarenalogs/parser`→`@gladlog/parser-compat`、`../../shared/src/…`→`@gladlog/analysis` 具名导出、`resolveRepoPath`→`resolveEvalHome`);(b) 目录常量换 eval-home 布局;(c) 本计划点名的适配。其余行为改动 = BLOCKED。
- **点名适配(spec 裁决,允许偏离旧源)**:① 溯源校验不再宽容 legacy 无溯源文件——缺 provenance/维度/factAudit = FAIL(新台账时代无历史包袱);② 校验器同时查 7 维整数 1–5 + factAudit ≥3 条(旧体系在工作流里查,现固化进校验器)。
- score 文件契约(执行器无关,spec"契约与未来扩展"):`{ prompt: {<7 维中 prompt 侧>: int}, response: {<7 维中 response 侧>: int}, factAudit: [{claim, verdict, evidence}]≥3, provenance: {judgeModel, judgedAt, promptSha256, responseSha256} }`;7 维 = sufficiency/noise/labelBias/inferenceScaffolding/accuracy/outcomeAlignment/focusCalibration。
- 私仓布局:`$GLADLOG_EVAL_HOME/{corpus,runs/<runId>,ab/<abId>,ledger.md}`;run 目录内 `{prompts,responses,manifests,scores}` 与旧工具的 BASE_DIR 同构;AB 目录内 `{control,treatment,blind}` 与旧 AB_DIR 同构(env `BASE_DIR`/`AB_DIR` 覆盖机制保留)。
- ESM、TS strict、vitest globals、测试在 `packages/eval/test/`;根 `npm test --workspaces` 全绿;TDD、每任务一 commit。
- 语料指纹格式:`<场数>: <首 matchId 前 8>..<末 matchId 前 8>`。

## 提取清单(控制器专用;→ = gladlog 目标路径,均在 `packages/eval/` 下)

```
旧 packages/tools/src/coverageManifest.ts          → src/quality/coverageManifest.ts
旧 packages/tools/src/promptQualityCheck.ts        → src/quality/promptQualityCheck.ts
旧 packages/tools/src/blindAbPool.ts               → src/ab/blindAbPool.ts
旧 packages/tools/src/abCompareStats.ts            → src/ab/abCompareStats.ts
旧 packages/tools/src/buildJudgeCalibrationSuite.ts → src/judge/buildCalibrationSuite.ts
旧 packages/tools/src/checkJudgeCalibration.ts     → src/judge/checkCalibration.ts
旧 scripts/check-score-provenance.mjs              → src/provenance/checkScoreProvenance.ts(转 TS)
旧 scripts/judge-spot-audit.mjs                    → src/provenance/judgeSpotAudit.ts(转 TS)
旧 scripts/calibrate-auditor.mjs                   → src/provenance/calibrateAuditor.ts(转 TS)
旧 docs/commands/{eval-healer-prompts,improve-healer-prompts,calibrate-judge}.md
                                                   → docs/commands/{eval-baseline,eval-ab,calibrate-judge}.md(控制器改写路径/命令名)
参考(不复制,控制器读取后转述):buildHealerPromptCorpus.ts(index/响应头/分层惯例)、printMatchPrompts.ts(ParsedCombat 型、MATCHID 头约定)
不移植:printMatchPrompts.ts 主体(绑旧 parser+claudeCli+web fetch)、resolveRepoPath.ts(被 resolveEvalHome 取代)、englishSpellName.ts(gladlog 已有 getEnglishSpellName)
```

---

### Task 1: `packages/eval` 脚手架

**Files:** Create `packages/eval/{package.json,tsconfig.json,vitest.config.ts,src/index.ts,test/smoke.test.ts}`

**Interfaces:** Produces 包骨架 `@gladlog/eval`:deps `{"@gladlog/parser":"0.0.1","@gladlog/parser-compat":"0.0.1","@gladlog/analysis":"0.0.1","fs-extra":"^11.2.0"}`,devDeps `{"@types/fs-extra":"^11.0.4","@types/node":"^26.1.1","tsx":"^4.19.0","typescript":"^5.5.0","vitest":"^2.0.0"}`;scripts `{"test":"vitest run --passWithNoTests","typecheck":"tsc --noEmit"}`;tsconfig/vitest 逐字照抄 `packages/analysis` 对应文件;`src/index.ts` 先 `export {};`。

- [ ] Step 1: 创建五文件;smoke.test.ts 断言 `import * as pkg from "../src/index"` 不炸。
- [ ] Step 2: 根 `npm install`;`npm test -w @gladlog/eval && npm run typecheck -w @gladlog/eval` PASS。
- [ ] Step 3: Commit `feat(eval): package scaffold`。

---

### Task 2: `resolveEvalHome` + `init` CLI(新代码 TDD)

**Files:** Create `src/evalHome.ts`、`scripts/init.ts`;Test `test/evalHome.test.ts`

**Interfaces:** Produces `resolveEvalHome(opts?: { env?: NodeJS.ProcessEnv }): string`(读 `GLADLOG_EVAL_HOME`,默认 `~/code/gladlog-eval-private`;目录不存在或无 `.git` → throw,message 含 `gladlog-eval init` 指引);`runDir(home: string, runId: string): string` = `<home>/runs/<runId>`;`abDir(home, abId)` = `<home>/ab/<abId>`。`scripts/init.ts`(tsx):创建 `{corpus,runs,ab}`、`git init`、写 `ledger.md` 表头(append-only 规则注释 + 基线/AB/校准三张空表,列名照旧台账)。

- [ ] Step 1(契约):

```ts
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execSync } from "child_process";
import { resolveEvalHome, runDir } from "../src/evalHome";

describe("resolveEvalHome", () => {
  it("env 指向合法 git 目录 → 返回该路径", () => {
    const d = mkdtempSync(join(tmpdir(), "gl-eval-"));
    execSync("git init -q", { cwd: d });
    expect(resolveEvalHome({ env: { GLADLOG_EVAL_HOME: d } })).toBe(d);
  });
  it("目录缺失 → throw 且 message 含 init 指引", () => {
    expect(() =>
      resolveEvalHome({ env: { GLADLOG_EVAL_HOME: "/nonexistent/x" } }),
    ).toThrow(/gladlog-eval init/);
  });
  it("存在但非 git 仓 → throw", () => {
    const d = mkdtempSync(join(tmpdir(), "gl-eval-"));
    expect(() => resolveEvalHome({ env: { GLADLOG_EVAL_HOME: d } })).toThrow(
      /git/,
    );
  });
  it("runDir 拼接", () => {
    expect(runDir("/h", "2026-07-11-a")).toBe("/h/runs/2026-07-11-a");
  });
});
```

- [ ] Step 2: 跑测 FAIL(模块不存在)。
- [ ] Step 3: 实现 `src/evalHome.ts`(existsSync + `<dir>/.git` 检查)与 `scripts/init.ts`;index.ts 导出 evalHome 具名项。
- [ ] Step 4: 测试+typecheck PASS;手动 `GLADLOG_EVAL_HOME=$(mktemp -d)/home npx tsx packages/eval/scripts/init.ts` 后 resolveEvalHome 通过。
- [ ] Step 5: Commit `feat(eval): eval-home resolver and private-repo init CLI`。

---

### Task 3: coverageManifest 移植

**Files:** Create `src/quality/coverageManifest.ts`;Test `test/coverageManifest.test.ts`

**Interfaces:** Produces `buildCoverageManifest(combat: ParsedCombat): CoverageManifest` 及 `CoverageManifest` 型(players/deaths/ccApplied/interrupts/dispels/counts,以旧源为准);`export type ParsedCombat = IArenaMatch | IShuffleRound`(本地声明,型取自 `@gladlog/parser-compat`)。

- [ ] Step 1(控制器):对照子项目 0 审计确认 CLEAN;复制 `coverageManifest.ts` 到位。
- [ ] Step 2(实现方):import 改写——`@wowarenalogs/parser` → `@gladlog/parser-compat`;`ccSpellIds, trinketSpellIds` ← `@gladlog/analysis`(spellTags 已导出);`specToString` ← `@gladlog/analysis`;`englishSpellName` → `getEnglishSpellName`(`@gladlog/analysis`,签名 `(spellId: string, fallback?: string | null): string`,调用点按此适配);`ParsedCombat` 由 import printMatchPrompts 改为本地 type 声明。零逻辑改动。
- [ ] Step 3(契约):用 4a 的 legacy fixture 桥(参照 `packages/analysis/test/helpers/legacyFixture.ts` 在本包 `test/helpers/` 复刻,读 `packages/desktop/test/fixtures/report-match.json`):

```ts
it("fixture 清单:玩家齐、友方死亡与 CC 数组形状正确", () => {
  const m = loadLegacyMatchFixture();
  const manifest = buildCoverageManifest(m);
  expect(manifest.players.length).toBeGreaterThanOrEqual(4);
  for (const p of manifest.players) expect(typeof p.spec).toBe("string");
  for (const d of manifest.deaths)
    expect(["friendly", "hostile"]).toContain(d.reaction);
  expect(manifest.counts.trinketCasts).toBeGreaterThanOrEqual(0);
  for (const e of manifest.ccApplied)
    expect(e.spellId ?? e.spellName).toBeTruthy();
});
```

- [ ] Step 4: 全绿 → Commit `feat(eval): coverage manifest port`。

---

### Task 4: 语料构建 CLI(控制器适配重写)

**Files:** Create `src/corpus/buildCorpus.ts`、`scripts/buildCorpus.ts`;Test `test/buildCorpus.test.ts`

**Interfaces:** Produces `buildCorpus(opts: { logPaths: string[]; outDir: string; ownerFilter?: "healer" }): Promise<{ entries: IndexEntry[]; fingerprint: string }>`;`IndexEntry = { ordinal: number; file: string; matchId: string; spec: string; result: string }`(与旧 index.json 同构,后续任务全依赖此形状)。落盘:`<outDir>/prompts/NNN-<matchId 前 8>.txt`、`<outDir>/manifests/NNN.json`(buildCoverageManifest 产物)、`<outDir>/index.json`、`<outDir>/fingerprint.txt`。

**流程**(控制器重写,解析链照抄 4a `packages/analysis/scripts/collectBenchmarks.ts` 的 on("match"/"shuffle") + toLegacyMatch/toLegacyShuffle + shuffle 轮次 fallback-id 模式):

- [ ] Step 1(契约):

```ts
it("desktop fixture → 语料落盘齐全、指纹格式正确", async () => {
  const out = mkdtempSync(join(tmpdir(), "gl-corpus-"));
  const { entries, fingerprint } = await buildCorpus({
    logPaths: [fixtureLogPath],
    outDir: out,
    ownerFilter: "healer",
  });
  expect(entries.length).toBeGreaterThan(0);
  expect(fingerprint).toMatch(/^\d+: [^.]{1,8}\.\.[^.]{1,8}$/);
  for (const e of entries) {
    const prompt = readFileSync(join(out, e.file), "utf-8");
    expect(prompt.length).toBeGreaterThan(500);
    expect(
      existsSync(
        join(out, "manifests", `${String(e.ordinal).padStart(3, "0")}.json`),
      ),
    ).toBe(true);
  }
  const idx = JSON.parse(readFileSync(join(out, "index.json"), "utf-8"));
  expect(idx).toEqual(entries);
});
```

fixtureLogPath = 从 `packages/parser` 测试固件中选一份含治疗者的真实对局日志(控制器指定;desktop report-match.json 是解析产物不是日志,此测试需要原始 .txt 日志固件——parser 包 fixtures 已有)。

- [ ] Step 2(实现方):实现 `buildCorpus`:逐文件 GladLogParser 解析 → 每场取 units 中 `isHealerSpec(u.spec)` 且 `u.reaction === CombatUnitReaction.Friendly` 方玩家为 owner(ownerFilter="healer";无治疗者场次跳过)→ friends/enemies 按 owner 阵营划分 → prompt = `buildMatchContext(combat, friends, enemies, { owner })`(`@gladlog/analysis`)→ manifest = `buildCoverageManifest(combat)` → 编号落盘 + index + fingerprint。`scripts/buildCorpus.ts`:argv `--manifest <日志清单> --run <runId>`,outDir = `runDir(resolveEvalHome(), runId)`。
- [ ] Step 3: 测试+typecheck PASS → Commit `feat(eval): corpus builder (gladlog parse chain, healer-owner prompts)`。

---

### Task 5: promptQualityCheck 移植

**Files:** Create `src/quality/promptQualityCheck.ts`、`scripts/qualityCheck.ts`;Test `test/promptQuality.test.ts`

**Interfaces:** Consumes Task 3 `CoverageManifest`、Task 4 `IndexEntry`。Produces `checkMatch(entry: IndexEntry, promptText: string, manifest: CoverageManifest): MatchQuality`(形状照旧源:coverage 五类 + noise + labelBias + hardFailures)以及 CLI(`BASE_DIR` 环境变量覆盖,默认拒跑并提示 `--run`)。

- [ ] Step 1(控制器):CLEAN 核验;复制到位。
- [ ] Step 2(实现方):import/路径面改写(规则见全局约束);把 `checkMatch` 与各 check 函数改为具名导出(旧源仅 main 内联调用——导出属 import 面改动,逻辑零改);CLI main 保留。
- [ ] Step 3(契约):

```ts
const entry = {
  ordinal: 1,
  matchId: "m1",
  spec: "Restoration Druid",
  result: "loss",
  file: "prompts/001-m1.txt",
};
const manifest = {
  players: [{ name: "Heals-Realm", spec: "Restoration Druid" }],
  deaths: [{ unitName: "Heals-Realm", reaction: "friendly", tRelSec: 42 }],
  ccApplied: [
    { spellId: "408", spellName: "Kidney Shot", spellNameEn: "Kidney Shot" },
  ],
  interrupts: [],
  dispels: [],
  counts: { trinketCasts: 1 },
} as unknown as CoverageManifest;
it("友方死亡不在 prompt → hardFailure;在 → 覆盖 100%", () => {
  const miss = checkMatch(entry, "nothing here\njust lines", manifest);
  expect(miss.hardFailures.length).toBeGreaterThan(0);
  const hit = checkMatch(
    entry,
    "[DEATH] 42s Heals died\nKidney Shot lands\ntrinketed out",
    manifest,
  );
  expect(hit.hardFailures).toEqual([]);
  expect(hit.coverage.friendlyDeaths.present).toBe(1);
  expect(hit.coverage.ccSpells.present).toBe(1);
  expect(hit.coverage.trinketCasts.present).toBe(1);
});
it("重复率:三行中一对重复 → exactDuplicateRatio 0.333", () => {
  const q = checkMatch(
    entry,
    "[DEATH] Heals\nKidney Shot\nsame\nsame",
    manifest,
  );
  expect(q.noise.exactDuplicateRatio).toBeCloseTo(0.25, 3);
});
it("bias 词典命中计数与行号", () => {
  const q = checkMatch(
    entry,
    "[DEATH] Heals ok\nKidney Shot\nthat was catastrophic",
    manifest,
  );
  expect(q.labelBias.totalHits).toBe(1);
  expect(q.labelBias.hits[0].sampleLines).toEqual([3]);
});
```

- [ ] Step 4: 全绿 → Commit `feat(eval): deterministic prompt quality checks port`。

---

### Task 6: A/B 统计与盲评池移植

**Files:** Create `src/ab/abCompareStats.ts`、`src/ab/blindAbPool.ts`、`scripts/{abStats,blindPool}.ts`;Test `test/abStats.test.ts`

**Interfaces:** Produces 具名导出 `signTestP(deltas: number[]): { p, positives, negatives, ties }`、`bootstrapCI(deltas: number[], rng): { lo, hi }`、`makeRng(seed: number)`、`dimensionScore(score, dim)`、`DIMENSIONS`(7 维 as const);`buildBlindPool(abDir: string): Promise<{ items: number; pairs: number }>`(逻辑照旧:MATCHID 头校验后剥除、Math.random 洗牌不可复现、mapping.json 落盘)。CLI 均以 `AB_DIR` 覆盖、默认 `abDir(resolveEvalHome(), <--ab 参数>)`。

- [ ] Step 1(控制器):CLEAN 核验;复制两件到位。
- [ ] Step 2(实现方):import/路径面改写 + 统计函数具名导出(main 保留);零逻辑改动(尤其:盲评洗牌**必须**保持无种子 Math.random——注释已说明原因)。
- [ ] Step 3(契约,数学 golden):

```ts
it("signTestP 精确二项:全正 3 → p=0.25;对称 1+1- → p=1;tie 剔除", () => {
  expect(signTestP([1, 1, 1]).p).toBeCloseTo(0.25, 10);
  const s = signTestP([1, -1]);
  expect(s.p).toBeCloseTo(1, 10);
  expect(signTestP([1, 0, -1]).ties).toBe(1);
  expect(signTestP([]).p).toBe(1);
});
it("bootstrapCI 确定性:同种子同输入两次同值;常数样本 CI 退化为该常数", () => {
  const a = bootstrapCI([0.5, 0.5, 0.5], makeRng(1337));
  expect(a.lo).toBe(0.5);
  expect(a.hi).toBe(0.5);
  const b1 = bootstrapCI([1, -1, 2, 0], makeRng(42));
  const b2 = bootstrapCI([1, -1, 2, 0], makeRng(42));
  expect(b1).toEqual(b2);
  expect(b1.lo).toBeLessThanOrEqual(b1.hi);
});
it("dimensionScore:prompt 侧优先,response 侧回落,非数值 null", () => {
  expect(dimensionScore({ prompt: { noise: 4 }, response: {} }, "noise")).toBe(
    4,
  );
  expect(
    dimensionScore({ prompt: {}, response: { accuracy: 3 } }, "accuracy"),
  ).toBe(3);
  expect(
    dimensionScore({ prompt: { noise: "x" }, response: {} }, "noise"),
  ).toBeNull();
});
```

另 `buildBlindPool` 集成断言:tmp 目录造 2 ordinal × 双臂(带 MATCHID 头)→ items=4、`blind/items/item-0*/{prompt,response}.txt` 存在、response 已剥头、mapping.json 覆盖全部且 blindId 互异;造一个 MATCHID 与 index 不符的响应 → 该 ordinal 被剔除。

- [ ] Step 4: 全绿 → Commit `feat(eval): blind AB pool + paired stats port`。

---

### Task 7: judge 校准移植

**Files:** Create `src/judge/buildCalibrationSuite.ts`、`src/judge/checkCalibration.ts`、`scripts/{buildCalibration,checkCalibration}.ts`;Test `test/calibration.test.ts`

**Interfaces:** Consumes Task 4 run 目录布局(prompts/responses/index.json)。Produces `buildCalibrationSuite(baseDir: string, opts: { sourceCount: number; seed: number }): Promise<CalibrationCase[]>`(7 缺陷类:fabricated-claim/duplicated-noise/severity-labels/shuffled-events/removed-deaths/wrong-outcome/trivia-focus + none 对照;LCG 种子可复现;manifest 盲评隔离)与 `checkCalibration(baseDir): Promise<{ pass: boolean; failures: … }>`(perturbed 必须低于 none 同源件的目标维度)。**v1 无被排除缺陷类**(7 类均 feature 无关——spec 排除条款对现集合空转,计划记录此事实)。

- [ ] Step 1(控制器):CLEAN 核验;复制两件到位。
- [ ] Step 2(实现方):import/路径面改写 + 构建/判分函数具名导出;零逻辑改动。
- [ ] Step 3(契约):

```ts
it("固定种子:每源产 none 对照 + 若干扰动件;扰动件与原文不同;manifest 全覆盖", async () => {
  const base = makeTmpRunWithTwoPairs(); // helper:2 份 prompt/response + index.json
  const cases = await buildCalibrationSuite(base, { sourceCount: 2, seed: 42 });
  const byOrdinal = groupBy(cases, (c) => c.sourceOrdinal);
  for (const group of Object.values(byOrdinal)) {
    expect(group.some((c) => c.perturbation === "none")).toBe(true);
    for (const c of group.filter((c) => c.perturbation !== "none")) {
      expect(c.targetDimension).toBeTruthy();
      const perturbed = readCase(base, c.caseId);
      const original = readCase(
        base,
        group.find((g) => g.perturbation === "none")!.caseId,
      );
      expect(perturbed.prompt + perturbed.response).not.toBe(
        original.prompt + original.response,
      );
    }
  }
  const again = await buildCalibrationSuite(makeTmpRunWithTwoPairs(), {
    sourceCount: 2,
    seed: 42,
  });
  expect(again.map((c) => c.perturbation)).toEqual(
    cases.map((c) => c.perturbation),
  ); // 种子可复现
});
it("checkCalibration:目标维度未降分的扰动件 → FAIL named", async () => {
  // 手写 scores/:none 全 4 分;fabricated-claim 件 accuracy 也 4(未降)→ 该件在 failures
});
```

- [ ] Step 4: 全绿 → Commit `feat(eval): judge calibration suite port`。

---

### Task 8: 溯源校验移植(mjs → TS,含点名收紧)

**Files:** Create `src/provenance/checkScoreProvenance.ts`、`src/provenance/judgeSpotAudit.ts`、`src/provenance/calibrateAuditor.ts`、`scripts/checkProvenance.ts`;Test `test/provenance.test.ts`

**Interfaces:** Produces `checkScoreProvenance(runDir: string): { ok: number; fail: number; failures: { file: string; reason: string }[] }`——对每个 `scores/*.json`:① provenance 块存在且 `promptSha256`/`responseSha256` 与 run 目录对应文件实测 sha256 相等、`judgeModel` 非空;② 7 维每维在 prompt/response 侧至少一处为 1–5 整数;③ `factAudit` 数组 ≥3 条且每条有 `claim`/`verdict`。任何一项不满足 → 该文件 FAIL(**点名适配:无 legacy 宽容**)。`judgeSpotAudit`/`calibrateAuditor` 照旧源移植(agy 调用外置于工作流文档,模块只做用例抽取与植入)。

- [ ] Step 1(控制器):CLEAN 核验;复制三件到位(.mjs 逐字转 .ts,加最小类型注解)。
- [ ] Step 2(实现方):路径面改写 + 点名收紧(见 Interfaces)+ 具名导出。
- [ ] Step 3(契约):tmp run 目录 helper 造 prompt/response 文件后:

```ts
it("合法 score(真 sha256+7 维+factAudit×3)→ ok", …);
it("缺 provenance → FAIL reason 含 provenance", …);
it("sha256 不匹配(prompt 改一字节)→ FAIL", …);
it("缺 1 维(删 focusCalibration)→ FAIL reason 含维名", …);
it("维度值 6(越界)→ FAIL", …);
it("factAudit 只有 2 条 → FAIL", …);
```

(每用例 5–8 行,写全:构造 score JSON、落盘、断言 `checkScoreProvenance(dir).failures`。)

- [ ] Step 4: 全绿 → Commit `feat(eval): score provenance validation (strict, no legacy leniency)`。

---

### Task 9: 三条工作流文档(控制器改写)

**Files:** Create `docs/commands/{eval-baseline,eval-ab,calibrate-judge}.md`、`.claude/commands/{eval-baseline,eval-ab,calibrate-judge}.md`(薄指针,格式照旧 fork:frontmatter description + "Follow the workflow in docs/commands/….md exactly")

- [ ] Step 1(控制器):CLEAN 核验三份旧工作流文档;改写并落盘——命令名/路径全部替换为本计划 CLI(`npx tsx packages/eval/scripts/…`)与 eval-home 布局;rubric 文本(7 维锚定、factAudit 规程、score JSON 契约)逐字保留;responder/judge 子代理扮演机制与"judge 以文件写工具落 score、不经 stdout"约定照旧;台账追加行规程指向 `$GLADLOG_EVAL_HOME/ledger.md`;裁决纪律(INCONCLUSIVE 依确定性理由 ADOPT 须记账)保留。
- [ ] Step 2(控制器):自查三文档无旧仓路径残留(`grep -n "wowarenalogs\|local-batch" docs/commands/eval-*.md docs/commands/calibrate-judge.md` 零命中)。
- [ ] Step 3: Commit `docs(eval): baseline/AB/judge-calibration agent workflows`。

---

### Task 10: 收官——端到端冒烟 + 台账 + 双 review

**Files:** Modify `README.md`(路线图 4b 注记)、`.superpowers/progress.md`;私仓实际 init。

- [ ] Step 1(端到端冒烟,控制器):`GLADLOG_EVAL_HOME=$(mktemp -d)/home` → init → 用 parser 真实日志固件跑 `buildCorpus` → `qualityCheck` → 手工造 1 份合法 + 1 份坏 score → `checkProvenance` 一过一拒 → tmp AB 双臂(同一语料复制两臂)→ `blindPool` → 手填 scores → `abStats` 出全 0 Δ 表。全链退出码逐一核对。
- [ ] Step 2: 真私仓 `~/code/gladlog-eval-private` init(git init + ledger 表头);不放语料(用户语料迁移是使用期动作,不在本计划)。
- [ ] Step 3: 双 review(agy,降级链照旧):T3-8 合并 diff review + 全分支终审;findings 闭环。
- [ ] Step 4: 台账 4b 完成条目 + README 子项目 4 整体勾选(4a+4b 均 ✅)+ Commit `docs: sub-project 4b complete`。

```

## Self-Review 记录

- Spec 覆盖:三工作流(T9)、五模块(T3-8)、私仓+resolver(T2/T10)、score 契约(全局约束+T8)、错误处理四条(T2 resolver 拒跑/T8 严格校验/T6 指纹在 T4 落盘+对比拒绝写在工作流文档 T9/T7 校准再生)、测试策略五条(T6 golden/T7 植入缺陷/T5 fixture 覆盖率/T8 坏文件/T4 语料 e2e)。指纹不匹配拒对比:执行点在 abStats CLI——已并入 T6 Step 2 范围(mapping/指纹核对属路径面)。✔
- 占位符扫描:T8 Step 3 的省略号用例已注明"写全"要求,属契约条目列表非 TBD;无其他。✔
- 类型一致性:IndexEntry 五字段 T4 定义、T5/T6/T7 消费一致;CoverageManifest T3 → T5;resolveEvalHome/runDir/abDir T2 → T4/T6。✔
```
