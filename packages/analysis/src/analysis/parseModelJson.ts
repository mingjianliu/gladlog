/**
 * 模型 JSON 输出的解析(**单源**)。
 *
 * 事实:即使 prompt 写死「Output ONLY a JSON array」,模型仍常把内容包进
 * markdown 围栏,或在前后加一两句散文 —— 尤其在 system prompt 同时要求
 * 「用中文回复」时。2026-07-20 用 `claude -p` 对真实对局实测复现:返回是
 * ```json … ``` 包裹的**完全合规**内容,却被 main 侧的 JSON.parse(raw.trim())
 * 判成 bad-json,整份好分析退成确定性展示。
 *
 * eval 的三个审计脚本早就各自写了围栏容错,产品侧却没有 —— 同一个事实两处
 * 认知不一致,正是 CLAUDE.md 说的那类腐烂。所以谓词放这里,两边都 import。
 *
 * **容错边界**(下面 parseModelJsonArray 的负向契约,别放宽):
 *   - 截断的 JSON 救不回来 → null(吐半份比回退更糟)
 *   - 顶层是对象 → null(契约就是数组,这是真违约不是格式噪音)
 */

/** ```json … ``` / ``` … ```(允许前后有散文)。 */
const FENCE = /```(?:json|JSON)?\s*\n([\s\S]*?)\n?```/;

/**
 * 从模型原始输出里取出候选 JSON 文本,按可信度从高到低。
 * 只做**定位**不做修补 —— 修补等于替模型编内容。
 */
function candidates(raw: string): string[] {
  const t = raw.trim();
  if (!t) return [];

  // 先剥围栏 —— 后续判断一律针对**载荷**而非原始文本。
  // (自查踩到过:守卫写在原始文本上时,```json {"findings":[…]} ``` 会因为
  //  原文以 ` 开头而放行切片,把内层数组切出来「救活」,悄悄改掉契约。)
  const fenced = FENCE.exec(t)?.[1]?.trim();
  const payload = fenced || t;

  const out = [t];
  if (fenced) out.push(fenced);

  // 载荷不以 { 或 [ 开头时(纯散文包着裸数组),切最外层方括号:
  //   以 [ 开头却解析失败 = 截断/语法错,切了只会掩盖成半份;
  //   以 { 开头 = 模型给了对象,那是违约,不该被切成里面某个数组救活。
  if (!payload.startsWith("{") && !payload.startsWith("[")) {
    const a = payload.indexOf("[");
    const b = payload.lastIndexOf("]");
    if (a !== -1 && b > a) out.push(payload.slice(a, b + 1));
  }
  return out;
}

/**
 * 解析模型返回的 JSON **数组**。成功返回数组,任何失败返回 null。
 * 调用方按 null 走各自的回退,别再自己 try/catch JSON.parse。
 */
export function parseModelJsonArray(raw: string): unknown[] | null {
  for (const c of candidates(raw)) {
    try {
      const parsed: unknown = JSON.parse(c);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* 试下一个候选 */
    }
  }
  return null;
}
