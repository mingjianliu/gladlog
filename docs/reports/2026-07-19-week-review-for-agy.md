# 近 7 日 commit 复核报告(2026-07-13 → 07-19)—— 交 agy 审核

**状态**:已跨 AI 定稿(Claude Opus 4.8 出稿 → agy / Gemini 3.5 Flash 复核,
verdict=REQUEST_CHANGES)。原 11 条**全部判成立**,agy 另加 2 条,我采纳 1 条半、
并反驳了它对 P2#6 的错误理由。最终 13 条待办见文末。**代码一行未动。**

下文 P1/P2/P3 保留出稿时的原始论证(含当时对 agy 的提问),复核结论集中在
「agy 复核结论」一节 —— 这样能看出哪些担心是被排除的,哪些是被证实的。

## 复核范围与方法(诚实说明)

- 范围:`51221c0^..HEAD`,261 个 non-merge commit,347 文件,+51969/-5625。
- **我没有逐 commit 读 diff**。这个体量下逐 commit 读会读成流水账,所以我按风险分层:
  对聚合后的净 diff,挑「新增核心逻辑 + CLAUDE.md 点名过的历史 bug 类型」深读源码,
  其余(docs/plans、eval 脚本、生成数据 json、样式)只扫结构。
- 重点读过的文件:`deepDive.ts`、`burstLedger.ts`、`positionAnalysis.ts`(局部)、
  `candidateFindings.ts`(dpsOwnerEvents)、`healerExposureAnalysis.ts`(常量段)、
  `desktop/src/main/analysis.ts`、`StructuredAnalysisPanel.tsx`、`GcdSwimlane.tsx`、
  `log-pipeline/{flusher,collectLogs,protocol/reconstruct}.ts`。
- **没深读**:eval 的 20+ 个 deepDive* 脚本、renderer 的 20 个新 derive 模块、
  arenaFloors/spellIcons 生成数据、styles.css(+2776)。这些是覆盖缺口,不是清白证明。
- `npm run typecheck` 当前全绿。以下结论都不是编译错误,是语义问题。

---

## P1 —— 正确性,建议下个 release 前处理

### 1. STAYED_IN「没掉血也开深挖门」:注释承诺的 HP 门根本不存在

- `packages/analysis/src/analysis/deepDive.ts:642`
- `packages/analysis/src/utils/positionAnalysis.ts:305-350`

`hasCoachableSignal` 里写着:

```ts
// 走位失误(修 3):STAYED_IN 已经只在掉血时触发,MISSED_PUSH/空放皆真失误。
if (it.kind === "position") return true;
```

但 `computeOwnerPositionEvents` 生成 STAYED_IN 时,`hpStart`/`hpMin` 只是**算出来填进
字段**,`events.push` 前没有任何基于 HP 的过滤 —— 判据仍是纯几何(`delta <
STAY_DELTA_YARDS`)。同一文件的 context formatter 更是反证:

```ts
// positionAnalysis.ts:671-673
: e.ownerHpMinPct >= 85 && (e.ownerHpStartPct ?? 100) - e.ownerHpMinPct < 15
  ? " (no real cost)"
```

代码自己承认「没有真实代价的 STAYED_IN」是存在的、并且要专门打标签。

**后果**:深挖门(修 1 的整个卖点是「干净窗口不值得一轮模型调用」)在走位这一路
被完全绕开 —— 一个 HP 100%→98% 的 STAYED_IN 就能开门,换来一次付费调用 + 大概率
filler 段落。这正好侵蚀 memory 里记的 filler 2.62→5.0 那个成果。

**建议**:二选一,别再靠注释。

- (a) 在 `hasCoachableSignal` 里对 `kind=stayed-in` 加 HP 条件,阈值复用 formatter
  的 `(no real cost)` 判据并 export 成单一谓词;`missed-push`/`cd-out-of-range` 保持直通。
- (b) 或在 `computeOwnerPositionEvents` 源头就不发无代价 STAYED_IN —— 但注意
  formatter 依赖它渲染「低危」标签,改源头会改动 prompt 文本,需要跑一轮 eval。

**倾向 (a)**,因为门的职责本来就在调用方(f379503 自己写的「门移到调用方」)。

**请 agy 重点核**:有没有第三处调用方已经做了这个 HP 过滤而我没找到?我 grep 过
`ownerHpMinPct` 的全部消费点,只有 deepDive 的 facts 填充和 formatter 的标签。

### 2. 全程免疫的爆发,`burst-into-immunity` 检测不到

- `packages/analysis/src/utils/burstLedger.ts:174-215`
- `packages/analysis/src/analysis/candidateFindings.ts:432-437`

`defensivesHit` 只在 `dominantTarget` 非空时才计算,而 `dominantTarget` 来自
`damageByTarget[0]` —— 也就是**必须有伤害记录**才存在:

```ts
const top = damageByTarget[0];
if (top) {
  /* 这里面才算 defensivesHit / 免疫 */
}
```

`damageOut` 由 parser 的 `record.damage` 分支填充(`packages/parser/src/l3/collect.ts:50`),
`SPELL_MISS`(IMMUNE)不带 `damage`,所以进不去。于是:

- 免疫**中途**才挂上 → 前半段有伤害 → dominantTarget 存在 → 免疫被抓到 ✅
- 免疫在爆发**开始前**就挂着(无敌泡/冰箱全程罩住)→ 该目标零伤害记录 → 若玩家没打
  别人则 `dominantTarget = null`,若打了别人则主目标变成别人 → **免疫完全不可见** ❌

漏掉的恰好是最该教的那一档:「敌方无敌还没转好你就开了大」。deepDive.ts:655 的注释
说 burst-into-immunity 是「旗舰进攻失误」,但它在最典型的形态下检测不到。

**建议**:免疫判定不要挂在 dominantTarget 上。爆发窗口内,对**所有敌方玩家**跑一次
`buildAuraIntervals(..., DEF_OR_IMMUNE_IDS, ...)`,只要有免疫与 span 重叠且该单位是
「爆发意图目标」(可用施法目标/上一窗口目标/最近 targeting 审计结果)就出条目。
需要先定义「意图目标」谓词 —— 这是设计取舍,请 agy 给方案意见,别直接实现。

**请 agy 重点核**:parser 是否真的完全不产免疫 miss 的 damage 记录?我只读了
`l3/collect.ts` 的 damage 分支,没追到 l1/l2 的事件分类。若 l2 把 IMMUNE miss
归成 `amount=0` 的 damage 记录,这条整个不成立。

### 3. `focusT` 在「死亡贴近比赛结束」时系统性偏早(最常见的那个 finding 首当其冲)

`packages/analysis/src/analysis/deepDive.ts:243`

```ts
const anchorTo = Math.min(durS, Math.max(...ts) + PACK_AFTER_S); // 被 durS 夹住
const focusT = anchorTo - PACK_AFTER_S; // 反推回锚点
```

`focusT` 想表达的是「锚点时刻」= `Math.max(...ts)`,但从被 clamp 过的 `anchorTo`
反推回去,clamp 一旦生效就推不回原值。

举例:锚点 t=100s、比赛 durS=105s → `anchorTo = min(105, 110) = 105` →
`focusT = 95`,比真锚点早 5 秒。于是:

- HP 检查点从 85/90/95 变成 80/85/90 —— **prompt 里那三个「死前血线」全部错位**;
- 截断排序 `Math.abs(a.t - focusT)` 也围着错的中心排,可能把死亡瞬间的证据挤出 14 条上限。

竞技场里决定性死亡本来就发生在比赛末尾(死亡往往就是比赛结束原因),所以
`max(ts) + 10 > durS` 不是边角情况,是**最重要那条 finding 的常态**。

同一文件的进攻路径写的是 `const focusT = Math.min(...ts);`(deepDive.ts:604)——
两条路径对「焦点」的定义本身也不一致(一个偏末锚点、一个偏首锚点)。

**建议**:`const focusT = Math.max(...ts);` 直接用锚点,不要从 anchorTo 反推。
同时统一两条路径的 focusT 语义,或注释写明为何进攻用 min、生存用 max。
`deepDive.test.ts` 现有用例的 `anchorTo` 都没触发 clamp(150 / 50),**加一条
`durS < max(ts)+10` 的回归用例**。

---

## P2 —— 健壮性 / 重复付费 / 规范违反

### 4. 047b5c0 只保护了首轮,`deepen` 仍会被切页重复触发(重复付费调用)

- `packages/desktop/src/renderer/src/report/components/StructuredAnalysisPanel.tsx:263-320`
- `packages/desktop/src/main/analysis.ts`(`running` 集合只在 `run` 里维护)

深挖的触发逻辑在 renderer 的 effect 里,条件是 `result && !result.deepened`。
`deepened` 标志由主进程 `writeMerged` 落盘。所以在 deepen **在飞**的那几十秒里,
缓存里的 `deepened` 仍是 falsy —— 此时用户切走再切回,面板重挂、`getCached` 拿到
初轮结果、effect 再次触发 → **第二次 deepen**。主进程的 `nextGen(matchId)` 会把
第一次判过期 abort,但那次调用的 token 已经花掉了。

这和 047b5c0 修的「病根2」是同一类,只是这次漏在 deepen 上(`running` 集合只有
`run` 会 add,`isRunning` 因此对 deepen 恒为 false)。

**建议**:`deepen` 里也 `running.add`(或另开 `deepening` 集合 + `isDeepening(matchId)`
IPC),renderer 的 effect 在触发前先查一次。

### 5. `getCached` → `isRunning` 之间的窗口会把结果漏掉,面板停在空闲态

`StructuredAnalysisPanel.tsx:160-183`

```ts
const cached = await bridge().analysis.getCached(matchId);
if (cached) { … } else if (await bridge().analysis.isRunning(matchId)) { setState("running"); }
```

两次 await 之间如果分析恰好完成:`getCached` 返回 null(那一刻还没写盘),
`isRunning` 返回 false(已经清了),done 事件也早在订阅建立前发完了 →
**面板停在空闲态,而结果其实已经躺在缓存里**,用户看到的还是「点我分析」大按钮。

窗口很窄,但这正是 047b5c0 要根治的那个用户体感(「切回来就没了」)。

**建议**:`isRunning` 返回 false 的分支里再 `getCached` 一次;或让主进程提供一个
原子的 `getState(matchId) → {cached, running}` 单次 IPC,从根上消掉这个缝。

### 6. 门规常量靠注释耦合 —— 直接违反 CLAUDE.md 的明文规则

- `packages/analysis/src/utils/healerExposureAnalysis.ts:44-51`
- `packages/eval/src/quality/positioningScan.ts:65-66`
- `packages/analysis/src/utils/positionAnalysis.ts:51`、`ccTrinketAnalysis.ts:45`

```ts
// These two constants MUST stay equal to TIME_SLACK_SECONDS /
// POSITION_MAX_GAP_MS in packages/eval/src/quality/positioningScan.ts.
const LOS_SWEEP_SLACK_S = 2;
const LOS_SWEEP_GAP_MS = 3_000;
```

**当前值是对的**(2 == 2、3000 == 3000,我核过)。问题是耦合方式:CLAUDE.md 写得
一字不差 ——「谓词放一处 export,两边 import;**做不到时写断言相等的单测,别靠注释**」。
这里既没 export 也没单测,只有注释。而且 `POSITION_MAX_GAP_MS = 1_500` 这个名字在
`positionAnalysis` / `healerExposureAnalysis` / `ccTrinketAnalysis`(前缀 CC_)三处
各自私有声明,与 positioningScan 里同名但值为 `3_000` 的常量**同名不同义**,读代码时
极易看串。

考虑到 CLAUDE.md 记录的历史代价(2026-07 审计 5 个 bug 全是这一类,其中就有
「小数秒 vs 渲染秒扫描网格」),这条不该留着。

**建议**:把 `TIME_SLACK_SECONDS` / `POSITION_MAX_GAP_MS` 提到共享模块 export,
两边 import;至少补一个断言相等的单测。顺手给那三个 1_500 改个不撞名的名字
(如 `INTERP_MAX_GAP_MS`),消除同名不同义。

### 7. 用户可见文本存在两套时间渲染,且 `fmt` 被复制了两份

- `packages/analysis/src/analysis/deepDive.ts:39`
- `packages/analysis/src/analysis/candidateFindings.ts:24`(一字不差的重复定义)
- `packages/analysis/src/utils/cooldowns.ts:1165` `fmtTime`

```ts
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));  // → "83.5"
export function fmtTime(seconds) { … }                                        // → "1:23"
```

同一份报告里,timeline / burst ledger 用 `fmtTime` 渲染成 `1:23`,而 finding 与
deepDive 正文经占位符插值后写的是 `83.5`。用户要在两种刻度间自己换算。CLAUDE.md 的
「锚定在渲染值上」讲的就是这件事 —— 目前门规复算不出问题(facts 自洽),但表层不一致
仍在,且 `fmt` 复制两份意味着下次改一处必漏一处。

**建议**:`fmt` 提到一处 export 两边 import(这条无争议,建议直接做);
是否统一到 `fmtTime` 属产品决策 —— 会改 prompt 文本、需要跑 eval,**请 agy 只给意见
不要动**。

---

## P3 —— 卫生项(低优先,可攒着一起做)

8. **`GcdSwimlane.tsx:94-137`**:`orderedTracks` / `cols` 是裸表达式,每次 render 都是
   新数组身份,所以依赖它们的 `useMemo` **永远不命中**,布局计算每帧重跑;三处
   `eslint-disable-next-line react-hooks/exhaustive-deps`(:136/:145/:153)正好把这个
   信号盖住了。建议 `orderedTracks`/`cols` 也 useMemo,然后去掉 :136 那个 disable。
   (:145/:153 的 disable 是有意的「只在 t/nonce 变化时滚动」,那两个合理,保留。)

9. **`desktop/src/main/analysis.ts`**:`generations` Map 只增不删,长会话里每个看过的
   matchId 留一个条目。量很小,但既然 `running` 会清,顺手在 `finish` 里把已完成且
   无人引用的代际也清掉更整齐。

10. **`burstLedger.ts:281-283`**:`targetDeathMs` 用
    `deathRecords.map(...).find(t => t > fromMs)` 取「窗口后第一次死亡」,这依赖
    `deathRecords` 已按时间升序。若上游不保证有序,这里拿到的不是最早那次。建议改
    `Math.min(...filter(...))` 或在类型/注释里把有序性写成契约。

11. **`deepDive.ts` 截断与门的顺序**:`PACK_MAX_ITEMS = 14` 的截断发生在
    `hasCoachableSignal` 之前(门在调用方)。理论上唯一那条可教条目可能被截掉,
    导致本该深挖的 pack 被判定为「干净窗口」。目前排序按「靠近 focusT」,可教条目
    通常离锚点近,所以概率低。**只是提请注意,不建议现在改** —— 改了要重跑 eval。

---

## 我认为没问题的部分(供 agy 交叉验证,别浪费时间重看)

- `log-pipeline` 的 `flusher.ts` / `collectLogs.ts` / `protocol/reconstruct.ts`:
  读得比较细。截断收缩检测、部分读循环、advance-by-actual、gunzip 失败 defer、
  重叠自愈都处理到位;`remaining` 在每条 continue 路径前都 delete,循环可终止。
  没找到问题。
- 047b5c0 的代际分桶本身(全局计数器 → 按 matchId Map)方向正确,病根 1 确实是这个。
  问题只在它没覆盖 deepen(见 P2#4)和那个 await 缝(P2#5)。
- `offensivePackItems` 的 role 全名比较(0b6d8df)、`burst-start` 条目补 `inWin`
  守卫:这两处是上一轮 agy 复核采纳项,改法正确,注释也留了理由,很好。

---

## agy 复核结论(2026-07-19,Gemini 3.5 Flash Medium,verdict=REQUEST_CHANGES)

**11 条全部判「成立」**,含三条 P1 的否定性证据 —— agy 独立追了调用链验证:

- **P1#1**:全库搜 `computeOwnerPositionEvents` 调用点(含 `buildMatchContext.ts`、
  `deepDivePositionProbe.ts`),确认**不存在第三处做 HP 过滤的调用方**。我的担心排除。
- **P1#2**:追到了我没追的那一层 —— `parseLine.ts` 里 `SPELL_MISSED` 因不以 `_DAMAGE`
  结尾而根本不填 `result.damage`,所以 `damageOut` 拿到 0 条记录。链路闭合,结论成立。
- **P1#3**:验算与我一致(100s/105s → focusT=95s,HP 检查点 80/85/90)。并给出统一语义
  建议:生存 `Math.max(...ts)`(锚死亡/高潮),进攻 `Math.min(...ts)`(锚起手),
  **两条路径语义本就应该不同,不要强行统一**,只是别再从 clamp 过的 anchorTo 反推。

agy 另跑了 `npm run typecheck`(0 error)与 parser/parser-compat/log-pipeline 单测(184 passed)。

### 对 agy 的一处反驳:P2#6 的理由错了(结论仍成立)

agy 写:「the analysis module uses 1500 ms while the evaluation scanner uses 3000 ms,
creating discrepancies in positioning validation」——**这是误读,当作 drift 证据会误导修法**。

实际是两个不同谓词:

- `healerExposureAnalysis.LOS_SWEEP_GAP_MS = 3_000` ←→ `positioningScan.POSITION_MAX_GAP_MS = 3_000`,
  **这一对是相等的**,是 LoS 扫描谓词,没有 drift。
- 那三个 `1_500` 是另一件事(插值 grounding 守卫),本来就不该等于 3000。

所以 P2#6 的问题**纯粹是耦合方式**(靠注释 + 同名不同义),不是「当前值已经漂了」。
修法仍按原建议:export 单源 / 补断言相等单测 / 给 1_500 改名去掉撞名。

### agy 新增两条 —— 我的采纳判定

#### 新#1 `auditDeepDives` 的占位符正则与 claimChecker 不同源 → **采纳**

- `packages/analysis/src/compare/claimChecker.ts:1` — `/\{\{\s*([\w.]+)\s*\}\}/g`(**容忍空格**)
- `packages/analysis/src/analysis/deepDive.ts:780` — `/\{\{(p\d+)\.[^}]+\}\}/g`(**不容忍前导空格**)

我核过了,两条正则确实不同源。模型若输出 `{{ p1.t }}`:claimChecker 认、裸数字检查也
认(`replace(/\{\{[^}]*\}\}/g," ")` 能吃掉空格),唯独 `usedKeys` 抓不到 →
`citedKeys` 为空时整条被静默丢弃;不为空时 chips 退化成只认 citedKeys,
**正好把 0b6d8df「chips 取 citedKeys ∪ usedKeys 防跳错时刻」那个修补悄悄废掉**。

这是标准的「同一事实两个谓词」,正是 CLAUDE.md 反复点名的类型。建议 `usedKeys`
直接复用 claimChecker 的 `PLACEHOLDER`(export 出来),别自己再写一条。
定级 P2 —— 触发条件依赖模型写空格,prompt 没要求也没禁止,概率未知但代价是静默丢内容。

#### 新#2 effect 缺 cancelled 守卫 → **部分采纳(agy 的描述夸大了)**

`StructuredAnalysisPanel.tsx:109-118` 的 `getFlags` effect 确实没有 `cancelled` 标志,
快速切场时旧场的 flags 可能后到并覆盖新场 —— **这条成立**,P3 级,照 :160 那个
effect 的写法补个 `cancelled` 即可。

但 agy 把 `:85-107` 的 `aggregate` effect 也算进去,说会「overwrite the goals for
Match C with Match A's」—— **不成立**。`aggregate()` 不接受 matchId 参数,返回的是
跨场全局聚合,A/C 两次调用拿到的是同一份数据,先后到达不会显示错内容。
真要说问题只是「依赖 `[matchId]` 导致每次切场白重取一次」,那是浪费不是 bug,P3 都算不上。

---

## 待办清单(跨 AI 定稿 13 条 —— 执行结果)

11 条已落地并各自 commit,每条都验证过测试对旧实现报错(不是「写完就绿」的假测试)。

**已完成**

| # | 内容 | commit |
| --- | --- | --- |
| P1#3 | focusT 锚最末锚点,不从被 clamp 的 anchorTo 反推 | `536295c` |
| P2#4 | deepen 幂等守卫(切页不再重复烧 token) | `ce33ef9` |
| P2#5 | 面板重挂改单次原子 getState | `d4bf4b4` |
| P2#6 | 位置采样谓词单源 export + 改名去撞名 | `46fc19a` |
| 新#1 | 占位符正则从 claimChecker 单源取 | `5845f95` |
| P3#8 | GcdSwimlane 布局 memo 真正生效 | `1da25f9` |
| P3#9 | 代际条目回收(仅在该场静默时) | `8a37def` |
| P3#10 | 目标死亡截断取最早一次,不依赖有序 | `624952c` |
| 新#2 | getFlags 补 cancelled 守卫(后半条驳回) | `90a1e36` |
| P2#7 | fmt 提取单源 fmtFactNum(统一 fmtTime 不做) | `dd428dd` |
| P1#1 | STAYED_IN 需付真实代价才开深挖门 | `800fd71` |

**已出设计,未实现**

- P1#2 全程免疫检测 → `docs/specs/2026-07-19-immunity-detection-design.md`。
  写 spec 时有个关键发现,把它从「设计取舍」降级成了有直接证据的问题:
  **免疫消掉的是伤害,不是施法** —— `spellCastEvents` 逐条带 `destUnitId`
  (`convert.ts:383`),对着无敌泡砸下去的每一发都留有目标记录。所以「爆发意图
  目标」不需要启发式猜测,直接查施法目标即可。spec 里仍有几个必须先定的数
  (`INTENT_MIN_CASTS`、宠物施法是否计入),留给确定性扫描定标,别在代码里随手拍。

**评估后不做**

- P3#11 截断(PACK_MAX_ITEMS=14)发生在门之前,理论上唯一那条可教条目可能被截掉。
  排序按「靠近 focusT」,可教条目通常离锚点近,概率低;改了要重跑 eval。只留记录。
- P2#7 后半:把 facts 的 `83.5` 统一到 fmtTime 的 `1:23`。属产品决策,会改 prompt
  文本。改为在模块注释与单测里把两套刻度的差异钉住,防止有人「顺手统一」。

**P1#1 的效果如实记录**(确定性扫描,4 语料 556 pack,不调模型):

| 语料 | packs | 含走位 | stayed-in | 无代价 | 过门翻转 |
| --- | --- | --- | --- | --- | --- |
| deepdive-220 | 179 | 19 | 17 | 2 | 0 |
| deepdive-hi | 191 | 23 | 21 | 3 | 0 |
| deepdive-2v2 | 136 | 24 | 20 | 1 | 0 |
| public-dps | 50 | 10 | 8 | 1 | 1 |

7 个无代价 STAYED_IN 里只有 1 个真正改变过门结果(556 分之 1)—— 其余 6 个包内
另有信号,本来就该开门。**这条的收益不是省调用,是拆掉一个假前提**:门此前依赖
一句与代码矛盾的注释,一旦有人放宽 STAYED_IN 的几何判据,门会静默失效而没有任何
测试拦得住。

**遗留的环境问题(未处理,等确认)**

`.claude/worktrees/report-ui-redesign/` 是个残留 git worktree,内含全套陈旧副本。
从仓库根跑 `npx vitest` 会扫到它、并用根配置去跑,产生与当前改动无关的失败
(本次排查中误导过两次)。`npm test --workspace=...` 不受影响。建议清掉。
