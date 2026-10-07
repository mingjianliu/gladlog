# prompt 诚实性:确定性门 > 调措辞

- **确定性门 > 调 prompt 措辞**:模型没有自查能力,`hardFailures`(`packages/eval/src/quality/promptQualityCheck.ts`)是唯一防线。
- **范例串自带数字会被逐字引用**:compare 解说 27/36 被 claimChecker 枪毙,根因是 prompt 范例带时间戳 + 百分比,与「绝不写裸数字」自相矛盾。修法:贴范例前用 claimChecker 同款正则洗数字 + verdict 值直接给模型 + 带违规清单重试一次 → 1/36。
- **占位符 / 纪律类改动必须真模型 smoke**:合成 pack 单测永远绿,真模型栽在 prompt-model 交互上(清单里独立 token 诱导写不存在的 `{{pN.units}}`;偏移量编进 key 名 `hpT15` 诱导裸数字;服务器名含数字)。landing 前 ≥6 个真语料锚点,看审计通过率;prompt 只印可占位的 facts,名字用短名,结构化数值拆成独立字段。
- **模型 JSON 输出容错单源 `parseModelJsonArray`**(`@gladlog/analysis`):`claude -p` 常把合规内容包进 ```` ```json ```` 围栏,零容错曾误杀整份分析。负向契约别放宽(截断 JSON / 顶层对象仍回退)。单测没抓到是因为夹具全是测试自己 stringify 的完美形态。
- **causalLint**(`packages/analysis/src/analysis/causalLint.ts`,中英单源;命中即整条丢弃,改模式要极其克制):每个模式要有专属 positive fixture;已知缺口是中文「不是 / 并非」否定和 hedge(「大概率」)。eval 自由文本与 coach chat **不走** causalLint(用户 2026-09-16:coach chat 让它自由发挥)。
- **responder 自查纪律**(逐条对照 prompt 行核实、不把含糊注释说硬、从时间轴重数)是全量审计找到的最大单一质量杠杆;产品侧 `buildFindingsPrompt` 已在结构上强制(事件 id 菜单、只许占位符数字、因果禁令),别削弱。
- facts 值里的 `", "` 会被文本侧解析器截断(门规 `checkFactsBlockIntegrity`)。
- 文本扫描门 / 探针解析渲染行时按渲染器的分隔符切字段(`[RES]` 是双空格),别用 `\S+`——多词技能名会被截断,一个扫描因此保护了 0 行。
- `[DMG SPIKE]` 要看窗口内低谷,不只首尾(`gridHpMinInWindow`)。
- 整数门正则会静默跳过带小数的标签。
- NaN 永不渲染,任何文本门都看不见;JSON 存储把 NaN 变 null、compat 读成 0。
- 渲染层的 friends 池必须按阵营过滤(曾把敌人记成「该救你的队友」)。
- 职业认错是模型侧错误 → 确定性 roster lint 兜底(见 [coaching-rulings.md](coaching-rulings.md))。

相关:[llm-eval-method.md](llm-eval-method.md)、[predicates-and-gates.md](predicates-and-gates.md)
