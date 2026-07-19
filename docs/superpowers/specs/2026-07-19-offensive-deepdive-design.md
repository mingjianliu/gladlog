# 进攻深挖(非死亡 finding 深挖)设计

**目标:** 让深挖轮(deepDive 多轮追问)也覆盖非死亡 finding,用与死亡路径**镜像**的进攻证据平衡当前偏重死亡窗口的教练——非死亡失误也能拿到深挖席位并被讲透。

**架构:** 新增一个「进攻 pack 构建器」兄弟 + 一个分发器,复用现有 `deepen()` / `buildDeepDivePrompt` / `auditDeepDives` 脚手架;**生存(死亡)路径完全不动**,对刚验证过的死亡深挖零回归。

**技术栈:** TypeScript monorepo。分析在 `packages/analysis`,深挖服务在 `packages/desktop/src/main`,触发在 renderer。eval 谐波在 `packages/eval/scripts`,产物在 `$GLADLOG_EVAL_HOME`(默认 `~/code/gladlog-eval-private`)。

## 全局约束

- **谓词单源铁律**:进攻 pack 只消费 `analyzeBurstLedger` / `analyzeOutgoingCCChains` / `computeOffensiveWindows` / `getHpPercentAtTime` —— 与 `candidateFindings.ts` 生成同类候选时**同一批谓词**,不新算任何事实。见 CLAUDE.md「门规谓词即规范」。
- **占位符纪律**:深挖叙述里所有数字必须是 `{{key.field}}` 占位符,claimChecker 之后才插值;名字用 `sn()` 去 realm 数字;不把结构化数值编进 key 名(HP/命中率/DR 拆成独立占位字段)。见 [[gladlog-deepdive-eval]]。
- **类型检查** `npm run typecheck`(绝不 `tsc -b`)。desktop push 前:`npm test --workspace=packages/desktop && npm run typecheck && npx eslint packages/desktop/src --quiet`。
- **深挖构建器在 `packages/analysis` 内**,用相对 import 取 utils 谓词(无需从 index 导出)。
- eval 子代理 responder/judge 一律 sonnet;跨 AI = sonnet + gemini(agy);agy 输出重定向到文件(勿 `| tail`)。

---

## 背景 / 现状

深挖现状(死亡向):

- `buildDeepDivePack(combat, finding, findingIndex, candidates, ownerName?)` 围绕 finding 引用事件 `[minT-30, maxT+10]` 收**生存证据**:友方受控(`analyzePlayerCCAndTrinket`)、友方防御+timing(`annotateDefensiveTimings`)、敌方进攻 CD、owner HP、驱散、owner 走位(修 3)。
- `hasCoachableSignal` 判「我方可控失误」:防御交早/晚、≥3s 硬控饰品该交没交、低优先级驱散废 GCD、走位失误。
- renderer(`StructuredAnalysisPanel.tsx`)按 `SEVERITY_RANK` 排序 findings,取前 `DEEP_DIVE_MAX=2` 个过门的构 pack,一次 `deepen()` 调用。`death` 候选 severity=high,几乎霸占 2 席。

非死亡候选类型**已存在**(`candidateFindings.ts`,各自带进攻事实):

| type                           | 触发条件(已 pre-curate)                            | 自带 facts                                              |
| ------------------------------ | -------------------------------------------------- | ------------------------------------------------------- |
| `unconverted-burst`            | 爆发未转化击杀且无免疫                             | target, damageM, hpStart, hpEnd, defensive, allyAligned |
| `burst-into-immunity`          | 主目标在爆发内挂免疫                               | target, immunity, overlap                               |
| `off-target-in-window`         | kill window 内命中窗口目标占比过低                 | target, onTargetPct, offTarget                          |
| `juked-kick`                   | 打断被假读条骗掉                                   | kick, fake                                              |
| `dr-clipped-cc`                | owner CC 落在 25%/Immune DR                        | spell, target, dr                                       |
| ~~`cd-waste`~~ **(排除,见下)** | 从不使用的**生存**大招(纯防御墙),whole-round `t:0` | spell, unit(healer)                                     |

**scope 修正(spec 自查发现):** `cd-waste` **不进本设计**。两个原因:(1) 它是
whole-round 观察(`t:0`,`cdWasteEvents` 注释「whole-round observation, not
time-specific」),窗口式 pack 构建器过滤 `c.t > 0` 会直接判 null,无时间锚点可深挖;
(2) 它其实是「从不使用的**生存**防御墙」(healer 锚定,`isThroughput` 排除),
本质是生存类而非进攻失误。故进攻深挖覆盖**5 类窗口式非死亡失误**:unconverted-burst
/ burst-into-immunity / off-target-in-window / juked-kick / dr-clipped-cc。cd-waste
若要教练需另立 whole-round 机制(记 backlog,非本设计)。

可复用谓词(均在 `packages/analysis/src/utils/*`,已被 candidateFindings 使用):

- `analyzeBurstLedger(owner, allies, enemies, combat)` → burst 窗口,每个含 `dominantTarget`{`hpStartPct`, `hpEndPct`, `damage`, `defensivesHit`[{spellName, isImmunity, overlapSeconds}]}, `allyCDsOverlapping`, `spells`。
- `analyzeOutgoingCCChains(friends, enemies, combat)` → 我方对敌 CC 链(target, applications[{casterName, spellName, atSeconds, drInfo.level}])。
- `computeOffensiveWindows(enemies, friends, combat)` / `auditWindowTargeting` → 进攻窗口 + 命中审计。
- `analyzeKickAudit(owner, enemies, combat)` → 打断审计(juked)。
- `getHpPercentAtTime(unit, t, startTime)` → 任意单位某刻血量(死亡路径已用)。
- `isHealerSpec(spec)` → 定敌方奶。

---

## 组件

### 1. `buildOffensiveDeepDivePack(combat, finding, findingIndex, candidates, ownerName?): DeepDivePack | null`

新函数,与 `buildDeepDivePack` 兄弟,输出**同一个 `DeepDivePack` 形状**(`deepen`/`prompt`/`audit` 全部复用)。窗口锚定同死亡路径:`[min(eventIds.t)-30, max(eventIds.t)+10]`,`inWin` 过滤。

窗口内收集(全部进 facts,数值走占位符,名字 `sn()` 短名):

- **`target-hp`** — 敌方目标血线轨迹:窗口内 `getHpPercentAtTime(target, tPt)` 打点(mirror owner-HP 拆分),facts `{t, hp, unit=sn(target), role:"enemy-target"}`。
- **`enemy-defensive`** — 接爆发的防御(非免疫):来自 ledger `dominantTarget.defensivesHit.filter(!isImmunity)`,facts `{t, spell, unit=sn(target), role:"enemy"}`。
- **`immunity`** — 免疫:`defensivesHit.filter(isImmunity)`,facts `{t, spell, unit=sn(target), overlap, role:"enemy"}`。
- **`our-cc`** — 我方对**敌奶**的外放 CC:`analyzeOutgoingCCChains` 筛 target=敌 healer 且 caster∈friends,窗口内,facts `{t, spell, unit=sn(enemyHealer), caster=sn(caster), role:"owner"|"teammate"}`。
- **`our-cd`** — 我方进攻大招对齐:窗口内我方进攻 CD 施放(`extractMajorCooldowns` 进攻 tag,或 ledger `allyCDsOverlapping`),facts `{t, spell, unit=sn(caster), role:"owner"|"teammate"}`。
- **分类型专属条目**(承接候选自带 facts):
  - unconverted-burst → `off-target` 若命中问题;核心是 target-hp + enemy-defensive 组合。
  - burst-into-immunity → `immunity` 条(overlap 秒)。
  - off-target-in-window → `off-target` 条 facts `{t, onTargetPct, target=sn, offTarget=sn(offTarget), role:"owner"}`。
  - juked-kick → `juked-kick` 条 facts `{t, kick, fake, role:"owner"}` + 窗口内附近敌方读条(`our-cd` 不适用,拉 enemy hard-cast 上下文)。
  - dr-clipped-cc → `dr-clip` 条 facts `{t, spell, target=sn, dr, role:"owner"}`,复用 `our-cc` 的 CC 链上下文。

**执行两类(juked-kick / dr-clipped-cc)拿子集**:它们是点事件,不铺完整镜像——juked-kick 拉附近敌方读条,dr-clip 拉 CC 链。转化三类(unconverted-burst / burst-into-immunity / off-target)拿完整镜像。(cd-waste 已排除,见背景 scope 修正。)

每类 `try/catch` 独立,缺高级日志/几何则该类缺席(同死亡 pack)。截断复用死亡 pack 的「靠近焦点时刻」逻辑(`PACK_MAX_ITEMS`)。

`PackItem.kind` union 扩展:`| "target-hp" | "enemy-defensive" | "immunity" | "our-cc" | "our-cd" | "off-target" | "juked-kick" | "dr-clip"`。

### 2. 分发器

`buildDeepDivePack` 与 `buildOffensiveDeepDivePack` 上层加路由:对每个 finding,查其 `eventIds` 引用的候选 `type`——

- 命中 death/death-setup → 生存构建器 + `hasCoachableSignal`。
- 命中 5 类窗口式非死亡之一 → 进攻构建器 + `hasOffensiveCoachableSignal`。
- 混合 → 取主导(引用候选多数派;平票偏死亡,死亡教练价值锚定更强)。

分发器放 renderer 选择逻辑里(见组件 4),不进构建器内部(职责分离,同修 1 门放调用方)。

### 3. `hasOffensiveCoachableSignal(items: PackItem[]): boolean`

平行 `hasCoachableSignal`。非死亡候选已 pre-curate 为失误,门轻——要求进攻故事在场:

- 有 `target-hp` 触底到某阈值(如 ≤35%)**且**有 `enemy-defensive` 或 `immunity` 接了 → 「该换/该等/该控奶」故事成立;或
- 有 `off-target` 条(命中率已低于 good);或
- 有 `juked-kick` 条;或
- 有 `dr-clip` 条。
  判据全用 pack facts,与候选 pre-curate 同源。

### 4. 席位选择(renderer,`StructuredAnalysisPanel.tsx`)

- 生存:仍按 severity 取前 `DEEP_DIVE_MAX=2` 个过 `hasCoachableSignal` 的。
- **保底 1 席**:在非死亡 findings 里选最优的 1 个(过 `hasOffensiveCoachableSignal`;多个时按候选 severity/damage 排序取 top-1)。
- 合并 ≤3 个 pack,**一次** `deepen()` 调用。`DEEP_DIVE_MAX` 语义不变(生存上限),新增常量 `OFFENSIVE_DEEP_DIVE_MAX=1`。

### 5. Prompt 扩展(`buildDeepDivePrompt`)

同一个 prompt 同时容生存 + 进攻 pack(都进一次 deepen)。加:

- 进攻条目图例(HARD RULES 加一行,解释 target-hp/enemy-defensive/immunity/our-cc/our-cd/off-target/juked-kick/dr-clip 各是什么、role 语义)。
- 进攻教练框架:"you had the kill set up — coach what to change to close it(swap to the exposed target, hold burst past the immunity, lock their healer first)"。
- 其余纪律不变(只引 pack 键、无裸数字、无因果、干净窗口留白、firm verdict)。
- `PROMPT_VERSION` 11→12(旧缓存失效)。

### 6. 审计

`auditDeepDives` **不变**:占位符解析 + 裸数字禁令 + causalLint + citedKeys⊆pack。进攻数值 facts(hpStart/hpEnd/onTargetPct/dr/overlap)走占位符;名字 `sn()` 短名避免 realm 数字误杀。

---

## 数据流

```
初轮 findings
  └→ 分发器(按候选 type 路由)
       ├→ 死亡类 → buildDeepDivePack → hasCoachableSignal → ≤2 生存 pack
       └→ 非死亡类 → buildOffensiveDeepDivePack → hasOffensiveCoachableSignal → ≤1 进攻 pack
  └→ 合并 ≤3 pack → 一次 deepen() → 一个 prompt(含生存+进攻段)
  └→ 模型输出 → auditDeepDives(占位符/裸数字/因果/cited)
  └→ 渲染深挖笔记 + chips(跳进攻窗口锚点)
```

---

## 测试

1. **单测**(`packages/analysis/src/analysis/offensiveDeepDive.test.ts` 或并入 `deepDive.test.ts`):
   - `buildOffensiveDeepDivePack` 在合成 unconverted-burst / burst-into-immunity fixture 上产出预期 kind + facts(target-hp、enemy-defensive、immunity)。
   - `hasOffensiveCoachableSignal`:target 触底+防御接 → true;off-target → true;juked → true;纯中性 → false。
   - 分发器路由:death finding → 生存;unconverted-burst finding → 进攻;混合 → 主导。
2. **确定性扫描**(`packages/eval/scripts/deepDiveOffensiveScan.ts`,镜像 `deepDiveScan`):对语料每个非死亡候选跑完整 buildOffensiveDeepDivePack + gate,断言无崩溃 / role 缺失 / facts↔items 不一致 / 残留数字(名字类),统计逐类型过门率、每包 mean 条数。`NUMERIC_FIELDS` 加 `hpStart/hpEnd/onTargetPct/dr/overlap`。
3. **谓词单源单测**:断言进攻 pack 的 target HP / 防御与 `analyzeBurstLedger` 同值(或直接消费,天然同源)。

---

## 大规模 A/B 测试(交付验证,用户强调)

镜像走位价值 eval(`deepDivePositionValue{Gen,Audit}.ts`),但对比的是**进攻深挖上线前后**:

- **before**:非死亡 finding 不深挖(现状——席位全给死亡,非死亡沉默)。
- **after**:进攻深挖上线(保底席 + 进攻 pack)。
- **语料**:公开对局 ≥200 场(复用 `gladlog-eval-private/corpus` 的 deepdive-2v2 / 220 / hi / public-dps ≈578 文件,去重)。
- **生成**:对每个过 `hasOffensiveCoachableSignal` 的非死亡 finding 出 v12 进攻 prompt;sonnet responder 产 deepDive JSON;回构 pack + auditDeepDives 解析。
- **盲评**:sonnet + gemini(agy)盲评 actionability 1–5;揭盲按类型(转化三类 / 执行两类)分桶。
- **对照锚**:同批死亡深挖(生存桶)进盲评,证明 judge 尺子正常 + 进攻不劣于生存。
- **指标**:
  - 产出率(过门后模型真产出 vs 诚实留白 vs 审计毙),逐类型。
  - 价值均值(combined + 逐 judge),进攻 vs 生存对照。
  - **零 filler 硬指标**(两 judge 均无 ≤2 分),同修 1+2 标准。
  - 净新增覆盖:多少非死亡 finding 现在有深挖(before 为沉默)。
- **决策规则**:进攻深挖价值均值落在可行动区(≥3.5)且零 filler → 上线成立;若某类型系统性偏低/filler → 该类型收紧门或降级(不做 spec 定制参数,用户铁律)。

---

## 边界 / YAGNI

- **不做全局锚点**(BACKLOG #13):进攻深挖仍是放大镜——只在初轮已标记的非死亡 finding 窗口内收证据,不全局扫新问题。全局发现是独立 brainstorm。
- **执行两类拿子集证据**,非完整镜像(用户确认)。
- **cd-waste 排除**:whole-round + 生存类,无窗口锚点,不进本设计(记 backlog)。
- **不做 spec 定制参数**:门阈值全 spec 无关。
- 进攻 pack 缺高级日志(无坐标/详细伤害)时优雅缺席,不抛。
