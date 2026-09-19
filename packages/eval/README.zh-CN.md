# @gladlog/eval

[English](README.md) · **中文**

gladlog 的评测、门禁校验与基准测试引擎：负责验证 prompt 保真度、校准 LLM 裁判、执行确定性质量门禁，并在对局语料库上开展具备统计学显著性的 A/B 评测。该包仅在离线维护与 CI 工作流中使用 —— 绝不打包进桌面端应用。

## 核心架构

```
原始战斗日志 / 语料库
           │
           ▼
[ 真实基准覆盖清单 (src/quality/coverageManifest.ts) ]
  从原始解析事件中提取全部死亡、CC、打断、驱散与饰品事件
           │
           ├───────────────────────────────┐
           ▼                               ▼
[ 确定性质量门禁 ]                  [ A/B 评测与基准比对 ]
  promptQualityCheck.ts               blindAbPool.ts / abCompareStats.ts
  20+ 类 hardFailure 硬失败检查       非参数符号检验与 Bootstrap 置信区间
  充分性、噪声与标签偏差                           │
           │                                       ▼
           └───────────────┬───────────────────────┘
                           ▼
            [ LLM 裁判校准 (src/judge/) ]
              checkCalibration.ts / buildCalibrationSuite.ts
              将主观维度锚定于实测客观事实
```

## 关键子系统

### 1. 确定性质量门禁 (`src/quality/`)

- **`promptQualityCheck.ts`**：在可机械检查的维度上替代主观 LLM 裁判。
  - **充分性（覆盖率）**：重新解析原始战斗日志构建真实覆盖清单，硬性断言关键事件（队友死亡、高价值控制、打断、驱散、章）必须出现在生成的 prompt 文本中。
  - **噪声与偏差检测**：度量精确与模板重复行比例、资源提示刷屏及严重性贬损词命中。
  - **硬失败不变量（Hard Failures）**：强制执行 20 多项不变量校验（`checkPercentileMonotonicity` 分位数单调性、`checkSameSecondHpConsistency` 同秒血量自洽、`checkWindowSpanConsistency` 窗口时长一致性、`checkCooldownLedgerConsistency` CD 时间轴一致性、`checkMenuTRenderGrid` 时间事实网格对齐、`checkFactsBlockIntegrity` 事实块反序列化自洽、`checkCjkLeak` 英文 prompt 漏 CJK 字符等）。

### 2. A/B 评测与统计严密性 (`src/ab/`)

- **`blindAbPool.ts`**：生成完全双盲、随机打乱的成对评测池，在相同随机种子下比对 baseline 与 treatment 两组 prompt 构建器。
- **`abCompareStats.ts`**：
  - 计算非参数双尾符号检验（`signTestP`）。
  - 计算各评测维度的 Bootstrap 置信区间（`bootstrapCI`）。
  - 杜绝因单次随机扰动或虚假微小提升误判为改进。

### 3. LLM 裁判校准与防偏见机制 (`src/judge/`, `src/halo/`)

- **`checkCalibration.ts` 与 `buildCalibrationSuite.ts`**：通过锚定真值的固定用例校准评测裁判模型。
- **`outcomeHalo.ts`**：度量并检测胜负光环效应（胜负结果是否在无关表现的情况下系统性影响裁判打分）。
- **`sycophancy.test.ts` 与 `familyBias.test.ts`**：审计裁判对模型的阿谀倾向与专精构筑偏见。

### 4. 语料库分层管理 (`src/corpus/`)

- **`buildCorpus.ts`**：按专精、赛制（2v2、3v3、单排）与敌方阵容构筑进行确定性分层抽样，构建均衡的评测语料，消除样本选择偏差。

### 5. 可执行防腐谓词索引单测 (`test/predicateIndex.test.ts`)

- 超过 2,100 行可执行断言，将 `docs/predicate-index.md`、`docs/predicate-index.zh-CN.md` 与实际代码导出进行三向硬绑定。
- 防止文档随代码迭代腐化，并严格守护“一个事实、一个谓词”原则，确保分析端与门禁验证端共享同一套判定逻辑。

## 工作流与常用命令

所有评测产出均写入 `$GLADLOG_EVAL_HOME`（默认指向 `~/code/gladlog-eval-private`）。

```bash
# 运行单元测试与确定性门禁
npm test --workspace=packages/eval

# 执行确定性 prompt 质量检查
npm run quality --workspace=packages/eval

# 扫描候选菜单渲染网格对齐
npm run scan:menu-t --workspace=packages/eval

# 扫描跨版本策展数据腐烂情况
npm run scan:rot --workspace=packages/eval
```

进阶评测工作流详见对应命令文档：
- [A/B Prompt 评测](../../docs/commands/eval-ab.md)
- [Baseline 基准评测](../../docs/commands/eval-baseline.md)
- [裁判校准](../../docs/commands/calibrate-judge.md)
- [全量流水线审计](../../docs/commands/pipeline-audit.md)
