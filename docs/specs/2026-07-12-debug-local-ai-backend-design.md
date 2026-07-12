# 调试用本地 AI 后端(claude / agy CLI)设计

日期:2026-07-12
状态:待用户审阅

## 背景与目标

打包后的 App 无 Anthropic API key 时,SP-A findings 与 SP-B2 cohort 叙述都退化为确定性兜底(截图:`0 findings` / `Reason: NO_API_KEY`,cohort 只显示实测数字)。用户希望**调试模式**:把这两处的 LLM 调用路由到**本地 CLI**(`claude` 打印模式 或 `agy` Gemini),无需配置/付费 API key 即可看到真实 AI 输出。dev/调试用,仅在装了 claude/agy 的机器可用;非终端用户功能。

用户确认:支持**两者可选**;**设置下拉持久化**。

## 现有接缝

两个服务都通过 `clientFactory` 拿一个 `AnthropicLike`:

```ts
interface AnthropicLike {
  stream(params: {
    model;
    max_tokens;
    messages;
  }): AsyncIterable<{ delta?: string }>;
}
```

`realClientFactory(key)` 是 Anthropic 实现。服务的门是 `if (!settings.anthropicApiKey) return fallback()`。本地后端只需再实现一个 `AnthropicLike`,并改门:本地后端无需 key。下游诚实门(`auditFindings`/`claimChecker`)不变,本地后端产出走同样校验。

## 组件一:本地后端(`packages/desktop/src/main/localAiBackends.ts`)

两个工厂,各返回 `AnthropicLike`:

- `claudeCliClientFactory(cmd: string)` — 用 `execFile`(**非 shell**)spawn `cmd -p --output-format text`,prompt 经 **stdin** 写入(避免 arg 长度上限);stdout 数据块逐段 `yield { delta }`。stdout 已是干净补全。
- `agyClientFactory(scriptPath: string)` — spawn `node <scriptPath> ask <prompt>`;`<prompt>` 作为 **args 数组元素**(非 shell 插值 → 无注入);stdout 逐段 yield,**丢弃开头 `[agy-run] …` 头行**(首个换行前的 `[agy-run]` 行)。

**PATH 解析(打包 GUI 关键)**:macOS GUI 进程不继承登录 shell PATH。启动时用登录 shell 解析一次可执行路径:`$SHELL -lc 'command -v claude'`(agy 路径固定 `~/.claude/skills/agy/scripts/agy-run.mjs`,node 同理解析);解析结果缓存。设置里的 `aiBackendCommand` 覆盖(用户填绝对路径时直接用,跳过解析)。**注入防护**:一律 `execFile`/`spawn` + args 数组,绝不 `shell: true` 拼接含对局数据的 prompt。

**流式**:stdout `data` 事件即 yield 一个 delta(渐进显示);进程正常退出(code 0)→ 迭代结束;非零退出 / spawn 错误 / 超时(120s)→ 抛错。

## 组件二:设置(`settingsStore.ts`)

`GladlogSettings` 加:

- `aiBackend: "anthropic" | "claudeCli" | "agy"`(默认 `"anthropic"`)
- `aiBackendCommand: string | null`(默认 null;覆盖 claude 可执行 / agy 脚本路径)

`sanitizeSettingsPatch` 白名单加这两个键;`aiBackend` 校验枚举,非法值回落 `"anthropic"`。`aiBackendCommand` 是路径不是密钥,不脱敏。

## 组件三:服务接线(`analysis.ts` + `compare.ts`)

抽一个共享 `resolveAiClient(settings, deps): AnthropicLike | null`(放 `ai.ts`):

- `aiBackend === "anthropic"`:有 key → `realClientFactory(key)`;无 key → `null`(兜底,现状)。
- `aiBackend === "claudeCli"`:`claudeCliClientFactory(resolvedClaudeCmd)`(无需 key)。
- `aiBackend === "agy"`:`agyClientFactory(resolvedAgyPath)`(无需 key)。

服务把现有 `if (!anthropicApiKey) fallback` 换成 `const client = resolveAiClient(settings, deps); if (!client) return fallback();`。测试注入的 `deps.clientFactory` 优先(保持现有测试)。

## 组件四:设置 UI(`DevPanel.tsx`,开发者视图)

在开发者视图加一个「AI 后端」下拉:`Anthropic API` / `Claude CLI` / `agy (Gemini)`,值 = `aiBackend`;`onChange` → `bridge().settings.save({ aiBackend })`,挂载时 `settings.get()` 回填当前值。可选文本框填 `aiBackendCommand`(留空=自动解析)。调试功能放开发者视图,不污染主界面。

## 数据流

面板点「重新分析/重新对比」→ 服务 `run()` → `resolveAiClient` 按 `aiBackend` 选客户端 → 本地后端 spawn CLI、prompt 入 stdin、stdout 流式 delta → 服务聚合 → 诚实门校验 → findings/叙述 或 dropped。

## 错误处理

- CLI 未找到 / 非零退出 / 超时 → 服务发 `error`(面板显示「后端失败:<msg>」),**不静默回落确定性**(让用户知道调试后端跑没跑)。
- 本地模型输出不合格式(JSON findings / `{{占位符}}` 模板)→ 诚实门照常丢弃 → 面板显示 dropped 数(信息性:模型没按格式来,而非静默空)。
- stdout 解析:JSON.parse 失败(analysis)→ 现有 invalid-JSON 回落路径。

## 测试策略(vitest)

- `claudeCliClientFactory` / `agyClientFactory`:注入 fake spawn(stub child,受控 stdout/exit)→ 断言 stdout → deltas、agy 头行剥离、prompt 经 stdin 写入、非零退出 reject、超时 reject。
- `resolveAiClient`:三后端选择 + anthropic 无 key → null。
- 服务:`aiBackend="claudeCli"` 无 key 也走 client(不兜底)——用 stub client 验证。
- 现有 desktop 套件不回归(注入 clientFactory 优先级保留)。

## 范围外

- 终端用户可用性(仅装了 claude/agy 的开发机)。
- 真流式 token(CLI 缓冲即整块 yield 亦可接受)。
- 后端的模型选择细化(claude 用 Claude Code 配置的模型;agy 用其默认 Gemini)。
- 打包分发 claude/agy(不捆绑)。

## 未决事项

无(后端集合 + 开关 UX 已确认)。
