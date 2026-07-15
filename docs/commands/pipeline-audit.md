# pipeline-audit — 全语料两层审计工作流

对 prompt 管线做**全语料**(每一场,不抽样)bug 猎捕:幻觉/假解析/本地化泄漏/token 浪费/几何失实。产出审计报告 + 修复清单 + 收官门数字。首次全量跑法与教训沉淀自 2026-07-13→15 审计(1245 场,见 eval 仓 `runs/2026-07-13-fullscale-audit/PIPELINE-AUDIT-REPORT.md`)。

> **与其他 eval 工作流的分工:**
>
> - `/eval-baseline` 抽样评质量现状,找下一个要修的——轻,常跑。
> - `/eval-ab` 受控验证单个构建器改动——修完东西后跑。
> - **本工作流** 全语料两层审计——大改动后、新赛季/新专精数据后、或周期性(季度)跑;贵,一次跑透。
>
> 判分之前先 `/calibrate-judge`(TOL=1)。

产物落 `$GLADLOG_EVAL_HOME/runs/<YYYY-MM-DD-slug>`。

## 两层结构

- **Layer A — 确定性 prompt-vs-log**(全语料)。原始日志太大喂不进 LLM,prompt→log 方向必须机器查:oracle(`coverageManifest.ts`,从原始 parser 事件独立构建,故意不走 prompt 构建器)+ 门规脚本。
- **Layer B — LLM 评审 response-vs-prompt** + 植入缺陷校准 + 跨 AI 家族互评。

## Layer A 步骤

```bash
# 1. 在 HEAD 构建全语料(铁律 3:任何门数字必须带测量时的 commit SHA)
npx tsx packages/eval/scripts/buildCorpus.ts --manifest "$GLADLOG_EVAL_HOME/corpus/manifest-fullscale.txt" --run <runId>
git rev-parse --short HEAD   # 记进报告/ledger

# 2. 三道门
node "$GLADLOG_EVAL_HOME/audit/layerAAudit.mjs" "$GLADLOG_EVAL_HOME/runs/<runId>"   # CJK/死亡diff/冗余/token/HP自洽/death-trace
BASE_DIR="$GLADLOG_EVAL_HOME/runs/<runId>" MANIFEST="$GLADLOG_EVAL_HOME/corpus/manifest-fullscale.txt" \
  npx tsx packages/eval/scripts/positioningScan.ts --mutate                          # 几何 grounding(--mutate 仅诊断,见铁律 6)
npx tsx packages/eval/scripts/qualityCheck.ts --run <runId>                          # 覆盖率硬门
```

绿 = CJK 0、death-trace 0、几何 0 violations、qualityCheck 0 hard failures。任何红先过铁律 2 再当 bug 报。

## Layer B 步骤

1. `/calibrate-judge`(植入 7 类缺陷,TOL=1;halo 防线 = eval-baseline.md Step 3 的维度独立性规则)。5/7+ 才继续。
2. 回复生成 + 判分:按 eval-baseline.md Step 2/3,**逐场生成**(铁律 4),resumable(输出文件存在即跳过)。
3. 跨 AI(配额允许时):`node audit/agyRun.mjs judge <run> "<model>" <outdir> <conc>`(eval 仓)——幂等、跳已有、配额 429 自动记数。配额梯子:Claude 主评 → Gemini/GPT-OSS 互评;各家配额池独立,滚动窗口(Gemini ~小时,GPT-OSS ~2.5h),收割循环 = 每窗口一轮 + sleep。互评是**校准样本不是逐场门**——~300 配对已够家族偏差统计稳定,不必追全语料。

## 铁律(每条都对应一次真实翻车)

1. **门规谓词即规范。** 分析侧与验证门算"同一个事实"时,分析必须**逐字消费门规的谓词**(共享常量/函数),并**锚定在渲染值上**(fmtTime 向下取整的秒,不是内部小数秒)。一次审计里 5 个 bug 是同一类:HP 半径、有界/无界采样、插值/raw/非同时刻 LoS、小数秒 vs 渲染秒。见根 CLAUDE.md 的规则条目。
2. **先怀疑 checker,再怀疑管线。** 新 checker 报大规模违规时:先手工核对 3 个例子确认 checker 的映射假设(本次审计两大假警报都是 checker 的错:spike 行盖在窗口 START 不是 END → 4075 假违规;过时的 `Deaths:` 行格式 → 1538 假掉失),再做变异测试(植入已知缺陷证明能检出)才可信零。
3. **任何数字必须带 commit。** 陈旧产物两次骗走数小时:老 baseline manifest 的"3 个假死"其实早已修;"最终"跑批两次落后分支头。报告/ledger 里的每个门数字旁写测量 SHA。
4. **批量 LLM 产物要做内容级完整性检查。** 16/1245 回复 MATCHID 头正确但正文串场——头部校验查不出,必须抽事实 vs prompt 比对;回复再生成后用 mtime 使旧分数失效。
5. **驱动器必须幂等可续。** 以输出文件存在为跳过键;中断(周配额/限流)后重跑同命令即续。
6. **positioningScan 语料级变异率仅诊断**(真实移动噪声下 ~60% 正常);100% 敏感度硬门在合成夹具单测(`packages/eval/test/positioningScan.test.ts`)。

## 收官

- 报告(run 目录 `PIPELINE-AUDIT-REPORT.md`):TL;DR、Layer A 发现、校准、判分、跨 AI、修复清单(带 SHA)、**收官门表格(修复前→后 @ SHA)**、open items。
- `ledger.md` 追加行(append-only);auto-memory 更新;修复走 PR。
- 修完必须在**分支头重建全语料**复跑三道门才可声称收官(铁律 3)。
