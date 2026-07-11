# App 功能 backlog

> 桌面 App 侧的功能需求(区别于 prompt 质量类改动,不走 /eval-ab;UI/交互改动直接实现 + 常规测试)。

## 1. AI 分析语言切换(中文 / English)⬜(用户提出 2026-07-11)

**需求**:在 AI 分析生成处(AIAnalysisPanel 的"分析"按钮旁)加一个语言切换按钮,可选中文或英文,控制教练回复的输出语言。

**实现要点(盘点自现状)**:

- **UI**:`packages/desktop/src/renderer/src/report/components/AIAnalysisPanel.tsx` — 生成按钮旁加 中文/EN 二态切换;选择持久化。
- **设置**:`packages/desktop/src/main/settingsStore.ts` 加 `aiLanguage: "zh" | "en"`(默认 `"zh"`,与现有 UI 中文一致);IPC 走既有 settings 通道。
- **请求**:`packages/desktop/src/main/ai.ts` 的 stream 调用**目前没有 system prompt**(messages 只有 user)——加 `system` 字段:教练角色设定 + 输出语言指令("Respond entirely in Simplified Chinese" / "Respond in English")。这同时是把 responder 角色提示词固化进产线的机会(eval responder 模板可对齐)。
- **缓存**:每场缓存是单文件 `<matchesDir>/<matchId>/analysis.json`,doc 里需加 `language` 字段;`getCached` 匹配当前语言不符时视为未命中(或文件名分键 `analysis.<lang>.json`,可同时保留两种语言的结果——推荐后者)。
- **注意**:语言属请求参数而非 prompt 构建器改动,`PROMPT_VERSION` 不需要 bump;时间轴 prompt 本体保持英文结构(spell 名中英混排问题单列,见 #2)。

## 2. 时间轴 spell 名统一(机会项,随 #1 顺带评估)⬜

中文客户端日志的时间轴里技能名中英混排(妖术/分筋错骨 vs Hammer of Justice)。`getEnglishSpellName` 已能把大部分名字转英文;可评估:prompt 全英文化(对模型更稳)+ 回复语言由 #1 控制。属 prompt 构建器改动,若做需走 /eval-ab(目标维度 accuracy)。
