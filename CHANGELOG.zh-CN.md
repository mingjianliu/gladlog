# Changelog

[English](CHANGELOG.md) · **中文**

每个 release 一节,列出全部改动与对应 commit(`git log v<prev>..v<new>`
口径,release/纯文档 commit 归入「其他」)。发版流程见
`.claude/skills/release`。

## v0.1.39(2026-10-28)

本版汇集八项工作。fact4 第四轮审计(69 处确认缺陷)以最后几批收尾:fact4 第 1–8 批与最终批。对上一周提交做的周审找出八个问题 —— 同一事实的两个读者口径不一、curated 扫描看不到的手工 id 表、名不副实的测试。新增一个 CI 任务,把公开的 wowarenalogs 测试日志跑过解析器与全部硬门规;另有一个变异探针,检验代码写错时有没有测试能发现。两者一起找出了:玩家从名册中掉出、中文法术名漏进 prompt、隐身在它自己的按键处就结束。fact5 第五轮双审(15 个回合、26 处缺陷)分第 1–5 批修完,每个事实类都在新的 `corpusFactScan4` 里有一项确定性检查。2026-10-24 的谓词索引裁定,把列出的每个「两个读者」事实统一为一种读法。F19 修复了 codex 读者清查找出的问题。PV463 这一批关掉了在第二份、更新的语料上仍然失败的硬门规。GH #163 把恢复德鲁伊的 Barkskin 按 PvP 下的 40 % 计。从 fact5 起,每一批都在 605 文件采集和这份 728 个较新文件的第二语料上测量;每一处增删指控的改动,都先预览、经用户批准后才落地。

要点:
- Solo Shuffle 回合对所有读者都在决胜死亡处结束 —— 时间线、定身、冷却台账、施法条、控制链、kick-eaten 以及桌面端各面板。
- 解码器读错光环列表的日志上,玩家不再从名册中掉出;玩家属于哪一方,取自日志自身的队伍字段。
- 中文或韩文客户端的法术名永远不会印出来;未知 id 回退为 id 本身。
- Aspect of the Turtle 重新算作敌方防御;Blessing of Sanctuary 解掉的控制会在 KILL ATTEMPTS 里点名,队友的区域保命(Spirit Link Totem、Rallying Cry ……)同样如此。
- 治疗增幅技能(Nature's Swiftness、Evangelism、Tip the Scales ……)与 Lifecinders 唤魔师的 Obsidian Scales 算作能帮到队友。
- 敌方治疗冷却名册加入 Evangelism、Tip the Scales、Nature's Swiftness、Divine Toll、Celestial Conduit、Frenzied Regeneration 与 Convoke。
- 被拒的就绪冷却按键,在 cd-waste、missed-cleanse、slow-defensive-response 中都算作尝试;治疗空档会列出治疗者被拒的按键。
- 第二语料:仍然失败的 7 类硬门规(49 行)现在为 0。

审稿:每一批都在落地前或刚落地后经过跨 AI(codex)审稿 —— fact4 的后续修复(20-F17-*)、fact5(20-F18-01 … 10)、F19(20-F19-01 … 09)、真实日志与谓词索引工作(30-RV-01 … 04),以及本版最后一批(20-G1 … G6)。凡是改变了输出行的发现都已修复;其余的局限记在 issue 跟踪里。

### AI 教练 —— 战报对你的评价

#### 击杀窗口、打断与保命

- `2b966ea8d` **Aspect of the Turtle 重新算作敌方防御**(fact4 D6,v0.1.38 引入的回归):按下时印一行 `[ENEMY DEF]`,KILL ATTEMPTS 也会点名它。605 文件:Turtle 的 `[ENEMY DEF]` 0 → 328,KILL ATTEMPTS 0 → 109。引导技能的最后一跳(Divine Hymn)不再算作对引导结束后才开始的爆发的应对。
- `352e7c962` **队友的 Blessing of Sanctuary:**
  - 它能解掉什么按 DB2:恐惧、沉默、昏迷与惊骇。
  - 被它解掉控制的击杀尝试,KILL ATTEMPTS 记为 `broke out (Blessing of Sanctuary)`,而不是 `not enough damage`(605 文件上 170 次尝试)。
  - `[CC REMOVED]` 会点名它解掉的沉默(96 行)。
  - 打在爆发施法者身上的 Snowdrift 昏迷算作对这次爆发的应对:治疗 slow-defensive-response 69 → 68,用户已批准。
- `5032b4e4f` **fact5 第 1 批,击杀窗口与打断:**
  - 施法行写着队友、施法者身上却没有自己光环的按键,不保护施法者。
  - 按下的 Spirit of Redemption 结束 `defenseless`。
  - STAYED IN 会点名区间内转好的防御。
  - ABILITIES INTO IMMUNITY / DR 按法术把施法与其伤害对上(Execute 281000 以 260798 命中);蓄力施法按释放时刻计,从未释放的持握不计。
  - 605 文件:kick-eaten 1,837 → 1,843、kick-priority-missed 47 → 48、kick-priority-team 72 → 74、burst-into-mitigation 7 → 8、position-mistake 154 → 151,用户已批准。
- `c5afbaf42` Roar of Sacrifice 挂着时结束 `defenseless`,与 Intervene 一样(用户裁定 2026-10-25)。一次控制只有在其目标于爆发的 8 秒内施放过爆发冷却之一时,才算应对这次爆发:slow-defensive-response 605 文件 +15 / 第二语料 +34;kick-priority −3 / −3;用户已批准。
- `6da8c6a08` 击杀尝试开始之后才按下的 20–99 % 减伤,在尝试开始时就算在手。回合结束时或之后按下的保命不是任何尝试的原因。外援窗口的吸收部分计入队友的召唤物。kick-eaten +1(605)、burst-into-mitigation +1(第二语料),用户已批准。
- `28371fe72` **用户裁定 2026-10-26:**
  - KILL ATTEMPTS 会把队友的区域保命(Spirit Link Totem、Rallying Cry、Anti-Magic Zone、Darkness、Power Word: Barrier)点名为外援 —— 前提是尝试期间光环挂在目标身上。Rallying Cry 228 / 624 行,Spirit Link Totem 79 / 222。
  - Die by the Sword 对近战仍然算应对;对近战范围外施放的法术,按它 30 % 的减伤来判断。
  - Rake 只有在潜行状态挂着、或手里有进入潜行的手段(Prowl、Shadowmeld、Incarnation、Sudden Ambush)时,才算 `[HEALER EXPOSURE]` 的昏迷威胁。证据:tooltip(「While stealthed, Rake will also stun」),以及 605 文件上 460 次 Rake 昏迷中的 441 次。第二语料:Rake 提及 1,836 → 822。
  - 候选不变(7,630 / 23,421)。
- `ff9f603a1` KILL ATTEMPTS 的 Cyclone 子句读尝试区间及其后的击杀归属宽限,与门规一致。Touch of Karma 与它的护盾同时结束,对所有读者都是如此。
- `7583b54a3` external-unused 要求外援就绪与施法者空闲同时成立:605 文件 144 → 137。
- `33043e8a5` external-unused 的「就绪且空闲」在外援每一段未就绪区间上都检查。队友复制来的减伤保留施法者自己的减伤记账。

#### 冷却

- `c60affdf9` **冷却模型只有一种读法:**
  - 被速率窗口加快的冷却会计入按键之后的窗口,因此 `[RES]` 与台账一致:Emerald Communion `(129s)` → `(119–129s)`,Rewind `(163s)` → `(151–163s)`。
  - 按键同一毫秒内的事件减冷却计入(Rumbling Earth 40 秒 → 25 秒);饰品 → Will to Survive 的锁定为 60 秒。
  - 充能冷却自身的效果会作用到多充能窗口、死亡时的就绪状态与同步窗口的回转。
  - 没有候选变化;`[OPPORTUNITY] … Holy Word: Chastise ready` 17 → 37。
- `66fc31962` **`[RES]` 中的 Hypothermia:** 同一秒稍后挂上的也算;冷却在它挂着时可能已回转的,印成 `(≤Ns; Hypothermia Ms)`。`[RES]` 图例写明台账的半秒宽限。Burrow 进入我方台账。Mutilate 的副手行与 Germination 的伴随 Rejuvenation 不算按键。没记燃烧光环的 Cauterize 触发仍然算数:dps cd-hoarded −1,用户已批准。
- `347d975ef` **治疗增幅技能能帮到队友:** Nature's Swiftness、Evangelism、Stasis、Tip the Scales、Convoke 与神圣 Avenging Wrath 不再被说成「正确留着的自保防御」。治疗 cd-hoarded 574 → 571(35 条被这类按键应对,新增 32 条),用户已批准。多充能冷却的窗口跟随台账:STAYED IN 不再在 Survival of the Fittest `[1/2]` 旁边说「no defensive CD available」。
- `0b30ed7a0` **用户裁定 2026-10-23:** Lifecinders 唤魔师的 Obsidian Scales 能惠及队友 —— 队友危机时算一个就绪的保命(治疗 cd-hoarded 571 → 573、slow-defensive-response 68 → 69,用户已批准)。玩家打在敌人身上的定身,在 `[SLACK]` 中算作进攻输出。
- `8ff4820ee` **按键血量**(用户裁定 2026-10-23,fact4 D31):按键前没有治疗到该单位时,按键同一毫秒内、记在施法行之前的读数,就是按键时的血量。605 文件:226 个按键血量变化,全部变低(中位 −1);58 行 `[YOU] [CD]` 新增了血量。
- `33043e8a5` F17 审稿后续:充能按速率时钟走;同一毫秒的减冷却计入倒计时;Spirit of Redemption 的上限读其施法者;敌方防御的按键血量按施法或效果读取。
- `805564270` 同时给施法者和队友挂上副本的按键(Obsidian Scales),对每个接受者都按其自己副本的结束时间应对。
- `bebed3c02` **F19,codex 读者清查**(用户 2026-10-27 批准):
  - 死亡选项:受害者死前刚被锁住的保命(Forbearance、Hypothermia),或挡不住致死伤害的保命,不再列出;自己持有的 Blessing of Spellwarding 会列出。
  - 我方的 Spirit Link Totem 算叠加减伤,以其萨满命名;Grounding 按图腾吃到的那一下记功;集火只计敌对单位。
  - 未关闭的敌方进攻光环持续其官方时长;充能翻转按整毫秒判定;多充能回转计入之后的重置。
  - missed-sync-window:玩家自己布置、被折叠进来的控制,算作该行里玩家的部分。
  - kick-eaten 的施法时长中位数读记录者的失败行。
  - 605 / 第二语料:cd-hoarded +7 / +5、cd-waste +9 / +45、external-unused −23 / −32、missed-cleanse +3 / +9、missed-sync-window +11 / +27、crisis-no-response 0 / −1。

#### 危机、治疗与驱散

- `2b966ea8d` **crisis-no-response 的「能行动」** 改用 cd-hoarded 的玩家门:跨线后 3 秒内至少空闲 1 秒,而不只看跨线那一刻(跨线后 79 ms 的一个 Void Nova 让治疗被控 4 秒,菜单却写着「free」)。它所说的爆发,是跨线时正在进行的敌方爆发。治疗 crisis-no-response 6 → 8,用户已批准。
- `4ba2b3ace` 危机的可行性在回合最后一个可操作时刻结束(crisis-no-response 8 → 7,用户已批准)。
- `5032b4e4f` **被拒的按键**(用户裁定 2026-10-25):就绪冷却的按键被 GCD 拒绝、之后也没再施放,在 cd-waste、missed-cleanse 与 slow-defensive-response 中同样算作尝试。治疗空档会带上治疗者被拒的按键 —— 写在 `[INACTIVITY]` 行上、作为治疗空档行的 `attempted` 事实,并在图例里加一句说明。
- `5032b4e4f` 敌方进攻冷却只有光环、没有按键时,记为一次 `(no press)` 出现,权重为 0(Enduring Rage → Recklessness、Odyn's Fury → Avatar)。Tempered in Battle 是伤害再分配,不是伤害。Fel Armor 是延迟伤害盾。`[CONTESTED]` / `[OPPORTUNITY]` 的「X ready on enemy healer」需要敌方治疗在可及范围内。
- `c5afbaf42` **敌方治疗冷却名册** 加入 Evangelism、Tip the Scales、Nature's Swiftness(德鲁伊与萨满)、Divine Toll、Celestial Conduit、Frenzied Regeneration 与 Convoke,各自只对其治疗专精生效(缺失行 1,175 → 3 / 4,207 → 8)。驱散只有在能解掉该减益类型时才算「在冷却」(Naturalize 解不掉诅咒):missed-cleanse +3 / +13,用户已批准。
- `ff9f603a1` 一次控制只有在危机期间其目标正在打受压单位时,才算应对这次危机(13 份公开日志:控制应对 7 → 2)。重新变形不算保护性应对。光环证实的按键算作天赋的证据。
- `de008dbac` 治疗基准里的躲控成功率只计玩家自己的躲避 —— 不算因为敌方猎人的 Freezing Trap 挂在治疗身上而记为 IMMUNE 的 Polymorph。

### AI 教练 —— 时间线事实

- `c027aef94` **第二语料上仍然失败的硬门规现在通过:**
  - 天赋给出的 Obsidian Scales 写成 `(on an ally — Lifecinders)`。
  - 记为 IMMUNE、且施法者在 1.5 秒内重新施放的控制,写成 `— recast landed +N.Ns`。
  - 同一个控制的同一次 IMMUNE,不在同一秒里说两遍。
  - 零时长的控制不在 `[DMG SPIKE]` 中被引为掩护。
  - Tree of Life 增益挂着时重新变形,不算按键。
  - peel 门规读取同一秒内各行的先后顺序。
  - Master's Call 的标签是 `(removes roots / snares)`(用户裁定:605 文件上有 571 次定身 / 减速控制记为 IMMUNE,其中 545 次仍在它挂着时命中)。
  - 没有自己按键的自我保命 —— 引导 Divine Hymn 时的 Guardian Spirit、带 Blazing Barrier 的 Ice Barrier、Well-Honed Instincts 触发的 Frenzied Regeneration —— 其 `[ENEMY DEF]` 行印 `[no press logged]`,并计入 KILL ATTEMPTS。
  - Stasis 不再把同一个 Verdant Embrace 列两次。
  - 措辞:`[REFLECTED] … reflected ×N`,按施法计数 —— 一次 Penance 引导算一次,相隔 943 ms 的两次 Fire Blast 算两次,每次被反射的触发(Astral Smolder)各算一次;控制命中后才做的位移写成 `[CC AVOIDED?] … pressed +N.Ns`,位移之后才生效的地面控制不这样写;`[no CC aura logged]` 加了图例。
  - 605 文件:候选不变(7,637);第二语料:7 类门规(49 行)→ 0。
- `20ede1a90` `7583b54a3` `bebed3c02` **Solo Shuffle 回合在决胜死亡处结束**(用户裁定 2026-10-24 与 2026-10-27):
  - 此后不再有时间线事件;之后的 `[DEATH]` 区块仍然印出。
  - 定身、控制、缴械与我方打出的控制链在此截断,并标为回合结束时仍在。
  - slack 与 contested 扫描、Stasis 的「整回合留着」、同步窗口、kick-priority 的施法结束、Innervate 注释、打断压力、叠加减伤与 Psyfiend 可及范围都在此停止。
  - 冷却台账、施法条、解控、HEALER TRAINED、光环覆盖率、kick-eaten 的打断后窗口、CC USE 以及装备栏的已开始施法条计数也在此停止。
  - 13 份公开日志:去掉 9 行,没有新增。
- `2b966ea8d` 敌方硬读条的结果按投出顺序配对(Chaos Bolt 飞行中位 852 ms,Pyroblast 455 ms)。
- `352e7c962` **延迟控制在其区域存续期间生效:** Freezing Trap 最长 60 秒、Binding Shot 10 秒、Snowdrift 6 秒 —— 放下 8 秒后才抓到圣骑士的陷阱,不再被说成「did not land」。打在别的单位上的控制失败行,算「在别处触发」。一条控制失败行只出一行,Snowdrift 的脉冲不算按键。宠物的控制点名其施法者(`X's pet`);Command Demon 按键与宠物的施法算一次控制、一次打断。
- `66fc31962` 关于某个单位的那一行,读该单位自己的 Dampening。控制族的减速副本 miss(Metamorphosis)不算控制失败:`[CC AVOIDED?]` Metamorphosis 38 → 0。
- `347d975ef` 没记移除的隐藏增益在其时长加 1 秒后过期;推断的控制结束按施加顺序结算,先走递减;推断结束的自己的盾持续到最后一次吸收。
- `4ba2b3ace` Dampening 从该单位的第一层起才计。有自己 miss 行的控制,只由其施法者命中同一触发来应对。宠物打断的 miss 行按宠物的时刻配对。被魅惑玩家被其本队施加的控制会锁住他的施法;术士的驱散在没有 Felhunter 时被锁,按每只宠物判断。`[CC AVOIDED?] … logged` 行 6,354 → 6,416。
- `c60affdf9` 自己的盾的吸收证据到下一次施加为止。移除记录丢失的光环在官方时长结束;记下的移除就是它的结束,即使超过官方时长。Stormkeeper 的最后一层被其他技能消耗,同样算用完。
- `7583b54a3` **丢失的移除:** Spirit of Redemption、Obsidian Mettle、Death Pact 与 Power Infusion 在其时长结束(推断的结束不印 `[ENEMY BUFF END]`)。Innervate 的免费施法只在它挂着时算;死亡结论把「付不起」与被控分开。被打断的敌方施法条不算硬读条(硬读条行 1,260 → 1,239)。`[CD PRIOR]` 的谷值从同一个单位的跨线读名字、秒与血量。
- `de35442b3` **消失、控制状态与计数:**
  - `[BUFF FADED]`:没命中的按键不估算消失;Alter Time 在回溯时结束;提前停下的引导写「ended early」;Divine Hymn 与 Tranquility 持续 DB2 的 5 秒与 6 秒。
  - `[CONTESTED]` 需要敌方治疗空闲:435 → 312。
  - `[REJECTED]` 串中的 GCD 拒绝是透明的;小驱散按驱散者的按键分组。
  - 按键血量会扣除按键自己触发的治疗。
  - 队友复制来的 Obsidian Scales 能应对爆发;紧挨着敌方 Shadowmeld 或 Transcendence 停下的施法条会写明;Grimoire of Sacrifice 意味着不能驱散;对别的单位、没有施法行的 Blind 算按键。
- `0b30ed7a0` 被自己重新施放接管的引导,不算被控制打断。
- `6804c59a5` `e9eb723e3` **没记结束的隐身**(Greater Invisibility、Mass Invisibility、Vanish、Burrow)在持有者自己的按键或命中处结束 —— 不在宠物的平砍或 DoT 跳伤处结束,不越过记下的移除,也不在比光环晚至多 150 ms 记下的它自己的施法行处结束。
- `e5795f619` IMMUNE 行上的 `(a Cyclone was on them)` 改用带上限的 Cyclone 读法:0:10 一个没记移除的 Cyclone,不再为 0:44 的 IMMUNE 背锅。
- `aa807f02b` 附带护盾(Shield of Vengeance)只有在日志里没有它的按键时才写 `[no press logged]` —— 旧补丁会记一次施法(公开日志:27 处矛盾 → 0)。
- `a2714c8de` `7db75818f` **不再出现客户端语言的法术名:** 中文或韩文客户端的名字永远不作回退;未知 id 印 id 本身(公开日志:每个视角 16 个硬失败 → 0)。
- `fdb26784f` `7db75818f` **引导的开始与结束只有一种读法:** 光环可以比施法行早至多 150 ms(公开日志 77 次引导中有 30 次因此对 missed-cleanse 与打断审计不可见)。被重新施放接管的区间不算被控打断,也不算打断停止,并且不超过引导的官方时长。
- `9539e006a` Top sources 与「killed by」给出被完全吸收的命中的学派(`Starsurge [Nature/Arcane]`;没有学派的条目 13 → 2)。
- `db590161e` `7db75818f` 名册标签只有一个构造器:`[HEALER EXPOSURE]` 与 `[ROOT]` 用时间线自己的;施法目标与伤害行现在也印名册标签(119 个公开 prompt 中 63 个、460 行)。
- `7db75818f` **谓词索引裁定 D1–D7:**
  - `[EMPOWER Ln]` 读已释放持握的等级(以前漏掉 2.6 秒的满蓄)。
  - 记在施法条自己 START 行之前的 SUCCESS 行,不是它的结束。
  - 打断深度、取消台账与施法窗口共用一种施法时长读法。
  - 宠物死亡或 Dismiss Pet 结束它的打断与 Felhunter 的驱散,直到看到另一只宠物。
  - 敌方命中按名册阵营读取;死亡路径的 Forbearance 与「敌人在控制中」读共用谓词。
- `c5afbaf42` 队友对准目标的控制没有挂上控制光环、也没记 miss 时,写 `[no CC aura logged]`,与玩家自己的一致;伤害的 ABSORB miss 不算控制 miss。地面控制自己的脉冲行就是它的触发时刻,用于躲避判断(Capacitor Totem)。
- `6da8c6a08` **fact5 第 3、4 批:**
  - 没有光环也没有 miss 行的定向控制,会点名施法时目标身上挂着的免疫(`[no CC aura logged — Phase Shift was up]`);施法之后才按的位移不算原因。
  - 100 ms 及以下的触发光环是施放时的一次净化,不是常驻免疫(Spirit Walk;共四个 id)。
  - 被盾吃掉的 DoT 跳伤不再结束不可见的保命(605 文件上 882 个区间)。
  - Spell Reflection 是战士的 Utility 按键(用户裁定 2026-10-26);对队友施放的引导会写明。
  - PvP 饰品按键会点名它解掉的定身,除非记下的驱散先解掉了(用户裁定 2026-10-26)。
  - 玩家命令宠物做的驱散是主动的,不是 `(passive)`。
  - 敌方冷却的区间按其效果所在的光环计算(The Hunt 的 DoT,而不是它的定身);不可见按键据以重述的那个光环,不再算第二次 `(no press)`;重新施放的引导自成一段。
- `28371fe72` Transcendence: Transfer 会印一行 `[ENEMY UTILITY]` 按键(303 / 1,053 行)。
- `bebed3c02` **F19,事实:**
  - 敌方宠物与图腾出现在 CC USE、PEEL OPTIONS 与召唤物可及范围中。
  - 一次按键的两个名字算一次按键:Blur 的第二层充能、Lightning Lasso 的引导阶段、重复播报的 Guardian Spirit、Greater Invisibility 的两条成功行。
  - 不可沉默的施法不被沉默挡住;跑满全程的控制,不算被最后一毫秒的饰品解掉。
  - 深入分析与桌面端读谷值;血量快照包括两端。
  - `[CONTESTED]` / `[OPPORTUNITY]`:就绪与可及须在同一秒成立。

### 战斗日志解析

- `60f0c325a` **玩家不再从名册中掉出:** 由三对组成的 COMBATANT_INFO 光环列表被读成两组三元组,整行解码失败,回合变成 3v2。公开日志:一场单排的 COMBATANT_INFO 解码 125/144 → 144/144;prompt 行上未映射的裸名字 21 → 0。
- `c5afbaf42` 玩家属于哪一方,取自日志的 COMBATANT_INFO 队伍字段,而不是反应标志投票 —— 后者曾在一个 Solo Shuffle 回合里把敌方冰法当成队友。
- `66fc31962` `4ba2b3ace` `33043e8a5` **滞后的最大血量:** 退出熊形态时当前血量立刻按比例缩放,最大血量字段约晚 0.3 秒才变,于是满血的德鲁伊读成 75 %。现在在源头为所有血量读者校正(误差中位 0.05 pp,原为 8.9 pp);按同一比例移动血量的治疗或命中不算滞后。
- `8ff4820ee` 解析器保留每个高级采样在日志中的行序,于是按键同一毫秒内的读数能分清在施法行之前还是之后。存储的文档约大 0.7 %。
- `6da8c6a08` 被吸收的输出伤害行带上攻击的法术 id。

### 桌面端

- `4ba2b3ace` 血量时间线与回放读校正后的最大血量采样。
- `7583b54a3` 死亡回顾读对的那一秒;Key Moments 计入 Adaptation。
- `33043e8a5` 死亡回顾卡片会写出施法者付不起的情况。
- `ff9f603a1` `bd408042c` 统计表的驱散次数把宠物的驱散记给其主人,与驱散面板一致。无法采取行动的窗口不再出 missed-purge 击杀窗口卡片。
- `bebed3c02` 回放中每个 SUCCESS 按行序关闭一个施法条。光环覆盖率、解控面板、Key Moments 与回放高亮都在 Solo Shuffle 回合的结束死亡处停止。

### 冷却、天赋与法术数据

- `6da8c6a08` `genSpellSchools`:100 ms 及以下的触发光环不算其父技能的常驻免疫;在 12.1.5.70391 上恰好四个 id 失去免疫机制。
- `635600c71` curated 扫描看不到的手工 id 表已登记(反射相关表、伴随施法行、事件减冷却 id、按事件计的时长法术);两个 id 标记待下个赛季复核。
- `1d8360f1d` **恢复德鲁伊的 Barkskin 是 40 % 减伤**(GH #163),不是 30 %:恢复专精的 PvP 光环在 Barkskin 与 Oakskin 之上再加 10 点。按专精拆分语料也吻合(恢复承受 0.600、平衡 0.704、野性 0.700)。605 文件:268 行恢复德鲁伊的 `[ENEMY DEF]` Barkskin 30 % → 40 %,候选不变。Grove Guardians 树人的 Swiftmend 不再算作主人的。
- `339b56965` 数据脚本的研究开关:构建天赋目录时不叠加当天的热修覆盖层,或把新的覆盖层写到旁路路径。两者默认保持原行为。

### 可靠性 / 测试 / CI

- `8ace671ad` `807b9e44a` **`real-logs` CI 任务:** 公开的 wowarenalogs 测试日志(钉住版本、运行时拉取、从不提交)跑过解析器的真实日志套件与全部硬门规,覆盖每个回合、治疗 / dps / 记录者三个视角,上下文与 findings 两种 prompt;不允许任何硬失败。它找出了上面的名册、CJK 与附带护盾缺陷。
- `0cfca7f35` `8072afcc5` 共用测试辅助函数构造的事件与应用实际读到的一致(伤害符号、日志行序、字段、单位数据流),并由契约测试对照转换后的真实夹具。
- `e9eb723e3` 日志形态矩阵把已知的真实日志怪癖(丢失的移除、同毫秒重播、并入主人的宠物伤害、DoT 跳伤、光环早于施法行的延迟)对核心读者重放;第一次运行就找出了上面的隐身缺陷。
- `17be77864` 每个导出的门规都必须由 `checkMatch` 调用(全部 103 个都已接上)。
- `4cc8bdcc9` `2f948f572` `000277592` **`mutationProbe`:** 每次改源文件的一个运算符,报告没有任何测试能杀死的变异体。castPress 61.1 % → 100 %,hiddenPress 52.9 % → 91.2 %;只在整套测试基线通过时才计分。
- `2b966ea8d` `5032b4e4f` `c5afbaf42` `6da8c6a08` `bebed3c02` 新的语料检查:`corpusFactScan3`、`captureFamilyDiff`(两份采集按族对比)与 `corpusFactScan4`,每个审计过的事实类一项确定性检查(例如 605 文件上 castDamageIdSplit 580 → 3、enemyCdAuraForward 294 → 3、ccReadyOutOfReach 98 → 0、deathOptionLocked 18 → 2、unusedAfterRoundEnd 46 → 0)。
- `352e7c962` `7583b54a3` `7e1d13264` `20ede1a90` `107f759d2` `bebed3c02` 新增与细化的门规:控制失败行就是该触发的结果;`[CD PRIOR]` 的跨线血量(2 → 0)并配有测试;回合结束后不得有事件,只豁免之后死亡自己的区块;`(area)` 的 `[ENEMY DEF]` 行在施法者装备栏的 `lasts` 内都算触及目标(用户裁定 2026-10-27)。
- `562bc32c9` `4c3e4551b` `7b6dc0c0d` corpusFactScan2:列表内的光环按适用性判断,未关闭的免疫设上限,有施法支撑的刷新算新控制,层数行既不重启上限也不关闭这次施加,E6 窗口与产品常量保持相等。
- `85115426f` `fe0e8bf38` cooldownRecastScan:充能逐层回复,宽限只作用于判定,汇总按法术、专精、冷却与充能数分组。
- `842a12757` `20ed91470` `78171ec0e` postKickSwitchAudit 按英文名点名产品所点名的切换施法,包括刚过窗口末尾的伴随施法。
- `24b7b1ad8` 覆盖清单按自身光环计入 Adaptation 的使用(605 采集:饰品使用 6,017 → 6,068)。
- `7e1d13264` `bd408042c` `60d5f45b1` 名不副实的测试重新测到它们名字所说的东西;统计表测试按枚举比较阵营。
- `bed34c22b` 光环激活表移到单独文件,消除一个让隔离测试失败的导入环。

### 其他

- `664f93f30` `242717d8c` `f2c30fb7d` `8c48f7247` PROMPT_VERSION 453、454、455、456(442–452 与 457–461 随各自的修复提交)
- `1d3c5c835` `42318e9f5` `57c25b3a6` 文档:开发者指南(中英)与 analysis-dev 介绍真实日志、日志形态矩阵、辅助函数契约与变异探针;关闭两条谓词索引条目;补回 PROMPT_VERSION v438–v441 的历史。
- `88a83533e` 修正描述错对象的注释;KILL ATTEMPTS 图例中的减伤下限改为读常量(渲染文本不变)。
- `a47dd8b14` 每日日志拉取跟随上游的 30 个定额:20 场 Solo Shuffle 加 10 场 3v3。

## v0.1.38(2026-10-22)

fact3 第三轮审计(GH #153)由两名独立审计员,对照原始日志核对了 30 个新回合。确认的 61 处缺陷按事实类逐一修复,每个事实的所有读者都一并修好。随后上了两轮全语料事实扫描,并把它们作为回归网(`corpusFactScan`、`corpusFactScan2`:每个审计过的事实类一项确定性检查,每批改动前后都在 605 文件采集上跑)。本版之后,第 1 轮全部为 0,第 2 轮的剩余项列在 GH #153。

要点:
- 持有者不在视野内时按下的冷却算作按键,并标 `[pressed while unseen]`。
- 法术反射的回弹按反射者的真实命中计算。
- 我方被控制但记为 IMMUNE 时一定有一行,并写出日志能看到的原因。
- 击杀窗口的 `defenseless` 区间,会在目标自己按下的吸收盾、Intervene、Mass Invisibility 或 Phase Shift 挂着时结束。
- Divine Toll 算作能惠及队友的治疗。
- Blessing of the Bronze 会加快它所点名的位移技能冷却。

每一处增删指控的改动,都先在 605 文件采集上预览、经用户批准后才落地。

已知审稿欠账(GH #144):审稿方的周额度用完后(2026-10-21 约 17:00)没有跑过跨 AI 审稿 —— 下列从 `9d24d307` 起的全部代码提交,约 31 个。v0.1.37 列出的五个冷却提交也仍未审。这些都已排进下一个审稿窗口(codex 自 2026-10-27,agy 自 2026-10-24);在此之前,每一批都由上述语料扫描把关。

### AI 教练 —— 战报对你的评价

#### 击杀窗口、打断与保命

- `dfb4cca9` **用户裁定 2026-10-21:**
  - 目标自己的 Power Word: Shield / Void Shield 挂着时结束 `defenseless`,对它施放的 Intervene 同样如此 —— 永不构成指控。
  - 处于 Ice Block 中的法师不算可用的打断者。
  - 605 文件:kick-priority-missed +1、kick-priority-team +2(同一事件),用户已批准。`[KILL WINDOW]` 8,443 → 8,338,`[VULNERABLE]` 411 → 435。
- `03a355dc` **第三轮审计,击杀窗口:**
  - Vanish 加入击杀窗口名册(用户裁定;盗贼 `[KILL WINDOW]` 1,203 → 752)。
  - Aspect of the Turtle 是偏转而非免疫。
  - Mass Invisibility、Phase Shift 与 Intervene 挂着时结束 `defenseless`。
  - kick-priority 以所有重叠窗口中最低的目标来判断一次治疗。
  - 605 文件:kick-priority-missed +17、kick-priority-team +22、kick-eaten +1、position-mistake +1、questionable-external −6、cd-waste −6、cd-hoarded −1 / +2、external-unused −9、backlash-dispel −1,用户已批准。
- `dd6fb6c6` `43be70b1` `023d857b` `45786610` **目标自己的吸收盾结束 `defenseless`** —— 任何它自己按下的吸收盾(Holy Bulwark、Blazing / Prismatic Barrier、Ignore Pain、Reversion、神牧触发的 Power Word: Shield)。一面盾在按下后一分钟内有效;天赋的被动吸收(Frost Shield、Fel Armor ……)不算。corpusFactScan2 覆盖在自己按下的盾上的区间:134 → 2。没有候选变化。
- `127021a5` **Divine Toll 能惠及队友**(fact3 D7):它唯一的非 dummy 效果是给施法者回 Holy Power,这条把指向队友区域的效果行藏住了。605 文件:治疗 cd-hoarded 566 → 574 —— 新增 14 条,全是队友危机时神圣骑士的 Divine Toll 就绪却没按;撤下 9 条,是按过的 Divine Toll 现在算作应对。写着「cheaper available: … Divine Toll」的提示从 209 行增至 627 行。用户已批准。
- `5e0dd271` **cc-avoidable 可点名更多玩家自己的按键**(用户裁定 2026-10-22):Blink、Icebound Fortitude、Lichborne、Demolish、Aura Mastery、Unending Resolve、Obsidian Scales、Zen Focus Tea,每个只挡它 DB2 行里列出的控制机制。605 文件上没有变化。
- `c5f8d4cb` **backlash-dispel 按驱散那一刻读目标血量**,而不是那一秒的 `[STATE]` 读数(用户裁定 2026-10-22,fact3 D45;渲染网格的第四个签字例外)。605 文件:backlash-dispel −1(两条移出血量分档,一条移入);39 条血量事实重读。用户已批准。
- `e46196d6` 武僧的 Touch of Karma 窗口在该武僧自己的转移被移除时结束。打进 Aspect of the Turtle 的控制计入 ABILITIES INTO IMMUNITY。
- `35eb2125` kick-eaten 读其他打断的锁定时带上本回合单位:非天赋持有者的 Counterspell 在这里也是 5 秒。

#### 冷却

- `7a6cae8e` **Blessing of the Bronze 加快它所点名的位移冷却**(fact3 D13:一名戒律牧的 Leap of Faith 在 90 秒的装备栏下 84 秒、82 秒就回来了)。
  - 不论是谁施加的(增辉龙队友),以及回合开局就带着的,都生效。
  - 同一轮加入 Sylvan Beckoning 与 Spirit of the Thicket 对 Swiftmend、Mystic Knowledge 对 Riptide、Ground Skimming 对 Surge Forward / Skyward Ascent。
  - 证据:DB2 aura 454,对 Leap of Faith 的类别 −15 %。语料里带着它的牧师重按最短到 51.3 秒 —— Move with Grace 的 60 秒 × 0.85。
- `9d62c243` 装备栏按 `[RES]` 行的读法,印出本回合被增益加快过的冷却的范围:Emerald Communion `[166–180s]`。
- `03a355dc` Berserk 与 Celestial Alignment 持续 DB2 的 15 秒。
  - 竞技场里 Intervene 持续 3 秒(用户裁定;防护的 6 秒未建模)。
  - Anti-Magic Shell 444741 带 Anti-Magic Barrier(2,366 次中 2,284 次为 6.0 秒)。
  - Axe Toss 与 Shambling Rush 取其控制效果的机制。

### AI 教练 —— 时间线事实

- `03a355dc` **第三轮审计,事实**(每处修复都有回归测试,并在从原始日志重新渲染的审计回合上核对过):
  - **单位不可见时做出的按键** —— 重新列出该单位的那一批里新出现、没有施法行的光环 —— 在冷却台账、死亡分析、`[ENEMY DEF]` / KILL ATTEMPTS 与 `[ENEMY CD]` / `[ENEMY HEAL CD]` 里都算按键,标 `[pressed while unseen]`。
  - IMMUNE miss 只点名能挡住那个控制的免疫。
  - Spell Reflection 解释 REFLECT,永不解释 IMMUNE。
  - 一旦 miss 行证明控制已打到玩家,就不再记位移躲开。
  - 日志没记移除的控制,在递减后的时长结束。
  - 我方驱散反噬的沉默是一条 `[SILENCE]` 行,附上期间做出的按键。
  - Spiritwalker's Grace 不算防御。
  - The Hunt / Stormkeeper 在抵达或充能用尽时结束。
  - 蓄力持握绑定到它自己那次按键。
  - 买不起或被拒的 Guardian Spirit 不算「空闲可用」。
- `9d24d307` `168fe85a` `033c0335` **法术反射的回弹:**
  - 不计入:同名的驱散反噬伤害,以及弹道飞行时间之后反射者自己的命中。
  - 计入:反射本身挂到施法者身上的那份副本。
  - 一个法术在两个 id 下的 REFLECT 行算一次回弹。
  - 脚本伤害法术(Fel Lance)保留它的回弹。
  - Nether Ward 的行归给最近的那次反射。
  - corpusFactScan 回弹行 202 → 0。
- `5a0abd22` `8619569f` `c7dfcba0` `fa8c4bde` `33a656b5` **隐藏按键:**
  - 通过按键自己的效果光环来识别(Alter Time)。
  - 只被批次重述的副本否决,不被潜行起手的施法、也不被按键的第二个同名光环否决。
  - Herald of the Sun 的触发包不算按键。
  - corpusFactScan 隐藏按键行 288 → 0。
- `a7ee20cf` 没有施法行的 Blessing of Sacrifice 算按键(605 文件:cd-waste −1、cd-hoarded −1,用户已批准)。
- `c7dfcba0` 敌方的解控种族技能会点名它解掉的、被反射回来的控制。进攻光环的一段按来源配对(两个法师对同一目标的 Touch of the Magi 是两段)。
- `8619569f` `0ed29933` 移除那一毫秒里的按键,不会抢走日志另有原因的那次控制。
- `7aec3189` 按键血量读在它自己第一跳 HoT 治疗之前,即使这一跳比施法行早至多 150 ms(Frenzied Regeneration 42 % → 34 %)。
- `b9b3950f` `eebc1652` `8f155f17` **我方被控制或沉默但记为 IMMUNE 时,一定有一行 `[CC AVOIDED?]`。** 这一行写出日志能看到的原因:免疫光环、Cyclone、递减已到免疫,或不注。
  - 免疫表加入 DB2 能解释的免疫:Freezing Trap / Imprison / Time Stop(全系),Blink、Icebound Fortitude、Lichborne、Travel Form、Demolish,以及免沉默的 Aura Mastery、Spiritwalker's Aegis、Unending Resolve、Obsidian Scales、Sanctified Ground、Zen Focus Tea。
  - corpusFactScan2 没有行的 IMMUNE:427 → 22。
- `189b6ac8` 地面控制已经生效之后才按的位移,不算躲开(30 条此类记录中 12 条;Capacitor Totem 的脉冲,以及已经抓到队友的 Freezing Trap)。
- `f4c02f62` Mass Invisibility 重新测量:挂上 2 秒之后只有区域伤害会命中。用户维持原裁定。

### 桌面端

- `4d131ae3` 场景基线跟随 2026-10-21 的裁定:真实样本里敌方牧师自己的 Power Word: Shield 结束了它的击杀窗口。

### 评测与验证工具

- `a7e640ce` **`corpusFactScan`(第 1 轮):** 四项全语料确定性检查。
  - 没有行的隐藏按键。
  - 光环与施法行的间隔。
  - 跑满全程却被说成「提前结束」的控制。
  - 反射回弹。
- `1d968d74` **`corpusFactScan2`(第 2 轮):** 六项检查。
  - 免疫原因。
  - 未关闭的递减控制。
  - `defenseless` 区间内的保命。
  - 宠物打断。
  - 重复行。
  - 免疫表正向检查。
- `8619569f` `c7dfcba0` `033c0335` `0ed438a0` `4ce9f54d` 扫描器与产品共用常量和谓词(`hiddenPressMs`、反射回弹常量、`HERALD_PROC_BUNDLE_IDS`、按键治疗提前量)。每一对都登记在谓词索引里,并由对应测试钉住。

### 其他

- `9c75b19e` `cedc8c27` `82795e75` `d1593db7` `3b40263c` `5df0c066` PROMPT_VERSION 436、437、438、439、440、441

## v0.1.37(2026-10-21)

两块工作。fact2 第二轮审计(GH #153)逐个事实类对照原始日志核对时间线,并修好每个事实的所有读者:光环解析回产生它的那次施法,击杀窗口的爆发计入被护盾吸收的命中,法术反射的回弹是反射者的伤害,ENERGIZE / DRAIN / LEECH 行作为 HP 与位置样本,谷值读到该单位死亡那一秒、直到死亡为止。冷却台账现在按天赋的真实效果建模:DB2 里按等级、按专精的天赋点数,说明文字里的专精分支,事件型冷却缩减(消耗资源、打断、命中、重置),按热修日期区分的数值,以及从天赋说明文字读出、再经语料确认的增益持续时间(GH #154、#155)。2,240 个文件上台账里「不可能的重按」从 5,240 降到 229。每一处增删指控的改动都先在 605 文件采集上预览、经用户批准后才落地。

随后对审计过的 30 个回合做了同局复审:第二轮的 67 条修好了 66 条;复审新发现的问题,发版前已修好或列在 GH #153。

已知审稿欠账(GH #144):五个冷却提交 `dec9626b` `c4a5a61d` `d2f2c08f` `01643393` `5dcd31c5`,以及撞到审稿额度上限的三个排队单元(复测第 1 组后续、2026-10-20 的裁定、GH #155 持续时间),还没有经过跨 AI 审稿;复审修复这一批 `c4291be6` 也还没有。

### AI 分析 —— 战报对你说的话

#### 冷却

- `dec9626b` **台账漏掉的德鲁伊冷却天赋**(GH #154):Control of the Dream 把冷却就绪闲置的时间抵扣掉,Cenarius' Guidance 每个 Grove Guardian 消失时让 Tree of Life 减 5 秒、让恢复 Convoke 减 60 秒,Call of Ohn'ahra 按日志日期取值(Nature's Swiftness 的不可能 + 下限解释重按 502 → 0)。**候选增加**:missed-sync-window +7(平衡德 Force of Nature 在窗口内回来),用户批准
- `c4a5a61d` 多个专精共用的天赋每个专精各有一条效果行,只有说明文字写明哪条归谁;现在由说明文字的专精分支给这些行设门(17 个天赋的 45 行)。火法的 Dragon's Breath 是 40 秒而不是 28 秒;Improved Feign Death 按等级读(25 → 20 秒);野性 Convoke 是 60 秒。没有候选增删;3 条在冷却中仍提议 Dragon's Breath 的 `[PEEL OPTION]` 行消失
- `d2f2c08f` 天赋点数按已购等级、按专精从 DB2 读取(此前两张表都没人读):神圣骑的 Blessing of Sacrifice 是 105 秒,Avenging Crusader 按等级 52.5 / 45 秒。**候选删除**:cd-hoarded −14 +1、external-unused −7、slow-defensive-response −2,用户批准
- `01643393` 台账之外的所有读者共用一套冷却模型(`unitCooldownEntry`):技能栏就绪、对面冷却时间线、击杀窗口的减伤状态、无防窗口、死亡回顾和对拼交换。Power Infusion 一次按键的两条 SUCCESS 行不再被读成两次按键(6,678 次「不可能」重按 → 0)。kick-priority-missed / -team 各 −1、kick-eaten −2,用户批准
- `5dcd31c5` **事件型冷却缩减纳入建模**(用户裁定 2026-10-20,取代 #124):消耗资源、打断、命中、消耗的增益、承受的攻击、光环结束和重置;充能技能走同样的效果和速率窗口的扭曲时钟;Sacrifice of the Just、Unbreakable Spirit、Safeguard 等按热修日期取值。台账不可能重按 5,240 → 229。missed-sync-window dps 373 → 437 / 治疗 140 → 164、kick-eaten +7、external-unused −9 +5、cd-hoarded −4 +1,用户批准

#### 击杀窗口、打断与保命

- `c4291be6` **同局复审修复**(605 文件预览经用户批准):治疗在 Spirit of Redemption 形态里读的治疗不再算 kick-priority(这类读条 233 次、没有一次被打断;kick-priority-missed dps 35 → 29,kick-priority-team dps 27 → 23 / 治疗 30 → 25);爆发窗口也认危机读者早已认的回应 —— Bear Form、Frenzied Regeneration、Roar of Sacrifice、Void Shield、Fade……(slow-defensive-response 88 → 69);death-setup +3(被心控的治疗吃了自己术士的恐惧);burst-into-mitigation −1

- `3d369bae` `2a9264c1` 用户对 v0.1.36 复测的裁定:Time Dilation 暂时挡下的伤害算减伤,就绪的 Alter Time 在击杀窗口里算手里有减伤,种族伤害增益(Blood Fury、Berserking、Ancestral Call)与 Ultimate Penitence 算进攻大招(kick-eaten +6 / +5、missed-sync-window +2 / +3、position-mistake −3 +1、slow-defensive-response +2)
- `6c20acbb` `8f2e472f` `81146d03` **用户对复测剩下三个问题的裁定**:Counterspell 只有带 Improved Counterspell 的踢人者锁 6 秒,确知没有该天赋的锁 5 秒(605 文件:4 个非持有者 4.93–5.00 秒恢复,501 个持有者中位 6.01 秒)。Survival of the Fittest、惩戒骑的 Divine Protection 和 Dark Pact 加入击杀窗口名册;技能栏标 `[UNUSED]` 的名册减伤整回合都算在手 —— 但没按的治疗或只能给队友的冷却不算(Desperate Prayer、Divine Hymn、Tranquility、Blessing of Sacrifice)。Shield of Vengeance 有了自己的 `[ENEMY DEF]` 行。`[KILL WINDOW]` 13,116 → 8,473、`[VULNERABLE]` 569 → 410;kick-priority-missed dps 38 → 35,kick-priority-team dps 26 → 27 / 治疗 31 → 30,用户批准
- `81228bc8` 用户裁定 R7 选 A:找爆发和判下限时计入被护盾吸收的命中,即 `[KILL ATTEMPTS]` 的口径(`[KILL WINDOW]` +412、`[VULNERABLE]`「未被惩罚」−217;候选不动)
- 下面整批 fact2 修复合计(基线 `fcde27b1` → 合并后):cd-hoarded dps 648 → 605 / 治疗 601 → 576(大多是主人在响应窗口内放的控制 —— Freezing Trap、Intimidation、Lightning Lasso…… —— 现在被认作已应对),missed-cleanse +29 / +21(敌人挂在我方的 DEBUFF 不再被读成我方的爆发威胁),菜单事件 7,559 → 7,560,用户批准

### AI 分析 —— 时间线事实

- `4da9c85e` **所有按施法 id 读的读者都把光环解析回它的施法**(施法 id ≠ 光环 id):KILL ATTEMPTS 自保(Alter Time)、叠加减伤、死亡窗口审计、爆发台账的墙(Rallying Cry、Spirit Link Totem)、`[BUFF FADED]`,以及按键放出的控制(Ring of Frost、Freezing Trap、Binding Shot、Sigil of Misery……)在每个施法侧读者上都算控制。击杀窗口团队伤害印出 `+Nk absorbed`
- `043ae29c` 第一轮修复漏掉的第一轮类:Flameshaper 的复制跟着携带它的单位走,只有按键证据的进攻大招按 `[RES]` 读法标 `[press-only]` 列出,`[CD PRIOR]` 的谷底读真实低点,Command Demon 算宠物的控制,没有结束行的 Oppressing Roar 在 10 秒结束,跑满全程的控制不算被按键解掉,Time Dilation 的延后伤害点名护盾施放者
- `827309cb` 击杀尝试点名团队在区间内打的人,锚在第一个打向他的按键;Spell Reflection 的回弹是反射者的伤害,并保留学派;每个时点 HP 读数取该时刻及之前的最后一条;`[RES]` 开局行把没动过的冷却列为就绪;附带驱散不印 `[ENEMY CLEANSE]` / `[PURGE]`;按出的 Spirit of Redemption 算免疫类保命
- `933c2838` 第二部分,每类都由 29 个审计日志上的确定性检查归零:`[ENEMY HARD CAST]` 的「landed」需要伤害或吸收行,按键 HP 落在它自己的第一跳之下,被反射的控制不算主人的增益,`[HEALER EXPOSURE]` 去掉确定在冷却中的控制(1,149 → 0),技能栏冷却印出 `[a–Ns]` 区间(241 → 0),「被锁」豁免写明多久(37 → 0),规避增益下无目标 AoE 的 MISS 算 `[CC AVOIDED?]`(48 → 0),Stampeding Roar 不是控制
- `7c14ff54` 第一轮复测遗留:Greater Invisibility 在持有者第一次出伤时结束,召唤物的驱散点名召唤物,触发可以比 proc 早 50 毫秒(223 对 Wake of Ashes → Avenging Wrath 中 165 对在 1 毫秒内、57 对在 2–50 毫秒),重按的 REFRESH 切开一面墙,被反射的施法不算「打进」免疫,对队友被拒的按键带 `[IMMUNE]`
- `81228bc8` 用户裁定 R1:谷值读该单位死亡那一秒里死亡前的存活样本,门规接受它(29 个日志上 troughFactScan:killWindowTeamMin 5 → 0,consequenceLow 15 → 0)
- `ef24bfdf` 605 全量的残留,逐条追到日志:召唤物的规避增益点名其主人,硬读条结果配到它之前最近的完成,按键 HP 算上自己的 REFRESH 或同名治疗,按键证据只取该单位自己的,饰品按下后仍持续的控制不算被它解掉,Hex 的变体是同一个按钮,提升上来的治疗冷却行带被拒目标的 `[IMMUNE]` 标记
- `a866f317` `2499cc5b` v0.1.36 复测第 1 组:战斗结束后还在跑的 Dragonrage,引导 / REFRESH 的按键 HP,ABILITIES INTO 不再列入免疫不覆盖的学派或控制,The Beast Within 按机制判,击杀窗口的「你的控制就绪」读技能栏,Kingsbane 链,Stasis 里没放出的蓄力,饰品行上被反射的 Cyclone,`[REJECTED]` 按法术分段,食尸鬼按 GUID 主人贴标签,Touch of Karma 在其减益移除时结束;KILL ATTEMPTS 图例写明外援的 20% 下限,无目标的非控制按键不带 `[IMMUNE]` 标记
- `db1b3956` `88fade8d` **增益持续时间从天赋说明文字读取**(GH #155):14 条说明文字写明、经语料确认的延长(Apotheosis、Cloak of Shadows、Zenith、Desperate Prayer、Power Word: Shield……),以及按每次施法计的 Spiritwalker's Momentum —— 技能栏印出「lasts 15–19s」。候选不动;1,875 份上下文
- `c4291be6` **同局复审,事实层**:一次 Capacitor Totem 命中只印一条 `[CC AVOIDED?]`;被自己 Cheap Shot 打破的 Vanish、随变形结束的 Frenzied Regeneration 如实写出;治疗死后的击杀窗口不再算「能出手、控制就绪」;Shield of Vengeance 标 `[no press logged]`;爆发台账和 KILL ATTEMPTS 不再计入 Time Dilation 的推迟吸收;Nether Ward 的回伤算作反射伤害;术士只有 Felhunter 在场时才能驱散(头部写明到几点);被驱散的缴械在驱散行里点名;天赋带出的我方控制(Terror of the Skies)算「放了控制」;刷屏折叠计入每一次施放;被心控者吃到自己队伍的控制也算控制,标 `[from its own team, while charmed]`;Berserker Rage / Shout 与 Nullifying Shroud 按 DB2 机制判免疫;晕链按最晚结束的那个晕结束;被 Oppressing Roar 延长的沉默 / 缴械按实际长度判。**用户裁定 2026-10-21**:`[CONSEQ]` 的起点取控制落地那一刻的 HP(不再是更早的 `[STATE]` 整秒读数;没掉血的行列出各队友读数),带 Improved Frost Nova 的法师 Frost Nova 按 8 秒算
- `fe557151` 跨 AI 审稿修复(15 条发现确认并修复 10 条,每条一个回归测试):延后类护盾的吸收行不进任何爆发与击杀读者,友方减益不算敌方威胁,Grounding 能看见施法 / 光环 id 不同的控制(Lightning Lasso),击杀窗口的开脱语同时写明两个限定,缴械或沉默跑满全程后才按的 Medallion 不算解掉它,开局 `[RES]` 行遵守 Forbearance,被压掉的 `[RES]` 行保留差量状态,反射回弹归到最近的伤害链(`[REFLECTED]` 42 → 52),效果证据的按键按效果时长分组,回合外的施法不再关掉推断。候选不动

### 战斗日志解析

- `d8978e39` SPELL_ENERGIZE / SPELL_DRAIN / SPELL_LEECH 行及其 PERIODIC 形式带有高级块(HP、最大 HP、位置);解析器现在把它们当作样本(占一个日志带高级块行数的 0.6–8.2%,此前 HP 与位置取样器从未见过)

### 冷却、天赋与法术数据

- `db1b3956` `82e7337a` `genTalentDurations` 从 zhCN 说明文字读取天赋持续时间延长(169 条:120 条固定、48 条按事件、1 条设定值;17 条未解析),已登记进 datagen manifest 和赛季手册

### 桌面端

- `3d369bae` 死亡回顾的减伤审计把 Time Dilation 写作「暂时挡下(之后以自身伤害落地)」,而不是「只是延后、没有挡住」
- `e0a12561` `16eb842b` `5f7e2a64` 场景基线和测试夹具跟随修复:report-synth 死亡回顾列出爆发台账已点名的 Blur;真实样例里的对手手握没按的名册减伤(Ice Block、Evasion、Aspect of the Turtle……),因此他们的击杀窗口和窗口内的漏驱散都消失了

### 性能

- `a3fcff9e` 首屏重新回到预算内(CI 比值 5.7 → 2.6):驱散汇总按单位缓存不能施法区间,重按切分只索引一次 REFRESH 行。605 文件输出逐字节相同

### 评测与验证工具

- `933c2838` `2a9264c1` `81146d03` `88fade8d` `fact2Scan`(每个审计过的事实类一条确定性检查,新增 inHandRewind、stackedDeferral、racialPressedInside、kitInHand、riderShieldLine、ledgerRosterUp、kitTooltipLasts)与 `talentDurationVerify`(持有者与非持有者「跑满」寿命对比)

### 其他

- `c4645a92` `9901ccba` `4274bbc7` `2071437a` `5d4d76bb` PROMPT_VERSION 427、431、433、434、435
- `bcd5ec8d` `7ac8ade0` lint 告警上限保持 1572

## v0.1.36(2026-10-20)

一个月的事实层工作。教练时间线逐行对照日志实际所写核了一遍,改写成如实陈述真实的游戏状态:印出的 HP 低点是真正的最低点,印在它发生的那一秒;控制写明是谁或什么解掉了它、它怎么结束;PvP 饰品按键列出它解掉的每一个控制;宠物的驱散点名那只宠物;没有按键开出的对面减伤写作 `[no press logged]`;对面的 Champion's Spear、Smoke Bomb 和 Tremor Totem 按键有了 `[ENEMY UTILITY]` 行;目标开出自己的减伤、免疫或吸收盾时,击杀窗口随之关闭;日志不写光环的沉默(Solar Beam)在有被拒按键证明时显示出来。打断锁定现在只锁它锁住的那个学派,击杀窗口在目标死亡和回合结束时结束,冷却台账能看见玩家实际按下的减伤。每一处增删指控的改动都先在 605 文件采集上预览、经用户批准后才落地。

这批工作经过多轮跨 AI 审稿,每条发现都钉了一个先失败的测试。参照表在钉住的 commit 上分批重生成(GH #115),WoW 数据刷新到 12.1.5.70391。桌面端新增可选的 AI 自查,用 findings 自己的 prompt 复核 findings(离线实验错误陈述 48 → 15),默认模型改为 Claude Opus 5.5。

### AI 分析 —— 战报对你说的话

#### 踢技与打断

- `21070935` `1fd9fffb` `11a6872c` `796d9cb8` `d3a28634` `1cc1bb6c` `b849da7c` `25047a2a` `2dc4fa7d` `73c5dd26` `6408863a` `6b3665db` **打断锁定只锁它锁住的学派。**过去每个读者都把任何打断当成锁住所有法术(605 文件上有 1,199 次被锁学派之外的按键落在锁定期内)。cd-hoarded 和同步窗口的就绪门改为逐法术判断并写出被锁学派(**候选增加**:cd-hoarded +2,missed-sync-window +9);漏驱散 / 漏净化、踢技优先级、cc-avoidable、`[CD PRIOR]`、爆发窗口可行性、死亡块的漏选项和 `[DEFENSIVE AVAILABLE]` 随后跟进,每项都先经 605 文件预览,并写明数字说的是哪个法术
- `d7d3cfff` **kick-eaten 按锁定期内双方的压力评判一次打断**(用户裁定,GH #113):每行写出最低 HP、有无死亡和双方冷却,双方都平静且我方没有爆发就绪的打断被丢掉(dps 1,030 → 998,治疗 506 → 475)
- `de3aeb57` `9c65b55b` `c28fab1b` **kick-eaten 增加候选**:每回合上限按压力给打断排序,死亡或危机血量时的前两次打断不计入上限(1,450 → 1,850 行,用户批准)。压力只算打断时已在运行的冷却,处于完全免疫中的单位不算「低血」(−36 +12,随后 +4)
- `78b46830` `36908dcd` `1c523fc9` `4ce68664` kick-eaten 读取被拒按键——游戏拒绝施放时不再说「啥也没做」或「等完了锁定」(≥ 162 → 0);昏迷中交饰品或种族技能算破控(24 → 0);行内点名被锁学派(「instant or channel」804 → 0),并且只在法术射程比打断远时才建议拉出射程
- `ea2790f6` `508307f0` 打断之后,一个法术只有所有学派都被锁时才算被锁;「switched」行带偏移量列出被拒按键,按键连发不算新按键,锁定在被锁学派的第一次成功施放处结束(switched / acted 1,924 / 809 → 2,111 / 622)
- `9a39c98c` `b1b0cf48` 法术已经放出后再踢在引导上标为 `phase=channel`(1,536 行中 273 行);多学派锁定列出各学派,「burst ready」不再声称这次打断拖慢了你的节奏
- `cf27fc9c` **新增:录像玩家自己的读条控制。**kick-eaten 写出你自己停掉了几次硬读条、骗掉了几次对面的打断;踢技面板多一条显示同样计数的条带(语料:硬读条 66% 读完、17% 自停、6% 被踢)
- `44ab92a8` `1935dc0f` `aab9a5c2` `fb759123` `2818d271` 取消计数读读条的方式与 `[CAST STOPPED]` 完全一致(1,869 行中 126 行),因你死亡或回合结束而断掉的读条不算取消。「JUKED by fake X」点名打断前最后开始的那条读条,且只在没有别的原因结束它时才点名(970 → 782);`kickDepthPct` 以你自己读完的读条为基准,绝不截到 100(75 → 10 行)
- `b7e92ac3` `dd3d5541` `63fc9df6` `68a609b8` kick-eaten 行写出因其他原因被拒的按键(202 行)、同时带沉默的打断,不再出现 50,000 码的占位射程,写出 `kickLandedFromYd`(196 行),插值得到的距离标为近似
- `0e71f311` `0f2d9e2b` 「我方低点」和「对方低点」只在锁定期印出的秒数内读取(166 → 0);先记一条伴随施放的硬读条(Chrono Flames)以它本身为换法按键(`0e71f311` 上线时标题是占位的;`0f2d9e2b` 补记)
- `c5a20f11` `a7197940` `e8305ed2` `9eb859c9` 打断距离读可施放的那个法术(Skull Bash 13 码,不是 100;Mind Control 34.5,不是 134.5)。只有踢手能在治疗落地前够到治疗者,才算「漏踢」——定身会截断跑动(定身列表加入 Ice Nova 和 Harpoon)
- `d0956fe0` `96c98c0a` `e5b2d663` 谁本可以打断在读条开始时读取:空闲的踢手、突进技能、不能移动的 owner;死亡或被控敌人的打断不算「UP」;`outRangeable=yes` 需要有一个踢手远到读条期间走不过来(76 → 10 行)
- `1d352ea8` `1293c3ed` `b73689fe` `036170bd` kick-priority 写出它评判的区间、打断的射程与可达距离、打断转好了多久,定身就叫定身,并写明一个治疗数字合计了几次施放(打断射程 0 → 91)。kick-eaten 统计同一踢手本回合的打断次数(0 → 1,225),kick-priority-missed 写出玩家当时在读什么,刚停掉的引导之后的打断算被它骗掉
- `76db805e` `7b149088` 打断审计一次打断只记一条;落地的沉默不算「什么也没打到」。被反射的控制或沉默锁住其持有者,驱散反噬锁住驱散者,Storm Conduit 持有者的打断锁定 ×0.6(cc-avoidable −1,missed-cleanse +1,用户批准)
- `a024f160` `24ce73b7` `05e976d5` 受控宠物施放的法术(Spell Lock、Devour Magic……)查宠物自己的控制和锁定,而不是 owner 的;图腾和守护者仍算 owner 的(0 个候选变动)

#### 冷却与救人

- `efc522b4` `28cbee6f` **台账能看见玩家实际按下的减伤。**正向完整性扫描补上了 Survival of the Fittest、Greater Invisibility、Alter Time、惩戒骑的 Divine Protection、Lay on Hands、Spellwarden 的 Anti-Magic Shell 和 Transcendence: Transfer;13 条错误的专精排除去掉,共享的 DB2 充能池让两个法术一起消耗(cd-hoarded −177 / +187,cd-waste +158)。用户签字:Greater Invisibility(60%)和 Divine Protection(20%)成为有定价的减伤,Lay on Hands 算爆发应对
- `cc7ab31a` `bb2b48c9` `024c9af3` `cb36a1aa` 专精的基础减伤在没按的回合也留在台账里(cd-hoarded 1,245 → 1,266),条目带另一个法术 id 的天赋能证明它赋予的按钮(Fortifying Brew、Avenging Crusader、Incarnation / Celestial Alignment、Berserk、Lay on Hands)
- `cb8b7729` `1fce5ef6` `d5f0d915` cd-hoarded 把越线前刚按下的救人算进来,已有大减伤开着时保持沉默(2,241 → 1,858);给了另一个队友的救人不算回应这个单位的危机;限学派的救人只在覆盖了大部分危机伤害时才点名
- `20edc688` `59fd92cf` cd-hoarded 按瞄准危机单位、落地并被吸收的伤害评判限学派救人——即 `[KILL ATTEMPTS]` 的判据(+1);Anti-Magic Shell 只在至少一半危机伤害是魔法时才算(−7)
- `f81ab360` **指控需要一个当时能动的 owner。**玩家被沉默、被踢、被昏迷或被困时,cd-hoarded、cc-avoidable 和 missed-cleanse 不触发;死亡的队友不是合格的驱散者;单排回合第一次死亡之后的结论被丢掉(删掉 123 条)
- `31836ea2` `ae41cd54` `4ed039df` `bfe5eff1` `33a41478` owner 门按日志顺序配对光环,算入敌方宠物和图腾,并在回合结束处停止;cd-hoarded 写出 `ownerCc` 和 `ownerFreeS`。空闲区间从危机那一秒开始,昏迷只在它能阻止那个冷却时才算(Shockwave 下的 Icebound Fortitude:空闲 5.0 秒,不是 3.0)
- `cfce4256` `f337f942` Divine Shield、Ice Block、Icebound Fortitude 和对自己施放的 Blessing of Protection 在昏迷中可用(DB2 免疫路径);控制解除与它自己施法者的那次施加配对(−3)
- `2478cb35` `985741e9` `639b6fb4` `41e9b29c` cd-hoarded 写出被拒按键发生在何时、你还能行动多久(1,313 行中 634 行);在 GCD 内被拒的就绪冷却算一次尝试。cd-waste 写「从未成功施放」,技能组写作 `[UNUSED — pressed N×, refused: …]`
- `e0012b99` 危机点的「前 2 秒伤害」截止到它的 HP 读数,于是越线那一下被算进来(cd-hoarded +16 / −11)
- `02d64099` `bbbc4eee` `e105bbd3` `fc4d2f3b` 一个决定,一张卡:同一受害者 5 秒内 external-unused 优先于 cd-hoarded(−63)。cd-hoarded 绝不点名你付不起的冷却——费用取该单位自己施放行写明的数,解析器现在保留它(Innervate 豁免)
- `bd321b4f` `972e47b5` `ad41d1fd` `a7fc4db5` Emerald Communion 算团队救人(+9 / −10)。**候选增加:**Mass Invisibility 成为可指控的减伤,只有带 Improved Mass Invisibility 时才够得到队友(+31 / −13),但不进 cd-waste。Feign Death 只算回应,从不被指控(635 → 617)
- `4c501cb1` `e5f4375e` `4117f97b` `17d05417` `fe55309a` Death Pact 加入死亡骑士台账(+5 −2),Lichborne 和 Smoke Bomb 作为功能技加入;Time Stop、Tree of Life 和 Havoc Metamorphosis 有了行,Flameshaper 的 Obsidian Scales 点名它落在哪个队友身上(用户批准)
- `5b6f4465` `c1ced674` 「从未按下」把同一充能池的按键算进来(cd-waste 983 → 938),一条 cd-waste 行把共享池的按钮一起点名(25 → 22);低压力 NOTE 只点名仅限自身的减伤
- `17b85fa5` `87026ad2` `592e3e63` 「有更便宜的可用」对团队救人只给能作用于团队的工具,对被昏迷的 owner 只给昏迷中可用的,且绝不给 Avenging Wrath(两轮 3,143 → 2,711);`[DEATH] … Unused` 用同一规则
- `55f81a65` `e4532584` Barkskin 和 Frenzied Regeneration 是恢复德鲁伊应对自身危机的救人,从不被指控;大减伤开着时 crisis-no-response 保持沉默(12 → 9)
- `471649ce` `1d1c1747` slow-defensive-response 写出你给队友的救人何时被拒;crisis-no-response 写出你当时按了什么,而不是「did NOTHING」
- `10272d40` `7315f4fd` cd-hoarded 写出你何时刚按了自己的爆发、按了哪些还在冷却中的减伤;missed-sync-window 写出被攒着的冷却何时进了下一次治疗被锁
- `2547c4a5` `bd5a6e19` `af1ad016` 谁打破了光环从破除行背后的那一击读取;Blessing of Sacrifice 的分担是圣骑士自己的法术(cd-hoarded +14,crisis-no-response +1)。为危机单位按下的转移类救人算回应了 cd-hoarded(−24)
- `a19623f7` burst-into-mitigation 只在减伤覆盖了爆发 60% 以上时触发,这道门取自数据(163 → 35;2v2 不动,用户裁定)
- `9b99eb04` `1f199ca8` **「就绪未按」有一秒反应窗口**:死亡或危机前不到一秒才转好的冷却不算未用(删掉 35 条 `[DEATH] (Unused: …)`);`[CD PRIOR]` 和爆发应对可行性用同一规则

#### 同步窗口、爆发与击杀窗口

- `b72807af` `d8b6240b` `d938a685` `3a426dfb` missed-sync-window:Immune 的控制不算窗口,一次连续的治疗被锁算一个窗口,「就绪」冷却需要空闲的 owner,正在运行的爆发算已进入,治疗的冷却只有 Power Infusion 算数(dps 1,100 → 642,治疗 550 → 321)
- `d75a3d95` `e8834062` `fdf3e198` `ab13c330` 锁定时长用控制行的格式化函数,在回合结束处截断,只给回合内的部分排序(756 → 726)。每个就绪冷却写明是谁的;单排里一行只在冷却或控制是你的时才给你(42 → 25)
- `ce125136` `905d1c86` missed-sync-window 写出冷却何时按下、何时转好,持有者为什么按不了,最低血的敌人,以及锁定怎么结束的(+12)
- `bd097f52` `2d36e612` `169491be` 进攻冷却只在它的增益挂在玩家身上时才算「运行中」——没有 10 秒下限,宠物身上的副本不算(Stormkeeper 区间中位数 15 → 5.5 秒)。kick-eaten、position-mistake、slow-defensive-response、burst-into-mitigation 和 questionable-external **都有候选增删**
- `07ab3c83` `2b7ea99a` **Empower Rune Weapon 不再算进攻冷却**(点名它的行 3,099 → 30;+13 −8,用户批准)。你按下的、对面那一侧会印出来的冷却算已按(1,826 次中 1,719 次没有行;missed-sync-window 807 → 747)
- `8db675ae` `b0fb637b` `9904cb96` **击杀窗口在目标死亡和回合结束时结束**(765 条 `[VULNERABLE]` 行中 53 条从尸体上开始;3,926 个单排区间跑出回合 → 0)。指向已死目标的 kick-priority 行被**删掉**(−6);两道新门守住这两条
- `24181198` `937b9dc4` `df5744b7` `c71c308d` `a855704d` **「无防备」区间在目标自己的救人处结束**:外部减伤、Blur、Greater Invisibility、Burrow、Time Stop(−119 / +10),它自己的 20–99% 减伤、免疫、吸收或区域救人(kick-priority-missed 45 → 38,团队 67 → 58),以及牧师的 Spirit of Redemption 形态(241 次失败 → 0),全部经用户批准
- `19538fe6` 单位自己拥有且还没按的 20–99% 减伤,在击杀机会分档里算在手(prime 4,712 → 3,734)
- `8ffcb686` `5930b49d` 死亡玩家不持有冷却——统一一个 dead-at 判据。击杀窗口的团队爆发算入拥有的宠物(68 条 `[VULNERABLE]` 行变成击杀窗口,用户批准)
- `45ae2188` `e45b3877` `e6de661c` 控制只有落在正在打受压队友的单位身上才算应对爆发(1,552 次中 252 次落在治疗身上)。受压友方取窗口内死亡的那个,优先于任何存活者;死亡友方在死后没有自救

#### 净化与驱散

- `4b72b713` **候选减少:**missed-cleanse 分档读签字的驱散裁定矩阵(新增 16 行;418 → 342 条)
- `8ca286ee` 驱散可达性从渲染秒开始扫,视野也真的被计算了——区域 id 读错了字段,所以这项检查一直只看射程(missed-cleanse 438 → 422)
- `e018e7b7` `fbf1266c` **候选增加:**猎人和 Devourer 恶魔猎手能驱散(`[MISSED PURGE OPPORTUNITY]` +540 / −241);Shattering Throw 应对免疫护盾,Shiv 和 Arcane Torrent 保持限定范围,在增益结束时的驱散也算(+19 −24,用户批准)
- `4820dfd0` `43e58265` `87bede27` `7e5a0f60` `4629caba` 漏驱散窗口在回合结束处结束(超出的 59 → 0),重新记录的光环不开第二个窗口;刷新型按键读它那个光环的结束(用户批准)
- `722c4d35` `ca8aa68e` `40924fde` missed-cleanse:取消的读条不再写「mid hard cast」(34 行);变形掉定身不算净化(`[CLEANSE]` 4,858 → 4,522);被 Mind Control 的队友只能被驱散
- `e1e2eedc` `adff9faa` `abb54e1f` 被敌方宠物打破的控制是被伤害打破的,不是没净化(+1 / −2);每条 BROKEN 行都算,无论它点名谁
- `296e4b25` `1f748efe` `40ca9059` `056fe589` `c937e58a` `9dab5701` missed-cleanse 点名你的驱散、它会移除的反噬减益、你被拒的尝试,只对有 DR 的控制写 DR 风险,写出定身已证明可达的秒数、净化的真实恢复时间;占用时间算读条、引导、喝水和蓄力保持;控后伤害排除 Void Leech 和 Spirit Link

#### 死亡、站位与控制

- `89ff539b` `4bd49a86` **候选减少:**death-setup 的「饰品过早」和「减伤过早」两种形状——后来的死亡无法证明更早的按键过早(dps 907 → 579)。healer-locked 需要击杀窗口内 ≥ 3 秒控制且受害者确实受到伤害(869 → 525)
- `90252b88` **来自用户自己 3v3 输局复盘的六处修复**:3v3 候选在第一个友方死亡处停止(用户裁定;删掉 126 张 dps 死亡卡),`[IMMUNE]` 只针对玩家(2,372 → 1,679),「free Ns of Ms」绝不超出窗口,一条格式错误的结论不再让整次运行失败
- `85c4f38f` `dd91ca98` `3197a11a` `e8744d52` STAYED IN / KITED 和 position-mistake 量到打你最多的那个敌人(2,156 行中 974 行;**减少**:294 → 176),绝不在你自己的尸体上,并在印出的窗口上读 HP(532 次门失败 → 0)
- `dd8249dc` `beccfcfa` POSITIONING 行点名区间内的爆发目标和最高伤害输出者、owner 被控了多久,并跳过 owner 无从左右的窗口(+10 −16)
- `a09c498b` `ab72caed` cc-avoidable 只给你本可以按的工具——不给 Divine Shield 或 Ice Block,读条中要有 ≥ 1 秒的空闲 GCD(89 → 62);被打断的读条不算空闲时刻(−3)
- `4f32e742` `50f5ba8d` `408e3636` `6828e3eb` **新增:PEEL OPTIONS**——友方死亡前,对主攻手就绪 ≥ 3 秒的瞬发控制,作为选项,从不作为结论(友方死亡的 28%)
- `8a6e8bfa` `43355cfd` **新增:CC USE**——你拥有的每个控制的使用计数,以及最多两个 `[CC BOOKMARK]` 时刻,从不算漏放(PEEL OPTIONS 235 → 208);两者都通过施加的光环读 DR
- `5c1ecc2f` **新增:`[FORCED TRINKET]`**——在你的击杀尝试中,你的控制在敌方交饰品后 3 秒内落地,记为时机得当(从不记为逼出了饰品,也从不记为击杀)
- `d06a86c5` `e927b9e3` **新增:观察到的后果。**`[CONSEQ]` 显示一队在其治疗被踢或被控期间的 HP;教练可以陈述接下来发生了什么,不做反事实(100 回合上有依据的句子 14 → 49)
- `9daf0a44` 统一回合结束:控制窗口、未净化窗口和治疗空档停在单排回合的结束死亡处(−12)
- `d111a142` `7b113bb4` `68dbabd9` `f040b861` `687bdc81` 死亡铺垫点名离死亡最近的锁定及其被锁和空闲秒数;漏选项查不可施法判据,并写出施法者最长的空闲段;KILL SEQUENCE 点名治疗的锁定链;owner 死后的死亡离开菜单
- `63f3dfbd` `04a3eebc` `419882bb` `ac7478eb` 用户批准的、会移动行的事实修复:Deep Breath 和 Dream Flight 期间不能施法,缴械阻止武器法术,同步窗口按观察到的结束判定是否进入,读条开始即结束一次打断锁定,Summon Infernal 持续 30 秒,Ice Nova 是定身,Wake of Ashes 未命中不算 `[CC NOT LANDED]`(slow-defensive-response 99 → 95)

#### 可靠性遗留(GH #107、#109)

- `91f065e1` `72bddd8f` 天赋替换取自官方数据(Nature's Swiftness 上的 cd-waste 12 → 0),Astral Shift 和 Psychic Scream 不再被减两次,只有 proc 的激活渲染为 `[PROC]` 而不是按键;被你自己变形结束的德鲁伊形态增益会写明;SPEC BASELINES 显示你的分数,低于 2100 时读作高分玩家的做法;中文请求要求中文事实字符串
- `86d71d4f` `[ENEMY HARD CAST]` 只给落地的读条(13,297 → 2,302——瞬发的 Hot Streak Pyroblast 被当成了硬读条);队友的控制以 IMMUNE 被拒时打上标记(0 → 1,450);施法者身上的 Blessing of Sacrifice 不算目标的减伤;敌方窗口时长读天赋(带 Reign of Tyranny 时 Demonic Tyrant 20 秒)
- `a75d53a2` `8513a101` `b19b851f` 危机可以由控制 peel 或任何团队救人回应(cd-hoarded dps 893 → 666);Cauterizing Flame 离开救人名册;missed-sync-window 需要你在锁定的一半时间里空闲;external-unused 需要可达(Darkness 是 8 码区域),敌方宠物踢手从宠物处量;饰品只在控制结束 50 毫秒内才绑定到它(「out of X」11,191 → 10,975)
- `ec984045` `c0c94505` 死亡行点名致命一击和最后 5 秒的最高伤害,包括被吸收的部分和延后伤害(Time Dilation);团队救人集合包括 Spirit Link、Barrier、Aura Mastery、Rallying Cry、Darkness 和 Zephyr(cd-hoarded dps 666 → 642);burst-into-mitigation 只指控已经开着的减伤(dps 44 → 7);敌方 `[KILL]` 行在 433 行上印了原始角色名——现在用名册标签
- `fe8bf626` `f53203f1` `c5af5985` `d062116f` `[BURST ANSWERED]` 记给第一个到达该单位的回应;「off-target」窗口 3,559 → 579;重新广播的光环算一个光环;KITED 需要是你拉开的距离(1,965 → 1,556);HEALER TRAINED 点名打了治疗的蹲守者(2,579 → 1,399);召唤物通过 owner 命名(裸「[pet]」4,305 → 5);未就绪按键在语料全部五种语言里都能识别;missed-sync-window 需要目标可达,并折叠重复的锁定(dps 604 → 506)
- `f5f7798b` `58c87398` **新的时间线事实** `[GROUNDED]`、`[REFLECTED]`、`[CC REMOVED]` 和 `[REJECTED]`;`[RES]` 列出你自己的打断和 Death Grip(0 → 4,408)
- `8cc7d09b` `27a822c9` `5f30b5c1` `2bef1356` `6b0dacfd` `b5e16700` 第 7–14 批的事后 codex / agy 审稿,每条发现都钉了测试:完全被吸收的命中点名攻击者(「Unknown — absorbed」1,228 → 11),团队外部减伤算应对爆发,统一一个延迟时钟,每次引导一条 `[REFLECTED]` 行(728 → 642),`[GROUNDED]` 写作「was redirected into」,KITED 记你在拉开距离中的 Shapley 份额,「you moved N yd」与门 G4b 共用,`[RES]` 显示充能和天赋缩短后的打断冷却

#### 菜单、prompt 与措辞规则

- `68c3bc36` 不再出现与台账矛盾的「the only cooldown left」或「the whole time」说法(50 份回复上 32 → 8)
- `a59903bc` 菜单表头陈述引用规则,而不是声称每一行都「provably happened」(47.3% 的行是关于没发生的事的事实)
- `0de6f51b` `1f599438` 菜单小时,findings prompt 要求「最多 N 条,每个菜单事件最多一条」,审计丢掉与前一条引用相同事件的结论(195 → 178)
- `973fbd42` cd-waste 写「this round」而不是「the entire match」(单排里 64% 的行在另一回合按过)
- `be89bc59` `f3cb4f94` 每个时间事实都向下取整到时间线的秒——113.957 秒的陷阱曾读作「114.0s」;一个语法树测试挡住下一个
- `2903812c` `cae10531` `15afb214` `3479acae` `a382c929` `9d6d0cd5` `dfe1dfa3` `74cffe18` `14bad33d` 图例:`[DMG SPIKE]` 的整秒边界,KILL ATTEMPTS 用「ran into」代替「cause」,给原本没有图例的事实补图例,`attempted` 包装改用英文,kick-eaten 的爆发事实写作「a cooldown was running」,不再指向未印出的图例,只给治疗看的行对 DPS 隐藏
- `e413993c` `[MATCH PATTERN]` 表头关闭,直到它的标签来自模型自己的运行——8 个里错了 7 个(2,742 → 0)

### AI 分析 —— 时间线事实

#### HP 与伤害

- `09b5b629` `dadebbc0` `9bc547e8` `49cdcf55` `d080f5bd` `46f708bf` `f1237fb7` `46603a80` `2b76a9bd` `92b1341c` `7745fa86` **印出的「低点」是真正的最低点,印在它发生的那一秒**(用户裁定)。`[DMG SPIKE]`、`[CONSEQ]`、爆发账本、`[BURST ANSWERED] bottomed at`、kick-eaten、STAYED IN、slow-defensive-response、`[KILL WINDOW]` 团队最低值和 `[CD PRIOR]` 读真正的最小值(6,845 个低点中 815 个比它高 10 个点以上;低于日志的低点 310 → 0)。决策仍留在网格上;kick-eaten −9
- `b0cca85f` `7141a674` `18305d6e` `[STATE]` 刻度有了图例;`[DMG SPIKE]` 在受害者死亡或回合结束处关闭,死亡时读 0%(16,613 个桶中 165 个跑出了对局)
- `0985a884` `efc05f62` 按键行上的 HP 是按键时的 HP——网格的一个签字例外;owner「本场」最低 HP 在回合内读取
- `cc944a73` 每个危机秒都有 `[STATE]` 刻度(1,322 行中 735 行没有 → 0,新门),你对危机单位的施放展开列出,以及 Alter Time 的回溯(0 → 553)
- `650fb921` `2cefc738` `d665a3a3` `[DMG SPIKE]` 图例写明只列 5 个最大的窗口,并计数被丢掉的;ABILITIES INTO IMMUNITY/DR 保留占比 5% 以上的法术(845 → 1,829 份 prompt);`Top sources` 一个技能只点名一次
- `57b0e994` `779f84ae` 伤害来源的阵营按其名册判定,再分配不算受到的压力;mitigation-audit 行写明它们的重叠在最后 10 秒内

#### 控制、DR 与破控

- `d1137675` `31af1368` **一张施放 → 效果光环表**,取自 DB2,在语料上验证过(手工映射漏掉的 69 对):记在效果 id 下的 IMMUNE 或 MISS 标到施放上,控制行点名它打中了谁
- `e8a53b47` `6d4bdcde` **新增:`[SILENCE]` 行**,双方都有(11,276 行)——之前治疗看起来可以自由施法。日志不写光环的沉默(Solar Beam),有一次以被沉默为由被拒的按键证明时,写作 `[SILENCE] … no aura logged`(25 行)
- `5d6347e3` `c72b10fa` `e9bd4209` Infernal Awakening 按官方机制是控制和昏迷,没有 DR 链(1,048 行)
- `b75e1db0` 没有记录结束的控制在其完整时长处关闭,而不是在对局结束(一个开门前的 Sap 曾读作「(276s)」)
- `b200ce8e` `84be4c59` `ef20116e` `1e60e698` `77ec7356` `c59b8f65` `ffa6801f` DR 按施加顺序计算,召唤物的控制记到 owner(`[DR CLASH]` 7,964 → 8,261);重施的 REFRESH 是一次新控制;重发间隙内的控制重施算两次,重新施加的未结束控制算一次
- `11056c0c` `54526a66` `9f4d03c8` `18e53c47` **PvP 饰品解掉了什么**:官方剩余时间最长的控制,退而取沉默或缴械;记录到破除或驱散之后不再记功,并列出它结束的每个控制;我方有了 `[DISARM]` 行
- `0f973729` `d2517991` `36069698` **谁打破了控制**:种族和职业技能渲染为 `used X out of <CC>`;伤害破控点名 `breaking hit`;无法解释的亚秒结束写 `cause not logged`,或 `ended by their Bladestorm`
- `d3412823` `8a64a74c` `c3fac0e0` `09d48d68` 控制行写出控制如何、何时结束,用 `<1s` 代替 `0s`,写出刷新(`refreshed at m:ss`)和移除它的按键(没有写明结束的 474 → 204)
- `e5c6ff88` `6aa23656` `ff86facc` `ae27703c` 1 毫秒内的 REMOVED → APPLIED 重新广播算一个光环,光环在它的 REMOVED 处结束,而不是在之前的 BROKEN 行(被提前截断的区间 1,352 → 0)
- `6d70a38c` `78d8b1d3` `f94611fa` `0bc690cf` `708d3dc1` `3a66d0c4` `5956f7a6` 控制行:统一一个时长格式化函数,AoE 控制按目标分别算 DR,`[ROOT]` 写出单位施放了什么,`[CC REMOVED]` 写出还剩多少,`[DR CLASH]` 把你自己的冲突排在前面,合并后的治疗锁定写作 `Fear ×2`
- `e2374e37` `b5327bf4` `dce81a4b` `6a1e4e26` 未命中的控制写作 `[MISSED on X]` / `[REFLECTED by X]` 并带原因;落地的控制绝不是 `[CC AVOIDED?]`(334 → 0);`[CC AVOIDED?]` 写出日志的未命中类型(1,504 行)
- `0099a96d` `a639a290` `f8ce87ae` **新增:`[CAST STOPPED]`**(1,402 行)和 **`[CC NOT LANDED]`**(3,138 行)
- `c575e25c` `c091d676` `505ef887` `80de07aa` 施放后几秒才落地的控制(Capacitor Totem、Sigil of Misery、Ring of Frost)与它的落地配对,而不是读成「没落地」(`[CC AVOIDED?]` −103),并在命中的那一刻读取;被拒按键归到原因所指的控制;因施法者被踢而结束的引导控制会写明
- `5ce10e10` `da1eb024` `d3b58433` 区域控制列出它落在谁身上(裸 `[YOU] [CC]` 1,905 → 28)
- `dc6b5898` `207753df` Oppressing Roar 下的控制多持续 30%(活过其标签时长的 47 → 8)
- `3088ee93` `[CC ON TEAM]` / `[SILENCE]` 列出你在其中按下、被游戏拒绝的冷却(1,226 行)
- `1f59f00a` `86b775da` CC USE 写出开了几次读条、放出了几次(`Cyclone … 4×, went off 0×`)
- `18a7eb50` `5ef309b7` `bf7a347b` `c91f39f6` `aebdb9e6` 可施法性把驱散反噬读作控制,把友方破控者的 BROKEN 读作控制结束;沉默只阻止 DB2 说它能阻止的东西;DR 历史和未净化窗口用共享的重新施加读法;缴械做了配对;KILL ATTEMPTS 忽略进攻方挂在目标身上的光环

#### 打断与施法

- `23e6e20d` `3b45d56d` `00e61aa8` 什么也没打断的打断写出日志的未命中——IMMUNE 并点名免疫(0 → 333)、被反射或未命中(0 → 108);你的打断有了审计结果(0 → 1,580);敌方 Death Grip 有了行
- `3d7b3610` `05e8623a` `48851c12` 只有结束了引导的打断或控制才算引导「被打断」(67 → 31);`[channel cut by CC after N.Ns]`(0 → 107)
- `fb5bf4a0` 队友死亡附近的被拒施放总是显示,Smoke Bomb 有自己的拒绝类型,友方死亡点名斩杀技
- `35ee9a43` 被拒按键原因覆盖 zh-TW、es-MX、fr-FR 和 ru-RU(未映射 583 → 0)
- `0fa2399d` `6b4eadc4` `55160c70` `fa0c21c8` 重评审计修复,候选无变化:被拒按键有了措辞并写明(无措辞 28,671 → 4,486),每次锁定一个 HP 低谷,读条在下一次 GCD 按键处截断,自我移除、驱散者被控、减速和友方免死的事实,Penitence 的目标,以及只在某行族存在时才交叉引用它的图例

#### 冷却与减伤

- `29c97c29` `c7a38dac` `ad4df655` `746db8e0` `3c220cb6` `2a1b6cbf` **敌方减伤印出它的作用**:`(absorb Nk, Ts)`、`(heal)`、`(dodge)`、`(cheat-death proc)`……而不是 `(self-save)` 或 `immune`(替换 13,068 行;697 次 Feign Death「免疫」中 510 次期间有伤害落地);Ultimate Penitence 有了行(0 → 372)
- `fefb6b48` `469be80d` `4d95151d` 敌方自保(Desperate Prayer、Touch of Karma、对自己施放的 Guardian Spirit……)有了自己的 `[ENEMY DEF]` 行(4,332),他们挺过的击杀尝试写作「self-saved (X)」;自身减伤按天赋定价(Barkskin 20 → 30%);你自己的 Touch of Karma 不算目标的减伤
- `2a4e0fc7` `961129c6` `54e99854` **敌方自保、治疗和拉人都算**:Death Pact、Evasion、Healthstone、Ice Barrier 等,Leap of Faith 算外部,Vanish 和 Cheat Death 算免疫;Blur 和 Greater Invisibility 在它们记录的 id 下被找到;区域技能渲染为「X (area)」(`[ENEMY DEF]` 16,645 → 37,714)
- `583ef4ca` `1b1a6762` `97afdcef` `4e5259a5` 只有光环的敌方外部减伤有了行(442);驱散反噬读同一张表(6,397 条错误的控制行消失);`[ENEMY DEF] … | during it:` 写出你的攻击者做了什么(2,103 行)
- `e81b5ff2` `9a9fd81d` `b2f3f642` `6d1fac16` `6d8dfe48` 没记录结束的印 `end not logged`(1,302 行);学派免疫点名其学派;Fortifying Brew 被找到(0 → 275);Blessing of Sacrifice 是一个按钮
- `7793ee2f` **没有按键的减伤**:没有按键开出的副本写作 `[no press logged]`,绝不因时长被说成开早了;友方 `[PROC]` 写出它随什么一起放出;Radiant Glory 无施放的 Avenging Wrath 有一条 `(no press)` 行
- `40563ec5` `f84e161b` `8ebec13b` `4cca243b` `25c3ad3c` **新增:`[ENEMY HEAL CD]`**(5,741 次按键),含 Tree of Life(0 → 334);变回该形态不算按键;Time Spiral 不算
- `c1813046` **新增:`[ENEMY UTILITY]`**,用于敌方 Champion's Spear、Smoke Bomb 或 Tremor Totem 按键(2,604 行)
- `a0871050` `e3bcccd5` `4c4fb104` `78e81225` `a09e94ed` `a4e91136` `cb7c5e58` `[BUFF FADED]` 和 `[ENEMY DEF]` 写出日志的结束原因(「ended early」1,871 → 969);一切都在回合结束处截断,而不是日志结束(432 中 360 → 0),那时仍挂着的增益不印结束行
- `97a68209` `7c4898f6` `63addfac` `589e5613` 被你的死亡剥掉的增益会写明(230);只作用于施法者的减伤渲染为「self」并带你的 HP(474);Guardian Spirit 写出何时触发(0 → 218);Power Infusion 写 `also on you`
- `864e9fd5` `592be42b` `c994cbd4` `b4908ad6` `859883a6` `93c02c05` `b12f6910` `1892a2f2` `82e48250` `[RES]`:付不起的就绪冷却打上标记;Darkness 只在区域内才为另一个单位点名;够不到的站位技离开 `rdy:`;每个回合从满行开始(182 → 0);`-0s` 10,644 → 0;Forbearance 和 Hypothermia 从日志读取(94 行上 Ice Block 未就绪);按键从它渲染的那一秒起算消耗(289 → 3)
- `b7c8ab0f` 你自己按下的、对面按键已经印出的救人有了行(1,743 → 0)
- `709aaeb9` `ab68f275` `aa374425` `317593a0` Stasis 在其就绪光环结束时释放(`[STASIS RELEASE]` 77 → 138);Reclamation 这类被动 proc 对八个「玩家有没有动作?」的读者都不算按键;天赋触发的效果在 `[ENEMY CD]` 上算 proc;proc 的触发源只在施放处点名,不占 GCD 的按键不会结束正在进行的引导
- `67a8ace6` `3c9d0c7d` `e3732171` `56cb3c91` `ec29cab1` 额外的爆发冷却点名施法者(8,315 条 `[BURST ANSWERED]` 行中 2,272 条);`[BUFF FADED]` 读按在哪个单位上的那个副本;death-setup 和 `[HEALER CC]` 链显示空档和打断锁定;刷新过的增益不印虚构的「expired, estimated」结束
- `bddf75c2` `4fb54724` 爆发账本能看见记在另一个光环 id 下的减伤(Greater Invisibility、Blur、Fortifying Brew)

#### 敌方爆发、击杀窗口与击杀尝试

- `9c2b67d8` `348f723a` `a65101ae` `4ed48d16` **产品看不见的爆发**(GH #115、#119):爆发也从光环读取——Havoc Metamorphosis(0 → 1,447 行;冷却 120 秒,取 DB2 值)、Doom Winds(37 → 132)、Summon Infernal(30 秒,16 → 1,283)、Radiant Glory 的 proc Avenging Wrath(用户裁定)
- `97d06e0c` `f79f6ecd` PvP Heroism 算进攻冷却;**候选增加**:Army of the Dead、Dark Transformation、Bloodlust 和 Heroism(+23 / −13,用户批准)
- `911ddbac` `a870133e` `c853e2de` `960d9656` `1023be26` 落地的地面或 AoE 控制算应对爆发(未应对窗口 73,183 → 49,755);`[BURST ANSWERED]` 写出谷底何时到来,队友死后不再记功,并点名控制打中了谁
- `47585d12` `dd7bbf98` `f6410727` `c1313fc8` 治疗进攻和 `[BURST ANSWERED]` 通过施放 → 效果表读 owner 的控制,所以从未落地的控制不算应对;一次爆发的各项结果读数共用一个结束点,回合结束后的按键被丢掉,HoT 跳数只有在 HoT 是窗口内挂上时才算新的自疗
- `c3543503` `0e06477e` `ae8010e3` `59548cc0` `b02d677e` `ca978ef3` 爆发账本:各自的区间、网格的 HP、只有完全免疫下才算 IMMUNE、被吸收的伤害和第二目标;`Aligned with:` 改为 `Ally CDs overlapping:`(7,538 条中 4,557 条没碰到任何人的目标)
- `11402ca6` `0763cb1f` `757c54ac` `e2f0f092` `df754ec6` `6aa3bbc2` `8e29559e` `[OFFENSIVE WINDOW]` 表头在回合结束处结束,绝不出现 `0:42–0:40`,只点名与之重叠的伤害尖峰(8,154 中 444 → 0)
- `4e8fc0a0` `7423398c` 击杀窗口就绪状态写明何时读取、有什么变化;「unreachable」逐秒判定
- `093da6e3` `2592b371` `c988c09e` `5b68c084` `[KILL ATTEMPTS]`:失败原因是尝试内的救人或开始时已开着的救人(Anti-Magic Shell 现在在 `[ENEMY DEF]` 上,+1,547);单凭自身达成击杀的爆发保留,一次死亡只记一行(重复记功 57 → 0;KILL 行 1,578 → 1,819);括号区间在回合结束或死亡处结束(714 条超出 2 秒以上);行内印出括号区间内的伤害
- `b502d70d` `e4c597a6` `a933f6b8` Burrow、Vanish 和 Mass Invisibility 在看到光环结束时才算;救人和外部减伤都点名;我方神圣骑士的 Avenging Wrath 不锚定任何尝试
- `c10bc1a5` `45cae8df` KILL ATTEMPTS 写出开始时开着哪个减伤,以及我方对目标的 Cyclone(373 行 → 0 条沉默)

#### 净化与驱散

- `61113052` `f955ee54` 你的驱散渲染为 `[PURGE]`(+616),带敌方可驱散增益数;小驱散带名字折叠
- `58728dc8` 由自身按键附带的 `[MINOR DISPELS]` 写作 `(side effect of the cast)`(3,687 行)
- `9f4d03c8` 宠物的驱散点名宠物、守护者或图腾

#### 站位、死亡与回合结束

- `7c6488e1` **「Offensive cooldown out of range」用该法术自己的射程**——统一的 15 码尺子曾在 21 码处指控 Grimoire: Imp Lord(516 → 2)
- `d4e352da` `3120cd2f` `c2e87b6a` STAYED IN / KITED 点名距离量到谁(门 G4:350 → 0);`[PEEL OPTION]` 标上「at m:ss」;Death Grip 不算你自己的移动
- `1226d3c9` `6300ad89` `7e4ef3c4` `4164e920` `da6b30e8` `c3cd1cbd` `[HEALER EXPOSURE]` 量每个控制的真实射程(威胁 26,099 → 18,555);落地的施放证明视野;召唤物的控制算 owner 的;HEALER OFFENSE 空闲时间扣掉沉默
- `6e1c49cb` `19d63efa` `bbdcaa9b` **统一一个 PvP 饰品判据**:Medallion 取自 36 个 DB2 物品 id(74 次错误的「available」),Will to Survive 锁 60 秒,Adaptation 被识别(0 → 51 / 51);「no breakable CC in the last 10 s」(547 个标记)
- `80b0fe94` `e5cac2ed` 教练过去靠猜的事实印出来了:`[DEATH]` 上的 dampening、敌方打断何时转好、`[SLACK]` 中的团队最低 HP、减伤时长、STAYED IN 窗口内最近敌人的距离;HEALER TRAINED 印出治疗真正被控多久(1,331 条「no CC on the healer」中 857 条是错的)
- `fd02c30c` `e582b916` `53516969` `[CONSEQ]` 绝不在死亡旁边说「no teammate dropped」,治疗被沉默有自己的行;被 Grounding Totem 吃掉的法术用一个判据,所以陷阱显示为 `[GROUNDED]`;敌方 Touch of Karma 写出是谁喂的、伤害去了哪
- `22f2b151` `fdc3a84a` `cfc1958a` `468180cb` `ba951f9e` `64b002cf` **统一一个 2v2 dampening 起点**,从第一个记录到的层数推得(159 份 prompt 不一致);读取层数下降;dampening 按行所属的队伍
- `73c4d952` `c2386096` `3ff85c97` `1bdfd501` `6c89928b` `[UNIT DESTROYED]` 写出召唤物存在了多久,并覆盖被杀的宠物(0 → 155);召唤物按日志所写命名(图腾 0 → 3,494);名册列出每个术士宠物;宠物的破控算宠物的(433 → 0)
- `1d5378f1` `1cd95ae9` `ba00e2cf` `ded32c36` 上下文行用名册标签(裸名字 10,570 → 0);MATCH FACTS 印出房间 MMR,基线写「personal rating」
- `312518e5` `28c354df` `d3576d4b` `294b9c61` Spirit of Redemption 写作 `:ghost`(0 → 9,247);召唤物的 `[ROOT]` 点名正确的施法者;`[STACKED DEFENSIVES]` 标签一致(4 → 0);什么也没改变的 `[RES]` 行被丢掉(717)
- `8ed8bd30` `852b68e3` `99191d08` `[CONTESTED]` 只对有读条可打断的控制写出施法风险和就绪的敌方打断;ENEMY CC KIT 列出落在其单位上的每个控制,`(landed N×)`;全时长光环按整毫秒读取,未知站位上不声称 SPLIT PUSH
- `9443b697` `e297224a` `f6a680cc` `67be227b` 等距的 HP 样本按一条规则判定(2.46% 的读数);德鲁伊的法力跳过形态样本
- `b2e7d29e` `f1ec20d1` `830d23d9` `ad5981ae` 审稿跟进:每个驱散读者都能看见本回合的宠物;区域救人截断其光环覆盖的每一段停留;dampening 处处按读者自己的队伍读取;只有魔法驱散对魔法增益才写「took X instead」;写明的救人包括转移;敌方时间线把无施放的光环与它之前的按键分开;无光环沉默只通过职业自有效果点名来源,并在 owner 死亡处停止。没有增删候选

### 战斗日志解析

- `2576b626` `b266718d` **近战平砍计数正确了。**只记为 SWING_DAMAGE_LANDED 的平砍是伤害事件(缺失的 5,767 行 / 3.9 M 伤害 → 0),平砍的伤害事件取受害者侧那一行(归错的 1,501 次平砍 → 0)
- `b999ce1c` `77060686` `bb6ca55e` 伤害事件的有效量是它移除的生命——数额减去溢出,不再二次扣除被吸收部分(用户裁定;候选 +22 −17);被护盾吃掉的命中是对被打单位的伤害,而不是对护盾 owner(+1);延后护盾只是推迟的伤害只算一次(6,070 个事件中 30 M 重复计算 → 0)
- `20ebf165` 本回合没有召唤事件的守护者从它自己的高级块取 owner(无 owner 守护者 3,063 → 1)
- `bdb440e1` 坠落伤害(`ENVIRONMENTAL_DAMAGE`)按它自己的偏移解码,不再产生 NaN 数额(57 个文件上违规 65 → 0)

### 冷却、天赋与法术数据

- `6c1ff1e0` **WoW 数据刷新到 12.1.5.70391**(热修截至 2026-10-15):PvP 嘲讽天赋 20 → 15 秒,Merithra's Blessing 60 → 30 秒并改为奥术,Improved Mass Dispel 60 → 75 秒,Ice Block 在 PvP 中经 Winter's Protection +30 秒,新的 DR 条目。可能增删候选行
- `18b648ea` **产品读错的天赋。**对 3,491 个天赋的全面审计发现了绕过天赋感知台账的消费者(敌方打断、易伤窗口、死亡块、治疗控制就绪、击杀窗口可达……)、缺失的逐级和脚本化冷却天赋,以及驱散 / 打断机制。全台账不可能的按键 752 → 311(Alter Time 266 → 0)
- `357715dd` `cb328d3b` 竞技场冷却纳入冷却天赋的 PvP 缩放、专精被动(治疗 PvP 饰品 −30 秒、神圣的 Divine Toll……)和逐级天赋(比模型短超过 1 秒的间隔:32,243 中 6,816 → 5,762)。台账只数按钮按键——不算 proc、引导跳数或被天赋替换的法术
- `a21d066c` `f2d27fd3` `3eb635fb` `a4c86367` **被战斗缩短的冷却印出区间**——`(a–Ns)` 或 `(≤Ns)`,取自实测重施下限表(Recklessness、Pain Suppression……;留出集上,真实按键前「certainly on cooldown」11.2% → 1.3%)。Storm Conduit 持有者与其他人共用一个判据;按键不再被标在下限之前(124 → 78 行)
- `a3a23a04` `6c4ae9a4` `a7835127` `e8e41992` 没救下人的 Guardian Spirit 在增益结束 60 秒后转好(台账矛盾 26 → 0),技能组写明其冷却如何取决于按键;Alter Time 持续 10 秒而不是 20(1,512 条配置行);Bladestorm 的两个 id 合为一个条目(1,188 条重复行 → 0)
- `218b0739` `a5d8f1b9` `730f00e1` `4d0a6bd1` `f9435bad` `b058d094` 增益时长:经 SpellLabel 又找到 27 个天赋修饰,时长由产生它的技能决定(Shadow Blades 20 → 16 秒,Trick Shots 经 Volley)或由蓄力等级和连击点决定(Rip、Rupture、Envenom、Fire Breath);分层天赋节点按条目读等级
- `759d8e4e` `71d43abf` `da32344d` 本赛季见到的 55 个控制法术加入法术分类(缺口 55 → 0);Cyclone 和 Incapacitating Roar 按官方 DR 类别;六个按光环 id 列出的控制冷却改按施放 id 进入台账,补上 14 个缺失的,未知 DR 族写作「DR n/a」(`[CC BOOKMARK]` 412 → 733;缴械只针对近战,用户裁定)
- `35c55d4a` `b3e24b29` `30564f79` 每个射程都是施法者自己的——基础射程加上持有的射程天赋和专精被动(戒律 46 码,恩护 +5 码);触发法术的 100 码占位射程让位于其施放的射程。在 732,037 次指定目标施放上对照游戏的判定检验过
- `881766ac` `a637d104` 视野几何对照游戏自己的判定检验(留出集上错误「blocked」10.6% → 2.8% 和 3.5% → 0.9%);野兽控制猎人算远程(SPLIT PUSH 56 → 32)
- `11984194` `27e5a0b5` Quell、Silence 和 Counterspell 按官方时间冷却,持有 Coldthirst 或 Light of the Sun 时更快(`[KICK] … back m:ss` 与同一单位下一次打断矛盾:4,471 中 85 → 3)
- `a580825a` `1c876685` `a6ea331a` `0c0aa906` `72cc5d20` 标为**可能增加指控**、等用户采纳后才落地的冷却数值:Boomstick(Lethal Calibration)、Born To Be Wild(Aspect of the Turtle 2 级时 120 秒,cd-hoarded +1)、Ardent Defender 90 秒(已标记,语料薄);Spellwarding 随其共享池恢复,300 秒而不是 180
- `23c4ba38` `b27998f6` `c25f08e8` `d90baeac` `3008c60c` `5c283dd5` `ebb689de` Storm Conduit 围绕 2026-08-18 热修按日志日期读取:恢复萨满每次施放先 4 秒后 2 秒(重施「not ready」59 中 27 → 1),被打断的 Lightning Bolt 先 ×0.35 后 ×0.6 锁定;解析器能读原始行写明的时刻
- `c48cbdf9` `1cbc7228` Champion's Spear 有了台账行(**已标记:新台账行**;[TEAM] +720,[YOU] +385 行),它可选的再次按下不算第二次按键
- `6ba6d2bb` `76707699` `91f40fc8` 对自己按下的 Roar of Sacrifice 在语料拆分确认后印出官方 25% 减伤;其图例写明它不算大减伤
- `e5a9e213` `1e2fe9a4` `73a1bfc9` Wildfire Bomb 每颗炸弹只算一次(0.3 秒内的命中);带补丁日期的数值只在距切换点 14 小时以外才取旧值
- `39007a52` `3d6e1a34` `7ea75f9a` 天赋未知的单位不给未经证明的冷却;Quaking Palm 按 DB2 是瘫痪;统一一个「这是不是打断」判据——没有学派锁定的沉默算控制(249 条 Strangulate 离开 `Kicks:`,用户裁定)

### 参照表

- `1fcec5e9` `41ef7d55` `0078f5e5` `4a46b355` `22f705ae` `ccb3db74` `8a9cfd85` `8d6d832a` 同步窗口表按新的 missed-sync-window 规则重生成,终于跑在完整的 63,303 文件归档上(窗口 118,267 → 107,357,每格都高于 3 pp 门槛);爆发窗口、cdTriggerPrior 和 kick-priority 跟随台账变化(没有超出样本量的变动)
- `c330552f` `867447ba` `8b3c0076` `854cc12f` 在钉住的 commit 上分三批重生成(GH #115):九张参照表、参照向量、cd-hoarded 结果参照和重施下限,最后一批在 PROMPT_VERSION 381(Boomstick 的下限去掉,39 → 38)
- `b0885605` 在完成的事实层代码上做第四批(PROMPT_VERSION 425):十一张表、参照向量和 cd-hoarded 参照——slow-defensive-response 跨 3 pp 门一进一出各一条,其余只是引用数字变化;恢复德鲁伊的生命之树和自然迅捷在玩家提前重按时冷却显示为区间(GH #154)

### 桌面端

- `e88e08c1` `fc1b36ec` `9c7deae9` `5dcfa1dc` **AI 自查(可选,默认关闭)。**首次分析之后,用同一后端和模型再调用一次,对照 findings 自己的 prompt 复核,保留、修正、弱化或删除陈述——从不新增。离线:错误陈述 48 → 15(准确率 90.7% → 95.9%)。数字保持符号和大小,超时会中止请求,问教练跟随复查后的结果
- `566c04d4` `2fe1bcab` `6c9a7c49` **Claude Opus 5.5 成为 Anthropic API 和 Claude CLI 后端的默认模型**;Opus 5 仍可选,Sonnet 5.5 加入下拉框(手设的 id 曾悄悄回落到 Opus 5.5)
- `1018f1bf` API key 用户不再因回答被截断而丢掉分析:输出预算适配自适应思考(超预算 3/8 → 0/8)
- `48e83e07` `8762b5ab` 两个对局 id 不再能互相覆盖对方的库文件夹;空结果写明分析没找到值得一提的东西,而不是缓存过期的提示
- `8521e4af` `43d980a6` `3b4dea9e` 驱散面板、漏驱散卡、统计表、回放的控制区间和死亡回顾在回合结束处结束,并像 prompt 那样构建摘要(不一致的行:483 中 12 → 0,1,447 中 17 → 0)
- `2094fd5e` `361a07bc` 驱散面板列出漏掉的限定移除(Shattering Throw);missed-sync-window 卡写明每个冷却是谁的
- `287a6229` `3b301ae7` 很长的分数历史不再撑破统计面板;死亡回顾每场只算一次
- `fdc3a84a` `468180cb` `cfc1958a` `44ab92a8` `aab9a5c2` `fb759123` 2v2 dampening 泳道从 0:00 以推得的值开始;踢技面板的读条控制条带和漏踢卡跟随修正后的取消与骗踢读法

### 性能

- `698fc588` `9d3de0dd` 光环区间按流做 memoize:构建一场对局的上下文快 33–37%,输出一致
- `ae52c335` `c48e7a00` 全库扫描异步运行,大库不再冻住窗口(500 场上最长卡顿 176–213 ms → 14–21 ms)
- `32650c89` 破控与控制链面板的推导重新变快(81 → 24 ms),输出逐字节一致

### 评测与验证工具

- `03f66f67` `57fefb23` `cafc2afb` `baacbf99` 评测按应用的方式构建菜单(198 行曾不一致);buildCorpus 读 gzip 归档(之前产出 0 场);每个 prompt 脚本都等待天赋数据(降级数据上 25 → 0)
- `37109f5b` `8b568c9b` `f0e22947` `8847a76c` `ea892153` `d99a57a0` 门:「free Xs of Ys」落在窗口内(193 → 0);控制距离按渲染秒取(变异检测 61.3% → 95.3%);一次完整的行门运行抓到两个自己引入的回归(580 次失败 → 0);回合结束之后不再有 `unpurged for Ns`(143 → 0);破控扫描记给正确的破控者
- `8607b996` `8a495cf1` `bf985839` `e98b7f09` 评测回答者有了因果与焦点纪律(50 份上无依据的因果句 57 → 0);responseQuoteScan;consequenceProbe,`[CONSEQ]` 背后的双臂探针
- `b312d34f` `07e7c66f` `16177786` `80872aee` logCensus 清点归档:63,303 个文件、108,060 个回合、0 次解析失败;一份从原始日志到 prompt 的字段覆盖台账和一个 HP 并列扫描
- `664536a6` `f03f6bf8` `0c349fe2` `3266ce62` 天赋影响审计做成三个可重跑的扫描和一份生成的 talent-coverage-gaps 文档;一个进攻效果完整性扫描(找到了 Havoc Metamorphosis 和 Doom Winds)
- `b900dc62` `1a5c4c73` `e297224a` `b7a559b7` `77f02fb1` `5b52d41d` `1dc110b1` `ac3c8e13` 探针:治疗可达距离及其真值检验、饰品纪律(以上下文事实收口)、ablationVocabJoin、summonExampleGen、candidateCastContext、auraCooldownModScan、不设上限的 kick-eaten 扫描
- `3cac0b05` `0b262c7a` `4b2f87e1` `3680dbed` `a5e9d256` `936303f2` 扫描脚本加固;共享一个 `fmtTime` 和 CLI 参数辅助函数;四个无引用的探针归档
- `8368b411` `dd817aa4` 审稿预筛把原始流交给法力查询(错误不匹配 75 / 307 → 0);match-explore `mana` 遍历完整序列
- `bce5fdf7` 首屏门把重场景与同一次运行的对照比较(比值 6.7)
- `2fc6b3bc` `ed715f31` `1df73618` `122d9e67` `db09291d` 为读条、位移、事实对原始扫描和四个未命名的门补测试;解析后的库共享(22.3 秒 → 1.7 秒),原始日志每个文件只读一次

### 内部重构(输出不变)

- `00519c5c` `cd56547c` `f09fcf80` `3717cb46` `20b60255` `e4969f1b` `dc78c1df` `d9358e01` `527a130e` `60398f62` `b294b73e` `e021efdd` `92077542` `21b96098` 4,125 行的时间线构建器拆成分节输出器,现在只负责编排(`matchTimeline.ts` → 995 行),每批在 605 个文件上逐字节一致;去掉无副作用的裸 import(GH #116)
- `5036227a` `410b88da` `172b4498` 原始日志读取走解析器自己的函数,专精表移到 analysis,专精到字符串的表只构建一次(5,221 → 11 ms)
- `fe5c1714` `c2de0254` 两处没有渲染变化的潜在判据修复:合并后的按键从其施放时间开始恢复;对他人施放的免疫不是它自己的破控者
- `f2996af1` `ed0ce01e` `4bb48bde` `39bde8b9` `d0193dc0` `14c3b853` `25d21721` `186cdd52` `528c93a6` **候选减少:**未接线的 cc-locked、wasted-trinket 和 death-unused-defensive 输出器及其他死代码(prompt 逐字节一致);删掉深挖路由、重复的辅助函数、退役归档器的 plist 和 22 个一次性探针

### 其他

- `fa651376` `ce36485a` `1d532a67` 测试:用假定时器修掉一个 CI flake;JSON 表用 JSON.parse 解析(analysis 测试 389 秒 → 72 秒);扫描不再对共享数组重新排序
- `a701227b` renderer 和 preload 只能 import 白名单内的 analysis 模块;日志管线测试不再在零文件上通过(GH #117)
- `5f860cd9` 在日志授权步骤会话过期时,带重新登录提示退出
- `cc8b22e8` `09415732` `daddeb01` Lint:eslint --fix 和警告棘轮(2,042 → 1,572);合并修补和 import 顺序
- `74bc1345` `0de04a31` `eb3e93ec` `86c0a959` `ed626748` `9511e7d3` `9225021c` `11770d42` `4bf36b08` `7e2a3c95` `43bc6174` `506b8d28` `5f2060a0` 分析改动和新的自查设置行之后刷新视觉基线
- `6407b687` `97538e11` `10345334` `8c3275fa` `8596c4a8` `ae42aa6f` `344deb59` `94388b0f` `a5bd8635` `47563ecc` `5cb5bd43` `f6263447` `d511b212` `235f4d38` prompt 版本记录 368–382,每条带 605 文件的前后对比
- `0856709c` `06858c5d` `2f1ff8d3` `3f6c084c` `ff0a9fa9` `465294db` `6bb408a1` `e667437a` `032ec2f3` `f59319c2` `a30af24a` `207b6943` `b219ccef` `c44179f2` `d41cc770` `2541e184` `47d0f1b6` 谓词索引行、钉子和「not yet unified」注记;CLAUDE.md 记下低谷例外
- `4db3c3e0` `858375f2` `cf5dac13` `155b473b` `deb58cf0` `40511920` `c8f6bc75` `4ee16e5f` `f1c03464` `58d59c61` `9b7f3e27` `d5fe89ba` `7c5ebb39` `580b2c1e` `2445a303` `4de7d683` `34e8e732` `30be3f46` `c1d5fc6e` `998c29e1` `faebc736` 文档:裁定、backlog、判官标定、运行手册,从 CLAUDE.md 和 skill 里删掉过时规则
- `30b36740` `bc30ae5e` `17339051` `3ba4e656` `5d2931fe` `91b9704c` `468a108e` `6fa414ab` `84234d11` `a006cb7f` `47f4279b` `32e29ffb` `0c5af4f5` 文档:规则历史移出 CLAUDE.md,文档地图和语言政策,包级 README,数据与脚本索引,prompt 版本历史独立成文
- `59d08ceb` `1451001e` `b4ce74a9` `c19bb16f` `c0a332dd` `1d869d95` `22d4c284` `8340c1bb` 文档:谓词索引行、知识笔记与裁定、精选的公开知识笔记、下一轮抽象层工作的计划
- `fcde27b1` 未做项迁到 GitHub issue(GH #123–#152),文档改为指向那里

## v0.1.35(2026-09-22)

一个修复版本,由两条用户反馈和一周的 prompt 工作驱动。击杀尝试事实不再责备起手打了饰品在手的目标——开场时所有人的饰品都在手;点名了阵容里没有的职业或专精的教练结论,在进战报之前就被丢掉。底下,对面的减伤、饰品和召唤物带上了上下文(它应对了什么、谁够得到那个图腾、根基图腾吃掉了哪个法术),宠物和图腾的死亡在 12.x 日志上重新可见,进攻大招表做了一次完整性扫描,找到了产品一直看不见的那套爆发。

### AI 分析 —— 战报对你说的话

- `e00e31b6` **起手打饰品在手的目标不再被当成失误。**过去每条 `[KILL ATTEMPTS]` 行都盖上 `locked (trinket up) … FAILED` 并计入统计,0:05 的起手也不例外。现在行里写 `trinket up (no softer target)`,或者点名当时确实存在的更软目标,汇总只数有更软目标可选的尝试(本机 1,241 回合:盖 locked 的行 6,269 → 0;`attempt-into-trinket` 卡退役)。同一提交把对局事实里的专精绑到玩家名上,点名阵容里没有的职业的结论被丢掉
- `3bd1e3f8` 阵容检查把中文昵称和完整专精短语钉到专精而不是职业:把神牧叫成奶骑的结论会被丢掉,哪怕阵容里确实有骑士(用户自己那份回复:6 保留 / 0 丢 → 5 / 1,丢的正是那条)
- `087be204` `bde4c493` v0.1.34 上线的两张治疗队友危机卡退役,统一挂在一个开关后面——辩论结论是这条指控定义不清(先落地「已有人阵亡不提示」,然后整体关闭)。事实行 `[STACKED DEFENSIVES]` 保留
- `8f3da9ae` `[KILL WINDOW]` / `[VULNERABLE]` / `[CONTESTED]` 行印在一个承诺「团队 ≥85% 血、对面无大招」的表头下,而只有 slack 行真的满足这个条件(288/309 份 prompt 自相矛盾);承诺现在只挂在它管的那一行上(GH #99)
- `536eec38` 图腾或宠物按同名召唤物在单位表里谁先出现归队——两边各有萨满时,一个电能图腾能「晕自己队友」(309 份 prompt 里 16 份共 48 行)。归因改走来源 GUID(GH #99)
- `9108994d` `5e95eef1` `9a2764de` `b6addf7b` `kick-eaten` 写出踢在读条的多深(30% 以下是假读条机会)、最近的踢手离多远、几个人在射程内;排除被打断和被污染的读条,审稿修了宠物技能集和 fixture(GH #73、#87)
- `008bd981` `9de01dcd` 被打断的法术分成治疗、控制、伤害、其他——踢得最多的 60 个法术 100% 归类;谴责和心灵游戏算伤害(GH #79)
- `16338aeb` `missed-sync-window` 写出控制落地时的 DR 层级;整场没见过对面放的打断标为 `(assumed)` 就绪,而不是默默当作就绪(GH #72、#88)
- `b2034102` 法术反制的学派锁定为 6 秒(官方 5,语料众数 6.10 秒,n=619——用户裁定);第六秒的机制写明未知

### AI 分析 —— 时间线上的对手上下文

- `fa450f04` `4069d870` `91b8085c` `c24a1564` `82ebd83f` `a01b8049` `fbc6a890` `[ENEMY DEF]` 和 `[ENEMY TRINKET]` 行带上下文:饰品解的是哪个控制、减伤应对的是你哪次爆发、目标当时的血量——进攻光环记到施放的那一方,只数真正的大招(GH #69)
- `ac784d37` `[DR CLASH]` 写出友方控制因为队友刚把目标推上 DR 而落在 50% 或免疫,点名两次施放和间隔(GH #67)
- `c07bc37f` **宠物和图腾的死亡回来了。**`[UNIT DESTROYED]` 原本依赖一个 12.x 日志只为 13,439 个召唤物中的 5 个写出的事件;现在依据日志仍然带着的溢出伤害——同一切片 24 → 3,076 行,战栗 / 灵魂链接 / 根基都在内(用户裁定 2026-09-20)
- `c6fef058` `e6ee732a` 对面的灵魂兽或灵魂链接图腾**没**被杀时,`[ENEMY SUMMON]` 写出它挨了几下、你方谁够得到且空闲了多久——作为事实,替代漏斗证明太薄不值得上线的指控(695 回合里 8 个)
- `a8d0eaf2` `f4163970` `700cc845` `fe6226b7` 友方战栗图腾结束恐惧记在 `[CC ON TEAM]` 行上(探针切片 0 → 71 条),对面战栗结束你的恐惧记在 `[CC ON ENEMY]` 上——控制实际被饰品、种族技能或驱散解掉时绝不记
- `58d7ffb2` `addfae20` `886c2926` `96d04a4d` `da533c3d` 根基图腾的注记点名它吃掉的法术(用户要求 2026-09-20);攻击法术无名的吸收不再把注记上所有名字一起丢掉
- `130e69f4` 适应算作饰品

### 冷却表

- `b57d7a9b` `c573cf89` `613fef3b` `9ba54d3b` `cfe215ae` `fc6e51dc` `512470b0` **进攻大招表整个漏掉了踏风的爆发。**风火雷电已按死亡 id 退役,接替它的极致从未登记,所以每个「对面开大了」的消费者都看不见它。随后的正向完整性扫描(rot 扫描的配对,以回合内伤害提升为尺)又加了十一个——虚空形态、现役 id 的剑刃风暴、巨人打击、王者之刃、齐射、辛达苟萨之息、末日之风、魔法师之触、魔典:小鬼领主、自然之力、伊露恩之怒、掠食者之息——48 → 60。审稿发现极致仍被十一处内联的「按键间隔 vs 充能」冷却读法挡住,现在统一成一个共享判据;同步窗口参照表按扩大后的表重算(2 倍对比仍成立)
- `c04a3fe5` `e803463d` 万灵之召刻意不进表(无专精门);手工表里的死亡法术 id 清掉

### 桌面端

- `79ffed05` 视觉基线按扩大后的进攻大招表重新生成(fixture 对局多出一条队友结论)

### 语料工具

- `ee8647cb` `36e2fbee` `62d78afc` 每日日志拉取自己同步到 Drive(205 个文件 / 2.53 GiB 从未离开过本机),我们自己的日志也上 Drive,2026-09-16 起从没跑过的 3v3 步跑起来了(实机 10/15 → 15/15)

### 评测与研究(无产品改动)

- `eb7701e4` `b7634b57` `511980b5` `f95067b5` `4841135a` `98d044f2` `bd3d7924` `ed44bd94` `dbd783b7` `343d9d92` `466c54eb` `31250fa3` `6a49bcc1` `67efeeac` `9f78aef8` `f87ee8da` `90c8ce7f` 日志可观测性审计(GH #100):原始日志还能告诉我们什么——高级块槽位辨认出来(剩余吸收、朝向按弧度标定)、过期的灵魂兽 id 找到、猎人 / 术士宠物阵亡窗口量出来(术士宠物 46% 的情况再也没回来)、资源与朝向按用户裁定关闭为教练方向
- `33896549` 消融无变化 `[RES]` 行的探针:模型对删掉它们没有反应(Jaccard 0.800,噪声底 0.802)(GH #99)
- `35986d0c` `9cacd681` `315fd394` `981cf045` `8d1fb58b` `13cca20c` `0eefa27b` `e1c6d941` `5f5e2394` `a1a8b6f2` `783de6f5` `3d317e12` `3701bb6d` `5974f6de` `0b28e96a` `79d296cc` `2575d994` 代码审稿批次:位置样本先排序再采样、战栗扫描提速、关键 NPC id 集中一处、不可施法检查改为区间求交、评测扫描脚本加固(文件追踪、错误处理、CLI 校验)
- `8a5831da` `62248524` `3eb9a124` 覆盖率:钉住最近的爆发 / 减伤冷却,给资源、射程、不可施法、memoize、学派、进攻浪费、专精基线和 DPS 指标补单测

### 其他

- `5a232e41` `a19ceb01` `5f70dce0` `77bf5910` `456ea3ac` `1193fb17` `d89d7a24` prompt 版本变更记录补链接,注释路径更新,presubmit 建议与 parser / eval 双语 README 对齐,待裁决清单、BACKLOG #49(四个抬上限杠杆,暂停),以及对手上下文行的设计与实施计划

## v0.1.34(2026-09-18)

一个教练层版本。治疗的危机信号现在覆盖「正在被击杀的队友」,不只看治疗自己的血——两张新卡,各带全量语料参照;危机判定还改对了三件事:天赋自动触发算应对、早就挂着的 HoT 不算主动按键、「对面开了大」全产品只用一个判据。底下,天赋接入(GH #96)整条线落地:冷却、持续时间、减伤的天赋修正从游戏数据编译出来,按扫描前写好的规则对着语料验证,然后打开。踢技优先级、驱散反噬两条信号经确认 A/B 进了菜单,时间线去掉了几处重复行,参照语料换成 2100+ 归档。

### AI 分析 —— 危机与队友

- `61475d5a` **新的治疗卡:队友掉过危机线,你什么都没放。** `teammate-crisis-idle` 只在这些条件全满足时出现:治疗整个窗口都自由(任一秒都没被控、被踢、被沉默、没死)、没有读条在飞、40 码内且有视野、有蓝、没施法没起手、没跑位、不在掉线段、身上没有你的 HoT 在跳——而且队友自己也没应对。同一提交加了 `[STACKED DEFENSIVES]` 事实行:两个人各给了一张大减伤叠在同一个友方身上,谁给的、重叠几秒、后开的那张挡了多少——只陈述,不写「一个就够」
- `5e55bea8` 这张卡背后的参照,来自 116,063 个归档回合:534 个这样的时刻(约 220 回合一次),队友 10 秒内阵亡 83%,治疗有应对时 10%,两组过同一套过滤。目前只有 3v3 过样本门
- `9e0e019f` **第二张卡:治疗把危机窗口花在了救错的人身上。** `teammate-crisis-triage`——同一道可行性门,但治疗在给一个血量在危机线以上的友方施法,而穿越的队友什么都没得到。参照:治疗的目标不在危机时队友阵亡 44%,目标也在危机时 21%(单排;3v3 不过样本门,不出声)。同一提交:`cd-hoarded` 不再在「低血天赋触发或防致死救了、人也活过窗口」的时刻指控握牌;「对面开了大」在敌方 CD 窗口、危机事实、队友卡三处只用一个判据——必须是真正的冷却,不是诅咒或 DoT
- `5a249db7` 危机事实里的「敌方爆发 CD 已开」原来读的是一份私有的 34 条表,不是全产品统一过的 47 条正典进攻表;同一语料切片上 3v3 危险时刻里对面开着大的比例从 30% 变成 45%。还加了两个脚本:打印真实卡片、逐事件追踪一张卡——新信号先读过再信
- `989c7d7e` **天赋自动触发现在算应对危机。** 精确本能自动放出的狂暴回复按它的标记光环识别,算作应对,它的治疗不再被当成主动按键或 HoT 带过来的;图例让模型说「天赋触发了」而不是「你按了」。另外,猎杀的竞技场冷却补成 60 秒:官方 90 秒(永恒狩猎后 75)被 1,401 次连续施放的 60 秒硬底推翻,台账里「还在冷却却放出来了」在 1/20 切片上从 1,196 次降到 0
- `8875557f` 游戏里所有自动保命天赋逐个过同一道语料检验,六个有可验证的标记——精确本能、抽血、自然守护者、百战活力、金色瓦格里算 proc,灸灼、装死单独算「防致死」,话术是「天赋替你挡了一次死」,绝不是「不用再交别的」。梦境向导查出来是发给别人的 buff,驳斥命运 / 炼狱 / 最后一搏 / 历战老兵样本太少验不了——都不登记,不猜
- `bf99e320` `872d682a` 危机参照表按这两臂重建:「没应对」总体缩小(2v2 3,255 → 2,883,3v3 1,781 → 1,652),每格里原来记在「HoT 带过来的」名下的份额降了约 0.06——有一大块其实是精确本能
- `0ba3ed1e` **危机前就挂着的 HoT 不再被说成自疗按键,攻击者自己走开不再被说成风筝。** 两者仍算应对——总体完全一样——但应对构成重新归属(2v2 自疗 0.55 → 0.24 加 HoT 带过来的 0.31)
- `7f5ce6d9` `23ca7de7` 治疗自己的真言术:盾 / 虚空之盾、渐隐、救赎之魂、回退、神圣赞美诗、树形态、熊形态、古树之灵、终极苦修、宁静算应对危机;徽章 / 种族技能只在后面跟了真动作时算,位移只在真的拉开距离时算——参照表按此在全量重建
- `077c501e` `7351ed28` `80fc353c` `6c1e0d09` `39e7cb68` `c4dac85e` `4dcbe4e5` `c07796b5` `1b396751` 队友卡背后的探针和三轮 codex 审稿:把第一版「啥也没做」形状否掉的漏斗与手读、爆发窗口上的时机形状、两个百分比减伤相乘的实测、暗影斗篷物理减伤追到 Bait and Switch、带审稿裁决的设计记录

### AI 分析 —— 天赋(GH #96)

- `69096f6d` `6916e677` `af45c9ba` **冷却天赋修正从游戏数据编译,不再手打**:武僧 / 恶魔猎手 / 唤魔师职业集、充能回复百分比、临时增益、行身份都修了;共享的天赋证据清单喂给冷却规则编译器,与旧生成器逐行对等;参照表重生成
- `76c51425` `fe04a713` 教练做的每一个危机 / 爆发 / 减伤判断都可追踪——存在过哪些机会、哪些被压掉、为什么——外加不可变的事实开关配置和判断级 diff 工具
- `c7241ff9` `2a23b9da` `94b4d2ed` `84b5d748` **减伤统一经一个解析器定价,认天赋。** 所有「那张墙挡了多少」的消费者读同一组分量(百分比、免疫、学派、载体);百分比的天赋修正只在语料拆分落进扫描前声明的区间时才转正(11 条里 7 条),开关已开。暗影斗篷 20% 物理减伤在全量上转正;`burst-into-mitigation` 现在要求墙至少覆盖 30% 的爆发(暂定)
- `cae735ae` 审稿意见落实:未确定的选择节点不再算「点了」,优胜劣汰降级,玩家聚类敏感性报告,M4 接受者过滤修正
- `a76aabda` `f80dd8a3` `7304c5cb` 持续时间修正同法验证:百发百中 +2 秒、暴虐魔君 +5 秒、碎骨者的震荡波眩晕 +1 秒、铁木树皮 +4 秒(再生心木)——每条都过了首次运行前预声明的规则
- `5325c993` `d0b35723` `b8ec1198` `dbb680f9` `7bf52f28` 冷却编译器漏了两种编码(按法术类别、按法术标签)——补回 274 行,爆发窗口与同步窗口参照重建;焦油缚链解释了束缚射击的 3 秒;猎杀的 60 秒硬底在数据侧找不到来源;脚本型天赋审阅记录了哪些是故意不建模的
- `1d71f897` `fd094a77` `68931658` `89613ac0` 全部 3,491 条天赋的目录(解析后的描述、代码引用)、所有加保护的天赋扫描、危机应对完整性扫描与分片天赋扫描;BACKLOG #41(6) 被减伤分量关闭
- `31d356ae` 天赋共享的墙按承载光环的单位定价——塑焰者的黑曜鳞片对施法者 30%、对盟友 15%

### AI 分析 —— 新信号与 prompt

- `82bf961c` **踢技优先级**:敌方治疗对你的低血击杀目标读条治疗,你的打断就绪且在射程内,没人踢——建在官方的逐玩家打断技能集上
- `2f955048` `26cec7bf` **驱散反噬**:把痛苦无常 / 吸血鬼之触从安全目标身上驱掉在语料上是净亏的;卡片镜像语料的代价 / 收益模型,受表守护
- `96217226` `4959f9b7` `3fe53d32` `7a9cd396` 两条都走了预注册 A/B:第一轮 n=78 结论是迭代(审稿修正落实、受审面收窄),Opus 上 n=40 的确认轮采纳。同一轮顺带关了一个缺陷——任何含逗号的事实值都会被截断——新增一类硬失败门规和一个序列化器
- `5622560b` 死亡窗口内的 `[ENEMY DEF]` 行和逐次施法展开(GH #97)
- `f123004b` `[DMG SPIKE]` 行标注低谷,客户端语言(中文)名字不能再漏进 prompt,击杀窗口列表按时间排序
- `4f9e4e61` `481fd5d6` `26eeddb9` `1f94e24b` 一件事只占一行——控制施法、自身增益、漏净化机会折进各自所属的行;圣疗术 / 神圣壁垒不再渲染两遍;判决标签变成「满足了什么条件」;窗口外的进攻峰值带标记(GH #99)
- `af785348` `d3b8ba97` `469514b2` 因果语言 lint 把「所以你赢了」和输的判决一视同仁,并识别英文判决句式;评测 responder 按打印原样引用窗口边界、时间戳和血量(GH #98)
- `51aebfb9` 对照第二赛季攻略读教练输出,找到并修了六处可测的正确性缺口

### 候选注册表、参照语料、实验

- `4c5816c0` `53ca82c1` `99cad7af` `64f31820` `5ddd3d0a` **一张注册表决定候选类型活不活**——开关、赛制名单、桌面忽略集、教练语料名单都从它派生;负对照从语料观测真相生成;新增 DPS 视角诊断切片(`burst-into-mitigation` 同样回合 0 → 11.4%)
- `db19aded` `2c735351` `24a9a927` `baaca696` 生产参照语料换成 2100+ 归档——这是本赛季天梯的顶端,不是拿代表性换覆盖——戒律终于按英雄树拆开;读侧按语料实际持有的分组降级,语料构建走归档模式
- `8b2ed2f0` `dd3dfb32` 「按下那一刻目标的状态」调查过并记为负结果——太情境化,连事实行都不做
- `0890ab3b` `105bdb4c` `5f65d7f4` `451d1675` `38973f99` `ff424eba` `fd6a089b` `a46ec48f` `9ef775bc` `e9303973` `c0948192` `678d8345` 时间证据实验(GH #94):更丰富、整体化的证据清单会不会改变 20 个冻结危机时刻的判断?两轮预注册、人工评判——实质事实增益 18/20,更好的解读 3/20,门槛是 4。记为失败关闭,留档
- `d9731f62` `46a9d675` `dc6434f1` `20869d0f` `db3881a1` `d3231d82` `1e872be5` `4695fdf9` `c68d573e` `c338bafc` `1426b9d9` 归档上的教练语料探针(每个玩家都作 owner、台账分数、分段默认关闭)、GH #67/#72/#79/#80/#81/#85/#87/#88 背后的周末批次、GH #71 准入审计、换目标噪声扫描与规则 171 示例生成

### 桌面端

- `79e8bced` `990025ff` `eb301504` 默认 Anthropic 模型改为 Claude Opus 5(评测 responder 与判官跟随);Claude CLI 模型列表提供 Fable 5.1
- `e880089a` 调 Claude CLI 分析时不再把用户自己的工具、MCP 服务器和技能载入会话

### 语料工具

- `cb43596e` `4257ad9e` `26dd2717` `68c2d81b` wowarenalogs 改成登录后每用户每天 15 条:拉取器走授权路径,旧归档器退役,每日驱动在 2100+ 拉 10 场单排加 5 场 3v3,记住当日配额,保留运行日志,会话过期时提醒

### 其他

- `403c7296` `0ce5d70d` 本机 analysis / eval 测试对白名单文件共享模块缓存(146 秒 → 52 秒),CI 保持全隔离并把单测分到并行 runner
- `5432c28b` `7838e9f2` `4e9e635c` `9d975345` `5b16ca8f` `f14cd08b` `75c4b3eb` `8045ea6b` presubmit 校验文档里的命令和 Markdown 链接,清掉过期的源码引用,中文文档对齐,归档九条 backlog,跨 AI 审稿技能改为先走 codex

## v0.1.33(2026-09-09)

修复版本。托管 OBS 录像在真机上完全不可用 —— 每次启动先弹一个阻塞式错误框,接着是「启动录像失败」—— 两条查下来都是我们自己生成的配置里写了 OBS 读法不同的值。同批落地的是增益时长那一摊:天赋现在真的会算进教练推理用的时长,手写时长表也不再遮蔽官方值。

### 录像(托管 OBS)

- `2adfc09c` **托管录像每次启动都弹阻塞式错误框,之后根本起不了录制。** 两个互相独立的缺陷,都在我们为自己那份 OBS 生成的配置里。版本标记写成了 `32.2.1`,而 OBS 把这个键当数字读 —— 它读到「32」,判定这份配置早于 OBS 31,于是每次启动都去迁移它,而且是在录像器还连不上之前。录制音频编码器则写了编解码器名,而这个设置要的是编码器 id;OBS 收下它时一声不吭,直到真正开始录制那一刻才失败,报出那句笼统的、把责任推给显卡驱动的「启动输出失败」。现在这两个值都出自同一处常量,并由测试按 OBS 自己的读法回读一遍 —— OBS 用不了的值会让构建变红,而不是让录制变红
- `2adfc09c` 录像器不再把「压根没开始的录制」报成正在录。录制是否真的开始,现在以 OBS 自己的状态为准,而不是从「请求成功」推断;找视频文件的兜底逻辑也不会再把上一场遗留的文件认成这次的
- `2adfc09c` 真机自检新增一行,直接回答「输出到底跑起来没有」

### AI 分析 —— 时长与天赋

- `b441214f` `ed5cd50a` `36f8241e` `ac23129e` **增益时长现在会算上施法者的天赋。** 存下来的是不带天赋的值,于是任何被天赋加长两秒以上的增益,它真实的移除事件会被判成属于另一次施放而丢弃 —— 全库实测,真实移除事件的配对从 582/620 提到 618/620。天赋表扩到 21 条,并按专精分门(同一个法术被两个专精用不同方式改的情况以前表达不了);新增一条的证据门槛现在是三样:官方修正行、它的职业掩码真的覆盖该法术、语料分组且算术自洽
- `a25bacf1` **PvP 天赋携带的时长修正此前永远不生效。** PvP 天赋不在级数查询走的那棵天赋树里,于是每一条都被读成「没点」
- `ca199da1` 三条时长条目上线时差了一倍:官方值对有些天赋是「每级」、对另一些是「满级总值」,而级数不能从一个恰好凑得上的数字反推
- `5c122ce7` 有些法术的基础时长本来就按专精不同,这在表里过去表达不了;另有 20 条时长按语料订正,且只往长里改 —— 光环活不过自己的时长,所以观测更长是证据,更短则可能只是提前移除
- `78974390` 升腾不是时长写错,是触发出来的:18 次施放对 1684 次上身,几乎全部由一个自带时长的天赋产生
- `3bb67622` **四条手写时长在遮蔽官方值** —— 手工表会静默替换生成条目,两者不一致没有任何东西会发现。四条都由语料裁定,时长谓词也从三处收敛到一处
- `5e56f564` 时长扫描第一次在没用过的样本上跑就报了三条不符;两条追到背后的天赋后关掉,第三条作为有意排除写清楚了
- `7db858eb` 一个在每个「漏净化窗口」上都算了都存了、却从来没人读的时长字段被删掉

### AI 分析 —— 信号
- `3ede44b0` **「你被打断了」这类结论改按「锁定期间到底有没有真读出东西」排序。** 旧排序断言换学派施法最不可教,而这只对真读了条的样本成立 —— 实测仅 16/292 回合。一个吃满打断、五秒里只按出一发瞬发治疗的牧师,过去排在「干脆等锁定过期」的人后面
- `faed3c7c` 同一类结论不再在玩家只按了个异学派瞬发时,告诉模型他「打穿了锁定继续输出」

### 其他(文档 / 工具 / 评测)

- `e60a8df7` `237d8480` `9cab0bf8` `b55abed3` 把「教练视频结论 ↔ gladlog 实算」的对账管线固化下来,含 runbook 与中文旁车
- `29347de7` `58db8d3d` `63c4182d` `c698121d` `232e024c` 跨 AI 复核订正了这份对账的头条数字:三条「gladlog 没有」被源码证伪,覆盖率有两层虚高;缺口本身证实为真
- `1046b087` `509f5263` `689a67fa` `71076c13` `e646a7e8` 信号探针:kick-eaten 的严重度轴建在测错的量上、兜底桶里没有误分类、按位置判 kick-eaten 可行性是 GO 但卡在官方射程数据、missed-sync-window 的核心主张通过而「值不值得进」的前提一条没带、unsynced-burst 的下架理由复查后站得住
- `f74b244d` `427037c1` `39301b5b` 上游关停 match search 后,合规文档按我们实际拿走的量与实测成本更新
- `d045b6ea` 误入的 `__pycache__` 从树里摘掉,并加了忽略规则

## v0.1.32(2026-09-05)

托管录像修复版本,外加本赛季的官方数据批次。真机(4K Windows)反馈了托管 OBS 录像的三个症状:没有声音、只有屏幕左上角一小块、录到的时间不对。前两个是真 bug,这版修掉。第三个查明是连续录像的原始分片文件本来的样子(产品内的录像页一直是对的),不过这版还是把原始文件切得更贴近对局了。同批:托管录像有了用户设置(录到哪、录哪路声音),治疗救人冷却名单改由官方数据生成而不再靠手写目录,冷却/时长/减伤背后的游戏数据也做了刷新与官方表对账。

### 录像(托管 OBS)

- `08dde677` **一场对局的录像文件现在从更贴近开局的地方开始。** WoW 在跑就连续录,所以带对局的那个文件过去可能以十分钟排队开场。两处改动:只要战斗日志足够准时、让「开局那一刻」仍然就是「现在」,就在对局自己的开始处切一个新文件;剩下的部分由空闲切片节奏兜底,从十分钟缩到一分钟。日志迟到时这一刀会被放弃而不是照切 —— 那时候切会把开手留在上一个文件里,而连续录制存在的意义正是防止这件事
- `e52761d2` **1080p 以上的显示器上,录像只有屏幕左上角一小块。** 采集源建进场景时没有设任何变换,OBS 就按它的原始像素尺寸画在固定 1920x1080 的画布上 —— 4K 屏上正好是画面的左上角四分之一。现在采集源会等比缩放到贴合画布,带鱼屏和中途改分辨率也一并覆盖
- `e52761d2` **录像完全没有声音。** 两个互相独立的原因,都堵上了:生成的录制配置从来没有指定音频编码器(而这个设置的合法取值里就有「不录音频」),桌面声音也只经由一个从未验证过能被加载的配置文件接线 —— 现在录像器会直接问 OBS 这一路声音有没有接上,没接上就用和画面同样的方式补上
- `e52761d2` 真机自检新增三行,直接回答这三件事:采集源实际落进画布多少、桌面声音通道上有没有源、它录在哪条音轨上
- `9483dece` `0b7fd2e4` `6aa76697` 托管录像新增设置:录像存到哪、录哪个桌面音频设备、录哪个麦克风(默认不录麦),以及从你自己装的 OBS 一键导入这些选择。改动其中任何一项都会重启托管录像器,立即生效

### AI 分析 —— 官方游戏数据

- `e1235284` `a19b637f` `83130c84` 治疗救人冷却名单改由官方数据加全量语料生成,不再靠手写目录 —— 手写那份漏了 53 张里的 23 张。全档影响扫描(859,821 次按键)决定谁进名单,时间轴的冷却表也照着重扫了一遍
- `4e6fb19d` `01686a29` `e2dd1241` `2fb26c15` 时间轴新增上下文行:同一张冷却,水平相当的玩家通常在多少血按下 —— 于是「交晚了」读起来才是交晚了。做过针对性消融探针、确认模型输出里量不到线索之后仍然保留:它是一条上下文事实,不是一句论断
- `1180346a` 踢技锁定时长改读官方 PvP 时长,所有生成的冷却、时长、减伤数值都会乘上官方的 PvP 倍率 —— 这个值生成器一直悄悄漏掉了
- `a4b3b7be` `63b1b684` 游戏数据刷新到 12.1.0.69587,并且暴雪的线上 hotfix 现在会叠加到随包数据之上,不必等到下一个补丁才可见
- `a1926f5b` `f6109cdb` `52da8af6` 三处与官方表的对账:一个被当作急速读的光环标志其实是移动速度、手写表里从来没有的 12 个战斗种族技能、「被控时可用」表改读游戏里有名字的标志位而不是猜出来的一个 bit
- `c69a5840` `95e92807` 击杀窗口现在认目标手上任何 20–99% 的减伤大牌,而不只是一份窄名单;光环掌握的减伤修正为 24%

### 移除

- `da2bbec2` `d00b7b0a` 分析 prompt 里的关键时刻段落删掉了 —— 探针显示它只是把时间轴已经说过的话又说了一遍
- `612aa96f` `146669f6` 对比页的打法维度当天上线又当天回滚
- `c04f98cf` 法力归因不做了(裁决已记录,issue 关闭)

### 语料归档

- `8939cd46` `e061a736` 不再归档 2v2 —— 采集策略与服务端认识的赛制分离开了。2026-09-04 那轮实测:2v2 占下载量的 34.8%,但只占字节数的 13.0%

### 桌面端

- `455bb975` 过期槽位的占位条不再与顶栏状态和导出按钮互相挤

### 其他(文档 / 台账)

- `15da8345` `adee6f88` 会话实践固化成 skill;一条过期的 backlog 行用生产语料的数字划掉
- `7a481c9a` Skill Capped 教练判决语料的接力笔记(68 个录像 / 2101 条判决;v2 判决里 71% 找不到产品真的在算的谓词)
- `00725d13` 发版提交(版本号与本篇 changelog)

## v0.1.31(2026-09-03)

教练信号价值版本。一周的工作都绕着一个问题:这个信号值不值得存在,玩家当时做不做得到?新增:治疗的 crisis-no-response,背后是「同样局面下高分玩家实际怎么做」的语料参照;敌方爆发窗口决策点;击杀窗口可击杀性事实。四个按机会归一化后技能梯度走平的信号下架或降级。控制时长改读官方游戏数据。同时:OBS 二期分支(托管便携 OBS 录像)首次并入 main,解析器给不完整的对局打标而不再当整场放行,拖了很久的桌面端 flaky 测试找到根因。

### AI 分析 —— 新信号

- **crisis-no-response(治疗 v1)**:`e74a37c5` 共享的危机决策点谓词;`879f4a80` `60a445ae` 生产器(上限 2 条、按危险度排序);`8f7933ba` 接入治疗菜单与图例;`120a4050` 桌面端失误规则、标签与详情;`3a5a6c31` `a0194ff0` 行为先验表(18,134 场里前 10% 治疗的危机应对)与查询;`2427cf8b` `e8e26ac0` 新增硬失败类 —— 渲染出的参照数字必须等于表值;`22ac9a2a` `d46bb4cd` manifest 登记与谓词索引行;`6365dfa1` 攻击者计数把宠物/守护者归到主人
  - 参照改为按结果定义并加伤害下限(§1b):`60e5cd79` `24dc92d9` 规格;`334640a1` `78d3384a` 谓词、表、图例与门;`86be4f59` 表重生成;`3810bf82` `a1203cc2` `a19b55fa` `ebb7f761` 复审修复(沉默覆盖、共享光环配对、梯度分母、NaN 守卫)与重生成
  - 单排参照计任意友方 15 秒内死亡(§1c):`d31c6f6f` 规格;`9fb21d9d` `90cf1b47` `5f4d9dac` `0662afd5` `db566d9e` 结果贯穿 prompt、门与桌面端;`c7661bdb` 参照结果渲染成句子而不是枚举 token
  - 角色维度(§1d,GH #59):`c819faf3` 规格;`4d64e556` `4856ce78` `1a4d4c16` `6b2c6529` `6b6d4ab7` 角色贯穿谓词、表、门与索引;`5f71683e` 扫出 DPS 格(120,439 个决策点),`2dab0084` 随后从发布表里撤下 —— DPS「没反应」在 68% 回合触发、对照仅 10.5% vs 6.5%,不值得做信号;`6f1070d6` 表按渲染网格锚定的总体重生成
  - 背后的语料扫描:`44f331fb` v1,`5c928285` v3 上下文特征,`932132b9` v4 应对构成,`400a6225` DPS 视角,`ee8f0850` 格式;设计文档 `d6479350` `6140129b` `396cb075`
- **敌方爆发窗口(GH #60)**:`85b7549b` 决策点与语料参照表;`1b345750` `ab6e8d18` slow-defensive-response 改成决策点形态,加两道门与过度反应探针;`9db3bbdd` [BURST ANSWERED] 上下文行,窗口的正面一侧;`860279f0` 队友可达门、规范进攻冷却表、梯度重测
- **击杀窗口(GH #31)**:`d726b6db` 可击杀性事实与 DPS 视图;`a0f1eee3` 大减伤名单单源化
- `7b5e8d3f` missed-sync-window 以重新设计的形态复活(GH #13 反转,用户裁定)
- `365418e1` [ROOT] 上下文事实 —— 定身只在目标够不到任何人时才算数(GH #24)
- `c1f240ea` [HEALER TRAINED] 逐行陈述事实、只说一次引导规则(GH #36);`fc794ce5` `bd1b9960` 支撑该裁定的两个 prompt 探针

### AI 分析 —— 下架或降级的信号

四个同一判据:分母换成机会数而不是回合数后,技能梯度走平。

- `e069f4cc` `1ecda5af` death-unused-defensive 下架(GH #58),由 crisis-no-response 接替
- `17356e93` missed-purge 与 unsynced-burst 降级为上下文事实(GH #50)
- `3f5f3b38` `7d219a66` `90747bbb` cc-held 在配上正确的机会分母后梯度走平,下架;视觉基线随之更新
- `fdc18785` cd-spent-idle 下架 —— 结果探针量不出任何代价

### AI 分析 —— 准确性修复

- `4fb50953` healing-gap 按最低队友血量把门,不再按空窗秒数;`e719f549` 图例说明 t 是空窗起点;`b4e66e48` `086baed5` 空闲时间扣掉打断造成的学派锁定(GH #54)
- `de35230b` cd-hoarded 改成决策点形态;`8ec64f96` attempt-into-trinket 引用语料结果对照(6.8% vs 3.8%)
- `af5504b5` 所有「冷却在 t 时可用」谓词共用同一个渲染秒容差(GH #61,台账硬失败 3 → 0),打断锁定改按语料实测而不是恒 3 秒(GH #62)
- `eaa1cd0e` `f6e4f504` kick-eaten、死亡、missed-cleanse 与危机的时间事实向下取整到渲染网格,不再四舍五入越界
- `8705d976` 盲评台四条裁定:2v2 白名单、击杀复盘降级、免疫破除可行性门、共享分段键(GH #18)
- **控制时长改读官方数据(GH #44)**:`c7451a1d` 完整时长走 ccFullDurationSeconds(手工表 22 条分歧里 21 条是手工表错);`553e35cb` 天赋条件时长 —— 共鸣之声把破胆怒吼 6 → 7.2 秒;`c43fe8e2` 8 个变形雕文变体登记;`5960ee7b` 删掉非控制类技能上 70 条无人消费的手写时长
- 登记表:`e26ee81e` 山崩登记为可驱散定身;`e3322e1f` 古树之识按官方 30% 入减伤表;`10c23d82` 驱散观测表按 12.0 与 12.1 重生成(305 → 421 个 id),基准按 12.1 归档重建
- **常量清查收官批(GH #34)**:`75219d2f` buff 到期配对与四个手写时长 —— 能量灌注不再总被说「提前结束」;`bf924bf0` 外置减伤逐技能读官方射程,替换掉「所有 40 码指向技能」这个假常量;`2fe0bdb5` 集结呐喊 10 秒改读官方光环;`c8361f07` 饰品冷却单源、自律读官方数据、两条手工假设被证伪并注明;`167c5d40` MIN_CD_SECONDS 单源;`8531db55` `d71e2530` `ef833c6b` `c9c603be` `7916b201` `ef473068` `41e423b5` `eb260831` `c581d31e` `d47946aa` 实测分布写到每个阈值旁(改值 0);`49535842` datagen emit-table 改为先写临时文件再拷贝
- `87efe544` 「有更便宜的可用」的队友可达判定改用官方能否施助谓词,不再用手工名单;`a60a3e3c` 第九类硬失败 —— [DMG SPIKE] 的「扛过去了」必须与同行血量变化一致(GH #36)
- `f2cf35a5` 语料驱散门不再把附带驱散算作「有人驱散了」(GH #32);`2fa060bd` 谓词索引最后一处分歧关闭 —— DR 分类经覆盖层读取(GH #33)

### 解析器

- `cf27d2fa` 结构完整性 —— 不完整的单排、短名单与无结果对局打标,不再当整场放行
- `35164768` `51c1b3b7` 宠物与召唤物按 SUMMON 关系与 PET 标记并入主人,伤害与治疗落到正确的玩家头上(GH #57)

### 录像 —— OBS 二期并入 main

以 v0.1.20-obs2.1 与 v0.1.26-obs2.2 测试包发过的托管便携 OBS 录像,现在并入 main、首次进入正式版本;功能说明见上文 v0.1.26-obs2.2 一节。带入的分支 commit:`ab3ab014` `13fe39d4` `64f45a8b` `368ae5f1` `4136a3e7` `49a18636` `0a62c0c2` `8b5924d3` `167ff96e` `bf799dce` `86f1f95b` `fb9d4c72` `a322713c` `96d8660f` `aa401e7a` `81831590` `1d3cd4ee` `3026bc54` `ea558d87` `54c99380` `7841af71` `e9e15556` `c3e00e73` `db3e7214` `88fdfc1a` `d47b5d87` `92f9e24f` `1e228b1b` `ea2a63bc` `cbc46460` `f6a80b21` `7efe296b`。合并修补:`eade0146` 设置页 fixture 补 uiZoom、下载进度断言锚定;`2140f3a0` 设置页与录像页视觉基线重生成。托管录像的真机端到端仍待验证。

### 桌面端

- `58ae7bba` 原子写文件在 Windows 目标被锁时重试一次
- `fa2dec06` 修掉衰减泳道悬浮死区、panic 命名、归属解析归并(GH #38)
- `bec96609` GH #26 flaky 测试根因 —— 复位状态的被动 effect 排在交互之后;`5c8a38e5` `47ae43aa` `909c5280` 一路引到根因的超时与诊断
- `8005b835` `a5459678` 视觉基线跟随 2v2 白名单与 cd-hoarded 决策点形态

### 评测工具

- `9a15ee45` headlessAnalyze —— 不开应用就对库内对局跑真实产品分析(GH #18)
- `641f683f` `18b18c83` findings prompt 语料渲染与回答插值,用于候选菜单盲评 A/B
- `0c7560dc` `d69238f1` 盲评台保留基线候选类型、按回合 id 解析单排回合
- `e1818153` `9a20ee7d` 会话探针与采集工具收入仓库;`f3bfd976` eval 仓审计的文档/脚本卫生

### 其他(文档 / 台账)

- `153aa886` `a4eeaeb0` CLAUDE.md 对齐;`4d9e5d8b` `88a547bb` `5d01efd3` `b5b84ee2` backlog 裁定入账;`a69d268f` `aa7ff481` `10761813` `017b375b` `d5b483b9` `a0e59ac5` `5c25bd62` `30461249` OBS 二期设计与计划文档、arenacoach 规则目录

## v0.1.30(2026-08-26)

教练准确性 + 第六后端版本:三天里两条主线 —— 修掉一批「指控玩家做不到的事」的教练错误并给 prompt 新增五类实测有效的事实标注;接入 CodeBuddy CLI 成为第 6 个 AI 后端。另有一次「拍脑袋常量清查」(改值 0,但抓出两个真 bug)与一套可复跑的 prompt 逐行效果探针。

### AI 分析 / 教练正确性

- `fe428a6c` DPS 视角验出三处真错:cd-waste 不再把控制技能当「没交的保命技」(58/176→0)、无按键墙(Berserker Shout)不再指控救队友、光环过期行改用日志真值
- `ba31cd05` 复苏烈焰按用户裁定登记为大技能(非减伤);燃烧从「值得偷」名单摘除(440 次上身 0 次被偷);爆发不配控不再把给队友的增益重复计数(375→309)
- `1273f8f3` 无按键能力(复苏烈焰)不再被任何「你本可以按它」类指控引用(8→0),loadout 改标 [PASSIVE]
- `10e5aee2` 低压力免责注只认 Defensive tag,不再替没放的控制技能背书(误报 12→0)
- `2abb8376` missed-cleanse 带上「手上有活」事实 ——「你漏了 X」改成「你选了 Y」
- `9ae382e4` Critical 级漏驱散必须有实测后果才指控(#39 裁定 A)
- `00ee7110` 承压计算补上被吸收的伤害(absorbsIn 改按受害者键)
- `43661043` 激活归类修正:法力 CD 而非治疗增益,出 [MANA] 行
- `f5ed0256`/`673c9d52` 免疫表两批补全 + 控制打进免疫在 prompt 里现形([IMMUNE] 标记)
- `861f0fae` 充能施法的释放等级进 prompt([EMPOWER L?])
- `9e12b879` [DMG SPIKE] 行新增敌方 CC 掩护标注 —— 配对检索实测弱后端准确率 65%→87%(p=0.0013)后采用,配第八类确定性门
- `3e0dc4bc` parser 读入五类此前丢弃的日志事件(资源/免疫/伤害转移/充能等级/治疗被吸收)
- `86258139` #40 双行修复 + #36 三项落地 + 打法维度进对比引擎
- `4bf5e27e` D7 探针真值按回合取(修单排后 5 回合真值恒 0)

### 数据与裁定册

- `2e9298e2`/`bdb7848b`/`d75ec874` 治疗裁定册:「加血大技能」归类此前不存在,12 条全部用户签字(10 burst-answer / 2 needs-healer);接线量化为零变化,暂不消费
- `a3cb4216` 三份生成物 build 号对齐 69404(数据零变化)

### 新 AI 后端

- `564f027b` CodeBuddy CLI(cbc)接入为第 6 个后端:14 模型枚举、事件数组 JSON 解析、教练会话恢复(外部贡献 PR #35)
- `84b0abf4` cbc 工厂级测试补齐消 CI 红 + 安全参数单源化;`58492dac` settings 视觉基线随后端下拉更新

### 常量清查(GH #34,改值 0)

- `89b30b2d` 删 73 行死代码(KILL_ATTEMPT 旧路径)+ 修 computePressureWindows NaN 静默丢弃(15/5697 窗口找回)+ 三条阈值补实测出处
- `1be8c427`/`c4044a63` *_CAP 全族 at-cap 体检与走位判据分布体检数字注入

### 工具与语料

- `c4646824`/`4deee7da` prompt 逐行效果探针(消融/植入/跨模型对照,断点续跑+熔断)
- `3ffcbe56`/`b3f21df9`/`255603d6` 真模型 smoke 体系改走本地 CLI 并补齐三标签验证
- `4db79018` 自有对局日志永久归档 Google Drive(21.28GiB→1.76GiB)
- `aa10f3e2` 语料校验器学会 hero 分组 + cache 改 gz(103 违规→0)

### 其他(文档 / 挂帐 / 让号)

- `75664207` 逐行探针结果报告;`994a5bf0` BACKLOG 全量镜像 GH #37–#54;`cbc991d8`/`832d1a80`/`5d959269`/`6876b72c`/`551dfa5e` 挂帐与裁定闭环系列;`66249909` 归档文档修正;`371e3447` 交接文档;`e9e72bfa` 号位协调

## v0.1.29(2026-08-23)

教练正确性版本。两个 GitHub issue(#28、#29)驱动了一个月的工作,只围绕一个问题:教练指控你的时候,你当时做得到吗?冷却的目标、学派、「打不打敌人 / 是不是范围 / 造不造成伤害」、「这个减伤够不够得着队友」现在全部来自官方游戏数据而不是手打标签;减伤裁定册 32 条全部签字、无悬案;两类指控加了可行性门。另有一个新的评估工具,用外部真相(分数段)检验教练信号。

### AI 分析 —— 技能事实改问官方数据(GH #28 / #29)

- `8c488aae` `eec1cd09` 技能画像从官方法术表建立:学派不再是手打标签,死值清理,用户的减伤裁定集中在一本签字册里
- `4b2306ea` 进攻三维 —— 打不打敌人 / 是不是范围 / 造不造成伤害 —— 改问官方效果数据
- `357a9c27` 大冷却的施放记录用官方 targeting 写明目标:「强化给了谁」此前 59/59 条 prompt 丢失,现在 0
- `b4ba5749` `073a5a8d` 只保自己的减伤不再被拿来指控「你本可以救队友」:官方 targeting 决定一个法术够不够得着别人。解码表同日返工 —— 18/87 条其实是「目的地」不是友方(405/965 假阳),并堵上运行时注入 tag 绕过检查的漏洞
- `a8ed9acb` 「防御反应慢」改为按承压对象问「你手里有没有工具」
- `a5fa1597` `11243630` `4daf30ac` `214d4724` `c476c702` `5101fd50` 用户签字的减伤裁定:光掌(全团 20%)与疾影术 → 永不构成「打进减伤」的浪费;盾墙 → 仅在击杀成立时;真言术:障由裁定人本人撤回;裁定册两处更正(一条是我自己编的分档规则,一条建立在已被证伪的前提上);「冷却闲置」改用签字判据。裁定册至此 32/32 裁完
- `3ad24bbb` `14a9712a` 「爆发不同步」只在队伍当时确实有硬控就绪时才指控
- `9a2ae2d8` 「可躲的控制」只指控你来得及反应的控制 —— 旧指控约 75% 是瞬发

### 战报

- `358b23f1` 高手对比缓存:「没有同池样本」会存,「没有 API key」不再误存(GH #27)
- `eaee24e2` 三份新数据表收缩到实战里观测过的技能 —— 渲染包 −134 kB
- `4ffdbb8d` `50b50001` 试过把这些表改成懒加载,撤回了:包是小了,首渲两次实测都更慢。保留的收获:所有语料扫描脚本现在会等技能名载入 —— 之前的扫描总数是在名字缺失下量的(正确口径 2,105 → 2,533 个候选)
- `5101fd50` 首渲预算按 39 次 CI 的真实最小值重锁:5200 → 6400 ms

### 评估工具

- `a42b8a95` `3cd34fa4` 信号技能梯度实验:每条教练指控是否真的随分数上升而变少?报告强制按分数段分层 —— 池化会把一条平信号造成 −9.6pp 的「技能效应」
- `4c5a66f4` 两条坏分母修正:missed-purge 用与产品相同的偷驱谓词,cd-waste 按每个冷却计

### 其他

- `9a085c70` 12.1 PvP 插件与外部软件生态调研;审计台账 D7(absorbsIn 以攻击者为键,五处消费者当「承受」读 —— 未修)与 D8(论坛称 Midnight 日志治疗偏低,在竞技场日志里不成立 —— 1,242 回合核查);两份探针脚本留在 `packages/eval/scripts`
- `23d3d77f` `ba4cc46b` 一个月经验回填 CLAUDE.md 与 skills(价值门规则、并行会话 skill);待办 #34 教练信号正确性

## v0.1.28(2026-08-22)

赛季数据版本:用一周真实 12.1 对局(10,682 场,来自公开竞技场日志源)审计了教练赖以推理的手工技能表。游戏里已经删掉的技能还留在表里,十几个 id 指向的根本是别的法术,而实际在打的技能 id 有三分之一是数据管线看不见的。三件都修了。另外是战报 UI 评审批次:标题行、看得懂的血线、主动与被动驱散分离,以及没配 AI 后端也能打开的演示分析。

### AI 分析 —— 技能表用一个赛季的真实对局审计

- `2a6f7e06` 22 个游戏里已不存在的技能(虚空行走、躯不坏、散魔功、冰冷血脉、忏悔、翼龙钉刺、邪能爆发、灵魂腐化、暗影决斗、禅悟冥想、精神之花……)从 19 张表移除 —— 10,682 场 / 330 万行日志里零出现
- `2a6f7e06` 14 个指错法术的 id 改正:进攻效果表 11 条死了 9 条(它的「处决宣判」其实是最终清算,「轮回之触」其实是万灵之召,宿敌早已变成死亡印记),根基图腾、剑刃风暴、操控时间、PvP 饰品全是旧 id,驱散反噬检查现在打在活着的痛苦无常沉默上而不是一个死 id
- `b127dc2c` 「这个法术算不算控」在 app 内部有两个答案 —— 硬控窗口读官方表,时间线的 [CC] 标签读手抄名单。现在统一成一个:63 个在打却没被标成控的技能(变形术与妖术的雕文变体、冰冻陷阱、禁锢、分筋错骨、割碎、圣言术:斥……)现在带着递减档位和目标饰品状态出现
- `924fdfff` 数据管线开采的技能宇宙从 3,719 扩到 5,362 个 id:1,643 个真实在打的 id 此前从没被问过。法术效果 +1,550 条、中文名 +1,359、天赋修正 +21;既有 prompt 逐字节不变(哈希验证)
- `022981f0` 新教练候选:群体驱散解旋风链,四门判据
- `fbe16737` 驱散按原始施法分为主动 / 触发 / 顺带,不再把每次被动触发都算成一次决策

### 战报

- `fb99aa61` tab 下方的标题行 —— 结果、对阵、谁终结、哪里转折 —— 复制/导出/报告收进 ⋯ 菜单
- `eaa61b05` 血线把满血平段淡化、移动段画得干脆;悬停图例或曲线即聚焦该条
- `f7e2f53d` 驱散 KPI、tab、表格都只数主动驱散;被动触发与顺带解除做成弱化后缀和单独一列
- `3690e03a` 事件 tab 默认打开「关键」预设(伤害/打断/驱散/死亡),全部事件一键可达
- `9e7f8e95` 统计行带一个身份元素 —— 专精图标加侧环 —— 走条形优先的栅格
- `3d0613d8` 轮换回合胶囊排成一条,容器变窄时收成纯数字
- `8908ca2d` 战绩页样本太小时先给场次而不是胜率
- `c1d2f17f` 没配后端时 AI tab 上的「看一个演示分析」—— 围栏化演示,与 fixture 桥同源
- `a007d393` 演示分析在渲染中途切语言不会崩

### 语料与工具

- `15ecc63a` `1696f0a0` 完备性规则从此有工具而不只是一段文字:全部手工技能 id 表的注册表(61 张)加三条扫描 —— 名单腐烂、官方控制里 app 看不见的、驱散地面真相对官方数据
- `42f5c1e8` `fc3e9bd4` `57579e8d` 日志下载会超时重试而不是永远挂着(一次归档跑因为一条卡住的连接空转了 30 分钟),非 ok 响应也会释放连接
- `331eb989` 日志收集器会诊断云端占位文件,而不是每分钟重复同一条警告
- `26db5a23` 人工盲标可以在同一份答案文件上与机器判据对齐
- `dd7aba04` `7bca0366` `88de4518` 同侪样本下限单源;新注册表补上位移破根驱散名单;UI 批次后重取视觉基线

### 其他

- `02487b19` `37a949e8` `13677a04` UI 评审方案、采纳计划与落地记录

## v0.1.27(2026-08-21)

接地版本:**教练做出的每一项指控都用真实对局数据重新审计过**。八个胜负判别力为零或反向的教练信号被退役,幸存信号的阈值全部实测签字,击杀分析改建为三档机会模型,新赛季 12.1 数据全链上线。另外:Claude CLI 后端现在逐 token 流式输出,~4200 行为已否决功能服务的代码被退役。

### AI 分析 —— 信号退役(机会归一化判别力审计)

每次退役用同一把尺子:转化率 = 抓住 ÷ 机会,赢家 vs 输家。分不开胜负的信号没有资格指责你。被退役信号背后的事实仍留在时间线里供模型推理,消失的只是指控;提取函数与测试全部保留。

- `16f0de4e` 「被控未解」退役 —— 按机会归一化后,能解时真解了的玩家反而赢得更少(23.2% vs 27.9%);98.5% 的指控落在两个无证据档位
- `90c26008` 「浪费徽章」退役 —— 约 94% 的指控是治疗解自己身上的控,判定谓词对 owner 结构性失明;归一化后比率反向
- `68253b48` 「踩 DR 的控」退役,顺带修掉两处光环区间伪影
- `2ae31e63` 「打进免疫」退役;「漏偷驱」通过终裁保留
- `5820eed3` 「窗内脱靶」退役,连同全大写的脆弱窗判词一起下架
- `0e4c8357` 「未转化的爆发」退役 —— 被新 [KILL ATTEMPTS] 块的逐尝试结果替代
- `22779c10` 「错过同步窗」与「被晃断的踢」退役(洗净机会分母后胜负转化率持平)
- `0a37d5ee` `14b8a124` 同一审计的反面:「防御反应慢」与「未同步爆发」被洗清 —— 它们的负判别力是分母伪影;防御反应慢实为全库最强的正向信号(+15.3pp)
- `67a6d3be` `f06ed5c8` 判别力扫描器与逐类候选体检转正为常驻 eval 工具,下一个新信号上线前先过这道审计

### AI 分析 —— 阈值接地与签字裁定

- `20153fd0` 「站在危险里」的豁免线改为实测的 hpMin<35 门,替换凭空发明的 85/15 组合
- `baae59ea` 可规避控制的最短时长 3 秒→4 秒;kick-eaten 与外置响应阈值连同实测依据登记;两处严重度修正
- `082a7498` `8c73eb2e` death-setup 的 12/3/90 回看窗与 30k 爆发伤害地板经语料检验后保留 —— 从「拍脑袋」变为「有实测记录」
- `551438fb` 每轮话题上限(2)转为长期保留:去掉上限的复跑出现 64.6% 泛滥;TEMPORARY 标签摘除
- `4ee44c3b` §C 发生率 × 胜负全表在 459 场 / 2114 轮的 12.1 实战数据上正式重跑入档
- `d6ef1513` `8f273d50` 失误卡重排序:两处严重度倒挂修正,同档内按实测判别力排列
- `1856f9aa` `d4db0378` 冷却台账守护注堵死「牺牲祝福可自救」的误读;finding 标题也走占位符解析(真模型 smoke 抓到 `{{target1}}` 原样渲染)
- `dfa6f772` `806697dd` 被控豁免按控制类型区分(晕表不再替恐惧代言);奶专精规避手段表分开「没有」与「不知道」
- `27866802` 「打进减伤算不算浪费」改由逐法术签字裁定册驱动,不再是硬编码集合
- `52778e29` #29 结案:意图守护过滤 GCD 连点伪影,「尚未恢复」不再冒充「技能在冷却」

### 击杀分析重建

- `9a4ae61a` `7603e107` `740181f7` 击杀窗目标选择改为三档机会模型(用户判据,8791 次晕落地验证);softness 公式与合格证退役;新增逐尝试的 [KILL ATTEMPTS] 块与 attempt-into-trinket 候选
- `b68b1d80` 击杀尝试 v2:大招锚定(团队进攻施放按可达性聚类成窗)与晕锚定并列 —— 真实击杀覆盖率 20.1% → 80.5%;旧脆弱窗 prompt 块下架,并修复一个让 [KILL ATTEMPTS] 自 v25 起从未进入生产 prompt 的稀疏路径接线 bug(0/146 → 146/146)
- `694755e5` `d5a66dce` 敌方治疗不再按 DPS 饰品冷却计分;敌方减伤判定共享充能谓词并感知天赋修正
- `63d86357` 冷却可用性感知充能:多充能技能走真实充能台账,不再「一按就没」
- `3027d0a0` 击杀尝试开关负控用例的测试清理

### 驱散与偷驱

- `1e2c7019` `459ea245` 签字的驱散优先级裁定册(按阵容分档)接进 missed-cleanse 三道门 —— 全库指控 705 → 194
- `ab48861b` `309cb659` 驱散时机门:「视局势」档接上平稳期谓词,并按签字档「承压期整窗豁免」扩到 worth/must 两档
- `e027c06c` `84e9cd94` 可驱散性候选名单对官方数据闭环:145 个法术 / 76.5% 的实际被驱散没有任何条目(暗言术:痛、月火术、腐蚀……)—— 已全部补齐
- `56736355` 双层表合并悄悄吞掉 12.1 新 id 的官方 dispelType;改字段级恢复(v30)
- `9b6aa54a` 偷驱黑名单新增三条,理由按机制写死:牺牲祝福与时间停止根本不可驱,萨满的自然迅捷瞬发即耗来不及驱(语料:1444 个窗口 0 次真实偷驱)
- `0a29c6d1` `59128b7c` 痛苦无常反噬豁免名单整条过期:名单内 id 语料零出现,真实敞口(1153 次施放)全部未登记 —— 已刷新,策展名单完整性规则补上反向检查
- `e9e6e4da` `3d5cd816` 虚空新星改判晕(治疗没法自驱);钻石寒冰/拘禁确认由官方独立 id 天然覆盖
- `d62fcfc4` 「什么算免疫」曾有三张互相矛盾的手打表;现在以官方减伤表(pct=100)为唯一权威并配双向跨表测试,分散(75%)移出,法术护佑补入

### 新教练候选(P1/P2 蒸馏)与 raw 日志层

- `591be70f` `d9f18bbe` `1895a494` `c861ece3` `5c4ff884` `1640e980` `4ec58994` 四个新候选类型在开关后建成:错过同步窗与未同步爆发(以治疗被锁为触发 —— 无血线门)、屯大招与空窗乱按(威胁分级门)
- `a64b44e5` `b2ace67a` `69a37039` `07bdccd4` `6fd4de62` `bac89057` `df1db220` 阈值在 1028 场 / 3441 轮上标定,随后每类型独立 A/B(各 n=30),harness 复用生产谓词
- `d08992ea` `39e88b34` `0b0db430` `8c4ea6f9` 四类型经裁决全量上线;选择层话题闸放宽 ≤2→≤3(+55 条干净新发现,0 机制错误,n=48);上线前修掉双治疗误标
- `f1a9acb9` `ab4581e4` `1df54bb2` raw 日志流层直读 raw.txt 的法力值与 SPELL_CAST_FAILED —— 支撑意图守护:按了但被游戏拒绝的大招不再算「屯着不用」(2720 条指控里 968 条属此)
- `85f9d0e1` `6e89a975` 对局中途日志轮转不再丢已完成的斗技场轮 callback(parser EOF flush,#21.8)
- `a2a6421c` `11a13af0` `1baf83ce` `cf66034d` `33c66839` `80869dd0` `06110543` `e3e210e2` `7e188495` `02323b75` `9afc6ef7` `34a9ad3c` `3ec0f68e` `e11025ab` `dd8de24c` 两个蓝量候选(OOM 窗承压、全场蓝效)完成构建、标定与 A/B 后裁定不上线:没有「被迫 vs 非被迫」归因的蓝量建议没有意义,后继 #33(确定性归因引擎)已立项;途中发现的斗技场跨轮污染 bug(87% 窗口)顺带根治

### 技能事实地基(教练能对技能断言什么)

- `9e7bfa30` `24fa7423` `22e276c9` `4d316e97` `430e3b75` 非官方技能事实进入 CI 强制的签字册;被晕可用表改由官方标志位推导(恐惧/迷惑被证明不可推导,留签字缺口;树皮术签字 true)
- `54e3d6a1` `51640d0f` `fd7a01ed` `e2c29643` `ccde762b` `3e672fb7` `bb0d3ea0` 签字册锚定清单逐条用户签字,配语料观测线(晕中实际施放)双向验证
- `415353e8` `24bb5d7f` 首批消费方接线:cost-normalization 守护注;导出 Markdown 的治疗列补上吸收
- `94eed173` `547ec6f1` `2d5993c8` `4bb23b99` `07222bcb` 冷却判定按玩家天赋自适应(proc 触发链、串行充能、分单位百分比修正、TrinityCore 叠加语义);一类负冷却秒数(265,187 行)归零
- `c6bcd082` `9b80bf9e` `8ad2d7eb` `425a9e86` 天赋减伤改从 tooltip 挖掘:输入宇宙从 46 条白名单扩到 3491 个天赋法术,九条 ≥20% 的自身减伤此前完全看不见;受益者分类修正(复仇撤退的减伤属于盟友,不是宠物)
- `f8aca39f` `2715d852` `d734f8a5` `20ff3d5e` `f26f5023` `4b6bb048` `0cd447cb` `041e6d1e` `af96533d` 光环记账加固:名表断链修复(活化烈焰恒显示就绪)、aura-only 归集改 fallback-only、硬控不再被化妆品光环挤出时刻查询(#27)、双关闭竞态捏造幻影区间修复(63,590 → 0,#28)、两个光环区间构建器统一到单一权威实现且防伪规则上移(谓词索引「尚未统一」再度清零)

### 12.1 赛季数据

- `17733808` `377f405c` `135ce694` 数据全量刷新到赛季 build(12.1.0.69382);首次逐条审读官方补丁说明 —— Stellar Protection 反噬门、Ancient of Lore、Scatter Shot 3 秒均按实战语料证据修正
- `e45aa03d` 候选池纳入 12.1 实战日志:观测法术 id 3417 → 3719,驱散覆盖缺口 0.62% → 0.37%
- `8654de68` `2a73d1cf` `a9bc6bf6` 真言术:障按裁定更正并补全局语料时代守卫;Ring of Fire 结案为旧 id 族回退而非新 id

### 应用

- `11406f10` Claude CLI 后端真流式:分析预览逐 token 亮起,不再空等几分钟后一次性出现(真机 smoke:37 个 delta 分布在 3.4 秒 vs 旧行为结尾单个整块);老版本 CLI 自动回退整段文本模式
- `ab833e7a` `2a859963` `dc0fa404` 失误卡先合并再截断(队友折叠、时刻分组、默认前 3);只有队友犯错的对局不再渲染一排 0
- `080b4675` `ab6c38f9` 回放:地图上的被控状态(环 + 消耗条)与 GCD 泳道的施法对象
- `870776aa` `573348da` `f01f916e` `f0702cc3` `528f6d73` `98929368` `b516db56` 大屏批:页面上限 1920→2560 且多出宽度按比例分、三处面板吃满高屏、对局列表可拖宽、生命曲线加「只看我方」开关、界面缩放档位修复 4K 下 12.5px 正文、伤害榜剥服务器后缀
- `24bb5d7f` 导出 Markdown 的治疗列计入吸收(顺带删掉一个死字段)

### 底层工程

- `cd3d23b9` `97165bf2` `62b1e78a` `add139b5` `986c8571` `032019be` 管线审查工程批:渲染网格搬出 cooldowns.ts、删四个死开关(−362 行)、candidateFindings.ts 按主题拆分(3776 → 2094 行)、四种并存的 HP 采样半径归一为单一常量、谓词索引按结构化表断言开关运行时真值、两份 resolveOwner 手抄本迁移共享 export
- `7c91140a` `ca339a29` `db1e46a1` 退役到零件(−4237 行):遗留 prompt 死分支(criticalMoments)、被否决蓝量候选的三处接线、被否决的时刻快照深挖(含设置开关)全部摘除 —— 纯提取函数与测试保留
- `e65c19d7` `b83ee0ea` scripts/ 纳入类型检查覆盖;易抖的 firstPaint 预算改取样本最小值
- `9af03b83` parser 差分 oracle 基线重新裁定:13 处差异附证据入档,gate 恢复绿(#23)

### 其他

- 交接文档、审计台账、issue 立项与设计文档:`eea82b28` `113cea55` `d777b660` `75ad3bf9` `3e113506` `1cb0094f` `959e0c11` `8b453a7c` `2845bacd` `12b46474` `c5456378` `4211c13a` `2ddff0f0` `75c51981` `d471d5cd` `e347cca2` `bdb82bc1` `eb000406` `a17d9e45` `e2de2fcd` `8c25079d` `6e361936` `2b3c3e35` `ccb4d1ac` `40e67946` `566f5d98` `45b08375` `3b6109f7` `611dc54d` `a4358d38` `f24f9e9a` `64f6891e` `0fe31552` `a6a68274`
- 内部文档语料英译(14 批)与 corpus-tools README 英文版,及一次陈旧基座恢复:`27b665b3` `be9b9eb4` `b3ab4bf9` `48ea4004` `48b531fb` `d2c3fa97` `a144ce1e` `9fcab15a` `cff326d2` `bab5439a` `211ce215` `8b2a2e48` `c545b68b` `dab2bba8` `f0749fae` `b4e3517c` `379be45d` `0e91fd0b` `7906b175`
- 视觉基线(CI 生成、人工审图)与仓库卫生:`11a5859f` `e3659f6e` `02a4720d` `089f13da` `7cfc3fee` `8ebfa516` `e52761ab` `aee39e0c`

## v0.1.26-obs2.2(2026-08-15,测试包)

**OBS 录像二期的功能测试预发布**,来自 `worktree-obs-phase2` 分支,未并入 main。它带上了 main 直到 v0.1.26 的全部改动,外加托管 OBS 录像(第 0、1 段)。核心是让用户零安装、零配置就能自动录竞技场;连接链路已在真机 Windows 上定位并修复(`npm run recorder:gatecheck` 通过),这个包就是用来测完整产品闭环的(自动录一场真对局、留存、点击跳转)。

### 录像(托管 OBS)

- `1d3cd4e` `aa401e7` `96d8660` `fb9d4c7` gladlog 现在自己托管一份便携 OBS:首次使用时从官方发行页下载一个钉死版本、校验 SHA 的 OBS,只解压需要的部分,生成便携配置,再通过 obs-websocket 驱动 —— 用户从不安装或配置 OBS。仅限 Windows;其他平台上一期「指向你自己的 OBS」那条路不变。
- `bf799dc` `0a62c0c` `4136a3e` WoW 运行期间连续录制、每场切一刀,留下含对局的分片、回收纯挂机的,并受数量 + 80 GB 双闸配额约束。因为分片起点必早于下一场开局,开场那几秒永远不会缺。
- `13fe39d` 托管 OBS 用 `--disable-shutdown-check` 启动。不加它的话,上次被硬 kill 的 OBS 下次启动会弹「以安全模式启动?」对话框,静默挡住 websocket 永远起不来 —— 除首跑外每次录像都会失败。真机上用 netstat + 日志 A/B 定位;此前加的 `--websocket_ipv4_only` 是对同一症状的误诊,已删(OBS 双栈绑定,`127.0.0.1` 连得上)。

### 录像回放

- `f6a80b2` `7efe296` 点死亡、finding 或爆发窗口会跳到那个事件本身,而不是晚好几秒 —— 「录像晚于开局」的偏移量此前被夹到 0,现在不再夹。
- `ea2a63b` `1e228b1` 一段录像可对多场对局,背靠背共用一段录像的两场不再丢第二场。

## v0.1.26(2026-08-13)

本版的主题是**教练不再拿游戏本身的机制责难你**:种族技能开始计入、饰品与种族的共享冷却被承认、牺牲祝福不再算作你自己的减伤、吸收盾终于计为有效血量,敌方护盾也重新成为分析看得见的驱散目标。

### AI 分析

- `b951837` 首次把种族技能计入分析。战斗日志没有种族字段,所以拥有性只能靠观测施放确立 —— 看到施放即证明拥有,没看到什么也证明不了。用生存意志/被遗忘者的意志/逃脱术/烈焰之血解控,不再被记成「饰品在手却干坐着」(本机 120 场里 35 次冤枉 → 0);进攻类种族(血性狂怒、狂暴、烈焰之血、先祖召唤)凭施放证据进入冷却台账(0 → 405 条)
- `a32c503` 承认解控种族对 PvP 饰品的 30 秒跨锁:用完被遗忘者的意志之类后的 30 秒内,饰品不再被报成「可用却没交」(200 场里 92 个窗口 → 0)。这个时长在游戏数据里查不到 —— 种族与饰品分属不同冷却类别 —— 因此由真实日志里 307 次连续施放实测得出(最小间隔 30.1 秒,无一低于 30 秒)。逃脱术不共享,已正确排除
- `03b1d08` 牺牲祝福不再出现在「你死时没交的减伤」清单里:对自己放它是机械上的空操作,30% 伤害转给施法者本人。prompt 的死亡行与教练结论两处都已修正(300 场里 6/18 条 → 0),清单其余项不受影响
- `4f3e118` `9e99b48` 吸收盾计为有效血量。死亡审计此前只看得见百分比减伤,套了盾的一局仍被读成「你什么都没交」;现在每个护盾报出日志所记的实际吸收量,结构上只计入护盾失效前真正挡下的部分。同一审计还补进四个此前挖不出的减伤(渐隐、适者生存、天神下凡、防御姿态);断筋、闪避、寒冰护体与大地盾经官方数据核对,确实不含百分比减伤
- `10d5600` `157e6c9` `ec29168` 敌方护盾重新成为驱散目标。寒冰护体没有分类表条目、真言术盾连技能表都没有,两者此前都不可能产生「你漏驱散了」的结论;现在都以适中优先级登记,刻意低于免疫与硬控所在的档位。另有十个高价值增益一并登记(时光倒流、愈合祷言、大天使、嗜血、虚空护盾、疾风屏障、气之茧),四个常驻团队增益进入黑名单(耐力、光明、野性印记、天空之怒);自由祝福的优先级改为看对局 —— 我方没有靠减速施压的专精时不再提示

### 其他

- 视觉基线、评审工作台工具、评测脚手架与文档:`698a573` `cd2b84b` `5a0363f` `ba534b3` `4014c7d` `e7274e0` `142dc4a` `e9b8366` `9c91e2f` `187c14d` `0b3b649` `73fced3` `d97b394` `f8c0def` `bfde7e3` `0adb57a` `9754352` `533f85e` `9383dd2` `d957654` `9bc4410` `3ce350b`

## v0.1.25(2026-08-12)

本版 = **打开对局快数倍**(Solo Shuffle 存档按轮懒加载)+ **同梯队对比的 AI 解说真正能出现了**(此前四篇里有三篇被静默丢弃)。

### 性能

- `e4122c2` 打开对局不再在界面线程上解析整个存档:Solo Shuffle 存档带上按轮字节索引,打开时只解析当前回合,切换回合时再加载其余。实测打开成本中位 49MB 档 186ms → 20ms、最大 277MB 档 1079ms → 184ms;既有对局库的索引在后台自动补齐,列表悬停与启动时会预热最可能打开的一场

### AI 分析

- `b1a384c` 「与同梯队对比」的 AI 解说不再被自家事实检查器大面积枪毙:实测 36 篇里 27 篇被静默丢弃、界面只显示「AI 解说未生成」,根因是 prompt 里的危机范例自带检查器禁止的时间戳与血量百分比,模型还会自创示意数字。现在范例用检查器同一套谓词洗净、逐维判语直接给到模型(此前要求它谈弱项维度却看不见哪些维度弱)、再配一次带违规清单的重试兜底——同批对局同批后端下存活解说 9/36 → 35/36,检查器本身没有放松
- `97aad76` 减伤分析不再把 Shadow Dance 当可用减伤(被 12.0 语料双向证伪),附带三条冗余覆盖清理

### 其他

- 评测工具、验证脚本与设计文档:`acd53a0` `18a8712` `89ae95e` `4d76970` `edc1e54`

## v0.1.24(2026-08-12)

本版 = **天赋感知教练**(不再拿玩家没点的天赋技能提建议)+ 回放心控敌我修复 + 死亡回顾精简 + 两个新教练话题。

### AI 分析

- `cf539cf` 天赋感知能力门:「队友可给 X」与死亡回顾的可用免疫建议现在核对玩家实际天赋——职业/专精/英雄三棵树含二选一节点,外加 PVP 天赋槽对照官方池。幽灵外置建议全库 517/918 → 0;Solo Shuffle 按轮读天赋(171/186 场 shuffle 有玩家轮间改天赋)
- `cd1b22f` `eac8853` 模型挑选层话题多样性:旧四族(漏驱散/漏净化/被控锁死/饰品浪费)每份报告限 2 条——prompt 限选句加确定性审计兜底;四个后端旧族占比 61–65% → 43–49%
- `c277ca8` 新话题:爆发打进大减伤且当时有更软的目标
- `0da7653` 新话题:敌方开进攻大招、己方真实承压后防御反应迟缓(8 秒门槛按实测反应延迟分布定,中位速度的反应不会被点名)

### 战报

- `6265556` 死亡回顾精简:DoT 与平砍逐跳合并为按技能小计行,低于最大血量 2% 的直击与治疗折叠成可展开行,驱散首次以独立行出现,卡头「显示全部」可回到原始视图。每次回顾中位行数 114 → 24,金额守恒
- `5753c14` 死亡回顾各行带内联技能图标

### 回放

- `48f3e2a` 心控不再带歪回放敌我(地图血条分列、圆点描边、泳道分组、两队 chip):敌我改锚定竞技场名单而非日志 flags,报障的「2v4 实为 3v3」那轮显示正确——已导入对局同样生效
- `22b9d00` 修复敌我投票回归(2026-08-07 引入):被 charm 碰一下就可能整场翻边,存档 230 场里 1459 个翻转单位 → 1 个

### 数据

- `526a3fb` 12.1.0.69273 正式 build 全链数据刷新:12.1 天赋树落地、官方移除的天赋消失、Ring of Fire 为历史日志保留
- `5856ee0` 递减重置窗口分时代:12.1 前 16 秒,S2 切点起 20 秒
- `2309964` 观测技能宇宙落账 8 月新对局:3346 → 3353 个 id(图标 +5,off-GCD +1)

### 其他

- 视觉基线、backlog 记档、开发工具:`5a907df` `1534706` `bb814f4` `1ba1613` `b77d460` `4e0beae` `fdc6dfe` `56e631d` `493e02d` `09ae85b`

## v0.1.21(2026-08-06)

本版 = **claude CLI 后端接入 Claude 5 模型家族** + Windows CLI 探测修复(「spawn …\npm\claude ENOENT」)+ 时刻级深挖一批(回放「深挖此刻」入口、窗口深挖多条化、后视偏差门)。这也是已装 0.1.20 的 Windows 机器第一次通过自动更新收到的版本。

### AI 分析

- `968ab59` claude CLI 后端的模型下拉更新到 Claude 5 家族:新增 Claude Fable 5 与 Claude Opus 5,Opus 4.8 由 Opus 5 取代。默认仍是 Claude Sonnet 5;此前选过 Opus 4.8 的自动回落到默认
- `8415b7e` Windows:claude/agy/codex 自动探测不再误选 npm 目录里不可执行的 Git Bash shim ——「spawn …\npm\claude ENOENT(版本探测失败)」的根因;版本探测对 .cmd 安装也能工作了
- `f8e0139` `e65a9ce` 窗口深挖每个锚点可产出 1–4 条独立发现,不再合成一大段;每条单独过审计,结果按条缓存
- `72e33ec` 深挖审计修复:多条 pack 不再因编号重映射整批丢弃(agy 后端曾 27/27 全丢)
- `1df954b` `06ad08e` 新增后视偏差门:用「玩家当时不可能知道的信息」评判决策的发现,展示前被丢弃
- `cbec10f` 深挖审计逐条记录丢弃原因,发现凭空消失可以查了
- `66d1b29` AI 面板显示在跑状态行:计时、后端与模型、CLI 后端无流式的说明、重试/补跑标注

### 回放与时刻级深挖

- `bc8387e` 回放控制条新增「深挖此刻」按钮,对光标所在时刻发起深挖;手动拖选窗口恒用密集快照
- `29fec9e` `f1642b1` `554f832` `923420d` `7d4b67f` `39bf02b` `1ed42d7` 密集时刻快照(锚点附近的 HP、光环、冷却、施法流)可打包进深挖 prompt,由设置开关控制
- `45f292a` `361bdc1` N=20 盲配对中密集快照未跑赢默认口径,开关默认关;且仅在 CLI 后端(订阅计费)生效,API 后端恒用默认 prompt
- `d1e3652` `267a405` 新开关与回放按钮的视觉基线

### 评估基建(面向开发)

- `9fb2428` `f6dad02` `12a7e2a` `117f66c` `d499503` `e5c4d71` 判官噪声底:accuracy 维改由 factAudit 确定性计算而非判官打分;可选 K 重聚合;种植错误工具;A/B 跑批失败显式记账与增量续跑
- `a6ec075` `1e7084c` `4f1f408` `ed7df7f` `bcee64f` 赛果光环实验:赛果标签涂抹、定种子建臂、符号翻转对齐统计、共享 bootstrap 种子、第六类 facts 一致性硬门
- `ece1011` `0b51b62` `2a1306b` 跨 AI 时刻深挖 A/B:--gen/--judge 参数、agy 后端、双判官一致率
- `0263d65` `63e9446` `5881a84` eval 批量的 DeepSeek 驱动:消息构造、容错 JSON 解析、超时与可重试性分类
- `9b7ebb3` `0f42562` `9d26676` 同族偏差 2×2 双差分与谄媚挑战工具
- `f0e5255` 后视偏差语料工具:种植/合法合成与谓词复核两模式

### 其他

- spec、计划与实测数字回写:`256a9c9` `fde0e43` `e000449` `d976582` `f332b6c` `0b05e44` `7e92056` `e150564` `19f89bd` `6839986` `ab15a62` `3b546d7` `6fd7738` `8d99348` `e2879f4` `ba5b876` `a38a79d` `9da1e1d` `2e2b695` `9834b79` `67d1991` `01f5f57` `b78c85d` `69e11bc` `63c499d` `33a68fe` `242ed43` `17b0cf6`

## v0.1.20-ui.1(2026-08-04,测试包)

今日战报/事件/批量分析一批改进的测试包,从 main 切出 —— 含下方 v0.1.20 一节的全部内容(Windows 自动更新等,尚未正式发版)与回放对齐修复。**不含** v0.1.20-obs2.1 旁支的 OBS 二期第 0 段(那条线等 Windows 门测后合入)—— OBS 测试机请勿用本包覆盖。

### 战报

- `618b8f2` 曲线指标下拉:血量 / 伤害 / 治疗 / 承伤 / 被治疗。四个流量指标按每秒堆叠柱渲染;治疗含吸收,与榜单同口径;切曲线联动切换同名榜单模式
- `c97d491` 各 tab 统一敌我记号:名字前队伍色点(绿我方、红敌方),榜单按队分两组,敌方血量曲线画虚线;宠物继承主人阵营
- `6803890` 右侧栏新增「问教练」tab —— 看着曲线问教练,与 AI 分析页同一份对话;打开死亡回顾自动切回

### 事件

- `e86783b` 表头筛选行:六列各自过滤(时间窗 / 类型多选 / 来源 / 目标 / 技能 / 数值下限),来源与目标是独立下拉且含宠物图腾;点列名排序,再点翻向

### AI 分析与批量

- `d252d4f` 同水平对比自动补跑:有分析没对比的对局,打开 AI 面板自动补一次(未分析的照旧不跑)
- `fc87ad9` 批量分析:「跳过已分析」改为可选(取消 = 重新分析并覆盖);列表行可勾选做定向分析,shuffle 一勾整场 6 盘

### 回放

- `c54dc0f` 录像/回放时间换算收敛单源(偏移允许为负,带 pre-roll)—— 录像 tab 的跳转不再差整个日志滞后量

### 其他

- `61861b5` 设置页「更新」行悬停可见完整错误信息
- `ce32577` 发布链路修复:tag 构建现在真会产出 latest.yml(--publish never)、上传 glob 收窄、安装按钮闩锁
- `1dee8f4` 首渲预算重锁 3300 → 5200 ms(旧线锁自已不存在的样本群,六次采样证据在 commit 里)
- 文档与基线:`fe0d1d5` 谓词索引收录 Report UI 一节,`d384fee` 自动更新真机实测记录,`2db86fd` 谓词索引条数订正,`613cd95` 开发过程档案;视觉基线 `93ae553` `68e83af` `8b3ec6a` `6b42b37` `b02eb83`

## v0.1.20(2026-08-05)

这版=**Windows 安装版自动更新** + 开发者页改版成工作台,**加上 v0.1.20-ui.1 测试包整批战报/事件/批量分析改进转正**(曲线指标下拉、各 tab 敌我记号、事件表逐列筛选排序、同水平对比自动补跑、批量勾选 —— 逐项带哈希见下方 ui.1 一节,此处不重复),再加其后两条跟进。

### ui.1 测试包之后

- `6d1e82f` 人物过滤改为 solo 语义:默认全选时点一个人 = 只看那个人;其余状态点击 = 只翻转那个人。把最后一个可见的人也点掉时回到全选(空白图没有信息)。图例、曲线、榜单点名同一套语义。
- `6d1e82f` 回放 tab 顶部玩家 chip 分成两个带标签的簇 —— ● 我方 与 ● 敌方,镜像下方泳道的分栏,不再平铺一行。

### 更新

- `6673a25` `6f6de3a` `23c7d3f` `59a1881` `faacad4` `05fce43` `b727f5a` `4d16124` `a922e6d` `6afa619` `648d290` `56578d0` `91b6c64` `f13180c` `13d8434` `dec7bc2` `5e0dd47` `67f810c` Windows 安装版现在会自己更新:启动后不久查一次 GitHub 有没有新版,之后 app 开着还会隔一段时间继续查,有新版就后台下载,顶栏出「新版已就绪 —— 立即重启 / 稍后」的横幅。**安装发生在退出时**,所以物理上不可能打断正在录制的对局;就算一直不点重启,下次正常退出也会装上。正在录像或正在跑批量分析时,「立即重启」是禁用的。设置页新增「关于」小节:当前版本号、手动「检查更新」按钮、「自动检查更新」开关(默认开)。检查失败是**刻意静默**的 —— 从 GitHub 拉 110 MB 失败是常态,弹窗只会变成噪声,而且失败不影响 app 的任何其他功能。
- `7739c13` `de28390` 更新之后,顶栏会出现一次「已更新到 0.1.20 · 更新内容」,点开是该版本的发布说明。自动更新本身是无感的,而「我现在是哪一版」恰恰是报问题时第一个要知道的。

不覆盖:macOS 不受影响(本机包走 ad-hoc 签名,Squirrel.Mac 不认,updater 在 mac 上根本不初始化);Windows 绿色版(zip 解压版)同样不启用,因为它没有可以接管的安装器。**0.1.20 本身仍需手动安装** —— 0.1.19 里没有 updater,收益从 0.1.21 起兑现。

### 开发者页

- `b4c0345` `5fdfff7` 「开发者」页改版成正经工作台:左侧导航 rail + 全高布局 + 底部常驻状态条,分四区 —— 监控、对局检查器、AI 调用、诊断。对局检查器的 JSON 树现在点开才懒加载节点,不再把整份文档一次性转成文字(库内对局均值约 62MB,以前会直接冻住);数组按 500 条分页。事实卡也新增了事件计数。

### 录像 tab

- `2a1222d` `15b8ed1` 「全部时刻」清单吃满侧卡高度(2560×1440 下 653px 浪费 → 11px),该 tab 的视口预算收敛为一处。

### AI 分析

- `959c1f6` 「同水平板块有时候不出现」根治:对比在主进程保留可拉取的终态、代际按场分桶、缓存键与分析 prompt 版本解耦 —— 切走 tab 再回来不会再丢已完成的对比。

### 其他

- `3d2b353` `56ef723` `5a9982f` `63df5de` `834d80b` `e5e6a60` `c684160` 自动更新设计 spec 与实施计划撰写及四轮复核修订(纯文档,不涉及 app 行为)。
- `79990b3` `b0f0efb` `42bcce1` `b08b6a9` 全仓代码注释中英化收尾(499 文件 / 6790 行,余下约 134 行为有意保留,例如生成物文件头与模板字符串)—— v0.1.19 第一批之后的第二批,也是最后一批。
- `105f0ec` `0d49b4c` `57720ac` 上面开发者页改版的视觉基线维护(三轮重生成+人工审图,刻意收窄范围避免带偏其他视图共用的 fixture)。
- `476eb4c` `59ea7ad` 聊天卡入基线、录像清单吃满高度、回放 chip 分簇的视觉基线维护;`0018b7f` 本 changelog 初稿;`3b75494` v0.1.20-ui.1 测试包的 release commit。

## v0.1.19(2026-08-02)

这版=对局内「问教练」AI 聊天 + 教练不再乱怪人(驱散责难四道可行性门)+ 新增打破控制统计 + 录像打完不停的修复 + 应用内报告问题。

### AI 分析(问教练:对局内追问)

- `d7d19bb` `409ac96` `a709d7c` `925c032` `5e0b549` `5df2807` `1a02cd0` `6b2875e` `ebb4699` `7398453` `6b14ecd` 新增**问教练**:AI 分析出结果后可以就这一场继续追问,续用同一次分析的会话上下文(Claude / agy / Codex 三个本地 CLI 后端均支持),不必把整场重讲一遍。多轮对话、随时停止(真正杀掉后台进程)、草稿保留。
- `49d2599` `6404573` `5305b25` `8d6f190` 三轮复核修复:切换对局不再串台、发送中途停止/重试不会抹掉草稿、回显不再出现重复气泡。

### AI 分析(教练不再乱怪人)

- `1c8f966` 「你怎么没驱散」这类指摘现在必须先过四道门:①**站位** —— 队友在柱子后面或超出 40 码驱散射程时不算你的错;②**你被控住了** —— 硬控/沉默期间没有反应窗口不算漏;③**你被踢了学派锁**;④**DR 语境** —— 对方控制递减还没起来、解了大概率立刻被续控满时长时,教练改成谨慎建议而不是当失误批评。本机 150 场实测:这类指摘从 710 条降到 505 条(-28.9%),你点名的束缚射击从头号误报源降了 42%、龙息降 40%。旧的分析缓存会自动失效,重跑一次即可看到新口径。

### 战报(新增打破控制统计)

- `fe1db04` 对局面板新增**破控** tab:①**资敌打破** —— 己方伤害提前打断了挂在敌人身上的控制(附打破者、打破技能、还剩几秒),这是可教的;②**敌方自误** —— 对面自己的 DoT 打断了他们给你上的控制,是正面信号。定身被打破单列不计入教学(定身常常是刻意打破换位置)。本机实测每场平均 6.1 次,两类几乎各占一半。
- `2d393bd` 控制时长的配对逻辑统一到一处(顺带核查:担心的时长虚增经全语料实测并不存在,如实记账)。

### 对局录像

- `85d4642` **打完对局录像不停**的修复:①对局中途 OBS 连接闪断后,打完这一场若没有下一场,录像此前永远没人去停 —— 现在会重连回去收尾;②战斗日志写盘停顿(打完没有新事件推动)时,超过 3 分钟自动收尾,不再干等 40 分钟安全阀;③所有 OBS 请求加 15 秒超时,单个请求卡住不再拖死后续所有起停。

### 回放

- `3754c31` 回放页移除内嵌的录像小窗(录像有独立 tab,那里画面更大、还有可点拖的战斗时间轴)。

### 全局

- `8dedeac` 新增**报告问题**:战报工具条一键打包本场原始日志、最近的 AI 调用记录(prompt 与返回)和你的描述,存到 gladlog-sync 同步盘(会自动上传)或本地,生成后直接打开所在文件夹。刻意不包含 API key。

### 其他

- `1993adf` 代码注释中英化第一批(8 文件 / 350 行,余量待续);`a4648f1` 清理死 import 修 CI lint

## v0.1.18(2026-08-01)

这版=批量分析并发化(3 路)+ 低承压守护注(没被打过的轮不再被指摘「减伤没用」)+ 战报/录像/战绩三项拍板字面与布局微调。

### AI 分析

- `0c568a0` 批量分析由串行改为 **3 路并发池**:跨场与 shuffle 回合同队列,一盘 shuffle 的多个回合也并行;进度仍按场计,取消对每个在飞单元逐个定点生效
- `37f5df2` 没被打出真实承压的轮(整轮最低 HP ≥ 60%),prompt 现在明确声明「捏着没开的减伤是正确决策」—— 教练不再照着技能组的 [UNUSED] 标签,在你几乎零承伤的轮里编排「你整场没用减伤」(本地库实测:低承压轮无门标签 72/92 → 裸奔 0/92)。提示词版本升级,旧分析缓存(含这类误报)会重新分析

### 战报/录像/战绩微调

- `c3dbb69` 战报页头结果区中文化(「败北」等,字重加大;meta 顺序改为赛制·回合·地图·时长·评分);录像页标记条挪进与进度条同一轨道列,可对着金带/图记拖动;战绩分地图卡改行式(名称+胜率条+n%·x场),点击行回对局列表并带上该地图筛选

### 其他

- `c287115` 拍板三项对应的 14 张视觉基线更新(CI 生成,人审)

## v0.1.17(2026-08-01)

这版=三个界面的两轮 UI 改版落地(战报双栏工作台/战绩 KPI 塔+教练卡/录像三 tab 工作区,含 4K 空态与真实局验收修复)+ 结构化分析八项信号出面 + 多模型分析对比与自动分析 + 数据合规三项。

### 战报(双栏工作台/第二轮微调/八项信号出面)

- `9672da3` 战报改版为**双栏工作台**(≥1440px):左列生命曲线、榜单+对局面板、爆发账本,右列死亡回顾+失误清单;页头加胜负结果区与 KPI 速览 chips(终结/失误/爆发窗/打断/驱散);打断/驱散/光环三张独立卡合并进对局面板 tab;窄窗口自动回退单列;`ff8c649` 四项复核修正随行
- `4bc1954` 生命曲线上的爆发/承压窗改为低透明度填充与边界描边 —— 重叠窗口不再糊成深色块;无友方死亡时回退展示的敌方最后死亡,标题改为「终结回顾」(终结即战果)
- `ff66f10` 死亡回顾卡真实局溢出两处修复:事件时间线收成 5 行内滚(长回合死前 10s 有几十行小额事件,曾把右栏抻到两屏多高),来源列剥服务器后缀(跨服全名曾把页面顶出横向滚动);`8a7ea5d` 滚动区域补键盘焦点(无障碍门当场抓到)
- 结构化信号出面:`2532caa` 单源结构化底座与死码清理;`f23569e` 曲线下新增 dampening 泳道,CC 时刻标注 DR 递减档位(`1a13c29` 复核修正);`3c2825c` 爆发账本加目标选择判定(该打谁)与治疗空窗出面;`6a215c8` 页头**比赛节奏行**(转折点可点跳回放)、走位事件进时刻轴;`5fd2e4c` 复核修正(去英文 prose/走位失误单源);`16f9900` 死亡回顾标注恐慌性防御与更省替代,新增**敌方 CC 链面板**;`97dd5c6` 更省替代排除自用无效的外置技能

### 战绩页(KPI 塔 + 教练卡 + 空态填充)

- `9672da3` 战绩页改版为左 **KPI 塔**(场次/胜率含 W-L/当前评分带 sparkline 点开大图/时长中位)与右教练卡双栏;整行评分曲线卡撤销;错题本与长期规律合并为「这周该练什么」
- `4bc1954` 4K 下右列大片空白的三件套:新增**最近对局**卡(最近 8 场富行,点击直进战报,评分涨跌与对局列表同源);「对阵敌方阵容」空态就地给**重建索引回填**按钮(不再引导去开发者视图,主进程加单飞防并发重建);评分 sparkline 加首末值标签;页宽上限与战报统一 1920

### 录像页(三 tab 工作区 + 播放联动)

- `1235c6f` 播放器换自定义控制条,进度条按 shuffle 轮夹取(原生 controls 会露出整段录像);`e045e3d` 事件 feed 改高度感知容量,不再按墙钟淡出;`0fdfd69` AI 分析结果可靠进 feed 与标记条;`2e0c5f5` 三项复核修复(录像比本轮短的空态防 CPU 打满等)
- `9672da3` 录像页改版:左播放器与**战斗时间轴卡**(与战报同源的 HP 曲线/金带/死亡 ✕,点拖即 seek 录像),右侧一张卡三 tab(播放 feed/全部时刻/AI 发现)
- `4bc1954` 未播放时默认落「全部时刻」清单(此时 feed 恒空),开始播放自动切回 feed,手动切过的选择永远优先;战斗时间轴敌方曲线降透明度突出己方血线;视频区吃满剩余视口、时间轴卡贴底

### 回放

- `b96dfda` 缩放改语义:地图放大而标记保持恒定屏幕尺寸;`a51e1c2` 删除内置竞技场底图(那些 PNG 里没有地图,只有已在画的障碍物)

### AI 分析(多模型对比/自动分析/未覆盖亮点)

- 多模型对比:`6cdcc80` 分析缓存分槽信封 v2(槽谓词单源);`44cde5f` 按后端×模型分槽落盘;`5f273c5` 分析按钮 split 箭头「选用其他模型分析」(临时切换不写全局);`d8abf5e` 分析面板多模型槽 tab 切换;`e35870d` 深挖追问跟随目标槽的后端/模型;`05a1e01` `6f01226` `6fa1dd9` 三轮复核(缓存端到端接线/旧槽占位提示/renderer 生产构建修复)
- 自动分析:`616cf7e` 设置新增「自动分析新对局」开关;`4002f51` 实时入库打 live 标志;`0b897fa` 新对局自动排队分析
- `5a3cc88` `4721f36` 未覆盖亮点卡:全场滑窗自动找 AI 没讲到的高事件密度片段,一键接选段深挖;`f1041e9` 三项复核修正
- `acfa1a9` CC 距离与「贴脸」定义在分析与验证门之间单源化,判定口径不再两套

### 数据与合规

- `3b6aff1` 断开对 wowarenalogs CDN 的运行时依赖(图标走本地缓存)与数据合规文档;`c840a19` 游戏枚举改由暴雪官方 DB2 生成,解除许可冲突;`0cb05ae` 语料采集加可识别 UA 与下载侧节流

### 语料工具(不随产品发布)

- PvP log 长期归档管线:`92b26a5` 编排壳(扫 feed/存压缩字节/传 Drive/记账去重);`134da14` 纯谓词归档计划;`1861bce` 按天分片账本;`7b6813b` rclone 参数与成功判据;`0921704` 运行锁;`05da63b` `f8b3625` 两轮复核修复;`b50af8c` 下载完整性校验分层

### 其他

- 文档:架构/谓词索引/包级 README/用户文档双语 `022d686` `54393d8` `c46fa3c` `9a0f321` `8baa85e` `0a6a1c7` `ace6334` `e44f959`;设计与计划 `2f62ac2` `df9553d` `2342ef9` `84f8c08` `38fd5b6` `09ea325` `6d7bc7f` `26ff4e9` `5796b07` `54dfb64` `a165a63` `3c85408` `a87e5cf` `b156296` `393932a` `375725b`
- 视觉基线更新(CI 生成,人审):`a1f0f8a` `886ac7a` `b505e48` `04c1756` `ff37adf` `6ff6fce`
- 工程:`84541b9` package-lock 版本号同步;`b6663cd` `1e77b18` 工作区依赖声明与 externalize 修正;`4e5171d` `2bf7a94` eval 侧声明收敛与谓词索引防腐测试

## v0.1.16(2026-07-31)

这版=17a+17b 减伤反事实全家桶(死亡回顾卡新增减伤核算/反事实推演)+ 全周对抗审计修复(OBS 录像/选段分析/密钥安全等)+ DeepSeek 后端转正。

### AI 分析(DeepSeek 后端转正/技能名与因果文案/本地 CLI 稳定性)

- `eeb291e` AI 后端新增 **DeepSeek API**(官方 api.deepseek.com,V3/R1 双模型)并转正(原 v0.1.16-ds.1 测试包内容);`04006af` 流式回复提前结束不再静默截断成"正常"结果;`c2f14e3` 流收尾补 decoder flush,防止结尾多字节汉字被吞;`b824e72` 强化技能名必须保留英文原名的规则,压制 DeepSeek 把技能名译成中文;`c792076` 客户端加超时/停滞看门狗与错误信息脱敏,请求卡死不再无限等
- `d9bfbfa` 新增技能名中文化检测(spellNameZhLint):AI 教练文本把技能名译成中文时自动识别并改回英文原名;`1b48d39` `91f7d0e` `331895b` `8aa766b` 四轮复核补齐否定守卫/hedge 豁免/gloss 守卫等误判缺口
- `d249c3a` 因果确定性用语检测(causalLint)补上中文模式——生产默认中文,此前一直是零覆盖盲区;`aed104d` `22eb6f2` 两轮复核修否定守卫遗漏(单字"未/不"、跨分句误豁免等旁路)
- `1ccfcab` `9d50192` 内联技能图标停用词表补漏(Heal/Push/Pull 等常见词此前会误撞技能名被撤掉图标)
- `6213503` `22e3ac5` "死亡时保命技能可用未按"类判定的冷却可用性算法抽成单一谓词并修边界(未来才发生的施放不再被误判成"当时可用")
- `d4910f5` `1936e70` `e6d1b50` 本地 CLI 后端(Claude/agy/Codex)稳定性三修:多字节 UTF-8 输出不再跨 chunk 乱码、版本探测失败提示"可能版本不兼容"、应用退出时确实收掉飞行中的分析进程/请求

### 战报(死亡回顾卡:减伤核算/反事实/图标)

- `2e00956` 新增技能减伤对照表(双层生成 + 35 条白名单人工审核策展,歧义技能不猜、如实标注);`c8ce5b0` 生成层用官方 SpellEffect 数据打底,拿不准的技能不瞎猜、标记待定;`8572bde` `322ffc2` `f7b0f38` 三轮修正个别技能的减伤判定(如"黑暗"改判为条件减伤而非无减伤)
- `ac7a81d` 死亡回顾卡新增**减伤核算 + 反事实推演**双面输出——每个已交的减伤挡了多少伤害、免疫期间承伤多少、"如果按了保命技能会怎样"的假设推算,同一套算术也写进 AI 分析的 [DEATH] 行,保证卡片与文字口径一致;`f97f06e` 反事实分三档(明显能活/边缘/仍然死)且判定谓词单一来源;`d335aee` `9f30824` "本可避免的死亡"新增第六档 + 存疑外置判定候选;`00950fc` 反事实关联改成按技能名+精确时刻匹配,避免同名技能记错场次;`4e5aad3` 阵营过滤修复 + 窗口常量统一来源;`93627b0` `be34e8a` 死亡结算外置表 7→14 项扩充 + zoneId 读取两处修复(含视野判定回归测试);`9b7410b` 六档标注正式接入时间轴分支(此前生产端是死代码,不生效);`ddea0e5` 免疫核算行措辞防止误读
- `6d36798` 死亡回顾卡的技能名统一换成内联图标(此前只有 AI 分析文本有图标)

### 对局录像(OBS 对账/退出兜底/保留策略)

- `8495025` OBS 断连后与实际录制状态对账,消灭孤儿录像连锁失败;`0b8b98c` 对账加"正向证据"门槛,不再误停用户自己手动开的 OBS 录制;`05c5f82` 应用退出前等录像真正停下,不然 OBS 会录到天荒地老;`199adec` 是否需要密码的判断改成三态诚实建模,字段缺失不再被误判成"需要密码";`811abc9` 录像索引四处修复:对局关联误判、孤儿录像挤占保留名额、磁盘占用泄漏、部分录像未纳入索引可见性

### 选段分析(#16 串台修复/缓存/重试)

- `2278430` `016c9ce` Solo Shuffle 换回合两修:不再渲染出上一轮遗留的选段 AI 分析结果,换回合状态清理改成精确清理而不是整组件重新挂载;`324f616` `db49a99` 选段分析缓存诚实标记"分析后确实无结果"的终态,重开同一时间窗不再重复付费调用模型(含版本戳/后端模型判据/时间键精度三处修正);`22ed56d` 手动点"重试"改成强制重新请求,不再被上面这个诚实空终态缓存拦住

### 设置与安全(safeStorage/密钥)

- `1748ee5` API 密钥落盘改用 Electron safeStorage 加密(此前明文存在配置文件里);`afa63d3` 保存设置时只对本次改动命中的密钥字段加解密,避免保存无关设置时把已保存的密钥抹掉;`bbf4a04` agy 本地后端在 Windows 上改走 `.cmd` 安全路径,消灭把 prompt 内容拼进命令行参数的本地命令注入隐患;`cf27f44` agy 落盘目录收窄到专用子目录 + 补崩溃后遗留文件清理

### 数据与工具(corpus-tools,不进产品包但影响数据质量)

- `187e4f3` fetch-pvp-logs 语料下载补分数段(BRACKET)校验 + 分页请求限速,更礼貌地请求外部接口;`c9c463e` 被截断的下载会拦下,不再混进清单和去重集污染语料库;`7e8b8b3` 仓外备份补 gitignore,GCS 元数据缺失字段的判断改成诚实建模;`f2d68c9` 本地语料覆盖文件损坏时补上警告日志,此前静默回退用户看不出原因

### 其他

- 减伤表与 17a+17b 设计/计划/收账文档:`514a3c5` `189367e` `7756c13` `288bfc7` `1b894f2` `baaf252` `6c1f8d1`;`01034bd` #17b 可行性量化报告;`d111b87` causalLint 中文盲区记录;`c55c583` 全周对抗审计 P2 挂账 10 项
- 视觉基线更新:`7c07e88` `c8b58a3` `901ee50`
- `04a82f6` release: v0.1.16-ds.1(DeepSeek 测试包,内容已并入本节转正)

## v0.1.16-ds.1(2026-07-30,测试包)

DeepSeek 后端测试预发布,基于 v0.1.15。真模型 smoke(填 key 跑一场分析)通过后转正。

- `eeb291e` AI 后端新增 **DeepSeek API**(官方 api.deepseek.com,OpenAI 兼容流式):模型 V3(chat)/ R1(reasoner);设置页选中后填 DeepSeek key 即用,无 key 走确定性回退;R1 思维链不进输出。注意:与本地 CLI 不同,数据会发送到 DeepSeek 服务器

## v0.1.15(2026-07-30)

录像 tab 信息关联一期(= obs.6 测试包内容转正)+ 语料工具与文档。

### 录像 tab(转正,明细见 obs.6 节)

- `5969efa` 对齐标记条(金带爆发窗 / ✕ 死亡 / ⚠ 失误,点击定位)+ 右侧播放事件 feed(kill-feed 式滑入/淡出/上顶,拖进度条不重放历史,可开关)

### 语料工具(不进产品包)

- `102eb1c` fetch-pvp-logs 产物归档 Google Drive(rclone 增量同步 + DRY_RUN + 未装/未配可读指引)

### 其他

- `859c954` backlog #20 AI 分析聊天框记账;`24f69f6` 起的 merge 与 release 工程提交;开发者指南补「开发环境依赖」(rclone 可选依赖)

## v0.1.15-obs.6(2026-07-29,测试包)

录像 tab 信息关联一期(brainstorm A+C 定稿),基于 v0.1.14。

- `5969efa` 录像 tab 新增:视频下方**对齐标记条**(金带 = 爆发窗、✕ = 死亡、⚠ = 失误,点击定位)+ 右侧**播放事件 feed**(kill-feed 式:播放越过事件时刻从底部滑入,5 秒后淡出、下面往上顶;死亡/失误/爆发/控制/驱散/防御,跑过 AI 分析的场次还有 🤖 深挖时刻;拖进度条不会把跳过的历史全弹一遍;可开关、记忆)

## v0.1.14(2026-07-29)

两条线合流:OBS 对局录像一期(obs.1–obs.5 五个测试包收敛,Windows 真机五轮验证)
与 main 上并行落地的三个 backlog 特性。录像部分的逐项内容见下方 obs.1–obs.5
五节(本节不重复);main 侧改动如下。

### 对局录像(OBS,正式并入)

- 汇总:自动起录/停录、时间窗关联、录像独立 tab、回放页同步小窗、自动检测
  OBS、shuffle 六轮共享与换轮时钟复位 —— 见 obs.1–obs.5 各节明细

### AI 文本内联技能图标(#15)

- `edd2413` `4d59b5f` `cb91248` `58ccfef` AI 分析/对比解说/finding 卡的技能与专精名渲染为图标+文字
- `a6cfffa` `e06b632` `7e9cbcd` zhCN 技能名词典与英文名倒排索引(数据层)
- `4455689` `f79e90c` `0d36c01` 所有格文本漏配/超短占位名/首屏富文本自愈三修
- `15795c1` `def748f` 视觉基线更新;`39fb7bd` datagen build 号钉住

### 战报选段 AI 分析(#16)

- `c46c82d` `ee54ba4` 时间窗工具条新增【AI 分析此段】:拖选任意时段一次性深挖,终态卡挂工具条下
- `50c80c6` `8fb8375` `606117e` 深挖链路 windowOverride 参数化 + window 模式 prompt(中性框架+空输出契约)
- `63d3c68` `c19cc42` `d1f743e` 跨窗口 lost-update/stale 响应/busy 终态等审查修复;`46d5977` `a051abe` 试验台与基线

### 时间轴承压泳道(#4)

- `1ea4397` `c10c38f` `0ea46f1` Timeline 新增承压/暴露细泳道:DMG SPIKE 点击直接设窗接选段分析,healer exposure 标记入轴
- `f48d4e6` 治疗暴露编排全分支审查三修;`0ad6134` 视觉基线;`2767b3a` TimelineStrip 同步项勘定作废

### 本地 CLI 后端零配置(另)

- `eab287d` `5af87e5` claude/agy/codex 命令路径自动检测(win+mac),设置页显示检测结果
- `8686bd7` agy Windows 命令行超限时 prompt 自动落盘中转

### 分析与基础设施(另)

- `c62f905` `562c988` 「死亡时可用未按」三份异源实现收敛到 `cdAvailableAt` 单源(BACKLOG #18)
- `e32f095` F170 `[ENEMY HARD CAST]` 接通 castStartEvents(0/208 → 28/208 场)
- `c837f73` `ce267ac` SP-B2.1:`reference_vectors.json` 支持 userData 覆盖热更 + 复审两修
- `6eb3715` fetch-pvp-logs 语料工具(corpus-tools,不进产品包);`bb545a3` 合规更正与 backlog #19

### 其他

- 各特性 spec/plan/收账文档与 backlog 状态更新(`c6a173e` `9d8f432` `bbc8887` `e70779f` `6007500` `a6e38c2` `253fb55` `732f43b` `e626be5` 等);merge commit `24f69f6`

## v0.1.14-obs.5(2026-07-29,测试包)

真机第四轮反馈,其余同 obs.4。

- `d1d6227` 设置页新增「自动检测 OBS」—— 直接读本机 OBS 的 WebSocket 配置,自动填好地址与密码并试连,不用再去 OBS 里抄密码;服务器未启用时提示去 OBS 勾哪一项
- `0a5b98a` 单排切换轮次时回放时钟(与录像画面)停留在上一轮时刻 —— 换轮自动复位到新一轮开始

## v0.1.14-obs.4(2026-07-29,测试包)

真机第三轮反馈,其余同 obs.3。

- `a2c9bfe` 新增独立「录像」tab —— 全宽原生播放器(可拖动/调音量/全屏),打开自动定位到本场(单排为本轮)开始;仅有录像的对局显示。回放页的同步小窗保留,用于与战斗时间轴逐秒对照

## v0.1.14-obs.3(2026-07-29,测试包)

真机第二轮反馈修复,其余同 obs.2。

- `1cbcaf4` 单排(Solo Shuffle)只有第一小局能看到录像 —— 整段录像现在 6 轮共享,点开任意一轮自动定位到该轮时刻

## v0.1.14-obs.2(2026-07-29,测试包)

真机测试首轮反馈的快速修复,其余同 obs.1。

- `5be0fdf` 设置页「测试连接」改用当前输入框内容(此前只用已保存值:输完密码没点保存就点测试,会以空密码连接报鉴权错误;地址框同理)

## v0.1.14-obs.1(2026-07-28,测试包)

OBS 录像一期(外控 obs-websocket)的**功能测试预发布**,出自
`feature/obs-recording` 分支,未并入 main;Windows 真机验证通过后并入并出正式版。
顺带包含 v0.1.13 后 main 上的 arenacoach 第一批分析增强。

### 对局录像(OBS,一期测试)

- `d40d873` `df70b55` 开场/结束实时感知:对局开打自动通知录像端(换日志文件、换目录等异常路径也会补发停录信号)
- `435c7a1` `06a19c8` 连接你自己装的 OBS(28+,开 WebSocket 服务器)自动起录/停录;设置页可配地址与密码(密码回读打码);OBS 没开只提示不影响战报入库
- `cb553b2` 录像按时间自动关联到对局,可配「保留最近 N 场」自动清理旧视频
- `9fd72dc` `a0350e1` 战报内直接播放本地录像(支持拖进度条),应用退出自动停录
- `1675f68` 回放页新增录像小窗:与回放时钟同步,点死亡/失误/事件跳转时视频跟着跳
- `3c15987` `084106d` 设置页新增「对局录像(OBS)」分组:启停、地址、密码、测试连接、保留策略
- `35829c2` 跨 AI 复核修 6 项:回放拖过视频末尾卡死 CPU、录像索引单行损坏丢整库、OBS 侧手动停录后拒录后续对局、对局中途关设置漏停录、换目录漏停录、保留场数逐键写盘

### AI 分析(arenacoach 第一批,来自 main)

- `ea25e77` `99b67d8` 新失误检测:自己死亡时保命技能明明可用却没按(含可在控制中使用的技能单独判定)
- `ce92a37` 新失误检测:队友阵亡时你的外部减伤可用未给
- `40a1011` `127b711` 新失误检测:中立局面浪费 PvP 饰品(解控饰品无控可解时按下)
- `4c45b29` 技能可用性判定统一为单一谓词,防御性 CD 分析同源重构
- `89dc8e8` 上述三类接入 AI 教练 prompt 与失误清单
- `a95991e` `dca4b52` 修驱散/死亡分析五个缺口(B站网友反馈排查)与复核采纳两条(ownerId 回退、饰品事件去重)

### 其他

- `b7a15d1` `843e7bb` 类型/静态检查修补;`9337cef` 语料扫描;`a3dbcac` 设置页视觉基线更新;`9e170bc` `5d74c52` `906a1cf` `72d2832` `644fd5f` `48c36b8` 文档(评估/计划/backlog)

## v0.1.13(2026-07-27)

来源:用户反馈「一盘一盘点 AI 分析太慢」—— 新增批量分析。

### AI 分析

- `b807b1f` 批量 AI 分析:对局列表顶部新增入口,选「最近 N 场未分析」
  后自动逐场跑与手动一致的完整分析(含深挖轮)——已分析的自动跳过,
  进度实时显示,可随时取消;切去看别的战报也不中断。
- `b807b1f` Solo Shuffle 按回合逐个分析,与手动逐回合点开一致;某回合
  已单独分析过不会整场漏掉其余回合。
- `b807b1f` 取消批量只停批量本身,不再影响手动正在跑的那场分析。

### 其他

- `6ac67d7` 新增 FAQ(面向新用户)并在 README 挂链接。
- `02075bc` 对局列表视觉基线更新(批量分析入口)。

## v0.1.12(2026-07-26)

来源:性能专项(打开对局/回放/首屏全面提速)+ 跨对局自我学习(新功能)

- Codex 本地后端 + 三条 UI 反馈。

### 性能(打开更快、更省内存)

- `ea8ef76` 打开一场对局 1244ms → 37ms:主进程字节直传,不再物化整个
  对象图,主进程堆增量 207MB → 0。
- `b425718` 全库瘦身迁移:对局文件总量 75.2GB → 49.0GB(-35%),旧档
  读取时自动自愈;瘦身谓词单源。
- `bc6c8d7` 主进程三处卡顿消除:取原始日志行/历史导入/重建索引改流式
  或下沉 worker,界面不再冻结。
- `eee7006` 回放稳态渲染开销降约百倍:GCD 泳道窗口化、事件表虚拟滚动
  (滚到底不再堆十万级 DOM 节点)。
- `2d7ecc7` 回放采样查找换二分,并堵住两处随播放时长增长的内存累积。
- `d8c1b97` 生产构建启用压缩(此前 3.6MB 裸包从未压缩过)。
- `ee7ff92` `7b69443` `67ddc95` `331b1f1` 大数据表(法术名/天赋/图标/
  效果)惰性加载与体积压缩:主进程与首屏不再为用不到的表付出启动代价。
- `bba4ed9` 战报 HP 曲线降采样,hover 不再每帧重建曲线路径。

### AI 分析 / 跨对局自我学习(新)

- `cef6a85` `ef7da45` 每次 AI 分析的 findings 自动沉淀到本地学习台账,
  历史分析一次性回填;台账不随提示词版本升级作废,记忆纯前向积累。
- `a78ce4a` 确定性模式挖掘:同类问题近 20 场出现 5 次以上且分布稳定,
  才判定为「稳定模式」;支持按对手职业/地图的条件切片。
- `78ae67e` `25c740e` AI 只负责把统计模式翻译成人话,文本过占位符纪律
  审计(禁裸数字、禁因果断定),违规整条丢弃。
- `5642ef4` `f2176f0` 整合服务:攒够 10 场自动整合;统计部分永远落盘,
  AI 提炼失败只缺描述文本、下轮自动补齐。
- `0abbcfe` `23fea3c` 战报 finding 上出现「惯性问题 · 近 N 场已犯 M 次」
  徽章 —— 规则引擎确定性匹配,不调 AI。
- `88403a8` `6a2b6a5` `a4e571b` 战绩页新增「长期规律」卡片:规则列表、
  活跃/已改进状态、每 5 场频次趋势、证据链跳战报、手动重新整合;订阅
  回填进度与整合错误提示。
- `9829abe` `97fd96a` 验收工具 `learning:scan`:台账/模式/规则三级数字
  复核,可自证不漏扫。
- `1efd7f4` 台账写入钩子异常隔离,任何情况不影响分析主流程。

### 设置 / AI 后端

- `7d2792d` `a71a6c9` 本地 AI 后端新增 Codex CLI(OpenAI gpt-5.5):
  免 API key,走本机 `codex` 命令;净回复取输出文件,空回复与并发调用
  的边界已处理。

### 事件表 / 战绩 / 战报(UI 反馈三连)

- `82c39df` 战绩页放宽至 1280px 并居中(此前 900px 贴左,宽屏空一半)。
- `82c39df` 事件表技能列加技能图标(tick 聚合行同样),行高与虚拟滚动
  不受影响。
- `82c39df` 死亡回顾只保留战报右栏常驻位:回放/事件里点死亡标记自动
  切到战报展示,浮层移除,不再两处重复。

### 其他

- `3bfd9bc` `abc0e11` 自我学习功能的设计文档与实现计划(含跨场键修正)。
- `79a2e0c` `bb1a33b` `126df6d` 测试/CI 修缮:lint 未用导入、CI 慢机
  预热 deepDive 模块、清除误提交的临时产物。
- `a3d72b3` `9d3da81` 视觉基线随事件表窗口化/战绩居中/事件图标/设置页
  Codex 文案重录(CI 单源生成,逐张人审)。

## v0.1.11(2026-07-26)

来源:用户实证反馈——神牧每盘被念「没用 Desperate Prayer」,但没被打的
场次根本不该念。

### AI 分析 / 失误清单

- `af248a1` 「保命 CD 整场未用」加承压门:整场最低血量 <60% 才判定
  (12 轮神牧实证:被误报的 8 轮最低血量全在 70–94%,真按保命技的轮
  9–52%;同判据修后误报 8/12 → 0/12)。失误清单与 AI 提示词同源,
  没被打的干净局不再出现这条,也不再被 AI 反复说教。承压场次照常保留。

### 其他

- `055414d` `d97a657` 修复配套:in-src 测试适配新签名;battle/synth 视觉
  基线随门重录(人审确认门双向:低承压行消失、承压行保留)。

## v0.1.10(2026-07-26,当日覆盖重发)

来源:死亡回顾可视化升级(v2 定稿)+ 开发者页规模修复 + 交互修缮 +
测试覆盖专项(六任务)。首发含 v1 双栏曲线,当日按反馈改版为逐行血条后
覆盖重发,资产同名内容不同。

### 回放 / 战报

- `3d52ce2` `60a541a` `c4f5d98` 死亡回顾升级:每行「技能 + 数字 + 血条」,
  血条画该技能作用前→后的血量区间——红=掉血、绿=回血,悬停显示
  「82% → 61%」;伤害数字标红、治疗标绿。前后血量精确到事件(高级日志
  同时间戳样本),旧日志无高级数据时该列留空。(中间态 v1 双栏曲线已被
  v2 取代)
- `85ce27c` AI 分析关键时刻轴:「+N 次要时刻」展开后现在可以收起(此前点开
  就回不去)。

### 开发者页

- `4d3d96a` 详情预览封顶 256KB:此前无上限渲染整份对局 JSON,真实库单场
  25MB 点击即冻死(>30s 无响应 → 501ms);超限显示完整体积与文件位置。

### 其他

- `477f473` `64011c6` `460c3ee` `f5d3055` `3df3e1e` `b359bf9` 测试覆盖专项:
  analysis 上下文四文件与 eval 审计器补测(criticalMoments 7.61%→83%、
  timelineSections 53%→98%、resourceSnapshot 58%→92%、judgeSpotAudit 0→100%),
  并落地 coverage 度量基建(`npm run coverage`)。
- `fec622d` `7b003b9` `2dee06f` 视觉基线随死亡回顾改版两轮重录(均已人审);
  E2E 导航定位改精确匹配,修掉与回顾卡按钮子串撞名的竞态。
- `8fb4869` `eb7c43c` `c19bf25` `ab2f1d7` `f56e6b6` 文档:覆盖提升计划收官
  回填、死亡回顾 v1/v2 设计与实现计划、CHANGELOG 基建与 v0.0.1–v0.1.8
  追溯补记。

## v0.1.9(2026-07-25)

来源:外部评审《调整方案.md》全量落地(经 agy 辩论采纳,五条修正)+
category 枚举化独立任务。

### 事件表

- `4d4f9ab` 死亡清场折叠(连续同目标 −失去 ≥5 条 → 一行聚合,±1.5s 有死亡标
  「死亡清场」chip)、周期 tick 聚合(同源同技能连续 ≥3 → ×N 求和);吸顶表头
  与表格自持滚动;「再显示 300 条」按钮换近底滚动加载 + 自动补页;kind 过滤
  换胶囊(色点 + 计数);伤害/治疗数额 p95 微条分色;死亡行高亮 +「▶ 死亡回顾」
  直达。

### AI 分析

- `f22776e` 关键时刻轴两级化:死亡/爆发带保持完整药丸,防御/驱散/控制降为
  小字行;同类同侧连发(≤5s)折叠为「{类} ×N」;条目 >40 收「+N 次要时刻」
  阀门;图标统一文本字形(禁 emoji);severity 中文映射(高/中/低);证据
  chip 补事件名短标签。
- `877c77d` `category` 从模型自由 string 收敛为八 slug 英文枚举(prompt 约束 +
  审计层归一 + 聚合按归一键),渲染侧中文词表(生存/冷却使用/站位/目标选择/
  控制/打断/驱散/进攻)。真模型 smoke:枚举合规率 9% → 100%(6 场 sonnet
  中文回复)。错题本跨场聚合从此稳定。
- `168af31`(P3-1 部分)cohort 卡:单维不再渲染「最强/最弱」;分位话术统一
  「第 N 百分位 · 高于/低于本分档中位」;spec 中文(42 专精词表)、
  「样本 N 场」。

### 战报

- `c5e3f33` 打断/驱散/爆发账本/失误清单四卡空数据保留卡壳 + 一行空态文案
  (0 失误显示「干净局」);光环 uptime 按单位分组(组头职业色 + 缩进 +
  超 top-6 展开)+ 0:00/mid/end 刻度 + 类别图例;失误清单严重度过滤 chips
  (>12 行默认藏轻微);死亡回顾进战报自动展开最近一次友方死亡(✕ 关闭后
  本场不再弹);HP 曲线图例行(点击 = 隐藏曲线)、⚠ 标记 <8px 聚簇为 ⚠N、
  死亡标签与 ⚠ 相邻时左锚避让;Shuffle 报表头 W/L 胶囊即回合切换
  (R{i}·W/L,键盘可用),删独立 Round tabs 行。
- `168af31`(P2-2/P3-2 部分)榜单数值分级缩写(1.54M/568k,title 保留精确
  全值,treemap 明细同规格);窗口列表行尾时长 chip + 击杀结果 chip。

### 回放

- `00a2efd` 地图名字标签按需显示(hover / HP<50% / 爆发中才渲染)+ 黑描边
  底板 + 相邻 <70px 自动上抬避让;GCD 泳道「标准/紧凑」档(紧凑 88px 列宽,
  chip 只留图标,localStorage 记忆)+ 泳道下方击杀窗口金色跳转 chips(点击
  两栏共享时钟同跳);底部双行快捷键/图例说明收进控件条右端 ? 圆钮。

### 全局

- `fddbf13` 技能名全站语言统一:渲染层 5 处 `getEnglishSpellName` 调用换
  `displaySpellName` 单源(日志原名直通,空才落词典)。CN 对局英文词典名
  1299 处 → 9 处(残留均为日志原文)。

### 其他

- `51e875f` `4f32916` CI 修复(空态断言随新行为反转、chip 兜底、漏交文件)。
- `5e5a2ca` + `51e875f` 内含:九张视觉基线中七张重录(逐张人审)。
- `d888619` session 沉淀文档(prod-triage skill 等)。
- `049d6c4` release bump。

---

以下为**追溯补记**(2026-07-25 据 git 历史生成:每版 = `git log v<prev>..v<new> --oneline --no-merges`;超过 40 个 commit 的版本只列 feat/fix/perf,省略 chore/docs/test/refactor 等,全量见 git log)。

## v0.1.8(2026-07-25)

- `f5e63fd` release: v0.1.8 —— GCD 泳道折叠(同刻一行 + off-GCD 小图标,用户设计)
- `b302351` chore(qa): 视觉基线 —— 泳道折叠版重生成(已人审:同刻折叠一行、off-GCD 小图标、大招描金)
- `0751bf4` feat(desktop,analysis): GCD 泳道折叠 —— 同刻多技能一行化,off-GCD 主动技折为小图标(用户设计)

## v0.1.7(2026-07-25)

- `70585a9` release: v0.1.7 —— GCD 泳道换轴:时刻精确对齐(漂移均 15.8s→0),重叠横向阶梯
- `a89c46f` chore(qa): 视觉基线 —— 泳道换轴后重生成(已人审:时刻精确对齐,阶梯可读)
- `7d75573` feat(desktop): GCD 泳道换轴 —— 纵向钉真实时刻,重叠横向阶梯,漂移 92%>0.5s(均 15.8s)→ 0

## v0.1.6(2026-07-25)

- `6783147` release: v0.1.6 —— 光环虚线推断修正(幻影整场虚线清零)+ CC 时长数据潜伏 bug 修复
- `39bad78` chore(qa): 视觉基线 —— 光环虚线修正后 uptime 卡重生成(battle/window 两张,已人审:幻影整场虚线消失)
- `1af0d55` fix(analysis,desktop): 光环虚线推断修正 —— 双来源分键/DOSE 开段/官方时长封顶 + 潜伏的 overrides 空壳压条 bug

## v0.1.5(2026-07-25)

- `747ff60` release: v0.1.5 —— 萌芽误杀修正 / 图标缺失 89%→0.05% / DR 表官方化 / dispel fallback 双证据清除
- `183fc23` chore(qa): 视觉基线 —— 萌芽类真按压回归 + 图标名全量解析,report-replay 重生成(已人审)
- `92a91cd` fix(analysis,eval): 图标宇宙定版 —— 三源并集 1.5MB,覆盖率不损(0.05% 缺失),首渲预算内
- `028e625` feat(analysis,desktop): 三项收口 —— 萌芽误杀修正 / 图标全量化 89%→0.05% 缺失 / DR 表官方化(抓出 2 错判+1 隐性失效)

## v0.1.4(2026-07-25)

- `210a884` release: v0.1.4 —— 泳道终局门(吞噬/幻灵清零,折叠 5.3%,误杀 0)+ 官方 PvP 替换表 17 对
- `2267f7e` fix(desktop): 泳道门终局 —— 默认保留 + 分层否决,误杀清零、折叠 5.3%、吞噬/幻灵清零
- `cef7d32` feat(analysis,desktop): 自制数据换正式数据 —— PvP 天赋替换表(官方 17 对)+ 玩家按键表(泳道垃圾清零,折叠 44.5%→1.9%)

## v0.1.3(2026-07-25)

- `d883607` release: v0.1.3 —— doc 瘦身(-39%)+ 读取自愈迁移,修内存 2GB+ 攀升(顺手清掉误入库的临时脚本)
- `0f7196b` fix(parser,desktop): doc 瘦身 —— 单场 442MB/内存 2GB+ 事故,params 稀疏化 -39% + 读取自愈迁移

## v0.1.2(2026-07-25)

- `beb926a` release: v0.1.2 —— GCD 泳道滤噪(折叠 44.5%→10.5%)/ 读条排队容差 / 灼热凝视替换 / 非法占位符堵漏
- `927c4eb` chore(qa): 视觉基线 —— GCD 泳道滤噪后 report-replay 重生成(其余 8 张字节级不变,已人审)
- `43d22c6` fix(desktop,analysis): GCD 泳道垃圾施法折叠真技能 / 读条排队误掐 / PvP 天赋替换未建模
- `070c923` fix(analysis,desktop): agy flash 复核采纳 3 条 —— 非法占位符堵漏 / 重试静默 / facts 键命名空间契约

## v0.1.1(2026-07-25)

- `1cbbe1c` release: v0.1.1 —— 修「只有2条/格式异常」:序号占位符 + max_tokens 扩容 + bad-json 重试;附生产验证驱动
- `9ca89e8` fix(analysis,desktop): 0.1.0 生产反馈两症状 —— 「只有2条」与「格式异常」

## v0.1.0(2026-07-24)

- `4b744c1` feat(analysis,eval): 可解性置信门 —— missed-cleanse/purge 主张语料实证率 92%/79% → 100%/100%
- `f5a7f54` feat(analysis,desktop,eval): 证据菜单覆盖面扩充 —— 治疗视角 3.4→8.6 条/场,三时段覆盖 0/17→11/17
- `2fff58a` fix(qa,desktop): 链路4 断言口径修正 —— 离屏窗初始高压到 500,>600 才真正证明整页捕获
- `e05c1e5` chore(qa): 视觉基线 —— 战报工具条新增「导出图片」按钮,3 张 report-* 重生成
- `a9569dc` feat(parser,desktop,eval,docs): 可验证性路线图剩余四项收口 —— B2 raw 行号深链 / trust chain e2e / B3 覆盖接入 / C3 图片导出
- `af5cd37` chore(qa): 视觉基线 —— df2789c UI 变更(时间窗条/失误卡/uptime/事件视图)4 张 report-* 重生成
- `473101d` feat(eval,docs): B1/SP-A.1 因果判官校准结案 —— causal-hardening 检出 50%→80%,verifiability 路线图五项收口
- `df2789c` feat(parser,eval,desktop): 可验证性路线 A2/A3/C3/B2 落地
- `95b8581` docs(backlog): #8 确定性失误检测 v1 结案(release/0.1)
- `6af9185` chore(qa): 视觉基线 —— 第四阶段④②③(失误清单/⚠标记/光环 uptime/事件视图)
- `c59ba8c` feat(desktop,analysis): 光环 uptime + events 视图 + 确定性失误引擎 —— 第四阶段④②③落地
- `ccd9e72` chore(qa): 视觉基线 —— 时间窗工具条(battle/synth)+ 新增 report-window 选中态
- `04cdabe` fix(desktop): TimeRangeBar 回显容差抬到 1s —— band 真值 36.734 vs 取整标签 36
- `b9a3142` fix(desktop): TimeRangeBar phase 下拉回显用容差匹配 —— band 起止带小数秒
- `5c29c2b` test(desktop): report-window 视觉场景 —— 时间窗选中态入基线
- `e1be96d` feat(desktop): 时间窗联动 —— 第四阶段① WCL timeframe/phase 交互落地
- `14e414a` chore(release/0.1): 开大版本分支 —— 版本升 0.1.0 + 第四阶段设计定稿

## v0.0.18(2026-07-23)

- `2cd5595` release: v0.0.18 —— 打断/驱散仪表盘、列表 comp/日期筛选、敌方饰品推断 + 漏驱散 7 条离散 CD
- `dc06585` chore(qa): report-synth 基线更新 —— 面板满状态入基线(其余六张字节级不变)
- `78b9ac5` test(desktop): synth fixture 注入打断命中 + 漏 purge —— 视觉基线覆盖面板满状态
- `bb85992` docs(backlog): #2/#3/#9 结案 + zh/EN 切换核实为已完成
- `0ba6cca` chore(qa): 重生成视觉基线 —— 打断/驱散面板 + 筛选条 comp/日期两维
- `793e127` fix(desktop): 筛选条日期组包成不可拆单元 —— 窄侧栏折行时分隔符不再孤行
- `fc2c73b` feat(desktop): 列表筛选补 comp(同队多专精)与日期范围 —— backlog #9 收尾
- `f145aaf` feat(desktop): 打断/驱散仪表盘 —— backlog #2/#3 打包落地
- `3746c55` feat(eval): §7ter 启用 + templateDuplicateRatio 单独定档 —— 两个 eval 决定落地
- `6949e20` feat(analysis): 敌方饰品未观察到使用推成可用 + 漏驱散补 7 条离散主动 CD —— 两个产品决定落地
- `08dcf63` docs(backlog): Layer B 三修复复评结案 —— 前后数字齐 + noise 重锚定副作用登记待拍板
- `65c791d` feat(eval): sufficiency 覆盖门裁决落地 + blindPool matchId 占位约定 —— 14.2/14.4 结案

## v0.0.17(2026-07-22)

- `580b4e4` release: v0.0.17 —— DMG SPIKE 起止时间戳、武僧打断专精分流、eval rubric 口径修复
- `d243f4b` fix(analysis,eval): Layer B 300 场评测挖出的三处真 bug —— DMG SPIKE 起止歧义/武僧打断误判/noise 口径缺口
- `6a5a905` docs(backlog): 14.2/14.5 结案 —— 修掉过期状态与一处被推翻的旧结论
- `cd21b15` docs(handoff): §1 收尾 —— 6/7,Layer B 可以开跑
- `22af6fd` docs(report): 上限修完后全 80 件重评 —— 4/7 → 5/7 → 6/7,余量变厚
- `d39b34b` fix(eval): 审计集 12 条上限吃掉尾部捏造 —— 抬到 20 且超限取两端
- `c0bd0d2` feat(desktop): 历史日志批量回填 CLI —— 带磁盘护栏
- `b269b90` docs(handoff): §1 补上完整 7 维结果 —— 5/7 达标但先修 12 条上限
- `eaa2af1` docs(report): §0 范围更正 —— scores-det2 已是全 80 件,不再是 30 件
- `9f583be` docs(report): 完整 7 维 verdict —— 4/7 → 5/7 达标,但脆且有一个规则伪影
- `0df6532` docs(handoff): §1 硬待办已结案 —— 指向 2026-07-21 的验证报告
- `277e80d` docs(report): 第三轮 rubric 验证 —— 锚点噪声清零,查证漏检没动
- `4ded221` feat(eval): 判官方差判据固化为脚本 —— 主判据改「找到的错误集合」
- `30bd91b` docs(handoff): 全面接管指令 —— 判官方差是唯一硬待办,两个产品决定不许代拍
- `a80f3f6` docs(report): 修掉普查文档里的过期状态 —— §1 表和 §3 都还写着「未查」
- `aa1d5e4` docs(report): 漏驱散修复的全量数字 —— 822 → 2251 行,门规全绿无丢失
- `0294de7` docs(report): 漏驱散与折叠驱散的根因 —— 「空 77%」里 73% 是正确沉默
- `2f1954c` fix(analysis): 漏驱散白名单 9 条里 7 条是死的 —— 补齐圣骑士三祝福 + 加一致性断言
- `737e39c` docs(report): 普查四项逐条结论 —— P1 已修,P2/POSITIONING 无需动,P3 留给人定
- `bf17ccf` feat(analysis): 敌方技能组与友方同源 —— 补上 65% 场次的证据缺口
- `329589d` docs(report): 证据缺口普查 —— 65% 的场次敌方冷却完全没追踪
- `9e257f1` docs(handoff): 判官方差与 Layer B 阻塞 —— 有真待办
- `3d92ba3` docs(eval-baseline): accuracy 锚点改查表 + 数字主张必须并排写值
- `5e9415e` fix(eval): factAudit 长度约定放宽为 [3,12] + 如实记录 14.5 的未证实结果
- `cca541c` docs(eval-baseline): factAudit 审计集改为规则确定,accuracy 只按该集打分
- `f8a74cd` docs(backlog): n=10 校准定稿 —— 14.2 加重、新增 14.5(accuracy 判官方差)
- `6f267ec` docs(backlog): 订正 14.2 —— 20% 里混了套件缺陷,真盲区是 2/5
- `8713a6d` docs(eval-baseline): 给 accuracy 三条操作判据 —— 治渗漏,不只重申原则
- `751f6bc` fix(eval): 校准特异性检查豁免构造性耦合维度 + 报告点名漂移维
- `92f96d2` fix(analysis): 死亡下的 [RES] 快照锚定到死亡时刻,不再取 T-3s
- `4997308` fix(eval): 冷却台账门规改为带归属判定 —— 消掉 67% 假阳性
- `2967959` fix(analysis): [HEALER CC] 施放者标签改用共享谓词 `actorLabel`

## v0.0.16(2026-07-20)

- `29d1d57` release: v0.0.16 —— prompt 自相矛盾清零 + 模型下拉 + 回放/地图若干修正
- `00234cc` docs(backlog): 14.1 标记已修,并订正其中错误的根因猜想
- `11a677e` chore(qa): 重生成 report-replay 基线 —— 底图改为固定桩件
- `68635d3` test(visual): 桩底图改用非对称角标,中央留空
- `f6dce47` docs: 两份 handoff 完工归档为一份复盘,移入 docs/reports/
- `a4d2e87` docs(handoff): 清过期与冗余
- `65f795c` docs(claude): 加「修复要给前后数字」验证规则
- `50deb8f` docs(backlog): 记入 2026-07-20 eval/QA 四项遗留
- `13d656e` docs(handoff): 标记两项遗留待办已完成
- `258dcdc` docs(eval-ab): 开跑前必算 MDE —— 防再跑一轮测不出的 A/B
- `0eeabb2` feat(eval): D 类冷却台账矛盾入常驻门规
- `637ebd8` docs(handoff): 盲评 A/B 收官 —— 七维全 inconclusive,凭确定性 ADOPT
- `665346a` docs(handoff): 盲评 A/B 续跑交接 —— 卡在子代理配额,6/100
- `710ed5f` docs(handoff): 订正 D 类结论 —— 第一次判断是错的
- `c820ad4` fix(analysis): D 类真根因 —— 同一技能两个冷却值(订正先前的错误结论)
- `8f48174` fix(analysis): 漏驱散行的时刻改用 fmtTime —— 最后一处裸秒时间戳
- `0a193b0` docs(handoff): 8 类全部处理完毕 —— 补两档半径删除依据与 D 类结论
- `dbe61bd` revert(analysis): 删除两档 HP 采样半径 —— 建立在已证伪的根因上,且有害
- `7c7e9f6` docs(handoff): 千场复验结果 + D 类已确认/未坐实部分分开写
- `1f33b04` docs(handoff): 更新至 7/8 类已修 —— 含「先问同不同时刻」这条主教训
- `23de9f5` fix(analysis): I 类 —— OFFENSIVE WINDOW 的伤害数字与显示区间对不上
- `be36279` feat(analysis): F 类 —— 玩家自己施放的 CC 补齐 DR 标注
- `cd60380` fix(analysis): H 类时长自相矛盾 + E/G 记号图例与窗口口径自洽
- `f42fca1` fix(analysis): C 类同秒 HP 矛盾 —— 消掉第三条 HP 采样路径
- `0e13264` fix(analysis): A 类真根因是渲染网格不是采样半径 + B 类百分位倒置
- `a8afe37` docs(handoff): 补 C 类根因与待改调用点清单
- `3cd5342` fix(analysis): HP 采样半径收敛为单源谓词 —— 修同秒 HP 自相矛盾
- `9b8e40d` chore(qa): 重生成 report-replay / settings 视觉基线
- `18d5fad` chore(qa): presubmit 一键门禁 + 模型输出形态审计工具
- `43c6e2e` feat(report): 纯地图档高度可调 + finding chip 技能图标
- `132b3da` feat(ai): 模型下拉 + 本地后端透传 `--model`;修围栏输出被误判 bad-json
- `2159889` fix(replay): 开局位置盲窗标成「位置未知」,不再当确定位置画

## v0.0.15(2026-07-20)

共 64 个 commit,以下仅 feat/fix/perf(32 条):

- `e44814d` fix(qa): webServer 判据抽成带测试的纯函数;report-ai 锚点收紧
- `9e952bd` fix(test): 分栏用例显式清 localStorage —— 修 CI 上的状态泄漏
- `ac5a2d1` perf: 大 JSON 走 JSON.parse —— 冷启动 25s→2s,首渲 24s→0.8s
- `7c14f5a` fix(qa): 补掉最终审查的两处「门看着在守、其实拦不住」
- `3ba8014` fix(replay): 提示条补 Ctrl+滚轮/分隔条可拖 + 清理两处退化 CSS
- `66acec0` fix(visual): threshold 0.2→0.05 —— 默认容差放行了同亮度的配色改动
- `75b27f1` fix(visual): 容差改用绝对像素数 —— 1% 比例放行了真实配色回归
- `de40f09` fix(replay): 分隔条补 pointercancel/精确像素换算/键盘可达性
- `76778b5` fix(e2e): 补 resolveJumpTarget 单测 + openAiView 提到公共助手
- `5ac8c92` feat(main): GLADLOG_E2E userData 重定向 —— E2E 跑在临时状态上
- `4ac00ae` feat(replay): 地图与 GCD 泳道之间可拖分隔条
- `884f28e` fix(parser): 删掉 synthArenaLog 未实现的 `rounds` 参数
- `f483483` fix(fixture): 补 `analysis.getState` —— AI 视图在 fixture 下真的渲染 finding
- `165a178` feat(replay): 三档布局(补纯 GCD),解除地图 560px 硬顶
- `e3aa811` fix(replay-zoom): 清理孤儿 CSS + 补测试覆盖
- `6698482` fix(visual): per-test 超时提到 120s + 端口真正单源
- `004118b` feat(replay): 缩放按钮浮到地图右下角
- `4b56c7c` fix(replay): 已进入缩放态后裸滚轮也接管地图缩放
- `0c67fa0` feat(replay): 分栏比例状态与 clampSplitRatio
- `f07d7d9` feat(dev-ui): 仪表盘/设置/列表场景 —— app-shell 也进视觉回归
- `c7c07ba` feat(dev-ui): `?scene=` 场景路由 —— 视觉回归的确定性入口
- `c72563c` feat(report): MatchReport 支持 initialView —— 视图可被 URL 直达
- `43f4b65` fix(deepdive): STAYED_IN 需付出真实代价才开深挖门 —— 判据与 formatter 同源
- `90a1e36` fix(desktop): getFlags 补 cancelled 守卫 —— 切场时旧场标记不再串台
- `624952c` fix(analysis): 目标死亡截断取最早一次,不依赖 deathRecords 有序
- `8a37def` fix(desktop): 代际条目回收 —— 但只在该场彻底静默时
- `1da25f9` perf(report): GcdSwimlane 布局 memo 真正生效 —— 依赖数组改稳定身份
- `5845f95` fix(deepdive): 占位符正则从 claimChecker 单源取 —— 别再各写各的
- `d4bf4b4` fix(desktop): 面板重挂改单次原子 getState —— 消掉「结果掉进缝里」的竞态
- `ce33ef9` fix(desktop): deepen 幂等守卫 —— 切页回来不再重复烧一轮深挖 token
- `536295c` fix(deepdive): focusT 锚最末锚点,不从被 clamp 的 anchorTo 反推
- `b7a7746` fix(desktop): running 追踪防泄漏(并发复审发现)—— 存代际按主人身份清 + abort 也清

## v0.0.14(2026-07-19)

- `1985247` release: v0.0.14 —— AI 分析切页不再丢失 + 未分析醒目大按钮
- `047b5c0` fix(desktop): AI 分析切页不再丢失 + 未分析时醒目大按钮

## v0.0.13(2026-07-19)

- `0b918a8` release: v0.0.13 —— 深挖轮(自动追问)覆盖死亡/走位/进攻失误 + 错题本
- `a81fc4c` docs(eval): 修正过时注释 五类→四类(juked-kick 已剔除)
- `6fbb4f9` test(eval): 进攻深挖大规模跨 AI A/B + 剔除弱类型 juked-kick
- `bdaf493` test(eval): 进攻深挖确定性扫描 + 扫描驱动的免疫门修正
- `1c85e9b` feat(deepdive): renderer 保底进攻深挖席位(survival≤2 + offensive≤1)
- `ad3aaac` test(deepdive): 断言生存-only pack 不印进攻图例(锁定门条件)
- `a477911` feat(deepdive): classifyFindingKind 分发 + prompt 进攻图例 + PROMPT_VERSION 12
- `0b6d8df` fix(deepdive): offensivePackItems role 用全名比较 + burst-start 条目补 inWin 守卫
- `76eed3c` feat(deepdive): buildOffensiveDeepDivePack + 纯映射核 offensivePackItems
- `c2ebd37` feat(deepdive): 进攻信号门 hasOffensiveCoachableSignal + PackItem kind 扩展
- `b073b94` docs(plans): 进攻深挖(非死亡 finding 深挖)实现计划
- `b1035bf` docs(specs): 进攻深挖(非死亡 finding 深挖)设计 + backlog #13
- `c55929d` test(eval): 走位信号价值 eval 谐波 —— 盲评生成 + 回构审计
- `11b5b51` feat(deepdive): 走位失误第四类信号 —— 补资源信号看不见的「死于走位」缺口
- `10c5112` test(eval): 逐 spec 信号分解 —— 诊断过门率差异根因(结构性 vs 覆盖缺口)
- `e66fe81` test(eval): 深挖大样本鲁棒性扫描 + prompt A/B 工具
- `f379503` feat(analysis): 深挖修 1+2 —— 可教信号门(防御Early/Late/≥3s硬控该交没交/驱散撞敌CD,门移到调用方)+ owner 锚定与 role 标签 + 干净窗口留白;PROMPT_VERSION 10
- `cf1ccfd` fix(analysis): 深挖 prompt 纪律修正(eval 驱动)—— 去 `units` 幽灵字段 + HP 拆逐检查点占位符 + facts 短名去 realm 数字;PROMPT_VERSION 9
- `59a75be` test(eval): 深挖轮量化脚本 —— 证据产出量(模型无关)+ 纪律 smoke(生成/审计两段)
- `858c46f` feat(analysis+desktop): 深挖轮(自动追问)—— 高严重度 finding 确定性证据包扩容([锚点-30,+10] 受控/防御/敌CD/HP轨迹/驱散)+ 第二轮叙述经 claimChecker+causalLint 审计 + 证据 chips 可跳回放;PROMPT_VERSION 7
- `cdb28cb` feat(analysis): death-setup 死因链候选 —— 死亡回溯前因事件(healer-locked/trinket-early/defensive-early,谓词镜像 death-trace)+ prompt 链条图例与死亡锚定上限 + max_tokens 4096 + PROMPT_VERSION 6
- `f1fcc04` feat(desktop): 错题本 —— 跨场 findings 按类型分组(main notebook 服务 + 战绩页内嵌展开卡:meta/标记/打开该场)
- `60392b1` docs(skills): agy-review skill(输出截断坑+采纳标准)+ desktop-dev 门禁改全仓 lint + cd 陷阱
- `7608d72` docs(skills): release skill —— tag 驱动出包/覆盖流程 + 资产验收 + 坑单

## v0.0.12(2026-07-18)

- `4f57f87` feat(desktop): 回放纯地图/GCD 布局切换(localStorage 记忆)+ 开发者页 AI 调用调试(最近 10 次 prompt/返回,内存不落盘)
- `1690a2e` feat(desktop): cohort 评分长条视觉增强 + AI 分析/对比合并为一个按钮(runSignal 联动)
- `2cdf2d6` feat(desktop): 0 finding 分因解释 —— fallbackReason(无候选/未配AI/坏JSON)+ 全被审计丢弃中文提示替换英文占位
- `7616a5c` release: v0.0.12 —— 首次加载提速(WeakMap memo/worker parse+LRU/bundle 拆分 19MB→2.1MB)+ tab 靠左
- `f35ee7a` chore: 外部评审可取两项落地 —— timeline spec tag 单测 + iconCache 缓存策略注释
- `7fa954d` feat(desktop): tab 位置调整 —— App 顶栏与战报页头的视图 tab 靠左(用户反馈),胜负+meta 推右
- `783657b` fix(desktop): matchStore 探针测试 console.log→warn(CI 全仓 lint)
- `d4c6342` perf(desktop): bundle optimization using top-level await dynamic imports for spellNames and talentIdMap
- `52e965f` perf(desktop): parse match file in worker thread and implement LRU cache
- `85474e6` perf(desktop): memoize toLegacySafe with WeakMap to speed up first load
- `c918779` docs(plans): 首次加载提速任务书 —— 全链路实测基线 + 三改法(memo/worker parse/bundle 拆分)

## v0.0.11(2026-07-18)

- `7cda727` release: v0.0.11 —— 全模块 UI 重设计(accent 夜蓝语言/战报时间轴脊柱/回放两侧框体/评分带) + 小地图专精图标 + cohort 评分化
- `f8b6301` fix(desktop): 重设计复核修正 —— 评分源同类相比(CR/MMR 不混)/当前评分基线守卫/跟进标记出证据守卫/回放光标投影(卸载回报)/死亡回顾卡 1c 样式/角色 chips accent 胶囊/CSS 去重(agy flash 复核 7 条)
- `930ca53` feat(desktop): UI 重设计 P7 战报 1c —— 单行页头+tab 同排/曲线卡 240 高+死亡圈标/窗口列表行(可点跳)/榜单|死亡回顾常驻两栏/榜单职业字形方块
- `d618d9f` feat(desktop): UI 重设计 P6 回放 1f —— 框体贴场地两侧/控件条重排+快捷键提示/泳道 5s 分隔带+光标徽标+大招 accent chip
- `0ffef99` feat(desktop): UI 重设计 P5 AI 分析 1g —— 操作区置顶+状态行(撤 MatchHero)/时刻轴单侧左轨/finding 标签化/cohort 分布条+游标(判定文本保持 faithfulness 锚定)
- `813b8ea` feat(desktop): UI 重设计 P4 战绩 1h —— 总览数字带(当前评分/涨跌派生)/曲线轴刻度+端点标注+图例/阵容胜率条/问题行式
- `c6c4792` feat(desktop): UI 重设计 P3 对局列表 1e —— 左缘胜负线/评分涨跌/日期分组头+当日小结/HH:MM/筛选条统一
- `08a65a2` feat(desktop): UI 重设计 P2 设置 1i —— 三列 grid/统一输入框/已设置胶囊/就地保存反馈/后端说明行
- `003a1e9` feat(desktop): UI 重设计 P1 —— accent tokens/Inter/两级 tab 形态/交互金→accent(数据金保留:击杀带/未按/控制字/kill chip/recent GCD)
- `d2070f2` docs(specs): UI 重设计交接稿收档(1c/1e-1i 全模块 + accent tokens)
- `0fd5605` feat(desktop): cohort 面板评分化 —— 方向修正评分单源(METRIC_LOWER_IS_BETTER)+ 评分条 + 确定性总结行(综合/最强/最弱)
- `1d9f1af` feat(desktop): 回放场上单位叠加专精图标(CDN 同列表先例,失败回退职业字形)

## v0.0.10(2026-07-18)

- `85ecb67` fix(desktop): 回放 UI 复核修正 —— smoothPath 端点/x 钳制,框体死亡判定改 deathT 谓词(agy flash 复核)
- `d10a575` feat(desktop): GCD 泳道两队分组 —— 友方列在左敌方在右,交界分隔竖线
- `449cd19` feat(desktop): 战报血量曲线平滑 —— Catmull-Rom 贝塞尔 + 控制点钳制防过冲 + non-scaling-stroke
- `47c6c05` feat(desktop): 回放竞技场框体侧栏 —— 友/敌两组血条常驻可读,hover 联动高亮+raise,替代旧 legend
- `1370f41` release: v0.0.10 —— 关键时刻轴 + 列表后台补载/战绩动态更新 + 战报明细 breakdown
- `1481898` docs: backlog #11 标记完成 + breakdown 实现计划入库
- `1750f55` fix(desktop): breakdown 复核修正 —— 点击区改真实 flex 盒 + 展开数据 useMemo + 宠物名不切分/同名不同服回退全名(agy flash 复核)
- `293536f` feat(desktop): 战报明细 breakdown —— meters 行内展开按技能/来源分解(backlog #11)
- `a4f33ba` feat(desktop): deriveDetailBreakdown —— 按技能/来源聚合,合计与 meterValue 对账
- `0a1bc18` feat(parser): decodeHpTail/hpTailSlice 导出 —— hp 尾参解码单源,parseLine 改用同一切片
- `24b1799` docs(specs): 战报明细 breakdown 设计(行内展开 + 核心列 + 暴击率,决策记录)
- `cf802d7` docs(backlog): #12 标记完成
- `f284d18` feat(desktop): 列表后台补载 + 战绩随入库动态更新(backlog #12)
- `751030b` fix(desktop): axis 复核修正 —— 被控节点带施法者 + useMemo 归并/分流 + 纯渲染 gap + 稳定 key(agy flash 复核)
- `cbbe235` feat(desktop): AI 分析页关键时刻轴布局 —— 轴替换横向 strip,cohort 全宽下沉,整场观察分节
- `da62316` feat(desktop): KeyMomentAxis 组件 —— 交错脊柱/省略标/点跳
- `ea8bf25` feat(desktop): deriveKeyMoments —— 关键时刻轴五类事件派生(谓词全复用 analysis)
- `62523ae` docs(backlog): #12 懒加载后台补载 + 战绩动态更新(用户反馈)
- `c12f586` docs(backlog): #11 战报明细 breakdown(按技能/来源分解,原版 detail 级)
- `714157b` docs(specs): AI 分析页关键时刻轴设计(用户批准的四项决策记录)

## v0.0.9(2026-07-18)

- `b9fb721` release: v0.0.9 —— 证据时间 chip + unconverted-burst 证据类型 + findings 3-5 条
- `ff2302b` feat(analysis): unconverted-burst 候选类型 + findings 提到 3-5 条(证据多样性)
- `cec89c5` feat(desktop): finding 证据加时间 chip —— 每条证据显示发生时刻,单独可点跳回放

## v0.0.8(2026-07-18)

- `0274b64` release: v0.0.8 —— 对比中文化/解说增厚/泳道截断
- `70606a4` feat(desktop): 对比面板全面中文化 + 解说增厚;回放泳道结束线截断

## v0.0.7(2026-07-18)

- `6181db4` release: v0.0.7 —— 后端命令路径手动设置
- `9aa71af` feat(desktop): 设置页补「命令路径」输入 —— Claude CLI/agy 后端可手动指定
- `25cdb67` docs: Windows + Claude CLI 安装指南(发同事用)

## v0.0.6(2026-07-17)

- `85c99a9` release: v0.0.6 —— 回放场地边界/入场房轮廓 + ⌘/Ctrl 滚轮缩放
- `e0d06b3` feat(desktop): 回放场地边界/入场房轮廓(语料实测)+ 缩放交互改 ⌘/Ctrl+滚轮

## v0.0.5(2026-07-17)

- `64881e3` release: v0.0.5 —— 覆盖尾巴清零 + 七个失明 CC + SPEC BASELINES 复活 + 敌方饰品行
- `b1ac13c` docs(plans): 超长对局加载优化设计 —— 主进程同步 parse 三重成本 trace + 方案 A
- `c9d6f0f` fix(analysis): benchmarks 千场重算 + 修活死键 SPEC BASELINES(第 15 例谓词分裂)
- `77c1b57` fix(analysis): [OFFENSIVE WINDOW] CD 带施放时刻 + 第 7 个失明 CC(agy 交叉复核)
- `5f16de9` fix(eval): rotScan 未用变量 —— CI lint 含 scripts,本地 `--quiet` 输出被截断漏看
- `cd0dc4b` feat(desktop): UI 压测样本池 —— 野生边界 fixture 生成/按需加载/headless 冒烟
- `41baa6c` fix(analysis): CC 白名单光环 id 腐烂 —— 千场语料实证补全 6 个失明 CC
- `601c959` fix(analysis): 覆盖尾巴清零 —— owner 无CD CC 上时间轴 + 双侧宠物驱散 + 敌方饰品行
- `d6f7cf2` fix(analysis): CC 行宠物施法者归因 + 千场野生 fuzz 工具
- `49046ba` fix(corpus-tools): comp tier 测试改静态导入 —— 冷 CI 动态 import analysis 超 5s 超时
- `ada128a` feat(compare): P2 对阵 comp 维度 —— 同阵容高手 cell + 时长/先杀 + comp tier 回退链
- `104dbd5` docs(plans): pro-comparison P1 勾选(387 cells,262 DPS)
- `6ea230f` fix(corpus-tools): union metrics 转 Record 需经 unknown(workspace tsc 含 src 测试)
- `f4e9845` feat(compare): 高手对比 DPS 指标组(P1)—— 7 维进 reference corpus,262 个 DPS cell
- `779a53b` docs(plans): 高手对局深度对比设计 —— 情境化指标/comp 维度/exemplar 导入
- `edd394f` fix(desktop): 缩放测试 className 类型(CI workspace tsc 含 test 文件)
- `6217aa5` fix(desktop): 缩放 handler prefer-const(lint)
- `dd431a5` feat(desktop): 回放缩放 + 战绩角色区分 + Windows 本地 CLI 后端
- `110bfff` refactor(logs): 日志收集工具整合 —— 共享 wowarenalogs 客户端 + 统一 `logs:*` 入口
- `753b674` ci: test workflow 加 electron-vite build 步 —— renderer 值引入 main 只有生产打包能抓

## v0.0.4(2026-07-16)

共 126 个 commit,以下仅 feat/fix/perf(89 条):

- `3a9ccc8` fix(desktop): API_KEY_REDACTED 移入 shared/protocol —— renderer 值引入 main 模块炸生产构建
- `6b697e7` fix(analysis): DPS baseline Top-3 修复 —— interrupt 字段语义统一 + kick 判定两 bug + 窗口截断 + 主语措辞
- `9836b74` feat(eval): 公开对局抓取器 —— 真 DPS 视角语料管线(D2 收尾)
- `1ac01b8` feat(desktop): 本场目标卡(D3 教练闭环)—— 「还在犯」分类进 AI 视图开场
- `d0c7089` fix(analysis): 爆发账本减伤行写明主语 —— 冒烟实测 responder 误读为己方外置
- `e3ee234` fix(eval): DPS 语料支持 —— `--owner dps` + 门规主语解析三修
- `0545421` feat(analysis+desktop): D2 —— AI 复盘 owner 视角泛化,DPS 记录者获 `<burst_ledger>` 与四类新事件
- `c83ba7a` feat(desktop): 回放爆发红光脉冲 + 同秒集火高亮(DPS D1 收官)
- `b9910a6` feat(desktop): DPS 爆发账本卡(D1)—— 爆发对齐/窗口目标纪律/打断审计
- `558359e` fix(analysis,eval): DR 图例消歧 + responder 聚焦句(baseline Top-2/3 issue)
- `602ed11` fix(analysis): 覆盖门三连修 —— 敌方宠物 CC / 敌方队内解 / 我方 CC 落敌不可见
- `b555dd9` fix(analysis): benchmarks 重生成 —— metrics 符号修复后的真实 DPS 基线
- `05bb089` fix(desktop): 移除未使用的 findingKey import(CI lint 挡了两个 commit)
- `59a586b` feat(desktop): 回放小件三连 —— 键盘操控 + 障碍物描边 + AI 流式预览(phase3 #4)
- `fd134a3` feat(desktop): 最常犯的问题聚合卡 —— 教练从点评变跟进(phase3 #3b)
- `d0369e8` feat(desktop): finding 跟进标记 —— 已跟进/还在犯(phase3 #3a)
- `7641d7b` feat(desktop): 历史日志导入 —— 文件对话框 → 解析入库 + 进度(phase3 #2c)
- `bb44c13` feat(desktop): 首启引导空态(phase3 #2b)
- `eaf37db` feat(desktop): 设置页 —— 用户项的正式家(phase3 #2a)
- `5726e52` feat(desktop): 战绩仪表盘 —— 跨场统计首落地(phase3 #1)
- `6925b41` feat(desktop): 战报 HP 时间轴画 KILL WINDOW/VULNERABLE 色带(可点跳回放)
- `d553b57` feat(desktop): 泳道阵亡 divider 可点 → 死亡回顾 —— 三处死亡标记入口齐活
- `bea7cd0` feat(desktop): 对局列表筛选条 —— 胜负/赛制/专精(对齐旧仓 MatchSearch)
- `454bdc1` feat(parser,desktop): 真读条条 —— SPELL_CAST_START 落地 + 回放读条进度(#11b 完全版)
- `45d0f0d` feat(desktop): 窗口色带可点 —— 点 burst/vulnerable 带直达该时刻
- `4f322c4` feat(desktop): 回放阵亡 ✕ 可点 → 死亡回顾(#6 v2)
- `f83228e` feat(desktop): 泳道 chip 点击定位 —— 点任意施法把共享时钟 seek 到该时刻
- `2c666ce` feat(desktop): 统计表行展开 —— 打断/被控实例明细 + 回放跳转(#10 v2)
- `8fca726` feat(desktop): AI 分析语言切换 中文/EN(backlog #1)
- `c03731f` feat(desktop): 回放三小件 —— HP 数字 + dampening 指示 + 施法闪现(backlog #11)
- `f32a4d2` feat(desktop): 统计表 —— 打断/被控/驱散每玩家硬数据(backlog #10)
- `b2fc00f` feat(analysis,desktop): 泳道技能图标 —— spellId→图标名挖掘表 + chip 渲染(backlog #9)
- `3501c76` feat(desktop): 死亡回顾抽屉卡 —— 点死亡标记看死前 10s + 可用未按保命(backlog #6)
- `b825184` feat(desktop): #8 收尾 —— TimelineStrip「回放此刻」+ KILL WINDOW/VULNERABLE 色带
- `8772f4f` feat(desktop): 对局列表富行 —— 胜负/地图/时长/评分 + 双方专精图标(backlog #7)
- `60d9707` feat(desktop): 证据链跳转 —— finding「回放此刻」直达事件时刻(backlog #8 核心)
- `852a136` feat(analysis): KILL WINDOW 重设计 —— 脆弱状态 vs 击杀尝试分离(burst 子窗口)
- `e3c1708` fix(analysis): 专精级覆盖排查 —— 12.x 爆发 CD 补齐 + Shadowfury DR + 7 个缺失打断
- `4cce06d` fix(analysis): OPPORTUNITY 行按时间渲染(选杠杆、排时间)—— 136/1245 乱序
- `5aa94e1` fix(analysis): 伤害符号约定 bug —— 'your damage' 全线只统计了被吸收伤害
- `f7a6251` fix(analysis): 不变量扫描再两修 —— kill-window CC 成员判定对齐渲染秒 + 引导施法注释自相矛盾
- `1aacaa5` fix(parser,analysis): 不变量扫描两修 —— shuffle 回合尾巴吞局间空隙 + CD 变体 id 误标 UNUSED
- `8181ef7` fix(analysis): Stasis 存储法术白名单补 4 个 12.x id —— 24/51 释放少列法术
- `6215390` fix(analysis): [MATCH TYPE] 头部预判框架 → 带对冲的 [MATCH PATTERN];产品提示词加 A/B 证据注释
- `ced551a` feat(eval): responder 模板加 ACCURACY DISCIPLINE 自查段(A/B: accuracy +0.71 CI 胜)
- `57d27f8` fix(analysis): labelBias 两处收敛信号 —— DMG SPIKE healed-through 标注 + 中性 exposure 判词
- `ec9a7c6` fix(analysis): RES 滞后 + STAYED_IN 窗口语义 + Sigil of Misery DR 标签(Gemini 评审三修)
- `f58ebc4` feat(analysis): 高频填充施法窗口折叠 + 引导 tick 抑制(降噪 A/B treatment)
- `aceafb5` fix(analysis): G5 扫描锚定渲染秒(floor)—— 1114/1021 残留根因
- `3cb15ea` fix(analysis): [CD] 目标标签最后两处 CJK 泄漏 —— pid 回退路径
- `315b224` fix(analysis): G5 take 2 —— LoS 判定改为与门规完全一致的 ±2s 扫描
- `83d4600` fix(analysis): last two locale-leak sites — [UNIT DESTROYED] + [CD] target labels
- `84bae32` fix(analysis): track Devourer Demon Hunter kit + Sigil of Misery CC
- `c0711f7` fix(analysis): evaluate LoS at raw sampled positions, not interpolated (G5 residual)
- `a3a75fb` fix(analysis): make INACTIVITY 'free' wording explicit (un-CC'd, could have cast)
- `0e360fe` fix(analysis): shared bounded HP sampler — death traces provably match STATE (B4 residual)
- `57a20fd` fix(analysis): resolve pet/NPC names in [KICK] lines (last locale leak)
- `8f5b255` fix(analysis): explicit "DAMPENING: n/a" line for short matches
- `7295177` fix(analysis): track missing enemy burst CDs (21% of corpus had zero [ENEMY CD])
- `69be1f3` fix(analysis): detect Grounding Totem absorbs by npcId, not English name
- `09cb414` fix(eval): SPECIFICITY_TOL default 0 -> 1 for the integer judge rubric
- `1e3bc3d` fix(analysis): bound position interpolation in healer-exposure LoS checks (G5)
- `4d65dbb` fix(eval): extend dispel-oracle rider exclusions found at 1245-match scale (B3)
- `c1f3fff` fix(analysis): unify burst-target attribution + tighten burst HP sampling (B4)
- `5f70143` fix(analysis): suppress localized totem/pet target names in timeline (locale leak)
- `c52ea5b` fix(analysis): render English spell names in offense/CC prompt sections (locale leak)
- `8c355a2` fix(eval): judge rubric 维度独立性 anti-halo rule (discriminant validity)
- `2188ec0` fix(eval): judge-calibration 判别效度 —— 特异性/最小样本/降幅门槛
- `bda41bf` fix(desktop): 修好 in-app fixture 预览(VITE_FIXTURE_MODE=1 npm run dev)
- `283fe30` fix(desktop): GCD chip 只显示技能名,目标移到 hover
- `1bbbae7` feat(desktop): 回放竞技场铺真实地图(按 zoneId 对齐 minimap)
- `3fb8c5f` fix(desktop): GCD 技能暂停时不压暗(只在播放时暗未来动作)
- `bc13036` fix(desktop): GCD 技能 chip 加高(上下更宽,更好读)
- `381f534` fix(desktop): 回放布局改 1:2(竞技场 : GCD 泳道),收紧中间间隙
- `56ed402` fix(desktop): 回放 GCD 泳道加宽放大(往左拉、字更大更清楚)
- `5413d7c` feat(desktop): GCD 泳道降密度 + 战报点名字筛选生命曲线
- `0df1479` feat(desktop): 本地 UI 试验台(npm run dev:ui)—— 纯浏览器渲染战报
- `e639493` feat(desktop): redesign AI 视图 — 双栏 findings 卡片 + sticky cohort
- `844caa9` feat(desktop): View C GCD 模式泳道(与竞技场共享时钟)
- `3d29414` feat(desktop): redesign View C 回放 — WoW 竞技场风格
- `821b741` feat(desktop): redesign View A — 段控视图 tab + 榜单内嵌模式切换 + 删单位侧栏
- `b5906c0` fix(vision): address agy cross-family review (C1)
- `abc6724` feat(vision): headless verify:vision script (C1)
- `7cd0c77` feat(vision): cohort selector + faithfulness checker (C1)
- `a69e662` feat(vision): timeline selector + faithfulness checker (C1)
- `cef0c97` feat(vision): meters selector + faithfulness checker (C1)
- `67d7d87` feat(desktop): 回放 Tab —— 2D 走位模拟(轨迹/阵亡/图例)
- `afd0dc8` feat(desktop): 单位详情合并施法+重要光环流 & 玩家筛选下拉
- `3807cce` feat(desktop): AI 分析拆成独立全宽 Tab(脱离右侧窄栏)

## v0.0.3(2026-07-12)

- `04b0f4c` build(lint): allow require() in .cjs files (electron-builder hooks)
- `fc55952` chore(desktop): bump version to 0.0.3
- `8710d4b` docs: /release-gladlog command — versioned desktop release workflow
- `5757fe4` feat(desktop): debug local-AI backend (claude/agy CLI)
- `136cb0c` docs(specs): debug local-AI backend (claude/agy CLI) design
- `b46fa73` build(desktop): afterSign hook — clean ad-hoc macOS signature (no more 'damaged')

## v0.0.2(2026-07-12)

- `bc45ba5` chore(desktop): bump version to 0.0.2
- `03641f6` perf(desktop): append-only NDJSON match index — one-read startup + O(1) store
- `ee3b37f` feat(desktop): infinite-scroll match sidebar (initial 100, older on scroll)
- `5874f51` feat(desktop): matches:page IPC + preload bridge
- `170def9` feat(desktop): MatchStore.page() paginated slice
- `3cc963c` docs(plans): match-list pagination + NDJSON index implementation plan
- `dc7e6fe` docs(specs): match-list pagination + fast-startup NDJSON index design
- `315814a` ci: let macOS build ad-hoc sign (drop CSC_IDENTITY_AUTO_DISCOVERY=false)

## v0.0.1(2026-07-12)

共 226 个 commit,以下仅 feat/fix/perf(157 条):

- `1d220ff` fix(log-pipeline): append-only reconstruction + review nits
- `50d1f94` feat(log-pipeline): collect CLI + cleanup tests
- `1eaa7d3` feat(log-pipeline): port cleanupAppliedSegments (node:fs + gzip-length cross-check)
- `ff940db` feat(log-pipeline): overlap-aware gunzip-validated collection
- `757ee57` feat(log-pipeline): length-encoded segment keys + flusher wiring
- `5475586` feat(log-pipeline): stage ported streamer + storage/protocol infra (raw port, pre-hardening)
- `c226d4b` feat(analysis): expand findings menu — side-tagged deaths + cd-waste events
- `cdebdf1` fix(analysis): honesty-pipeline bugs from agy cross-family bug-hunt
- `70da433` fix(analysis): three verifiedComparison bugs surfaced by the smoke test
- `4905b59` feat(analysis): harden findings prompt against raw digits (SP-A.1 digit refinement)
- `bf907fd` fix(analysis): R3 — render offensive-waste block in the timeline branch
- `ab05545` fix(SP-A): narrow causalLint patterns to cut false-drops (agy re-verify)
- `2ff8aec` fix(SP-A): close two honesty holes from Opus whole-branch review
- `a4afff4` feat(desktop): ExportButtons + StructuredAnalysisPanel replacing the <pre> analysis (SP-A T7)
- `308aa4d` feat(desktop): FindingsList + MatchHero + TimelineStrip (SP-A T6)
- `6bdca5e` feat(desktop): main-process analysis service + IPC/preload (SP-A T5)
- `43d6965` feat(analysis): findings prompt + analysis exports (SP-A T4)
- `a85a084` feat(analysis): auditFindings three-layer gate (SP-A T3)
- `1046bf9` feat(analysis): causal-language lint (SP-A T2)
- `e867e50` feat(analysis): candidate-event types + extraction (SP-A T1)
- `e6c07f1` fix(SP-B2): reset compare panel state + guard async race on matchId change
- `1407a00` fix(SP-B2): address Opus whole-branch review findings
- `9613971` feat(desktop): ProComparisonVerified panel (SP-B2 T7)
- `39ac7a8` feat(desktop): corpus loader + compare IPC/preload wiring + bundling (SP-B2 T6)
- `0899967` feat(desktop): main-process compare service with fail-open + claimChecker (SP-B2 T5)
- `63249ba` feat(analysis): exemplar-led prompt + compare exports (SP-B2 T4)
- `f3e7dcc` feat(analysis): template interpolation + claimChecker gate (SP-B2 T3)
- `4b12832` feat(analysis): verifiedComparison + facts dictionary (SP-B2 T2)
- `b7c7764` feat(analysis): compare corpus read-types + cell lookup fallback (SP-B2 T1)
- `f9f1673` fix(SP-B1.5): address agy whole-branch review findings
- `a05f9d3` fix(corpus-tools): aggregateCells self-guarantees the buildGroups invariant
- `6b30dd3` feat(corpus-tools): maintainer keystone-discovery tool (SP-B1.5 T7)
- `1e02d29` feat(corpus-tools): thread keystone gates through buildCorpus (SP-B1.5 T6)
- `3892072` feat(corpus-tools): validate build-group schema integrity (SP-B1.5 T5)
- `c3ff208` feat(corpus-tools): build-split cells + N_floor guard + buildGroups (SP-B1.5 T4)
- `9d39e0b` feat(corpus-tools): winsorize offensiveIndex to pool p99 (SP-B1.5 T3)
- `1ebeefb` feat(corpus-tools): assign buildGroup per record via keystone gate (SP-B1.5 T2)
- `2f342f8` feat(corpus-tools): keystone gate module + curated table (SP-B1.5 T1)
- `b0090a1` feat(corpus-tools): retry-with-backoff on feed calls for production-scale runs
- `2bcb0cc` fix(SP-B1): address final-review Important findings (latent safety-net gaps)
- `c6b0cc6` feat(corpus-tools): T8 real corpus build + 2 metric fixes found by acceptance gates
- `0c6b7e8` feat(corpus-tools): per-match record + buildCorpus orchestration (SP-B1 T7)
- `35f37a8` fix(corpus-tools): feed query needs inline fragments on ArenaMatchDataStub/ShuffleRoundStub (go/no-go smoke diagnosis; direct field selection on CombatDataStub interface → HTTP 400)
- `2727cce` feat(corpus-tools): feed client + go/no-go smoke (SP-B1 T6)
- `481bb57` feat(corpus-tools): corpus validator hard gate (1.5 sentinel/ASCII/N_floor) (SP-B1 T5)
- `9392e73` feat(corpus-tools): scaffold package + cell aggregator with archetype celling + N_floor (SP-B1 T4)
- `3817d11` feat(analysis): enemy-comp archetype classifier for cohort celling (SP-B1 T3)
- `4a4a02f` feat(analysis): port extractRotations/crisisEvents from old fork (SP-B1 T2)
- `ecdb8cf` feat(analysis): port computeHealerMetrics from old fork (SP-B1 T1)
- `2ee7ee2` fix(analysis): restore death-outcome block + never-used flag in timeline prompt (E2E regressions R1+R2)
- `154d38c` feat(analysis,eval): dispel visibility — named dispel spells on [CLEANSE], team [PURGE] + [ENEMY PURGE] lines, folded [MINOR DISPELS]; manifest excludes movement root-breaks from dispel denominator (backlog #5)
- `f004d74` feat(eval,analysis): geometry grounding scanner + pipeline guards — 176-match corpus at 0 violations (backlog #3 hard gate)
- `22f7565` feat(eval): CONTESTED safety-contract assertion script (F193 replication) — 176-match corpus clean; F193 rubric clause added to eval-baseline accuracy dim. Backlog #4 closed
- `ed29c81` feat(desktop,eval): adopt timeline prompt variant as production default
- `ac35614` fix(parser): strip trailing \r from CRLF logs — feign deaths were recorded as real deaths; timeline: STATE min-gap 3s + delta [RES] on CD casts (A/B cycle-3 density compression)
- `0e6d5c4` feat(analysis): timeline unit references carry compact spec tags (A/B cycle-1 accuracy-regression fix)
- `3e4adf4` fix(analysis): owner-perspective Result line + neutral section headers (baseline eval findings)
- `d68f8d1` fix(review): sub-project 5 findings — unsigned mask decode, build-string validation, icon fetch budget, test-hack removal
- `c3c6e64` feat(report): talent icons with local disk cache (zamimg, offline-degrading) + update-wow-data workflow + datagen manifest
- `7dd1f93` feat(report): named talents in unit panel (getTalentNames via raidbots node maps)
- `f77afd5` feat(datagen): spell-class map + catalog validation (known-removed allowlist: Mind Bomb kept for historical logs)
- `a08df98` feat(datagen): own generators ported (trinkets, talent modifiers) + regenerated artifacts (build 12.1.0, 129 tracked spells)
- `9b1134c` feat(analysis): two-layer spell effect data (generated base, curated overrides win)
- `e2bd7b9` feat(datagen): spell effects miner (PvP-duration-aware, GCD-artifact filter) + generated base layer (3560 spells)
- `a611d42` feat(datagen): spell names regenerated from wago (enUS, minified, 413k entries, 13MB→12MB)
- `d6e8ba0` feat(datagen): raidbots talent fetch + real talentIdMap (40 specs, activates named-talent decoding)
- `1354e16` feat(datagen): wago csv + emit foundations
- `5b62fb0` fix(eval): final-review findings — blinding protocol, strict score schema, auditor robustness, CLI parity
- `6927ece` fix(eval): review findings — LCG strict [0,1) bound, dimensionScore numeric-string coercion parity
- `b01edc2` fix(eval): checkProvenance CLI accepts BASE_DIR without --run; e2e smoke pass
- `b71163f` feat(eval): score provenance validation (strict, no legacy leniency) + spot-audit/auditor-calibration ports
- `cba3178` feat(eval): judge calibration suite port
- `a09b091` fix(eval): corpus result is owner-relative Win/Loss/Unknown (ledger + calibration contract)
- `4d7446c` feat(eval): blind AB pool + paired stats port
- `0dfa847` feat(eval): deterministic prompt quality checks port
- `05536e9` feat(eval): corpus builder (gladlog parse chain, healer-owner prompts)
- `ec0439a` feat(eval): coverage manifest port
- `34315ae` feat(eval): eval-home resolver and private-repo init CLI
- `42c6ed1` feat(eval): package scaffold
- `6d2ce88` fix(review): final-review findings — AI stream race, key redaction, stream abort, pass2 id parity
- `1d586c4` fix(review): T2-6 review findings — params hardening, DR entries, API exports
- `d9a7024` fix(analysis): benchmark CLI parse-chain (correct GladLogParser API, glad-id keying, two-pass) + streaming aggregation; real-corpus benchmark_data (200 logs, 346 combats, 27 specs)
- `d6010e3` feat(analysis): local-corpus benchmark rebuild — stratified sampling, metrics core, CLI (haiku subagent)
- `d0e271d` feat(desktop): AI analysis panel wired to report page (unit/AI side tabs)
- `32df349` feat(desktop): main-process Anthropic streaming ai service (haiku subagent impl per degradation chain)
- `c54d051` feat(analysis): batch C + buildMatchContext port — full prompt pipeline green (459 tests)
- `e06f4d6` feat(analysis): core batch B port (dr/ccTrinket/dispel) + owned DR table; compat extra-spell fields
- `a7cbf6b` feat(analysis): core batch A port (cooldowns/enemyCDs/offensiveWindows) + catalog calibration via own tests
- `880fa92` feat(analysis): base utils port + owned classSpells/spellIdLists catalogs
- `ef34cf1` feat(analysis): data layer port — curated spell categories/effects, local SpellTag, talentIdMap placeholder
- `f47badd` feat(analysis): data layer port with curated spell-effect overrides
- `8f42be0` feat(analysis): package scaffold
- `7bf8c4d` fix(desktop): remount reports on doc switch (key); merge pet absorbs into owner; show build summary in unit panel
- `1fbd4b5` fix(desktop): bridge indirection — fixture override slot, contextBridge prop is read-only
- `7354548` feat(desktop): match/shuffle report assembly, fixture bridge, app shell restructure
- `70a3471` feat(desktop): SVG timeline (d3-scale) + unit detail panel
- `ffb3e46` feat(desktop): report header + meters components with jsdom test setup
- `f46c97e` feat(desktop): class colors/names + spec names incl. runtime-observed 1480 Devourer DH
- `3b14598` fix(desktop): death marks include players without combatant info
- `5c9271d` feat(desktop): cast and aura sequence derivation
- `f331308` feat(desktop): timeline derivation — hp series + death marks
- `9c47022` feat(desktop): unit summary derivation with pet merge
- `9c58353` feat(desktop): report derive types + roster derivation
- `8fc5268` feat(desktop): sanitized report fixture (self-collected 2v2) + generator script
- `9a0026e` fix(desktop): fatal parse errors crash worker for quarantine attribution; persist quarantine across reconfigure
- `68a68df` fix(desktop): process rename events in watcher — macOS reports new files as rename; tail reader tolerates races
- `a2a0f84` feat(desktop): log replay script for e2e acceptance
- `1eaa0ee` fix(desktop): build preload as CJS — sandboxed preload cannot load ESM, window.gladlog was never injected
- `4ccc4c7` feat(desktop): debug-grade live UI — status, match list, detail, diagnostics
- `dd858fd` fix(desktop): self-heal match dirs with corrupt meta (rm before rename); pin app name for stable userData
- `59b00da` feat(desktop): main-process assembly, typed IPC bridge, preload api
- `509f5a6` feat(desktop): match store — atomic meta/match/raw persistence with idempotent dedupe
- `cf6ea25` feat(desktop): worker host with crash attribution and per-file quarantine
- `5bc4330` fix(desktop): advance tail state only after batch fully fed to parser (no silent drops on push throw)
- `c724089` fix(desktop): guard tail reader against TOCTOU file deletion between stat and open
- `1452b34` feat(desktop): worker runtime — configure/scan/watch loop with checkpoint persistence
- `6daa66f` feat(desktop): file pipeline with safe-boundary checkpoints and rotation reset
- `15027d3` feat(desktop): byte-accurate tail reader with rotation/truncation detection
- `eb35f6d` feat(desktop): event-driven log watcher (ported own windows-agent watcher)
- `27dd8d7` feat(desktop): atomic checkpoint registry (ported own state.ts pattern)
- `3f8de42` feat(desktop): WoW dir detection + logs dir resolution (ported own detect.ts semantics)
- `72b2773` feat(desktop): worker protocol types + atomic SettingsStore
- `13d1e79` feat(desktop): electron-vite scaffold with main/preload/renderer/worker entries
- `2899449` feat(parser): read-only hasOpenSegment() for shell safe-boundary checkpoints
- `861b3c1` perf(parser): cache Intl.DateTimeFormat per timezone — 23k→105k lines/sec
- `449bfad` fix(compat): exclude CI-less player units (outsider filter, adjudication #27)
- `c7f0ebb` fix(compat): drop absorb interleave from damageIn; spellSchoolId hex string (adjudications #24/#25)
- `008c95f` fix(compat): spellId/extraSpellId as strings (adjudication #23)
- `3f014fe` fix: legacy CombatantInfo shapes — talents objects, string pvpTalents, structured equipment, aurasJSON (adjudication #22)
- `b978f5e` feat: raw params passthrough on events; legacy logLine.parameters with numeric coercion (adjudication #21)
- `9d6fe40` fix(compat): advancedActions entries carry advancedActorId + logLine (adjudication #20)
- `fd29dc8` fix(compat): teamId family as strings (legacy fidelity; downstream typeof check)
- `d836ce9` feat(parser): SPELL_SUMMON owner linkage for totems/guardians (adjudication #18)
- `a53b519` feat(compat): zero effectiveAmount for pet/guardian-targeted rows (adjudication #17)
- `b578f2e` feat(compat): merge pet/guardian dmg+heal into owner arrays (adjudication #16)
- `f6f9863` fix(parser): tolerate empty elements in COMBATANT_INFO nested arrays (Blizzard quirk)
- `a90b067` fix: absorb attacker-attribution + swing-form decode + legacy effective subtracts absorbed (adjudication #13)
- `b9f6f89` fix: preserve real event names in legacy shape; SWING_DAMAGE_LANDED dedup
- `e2b7012` fix: export type for type-only re-exports (tsx ESM runtime)
- `5adf9f3` fix(parser): type-only imports for ESM strictness (tsx runtime)
- `9514711` feat(compat): legacy damage sign convention + absorb interleaving (adjudication #6)
- `f5c7940` fix(parser): segment-anchored COMBATANT_INFO decoding (2024-vintage format from diff harness)
- `1828a0c` feat(compat): WoWCombatLogParser shim covering the 7 legacy call sites
- `0381920` feat(compat): legacy types + toLegacyMatch/toLegacyShuffle converters
- `0bfc6b2` feat(compat): package skeleton + legacy enums pinned to runtime manifest
- `5372410` feat(parser): GladLogParser emits GladMatch/GladShuffle; golden fixture assertions
- `276aad7` feat(parser): l3 outcome rules + match/shuffle composer
- `2624b14` feat(parser): l3 event-collection reducers (per-unit timelines, pet attribution)
- `422390c` feat(parser): l3 flags decoder + roster builder (owner via MINE bit)
- `c0cfd03` feat(parser): l3 data model + specToClass table
- `d6b7bc0` feat(parser): GladLogParser public shell (L1+L2 wiring, stats, diagnostics)
- `eda1550` feat(parser): l2 segmenter state machine (match/shuffle/diagnostics)
- `d7e9dcc` feat(parser): snr sweep script; timestamp variants from real-log sweep (UTC-offset suffix, variable fraction width)
- `cbda5ec` feat(parser): parseLine dispatcher + public L1 surface
- `b24fce2` feat(parser): combatant_info decoder
- `b3368f5` feat(parser): l1 event-family decoders
- `86bb502` feat(parser): l1 timestamp + top-level CSV tokenizer
