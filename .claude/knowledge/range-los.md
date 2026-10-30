# 射程与视野的真值

GH #83(2026-09-23)。用户裁:「射程必须修,看天赋修,不管用不用,不能我们理解是错的,其他射程距离的也修」「地图能不能也修一下」。

## 真值的来源(别处没写)

- 一次成功的友方目标施法证明那一刻射程 + 视野都成立。
- SPELL_CAST_FAILED 不带目标;但在 2v2 里,只能对友方的治疗以「目标不在视野中」失败,只可能是唯一那个队友 → 也能给出正例。工具 `losGroundTruthScan.ts`(`--out` / `--rescore` / `--offset` 做 hold-out)。
- 射程真值扫描 `spellRangeGroundTruth.ts --spells <ids>`(runbook §7b),用来确认模型真的变了。踢技射程:`kickCastSpellId` 把效果 id 映射回施法 id。

## 教训

- 正例很薄(每张图每 3k 文件约 10–80 个),**永远在不相交的 hold-out 上验**。一条在拟合样本上完美的地图规则在 hold-out 上丢了 14/33 个真遮挡,最后以「在墓穴轮廓内 = 未知」上线(日志没有 z)。
- 全图视野重描试了两次(预注册 hold-out 选择),增益在噪声内(各图选择在两轮间翻转),**没上线**。
- 召回低是测量上限,不是画得差:失败施法不带位置(边缘噪声),而大部分远距离 miss 穿过的是游戏能看穿的格子(高度、宠物目标)。没有高度模型或更好的位置时机,别重做 2D 重描。下一个杠杆是高度模型(GH #104、BACKLOG §55)。
- CC 威胁 = 射程 + 按法术实测的贴近距离;贴近距离取决于**法术**,不是施法者角色。
- `[HEAL REACH]` 用户裁不接。

## reach 表 vs 运行时所有权(GH #120,「表里有 ≠ 看得见」)

1. 专精被动在 reach 表里是死的:`talentModifierOwnershipOf` 对不在天赋树 / PvP 池的 id 答 "no"。修:生成器标 `specIds`,运行时用 `specPassiveOwned`。
2. 只经 trigger 才挂上的 SpellMod(inventory hop ≥1)属于某个光环,不是被动(某射程加成只在大招期间;DB2 时长 −1 会骗过被动检查)。genSpellReach 跳过 `triggerApplied`;buff 门控的射程未建模。
3. 占位射程(100 / 50000)在 trigger id 上继承施法父技能(真实值 > 语料观测 > 最远)。

相关:[talent-data.md](talent-data.md)、[log-observability.md](log-observability.md)
