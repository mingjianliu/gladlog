# 全程免疫的爆发检测(burst-into-immunity 盲区)设计

**目标:** 让「敌方无敌还开大」这条旗舰进攻失误在**最典型的形态**下也能被检测到 ——
目前只有免疫**中途挂上**才抓得到,免疫在爆发**开始前就罩着**时完全不可见。

**架构:** 把免疫判定从 `dominantTarget`(伤害派生)解耦,改挂在**施法目标**上。
不新增分析器,只改 `burstLedger.analyzeBurstLedger` 的目标推导;
`candidateFindings.dpsOwnerEvents` 与进攻深挖 pack 消费面不变。

**技术栈:** `packages/analysis/src/utils/burstLedger.ts`(主改动),
`packages/analysis/src/analysis/candidateFindings.ts`(消费面),
eval 确定性扫描在 `packages/eval/scripts`,语料在 `$GLADLOG_EVAL_HOME`。

## 全局约束

- **谓词单源铁律**(CLAUDE.md):免疫区间必须继续走 `buildAuraIntervals(unit,
DEF_OR_IMMUNE_IDS, combat.endTime)`,不得另写一套 aura 扫描。`overlapSeconds`
  的舍入(`Math.round(ms/100)/10`)与 `MIN_DEFENSIVE_OVERLAP_S` 保持不变 ——
  candidateFindings 的 `overlap` facts 与门规都按当前值复算。
- 新增谓词一律 export,消费方 import;不靠注释耦合(周度复核 P2#6 的教训)。
- `npm run typecheck`(绝不 `tsc -b`)。

---

## 背景 / 病根

`analyzeBurstLedger` 里,免疫与防御的检测**整体嵌在 `dominantTarget` 非空的分支内**:

```ts
const top = damageByTarget[0];
if (top) {
  // defensivesHit / isImmunity 只在这里算
}
```

而 `damageByTarget` 来自 `player.damageOut` —— parser 侧 `record.damage` 只在
事件名以 `_DAMAGE` 结尾(或 SWING_DAMAGE)时才填(`l1/decoders.ts` 的
`hpTailSlice`、`l3/collect.ts:50`),`SPELL_MISSED`(IMMUNE)不产生任何伤害记录。

于是:

| 场景                       | damageOut 有记录? | dominantTarget | 免疫可见? |
| -------------------------- | ----------------- | -------------- | --------- |
| 免疫中途挂上(前半段有伤害) | 有                | = 免疫单位     | ✅        |
| 免疫全程罩着,玩家硬打它    | **无**            | `null`         | ❌        |
| 免疫全程罩着,玩家切了别人  | 有(打在别人身上)  | = **别人**     | ❌        |

漏掉的第二、三行恰好是最该教的那一档。`deepDive.ts` 的注释称
burst-into-immunity 是「旗舰进攻失误」,但它在最典型形态下检测不到。

**跨 AI 复核已确认**(agy/Gemini flash 独立追了 `parseLine.ts` → `collect.ts`
→ `decoders.ts` 三层):免疫 miss 不会被归成 `amount=0` 的伤害记录,盲区成立。

---

## 关键发现:施法目标在免疫时依然有记录

免疫消掉的是**伤害**,不是**施法**。`ICombatUnit.spellCastEvents`
(由 `unit.casts` 转换,`convert.ts:383`)逐条带 `destUnitId` / `destUnitName`,
对着无敌泡砸下去的每一发技能都留有目标记录。

这把「爆发意图目标」从一个**需要启发式猜测**的设计难题,变成了**有直接证据**的
查询 —— 这是本设计与周度复核报告初稿的关键差异(报告当时把它列为「需先定义
意图目标谓词、属设计取舍」,现在不必猜)。

---

## 设计:目标推导改为「伤害优先、施法兜底」

`analyzeBurstLedger` 每个 burst 内:

1. **保持现状**:按 `damageOut` 聚合 `damageByTarget`,取 `top` 为主目标。
2. **新增兜底**:当 `damageByTarget` 为空(全程免疫、玩家没切目标),
   改用窗口内 `spellCastEvents` 中 `destUnitId` 命中敌方玩家、出现次数最多的
   那个单位作为 `dominantTarget`,`damage: 0`。
3. **新增旁证**:即使 `top` 存在,也扫一遍窗口内施法目标集合;若某个**非 top**
   的敌方单位在窗口内被施法 ≥ `INTENT_MIN_CASTS` 次且全程挂着免疫,
   单独产出一条 `wastedOnImmuneTarget` 记录(覆盖第三行:开大砸进无敌、
   发现打不动才切人)。

`dominantTarget` 的类型需要一个来源标记,消费方与门规才能分辨证据强度:

```ts
dominantTarget: {
  ...
  /** damage = 由伤害聚合得出;casts = 全程零伤害,由施法目标兜底(免疫/完全被挡)。 */
  derivedFrom: "damage" | "casts";
}
```

### 待定(实现前必须定,别在代码里随手拍)

- `INTENT_MIN_CASTS` 取值。建议 2:单发可能是误触/AoE 溅射,连续两发才算意图。
  **需用确定性扫描定标**(见验证)。
- 自身增益类 CD(Avenging Wrath / Combustion 等)的 `destUnitId` 是自己或
  `0000000000000000`,必须**排除**在意图推导之外 —— 只统计目标为敌方玩家的施法。
- 宠物施法(`petSpellCastEvents`)是否计入。倾向**不计**:宠物目标常滞后于主人,
  会稀释意图信号。
- 全程免疫但玩家**只放了一发**就切人 —— 这其实是**打得好**(试探后立刻换端),
  不该报。`INTENT_MIN_CASTS` 正是拦这个的闸,取值不能太低。

---

## 影响面

| 消费方                                                      | 影响                                                                                                                                                                                                                    |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `candidateFindings.dpsOwnerEvents` 的 `burst-into-immunity` | 命中率上升(这是目的)。facts 结构不变。                                                                                                                                                                                  |
| 同处 `unconverted-burst`                                    | 需确认:`derivedFrom: "casts"` 且 `damage: 0` 的 burst **不应**再报 unconverted(它没转化是因为免疫,已由 immunity 条覆盖,`isBurstConverted` + `!defensivesHit.some(isImmunity)` 现有过滤应已排除,但要加测试钉住,别双报)。 |
| 进攻深挖 `hasOffensiveCoachableSignal`                      | `immunity` 单独即过门,已有逻辑,不改。                                                                                                                                                                                   |
| `formatBurstLedgerForContext`                               | `damage: 0` 时 `fmtM` 会印 `0.00M`,读起来像 bug。需改成「零伤害:全程被免疫挡下」的措辞。                                                                                                                                |
| 报告 UI `BurstLedgerCard`                                   | 同上,零伤害 burst 的展示需要一句人话。                                                                                                                                                                                  |

---

## 验证(实现前后都要跑)

1. **确定性扫描定标**(不调模型,4 语料):统计
   - 现状 `burst-into-immunity` 候选数;
   - 改后候选数,按 `derivedFrom` 分列;
   - `INTENT_MIN_CASTS ∈ {1,2,3}` 各自的候选数与「只放一发就切人」的误报数。
     目标:选一个把误报压到 ~0 又能捞回盲区的取值。
2. **单测**:三行场景各一条(中途挂上 / 全程罩着硬打 / 全程罩着后切人),
   外加「试探一发即切人不报」的负例。
3. **不双报**:同一 burst 不得同时产 `unconverted-burst` 与 `burst-into-immunity`。
4. 全语料 `npm test --workspace=packages/analysis` + `typecheck` + `eslint`。

---

## 不做

- 不改 parser 让 `SPELL_MISSED` 产伤害记录。那会污染所有伤害统计
  (DPS、占比、meter),代价远大于收益,且违反「effectiveAmount 即真实伤害」的语义。
- 不引入「玩家当前目标」概念(日志无 target-change 事件,只能从施法反推)。
- 不动 `MIN_DEFENSIVE_OVERLAP_S` / `overlapSeconds` 舍入 —— 门规按现值复算。
