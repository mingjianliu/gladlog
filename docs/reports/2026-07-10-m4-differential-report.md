# M4 差分对齐报告(新 parser + compat vs 旧管线)

状态:**完成**(2026-07-10)。

## 方法

- **Oracle**:旧 fork 私有运行旧 parser(合法私用);差分工具驻旧 fork `scratch/parser-diff/`(不入本仓库)。
- **Level-1 核心事实**:规范化 JSON(对局切分/名单/spec/teamId/胜负/真死亡/伤害治疗总量)逐字段比对。
- **Level-2 下游消费面**:双侧输出喂同一个 React-free `buildMatchContext`,prompt 行级 diff + 三类分桶:
  `numericDrift`(骨架同、数字异)/ 枚举顺序(canon 规则消除)/ `STRUCTURAL`(逐桶抽查裁决)。
- **裁决原则**(spec):旧 parser 非无条件真理;每个分歧按原始日志仲裁;新侧正确的记 NEW_CORRECT 不迁就。

## 裁决台账(全档,编号对应旧 fork scratch/parser-diff/adjudications.md)

| #     | 规则/发现                                                                                    | 处置                                       |
| ----- | -------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1-5   | early_leaver 整场丢弃、2024 金额错乱、playerId 缺失(旧缺陷);CI 固定索引(新,已修)             | NEW_CORRECT ×3 + 新侧修复 ×2               |
| 6     | 旧惯例:伤害负号 + absorb 以正数混编攻击方 damageOut                                          | compat 复刻                                |
| 10/12 | SWING_DAMAGE_LANDED 双计(新,已修);事件名保真(新,已修)                                        | 新侧修复                                   |
| 13    | effective=amount−overkill−absorbed;absorb 归攻击者、数额取 absorbed 参数                     | compat 复刻                                |
| 14    | 旧存在无法用原始参数解释的 periodic 清零                                                     | NEW_CORRECT,白名单 = Σ(旧 eff=0 行 amount) |
| 16-18 | 宠物/守卫并入主人;宠物目标行 eff 零化;SPELL_SUMMON 建立图腾归属                              | compat/parser 复刻+修复 → **治疗完全对齐** |
| 19    | 旧的 absorbed 扣减跨日志年代自相矛盾(EU 扣/CN 不扣,每法术统一偏移 5-13%)                     | 冻结:新侧语义为准                          |
| 20-23 | 下游契约:advancedActions 形状 / logLine.parameters / CombatantInfo 精确形状 / spellId 字符串 | compat 复刻(4 项)                          |
| 24-25 | damageIn 无 absorb 混编;spellSchoolId 十六进制字符串                                         | compat 复刻                                |
| 26    | 防御重叠(GS+Evasion)新侧检出、旧侧漏报,原始行实证                                            | NEW_CORRECT                                |

## T1-200 结果(分层:90 3v3 / 80 shuffle / 30 2v2,seed 20260710)

### Level-1 核心事实(600 场对局/回合)

- **结构完全一致:599/600(99.8%)**。唯一剩余 = shuffle round 双死亡 0.75s 间隔的胜负案:原始 CI 实证**新侧正确、旧侧判错**(裁决 #30)。**未裁决差异 = 0,验收达成。**
- 治疗总量:中位偏差 0.00%,p90 0.00%,99% 单位 ≤2%。
- 伤害总量(#14 白名单后):中位 2.74%,p90 11.06%——残差全部归因于旧管线的 absorbed 扣减跨年代自相矛盾(#19,冻结)与 periodic 清零(#14),新侧语义可用原始日志逐行验证。
- 旁观者渗漏 12 例由 #27 过滤修复后清零。

### Level-2 下游消费面(600 份 buildMatchContext prompt)

- 行差异 31.4%(33,236/105,717):**numericDrift 23,727(71%,#14/#19 已裁决类)+ 结构 9,509(29%)**。
- 结构 census 全部归因(每桶抽查锚定原始日志):
  - 施放清单卫生:旧侧同技能自相矛盾重复条目 438 行(#28,NEW_CORRECT)
  - 压力/idle 窗口与 [MATCH TYPE] 分类器在数字漂移下的阈值翻转(#14/#19 联动)
  - 防御重叠/PANIC TRADING 检出:新侧多检出的重叠经原始行实证真实存在(#26,NEW_CORRECT)
- 结论:**没有一类 Level-2 分歧指向新 parser 的解析错误**;全部为(a)已裁决的旧管线缺陷,或(b)其数字在下游阈值边缘的确定性联动。

### 对齐验收裁定

spec 标准"每个差异都被裁决、未裁决差异数为 0"达成。M4 完成;伤害口径的系统性结论(新侧更准)已录入,供子项目 4 数据再对齐期设定预期。


## 对子项目 4(下游移植)的含义

- compat 已复刻的旧惯例(负号、混编、宠物并入、零化、字符串 id)使旧下游代码**无需修改语义即可运行**。
- NEW_CORRECT 类差异意味着移植后:aborted shuffle 会出现、压力/伤害数字整体略高且更准、部分旧漏报的分析时刻会新增——**benchmark/阈值重跑时的漂移来源以此为主**,与 roadmap spec 披露的"数据再对齐期"一致。
- 旧管线确认缺陷清单(供直觉校准):early_leaver 丢场、2024 版本金额错乱、periodic 清零、absorbed 扣减不一致、防御重叠漏报。
