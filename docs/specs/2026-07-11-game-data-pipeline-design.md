# 子项目 5:游戏数据管线 设计

日期:2026-07-11。前置:子项目 1–4 完成。用户已授权本 spec 决策按 Recommended 自选并记录(用户就寝,事后可改)。

## 目标

权威数据管线替换 4a 时期的占位符与最易错的手工数据:wago.tools DB2 CSV(暴雪公开游戏数据)+ raidbots 静态天赋 JSON → 生成器产出 gladlog **既有目标形状**(消费方零改动);UI 接线具名天赋与法术图标。

**范围外**:全量 spellId→图标映射与离线图标预取(v1 只做天赋图标 + 目录内法术)、zone geometry(已有 CLEAN 移植件)、走位回放 v2、Blizzard Game Data API 源(debate 驳回:OAuth 门槛/限流/无 DB2 保真度)。

## 关键决策(自选 + debate 修订)

| 决策点     | 定案                                                                                                                                                                                                                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 分工       | **判断层人工、机械层机器**:大保命/DR 类目等判断型目录保持人工策展(上游同样如此,BigDebuffs 社区数据),管线对其只做**构建校验**(id 仍存在于 SpellName.csv,更名/移除报人工复核);CD/时长/驱散类型/名称/饰品/天赋树为机械层,机器生成                                                               |
| 合规       | 4 个上游生成器**清洁室重写**(只依据 gladlog 既有输出契约 + wago 公开表结构,不读上游源);自有 2 件:generateTrinketItemIds(CLEAN 直移)、generateTalentModifiers(NEEDS_SCRUB 按审计刮迁);update-wow-data 工作流文档 CLEAN 改写                                                                   |
| 候选集     | IMinedSpell 挖掘白名单 = 策展目录 id ∪ raidbots active 天赋 spellId ∪ **PvpTalent.csv spellId**(debate 修订:PvE 树不含 PvP 天赋,漏之则竞技场解析器致盲)                                                                                                                                      |
| 双层数据   | `spellEffectData` = 生成基础层(DB2 原值)+ `SPELL_EFFECT_OVERRIDES` 策展覆盖层**优先**——4a 手工校准的 PvP 修正值(炉火时长等)保留;utils 本就日志实测优先、静态时长仅兜底。**已知维护税(debate 终判)**:PvP 时长修正无法纯管线自动化,override 层是长期人工责任,每次 benchmark 发现偏差就地补条目 |
| 落点       | 生成器 = `packages/analysis/scripts/datagen/*.ts`(tsx CLI,collectBenchmarks 惯例);产物 JSON/TS 进公仓(客观游戏事实),同名同形状原位替换                                                                                                                                                       |
| 图标       | icon name → zamimg CDN,**首次拉取后落盘缓存**(desktop main 进程 userData 下),离线且未缓存时降级文字;不入库暴雪美术(公仓 MIT,分发即侵权——debate 驳回其"提交图片"钢人)                                                                                                                         |
| spellNames | wago SpellName.csv 再生(enUS 单语、压缩行);dev 首载若仍慢,运行时优化进遗留                                                                                                                                                                                                                   |

## 架构与组件

### 生成器(`packages/analysis/scripts/datagen/`)

| CLI                     | 输入(wago.tools CSV / raidbots)                                                                                                       | 产物(既有形状)                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `fetchTalents.ts`       | raidbots `static/data/live/talents.json`                                                                                              | `data/talentIdMap.json`(原样落盘,talentStrings.ts 已实现解码)                    |
| `genSpellNames.ts`      | `SpellName.csv`                                                                                                                       | `data/spellNames.json`(id→enUS 名,压缩)                                          |
| `genSpellEffects.ts`    | `SpellCooldowns.csv`、`SpellDuration.csv`、`SpellMisc.csv`、`SpellCategories.csv`、`SpellCharges?`(以 wowdev.wiki 表结构为准)+ 候选集 | `data/spellEffectGenerated.ts`(`Record<string, IMinedSpell>` 基础层)             |
| `genSpellClassMap.ts`   | `SkillLineAbility.csv`+`SkillLine.csv`(职业关联为表内直接编码,无启发式)                                                               | `data/spellClassMapGenerated.ts`(现 drCategories 的 DR 表**不**由此生成——判断层) |
| `genTrinketItemIds.ts`  | `ItemSparse.csv`(自有件直移)                                                                                                          | `data/trinketItemIds.json`                                                       |
| `genTalentModifiers.ts` | talentIdMap + spellEffects(自有件刮迁)                                                                                                | `data/talentModifiers.json`                                                      |
| `validateCatalogs.ts`   | `SpellName.csv` + 全部策展目录                                                                                                        | 校验报告:策展 id 失效/更名清单(非零退出)                                         |

公共层:`datagen/lib/wagoCsv.ts`(build 查询、CSV 拉取与解析、缓存到临时目录)、`datagen/lib/emit.ts`(形状断言:条目数下限、必填字段,不合格不落盘)。纯变换函数与 fetch 分离;测试用入库 fixture CSV 切片(每表几十行),真实拉取只在手动工作流。

### 数据接线

- `spellEffectData.ts` 改为:`{...GENERATED, ...SPELL_EFFECT_OVERRIDES}`(覆盖层优先),导出面不变。
- dispelType 整数映射按 wowdev.wiki 文档枚举(1=Magic 2=Curse 3=Disease 4=Poison),golden 断言钉死(Polymorph→Magic、Curse of Tongues→Curse)。
- 4a 的数据校准断言(221+)作为替换回归门:换数据后全套 analysis 测试必须绿。

### UI 接线(desktop renderer)

- UnitPanel:`talentStrings` 解码天赋串 → 具名天赋列表(名称来自 talentIdMap entries;PvP 天赋名来自 mined 名称表)。
- `SpellIcon` 组件:icon name → 主进程 `gladlog:icon:get`(缓存命中读盘,未命中拉 zamimg 落盘)→ data URL;失败降级为首字母块。
- 时间轴/meters 图标 v1 仅覆盖目录内法术,其余无图标(不留破图)。

### `update-wow-data` 工作流(docs/commands/,CLEAN 改写)

查 wago builds API 最新 retail build → 与产物内记录的 build 比对 → 逐生成器跑(失败即停)→ `validateCatalogs` → 全套测试 → git diff --stat 汇总汇报。

## 错误处理

- 拉取失败/CSV 形状意外 → 生成器非零退出,不写半成品(emit 层形状断言)。
- 策展目录 id 在新 build 失效 → validateCatalogs 报清单,人工裁决(更名跟进/移除)。
- 图标拉取失败 → 缓存不写入,UI 降级文字,不重试风暴(会话内失败记忆)。

## 测试策略

- 每个纯变换函数:fixture CSV 切片 → golden 产物断言(含 dispelType 枚举 golden)。
- emit 形状断言:构造不足条目/缺字段输入 → 拒绝落盘。
- 双层合并:override 优先的合并语义单测(同 id 两层并存时覆盖层赢)。
- 回归门:真实产物落盘后全仓测试绿(4a 校准断言)。
- UI:SpellIcon 缓存命中/未命中/失败降级三态(mock 主进程 bridge);UnitPanel 具名天赋渲染(desktop fixture 的天赋串)。

## Debate 记录(agy Gemini 3.1 Pro,2026-07-11,三轮)

OPPOSE→PARTIAL→CONCEDE。让步给对方:①判断型目录不可机器推导——改为"判断层人工+管线只校验"(命中);②图标 CDN 与 local-first 矛盾——改为拉取即落盘缓存(命中;其"提交图片入仓"钢人以版权驳回);③PvP 天赋不在 raidbots PvE 树——候选集并入 PvpTalent.csv(命中,结构性修复);④PvP 时长修正不可纯自动化——双层数据 override 优先,**并接受终判:override 层是项目终身维护税**。守住:wago.tools 源(vs Blizzard API 钢人:OAuth/限流/保真度);dispelType 映射非盲猜(wowdev.wiki 文档 + golden 断言)。
