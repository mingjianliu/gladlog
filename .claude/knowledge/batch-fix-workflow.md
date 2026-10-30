# 修复流程:小批修、集中回归、参照表攒着重跑

## 小批修 + 集中回归(用户 2026-09-26)

用户:「不是一个一个修 bug,而是一小批一小批修,然后集中跑测试和回归,最后一起做一个大的 eval 看看所有的效果」。

- 3–5 项按区域合一批;整批改完 → typecheck + 单测 → **一次**真实对局前后采集(`acceptanceCapture.ts`),按行特征把 delta 归到各项 → **一次**审查整批 diff + 数字 → 一次提交推送。只有设计拿不准的项开工前单独讨论。
- 采集产物放持久目录,**别放会话 scratchpad**——会话重启清空过一次,基线和审查记录全丢。长期状态写进文件,不要只在会话里。
- 每局按每个 owner 各出一份 findings,候选计数是 per-owner 行数(≈3× 独立窗口),报数时说清。

## 采集与对照的坑

- 基线要从**干净且没人在动的树**采:采前采后各 `git status -- packages/*/src`,记 HEAD。
- **在落地基上整批量**:旧基 + 新改动与落地基行为可能不同;单文件复跑看不出跨对局泄漏(别名触发原地改写共享表,只有整批暴露)。增删类批次先看整批表再定稿;门规数字逐提交用该提交自己的门规量。
- 采集跑时别改源码;上游移动时在新上游重采基线。
- 审后改过代码的批次必须重采。新增账本行时从源头做「默认不给、显式要」,别逐个读者补过滤。
- 手工覆盖表 `{...GENERATED, ...OVERRIDES}` 是**按 id 整行替换**,漏字段会删掉 DB2 值;要保留就 `{ ...SPELL_EFFECTS_GENERATED[id]!, durationSeconds: N }`(`spellEffectOverrides.shadow.test.ts` 守着)。
- 修一个类别要列全它的所有情形——修过的类别会换个情形回来。
- 测试别钉死样本里唯一的一条候选(分析逻辑一改就红),用 `vi.mock` 往真实输入里补。
- 语料扫描别把解析过的比赛全缓存在内存(OOM 过),只留当前文件。

## PROMPT_VERSION 撞号

并行会话抢 PV 号:冲突时取上游两份 PV 文件,把自己的条目改号追加,改提交信息里的 PVxxx,重跑 presubmit。rebase 时父提交重编号后,下一个提交的版本说明可能无冲突套上,留下两条同号而常量不涨 → 逐提交核对。PV 历史在 `docs/prompt-version-history.md`。

## 参照表攒着统一重跑(用户 2026-09-26)

用户:「全量表先不做了,我之后还会做大量改动,干脆之后所有的全量一起跑」;「以后改动如果让某张全量表过期,在提交信息里写清楚是哪张表、为什么,再加到 GH #115 的待跑清单里。前后对比继续用小样本。」

- **Why**:每张全量重跑 1–7 小时 CPU,下次改动又会过期;多会话为重跑互相排队。
- 改动动了某张表的输入(burst-window、behaviorPrior、sync-window、cdTriggerPrior、kick-priority、healerSaveCd、backlashDispel、cdRecastFloor、CD_HOARDED_OUTCOME_REF……)→ 提交信息写明哪张、为什么,并在 GH #115 加 "Stale since <sha> …"。列过期表要**按符号 grep 全部读者**。
- **重生成必须用被替换表的同一语料**:先看那张表上次提交的 manifest / 文件数。一次用错语料,把窗口数下降误归因给了无关改动并推了上去——实际主要是语料大小。
- 跑的时候按 runbook `docs/commands/update-wow-data.md` 6b-pre;分片循环遇死分片必须失败(ENOSPC 事故);入库前查分片日志有无 ENOSPC、`done: scanned=` 是否等于 limit;重跑期间 main 改了它读的谓词 → 在新 main 上抽样重扫逐条比对,有差再全量。
- 语料驱动的先验表按赛季与谓词变化重跑,不随 build。

## 大重构:逐字节等价

GH #116 把 `buildMatchTimeline` 拆成 `packages/analysis/src/context/timelineSections/`(4,125 → 995 行)。每批在其确切上游父提交上与新鲜基线比采集逐字节相同。用户定**不再继续切**:剩余想法记在 #116 上,不要主动做。

## 收尾报告

大轮修复结束时用户要**详细、可核对的报告**,不是信任修复会话自述的摘要(用户 2026-10-03:「做完了我要详细的报告,不能得过且过全交给 AI 了,不然技术债越来越多」)。每个主题 / 分组写:落了什么(commit、PV)、同判据前后数字、推迟或否决了什么及原因、每条「Not yet unified」/ 登记未修项、采纳的裁决、已知缺陷、审查来源,以及审后未复审的改动。技术债明说,别抹平。

相关:[verification.md](verification.md)、[review-tiering.md](review-tiering.md)、[shell-and-git-traps.md](shell-and-git-traps.md)
