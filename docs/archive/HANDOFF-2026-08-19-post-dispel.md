# HANDOFF 2026-08-19:驱散三层收官后的接力点

> **Archived 2026-09-26** — historical handoff; paths and state may no longer match the repo.

> 接替 `HANDOFF-2026-08-17-grounding.md`(那份的 §一–§四 已全部落地或结案)。
> 本文档为新 session 自含:所有裁定、数字、方法都有 main 上的落点,不依赖
> 任何旧对话。工作分支纪律照旧:直接 commit+push main,验收先行。

## 一、已收官(2026-08-18/19 两天,均在 main)

| 主线                       | 落点                                        | 关键数字                                                                                       |
| -------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 天赋自适应冷却(#29 后续)   | `94eed173` + `07222bcb`                     | cc-avoidable 271→625;挖矿三修;串行充能谓词 `chargesAvailableAt`                                |
| 痛苦无常豁免过期(#23,已关) | `0a29c6d1`                                  | 反噬标注 540→872;「策展名单腐烂」第 4 例入 CLAUDE.md                                           |
| 虚空新星误分类             | `059cbd05`                                  | root→cc;84 个「被晕治疗没自驱」不可能指控清零                                                  |
| 驱散三层(#20,已关)         | `a838aabb`/`459ea245`/`ab48861b`/`309cb659` | missed-cleanse 全链 **705→194(−72.5%)**;签字册 `dispelVerdicts.ts` 27 行 + 三门 + 时机门(全档) |
| #13/#15 下架(已关)         | `22779c10`                                  | healer 侧 sync 1426→0;DPS 侧 juked 581→0、sync 2852→0;PROMPT_VERSION→27                        |
| #12 三张表(已关)           | 评论关账                                    | ①已修 ②`CORPUS_OBSERVED_DISPEL_IDS` 已挡 ③被三档模型作废                                       |
| firstPaint 门修判据        | `b83ee0ea`                                  | 5 样本取最小值,阈值 5200 不动;三连稳                                                           |
| 视觉基线跟进退役           | `11a5859f`                                  | 9 张,CI 生成+人工审图;CI 全绿收官                                                              |

用户裁定索引(新 session 引用时以此为准,勿重新讨论):

- DoT 暂不进驱散候选;root DR 不做(#24 留档)
- 硬控×治疗自身 = 结构性豁免(治疗被控不能自驱,两轮指正定稿)
- 时机门覆盖**全部**签字档(二次裁定「worth/must也扩上时机门」)
- #13/#15 下架;#20/#12 关闭

## 二、验收方法(常驻工具,已转正)

- `packages/eval/scripts/acceptanceHash.ts` —— healer 口径:聚合 prompt SHA256
  - 逐类候选计数,同判据前后 diff。**覆盖边界写在文件头**(看不见驱散标注
    与 TARGET SELECTION 行;DPS 类型恒为 0),拿零变化当无影响是假绿。
- `packages/eval/scripts/acceptanceDpsCount.ts` —— DPS-owner 口径逐类计数。
- 全库扫描**一次只跑一个**(32GB 机器,并行扫描已造成三次死机 —— 见
  prod-triage skill)。
- 负对照纪律:门类改动先撤线验红再上线验绿;基线由 CI 的 visual-baseline
  workflow 生成,本机绝不跑 `test:visual`。

2026-08-19 收官时的基线数字(n=300 / 1178 回合,healer 口径,供下次对照):
聚合 SHA `3b49fe01…`;missed-cleanse 194 / missed-purge 1507 / cc-locked 1730
/ cc-avoidable 632 / unsynced-burst 1359 / attempt-into-trinket 1107(全表在
`22779c10` 的 before/after 文件与各 issue 关账评论里)。

## 三、剩余工作(依赖已清,均自含于 issue)

1. **#14 cc-locked 治理**:触发 87% 且 UI 与 LLM 口径自相矛盾;零依赖。
   方法论提示:先按机会归一化再判信号(memory
   `opportunity-normalized-discrimination`,#13 的教训)。
2. **#17 DPS 视角发生率**:范围已减为**三类待拍板** —— off-target/juked 之外
   `unconverted-burst` 也已退役(`0e4c8357`,用户裁定 C:被 [KILL ATTEMPTS]
   逐尝试结果替代,v26;#17 有六类处置状态表)。剩 burst-into-immunity
   (−6.8pp 全系统最负)/ dr-clipped-cc 处置(21 条全是文档说不该出现的
   Immune 档 + 4 条解析伪影;若删除,顺带处理 `drAnalysis.ts:581`
   `hasWastedApplications` 这个未登记的手抄重复谓词)/ burst-into-mitigation
   已换三档判据无需再动。`acceptanceDpsCount.ts` 即现成工具。
3. **#21 missed-purge 价值**:零依赖 —— 本批所有改动 missed-purge 恒 1507。
4. **#16 阈值接地**:驱散侧 3s 已被三层叠加降级为反应下限(issue 有更新
   评论);其余数字待接地。
5. **#24 root DR**(用户裁定不做,留档)、**#18/#19/#22** 照旧。
6. **击杀尝试线的两个尾巴**(2026-08-18/19 重设计,台账在 #16):
   ①「无控但极高爆发」第二锚定路径未实现 —— 用户判据是「看大技能使用,或
   dps 事后的分布」,主判据(窗内有进攻大招)零发明数字可直接做,辅判据的
   速率分位要接地(killAttempts.ts 头注释有 scope 留档);② 旧 KILL WINDOW
   / 脆弱窗 prompt 块与 [KILL ATTEMPTS] 并存,去留未拍板;③ 天赋减伤表
   `talentMitigationGenerated.json` 还有 8 条 pendingRuling(技术边角,
   低优先,队列随每次数据刷新重算不会丢)。

## 四、未结疑点(小,按发现顺序)

- **Ice Block 官方数据 240s vs 12.1 攻略「3 分钟」**:无消费方受影响(它只
  进 healer owner 的规避路径),未查证。下次 update-wow-data 时顺带核。
- `196363`(TWW 时代的 UA 反噬 id)在名表里解析为 "Eye Beam" 且语料零出现,
  疑似当年就登记错;无时代语料可证,原样保留在 `BACKLASH_CC_SPELL_IDS`。
- desktop 测试在 CI 有过两次「本地绿 CI 红」的单测闪红(StructuredAnalysisPanel
  warn、devpanel.detail),两次都不同文件、同 SHA 本地全绿;未立案,再现
  第三次再立 flaky 台账。
