# LLM 评测方法:判官噪声、A/B、探针

正式流程见 `docs/commands/eval-ab.md` 与 skill `eval-ab` / `calibrate-judge`;CLAUDE.md Value-Gate 第 6 条与 `docs/rule-history.md` 有当前噪声底数字。

## 判官噪声与盲区

- **accuracy 维**:Sonnet 判官配对 SD 1.30(n=50),|Δ| < 0.4 测不出;Opus 5.5 SD 0.65 / MDE 0.18(2026-09-23)。查表锚点(accuracy = 5 − refuted 条数)消除了应用噪声,但「谁查到哪条错」的实质分歧不降,且同比例缩尺度,判别力净变化 ≈0(见 [metrics-and-discrimination.md](metrics-and-discrimination.md))。
- **sufficiency 维**:注入「删整场死亡行」检出率 20%——盲评在这一维**没有裁决权**,只能由确定性覆盖门裁。
- **判官召回字面错误很低**(470 句双盲):≈8–15%,都 ≤23%。裁判必须**两个判官 + 裁分歧**:宽松的判官单用会把其他判官都算成误报;严格的判官会把 "the whole time" 读成整场,时段句要人工复核。
- 跨模型家族迁移 rubric 两次 0/7,勿再迭代;同族偏差实锤(+0.84),跨族 A/B 要双族均值。换判官模型先过 `/calibrate-judge`,不过门就停下报用户,不许无穷调 rubric。
- **跨判官模型切换点的绝对分不可比**(Opus 判官更严:同一件 accuracy 2.8 vs Sonnet 4.3)。
- **推论**:prompt 内部一致性类修复别指望盲评验出来(hard-failure 185 → 0 时盲评七维全 inconclusive)。采纳依据写「凭确定性」。判官最有用的产出是指出 prompt 内部矛盾——refuted 主张三分:responder 错 / 判官误读 / prompt 真矛盾。
- 派判官车队时盲件 id 用无补零的两位数;brief 写「不许读 blind/ 下其他文件」(否则会偷看兄弟评分)。

## A/B 的固定做法与教训

- 报告**先写确定性表**(菜单行差分、audit kept / dropped、被驳断言数、同秒矛盾计数),再写判官分。
- 预注册(用户 2026-09-12):n=100 + 非劣性规则——ADOPT iff focusCalibration 与 accuracy 的 CI95 下界 ≥ −0.2、0 确定性回归、0 新行断言被驳。**欠功效的 run 不许写「无回归证据」**,写明 MDE 和预注册边际(n=11 只能测 |Δ| ≥0.77)。candidate 类型变化时按信号 × owner 角色分层报。
- 逐行参照句会「抬高」次要信号的权重——参照放图例,不放逐行。
- **最小对比门**(参照差 <3 pp 不指控)是所有带参照信号的标配。
- 给模型两个数字不给动词 = 邀请它编动词(治疗 181k → 222k 被说成「下降」)→ 生产者预写方向词。
- `SPELL_CAST_START` 的目标 GUID 恒为 0,读条目标在落地前不可知 → 两臂纳入条件必须对称、不依赖结果。
- 反向探针(逐场问模型「用没用这条事实」)三分:真消费 / 巧合重叠 / 顶撞赦免;探针会把 "none found" 写进数组,聚合时读内容,别只数非空。
- 批量 LLM 生成要内容级完整性检查(曾 16/1245 响应串场:头对、正文错)。

## prompt 逐行探针

- **最贵的坑:CLI 在仓库目录里跑会加载 CLAUDE.md + skills 当上下文**——同 prompt 同模型,cwd = 仓库 75 s 且答非所问,cwd = 空目录 25 s 正常。被测对象是 prompt,模型就不该看到 prompt 以外的任何东西。`cliDriver` 内置 mkdtemp;产品侧 `claude -p` 也有隔离参数 `CLAUDE_CLI_ISOLATION_ARGS`。
- 其他坑:无对照组 / 采样噪声 / 指标混极性 / 不熔断 / 中止丢数据(增量落盘 + 断点续跑)/ CLI 错误在 stdout 不在 stderr / 瞬时限流要指数退避而不是熔断。批量任务默认假设会被打断。
- **结论**:消融 4,986 样本三后端零显著、跨模型排序互不认账 → **行类型级 prompt 增删低于噪声底,是伪优化**;植入矛盾模型指出 0/100 → 模型无自查,`hardFailures` 是唯一防线。判据用确定性行为改变(结论集合 Jaccard vs 自比噪声底),不用判官分。
- 方法与八个坑:`docs/reports/2026-08-24-prompt-line-probe-method.md`。

## 没 API key 不是阻塞

用户 2026-09-22:「如果要去跟大模型跑测验的话,可以用本地 cli 去模拟啊」。`claude -p --output-format json` 的信封带 `usage.output_tokens`、thinking tokens、`stop_reason`,足够量 token 预算类数字(`packages/eval/scripts/outputTokenBudgetProbe.ts`)。对齐产品路径:`--effort high`、产品的隔离参数、system prompt 前置、中性 cwd。评测时产品模型名单里没有的名字会静默退回默认模型,要做来源校验(`modelUsage` 的 key 即实际模型 id)。

## 评测用哪个模型(用户偏好)

eval 批量子代理(responder / 盲评判官)、探针一律用 Opus(当前 5.5),与产品 coach 同模型。用户 2026-09-15:「以后不用 haiku;实在不行可以用 Sonnet 但不建议」——haiku 不出现在任何设计里;Sonnet 只在 Opus 不可用时兜底并注明。主会话自己的少量高判断力工作不受限。

相关:[prompt-honesty.md](prompt-honesty.md)、[verification.md](verification.md)
