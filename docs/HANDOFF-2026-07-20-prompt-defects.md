# HANDOFF 2026-07-20 — prompt 数据缺陷修复

> 上下文压缩前的交接。**从「未完成」一节往下照做即可续跑。**

## 一句话现状

50 场 healer eval 挖出 8 类 prompt 自相矛盾缺陷;**A 类(最大,31/50 场)已修并进 main,
其余 7 类未动**。端到端 A/B 验证尚未做。

---

## 已完成(全部已在 main)

| commit     | 内容                                                                              |
| ---------- | --------------------------------------------------------------------------------- |
| `132b3da`  | 模型下拉 + 本地后端透传 `--model` + **bad-json 围栏容错**(claudeCli 误杀率 25%→0) |
| `43c6e2e`  | 纯地图档高度可调 + finding chip 技能图标                                          |
| `18d5fad`  | `npm run presubmit` 一键门禁 + `modelFormatAudit.ts`                              |
| `9b8e40d`  | 重生成 `report-replay` / `settings` 视觉基线                                      |
| _(待提交)_ | **A 类修复:HP 采样半径单源谓词** — 见下                                           |

### 已验证的三层结果

1. **千场管线体检**(`pipelineFuzz --run fuzz-2026-07-20-postchange`):1000 场
   **0 解析失败 / 0 异常**;229 条 CJK 全是玩家名;07-17 的宠物名泄漏未复发。
2. **模型输出形态**(`modelFormatAudit`,52 场):claudeCli 修前误杀 **25%**、
   agy 2.5% → 修后**均 100%**,零未知形态。
3. **healer eval**(`runs/2026-07-20-smoke`,50 场):见 `eval-report.md` + `ledger.md`。

---

## A 类修复(本次改动,待提交)

**根因(读代码坐实,非推测)**:`cooldowns.ts` 的 `HP_SAMPLE_RADIUS_MS` docstring
明文规定 `[STATE]` tick 与 `[DMG SPIKE]` 端点必须同半径。后来 `matchTimeline.ts`
为关键窗口加了**局部常量** `HP_SAMPLE_WINDOW_CRITICAL_MS = 1500`(理由正当:密集
1s tick 不该重复取样),**但只改了 STATE 一侧**。而 DMG SPIKE 只发生在关键窗口
→ 两者必然取到不同样本 → 同一秒两行 HP 打架。

**修法**:半径改为随时刻取值的共享谓词。

- 新增 `hpSampleRadiusMs(tSeconds, criticalWindowSeconds)` @ `packages/analysis/src/utils/cooldowns.ts`
- 新增 `HP_SAMPLE_RADIUS_CRITICAL_MS = 1500`(原局部常量提升为 export)
- `matchTimeline.ts`:删除两个局部常量,STATE tick 改调谓词
- `matchTimelineSections.ts`:`emitDmgSpikeEntries` 新增入参 `criticalWindowSeconds`,
  两处 `getUnitHpAtTimestamp` 改用谓词
- 回归测试:`packages/analysis/src/utils/hpSampleRadius.test.ts`(6 条,含反作弊用例
  「两个半径常量不许相等」)
- `npm run presubmit` exit=0(analysis 633 / desktop 335)

---

## 未完成 —— 剩余 7 类缺陷

按性价比排序。每条都附了**实例**与**建议改哪里**。

### B 基线百分位倒置(11/50 场)★ 次高优先

`INCOMING DAMAGE BASELINES` 表中特定 spec 行 `p50 > p90`。
实例:MM 猎人 `p50 214k | p90 65k`,**同表其它行正常** → 特定行错位,非算法坏。

- 查 `packages/analysis/src/utils/specBaselines.ts`
- **修完加确定性不变量**:`packages/eval/scripts/qualityCheck.ts` 加「所有 pXX 序列
  必须单调不减」。这条能挡整类回归,且不依赖模型。

### C / C2 同秒 HP 冲突的其它面(6 场 / 2 场)

- **C**:`[CD]`/`[RES]` 行内嵌 `(X% HP)` 与同秒 `[STATE]` 冲突,最大差 **13pp**,
  且出现在决定性死亡前 2 秒(ord 014 三处实例)。
- **C2**:DEATH 块逐秒 HP 轨迹与相邻 STATE 冲突。
- **很可能与 A 同根因** —— 先查这些渲染点是否也各自传半径常量;若是,同样改调
  `hpSampleRadiusMs`。修 A 时我只改了 DMG SPIKE 一处,**C/C2 未查**。

### E/G 记号无图例(9 场)

`[1/2]` charges 语义(已用 1 / 余 1?)、`rdy:Δ`、窗口时长口径。

- 在 prompt 图例段补定义。另外 ord 001 指出:**`DMG SPIKE` 的时间戳标的是窗口
  起点还是终点,图例从未说明** —— 代码里是 `pw.fromSeconds`(起点)而 HP 显示
  `hpFrom -> hpTo`(终点在 `toSeconds`),这本身就容易误读,值得在图例讲清。

### F DR 标注不一致(1 场)

DR 百分比与观测到的 CC 实际时长对不上;**玩家自施 CC 行缺 DR 标注**(敌方施放的行有)。
后者是信息缺口 + 不对称,诱导模型把敌方行语义迁移到自己身上(ord 008 初稿踩过)。

### H 时长/结束时刻自相矛盾(1 场)

dampening 段报 `37s`,`MATCH FACTS`/`[MATCH END]` 报 `0:36`。

### D 冷却台账自相矛盾(1 场)

死亡块冷却台账与「DEATHS WITH MISSED OPTIONS」标注对同一冷却的可用性判断相反。

### I OFFENSIVE WINDOW 语义/数值可疑(1 场,ord 017)

- `[OFFENSIVE WINDOW]` 总伤害与一个**不相关的更早 `[DMG SPIKE]`** 完全相同
  (同单位、不同窗口,均 0.66M)→ 疑似陈旧/复用未清。
- 其 target 单位语义易误读 —— ord 017 的 responder **因此写错结论**,accuracy 判 3。
- 另外它精选的 `KILL SEQUENCE` **漏掉真正的直接死因**(victim 身上的 Kidney Shot),
  却摆出一个无关的、更早的、落在治疗身上的 CC。

---

## 如何做端到端 A/B(尚未做)

**这是防 regression 的关键一步,别跳过。**

用 `/eval-ab` 受控 A/B,同一批语料:

- arm A = 修前(`18d5fad`)
- arm B = 修后

**判据要用确定性指标,不要用七维分数**(见下方「已知陷阱」):

> `promptDefects` 里 A 类的独立场次数应从 **31 → 0**。

语料已就绪,**不需要重建**:

- 清单 `corpus/manifest-smoke-2026-07-20.txt`(从 `corpus/fuzz-1000` 等距抽 50)
- run 目录 `runs/2026-07-20-smoke/`,fingerprint `be78167b..2faaf381`
- `selected.json` = 评测用的前 50 条

---

## 已知陷阱(今晚踩过,别重蹈)

1. **七维分数不可作跨 run 绝对刻度** —— 本轮未跑 `/calibrate-judge`,judge 间口径
   不一致(同一个 A 类缺陷,ord 030/031 扣 `inferenceScaffolding`,多数场不扣)。
   要绝对刻度必须先补校准。
2. **缺陷线 ≠ 分数线** —— 46/50 场报了缺陷,却只有 1 场 flagged。原因是 responder
   多数情况自行绕开矛盾数据,`accuracy` 反而高分。**缺陷必须单独收集**
   (judge 指令里的 `promptDefects` 字段就是为此加的)。
3. **`promptDefects.kind` 要给受控词表** —— 本轮没给,40+ 种拼写描述同几类缺陷,
   需事后归一。下轮直接给枚举。
4. **聚合前先确认没有在飞的子代理** —— 本轮我在还有 judge 在跑时就聚合、发布数字、
   让 agy 复核,结果 041 第三次重派落盘后两维均值变了(noise 4.36→4.38,
   scaffold 4.66→4.64),已在 `eval-report.md` 加勘误段。
5. **派 judge/responder 时 NNN 写错没有任何东西能当场挡住** —— responder 有
   `MATCHID:` 头可交叉校验,judge 没有等价自检。派发后务必跑 ordinal 完整性检查。
6. **本机 jsdom 没有 `localStorage`,CI 有** —— 依赖持久化的测试会「本地红 CI 绿」。
   已在 `test/report.replaysplit.test.tsx` 加内存 shim。
7. **`report-*` 视觉基线改了 report UI 就要重生成** —— 走 `visual-baseline.yml`
   (artifact 上传,需手动下载提交),本机跑 `test:visual` 必假红。

## 工程约定

- 提交:**直接 commit + push 到 main**,不建分支不开 PR;CI 红了再修
- 提交前:`npm run presubmit`(= lint + typecheck + 全 workspace test + verify:vision + 生产打包)
- eval 产物在 `$GLADLOG_EVAL_HOME`(默认 `~/code/gladlog-eval-private`)
- responder/judge 批量子代理一律 **sonnet**;agy 用于跨 AI 复核
