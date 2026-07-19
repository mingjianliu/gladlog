/**
 * 位置采样谓词(单源)—— 分析侧与 eval 门规侧共用的常量。
 *
 * 为什么单独一个模块:CLAUDE.md 的门规谓词即规范要求「同一个事实用同一个谓词:
 * 同一常量、同一采样函数、同一容差」,且「谓词放一处 export,两边 import;
 * 做不到时写断言相等的单测,别靠注释」。
 *
 * 这些常量此前散在四处私有声明,靠 healerExposureAnalysis.ts 里一句
 * 「MUST stay equal to … positioningScan.ts」的注释耦合 —— 正是该规则明令
 * 禁止的形态。2026-07 全量审计里 5 个独立 bug 全是这一类(HP 采样半径不一致、
 * 有界 vs 无界回溯、插值 vs raw 采样、小数秒 vs 渲染秒网格),所以这里改成
 * 真正的单源 export。
 *
 * 注意两个常量语义不同,不要因为都叫「gap」就混用:
 *  - LOS_SWEEP_GAP_MS  = LoS 扫描判定用,分析与门规必须逐字节相同,否则门规
 *                        复算不出分析的结论(或反过来放行了幻觉主张)。
 *  - INTERP_MAX_GAP_MS = 单点位置插值的 grounding 守卫,比前者严得多 ——
 *                        采样间隔超过它就认为插值是编的(单位 idle/潜行)。
 *    它**不该**等于 LOS_SWEEP_GAP_MS,历史上因为两者都曾叫
 *    POSITION_MAX_GAP_MS(值 1500 vs 3000)而极易看串。
 */

/** LoS 扫描的时间松弛(秒):锚点 ±N 秒按整秒网格扫描。分析与门规必须相同。 */
export const LOS_SWEEP_SLACK_S = 2;

/** LoS 扫描的位置插值最大采样间隔(毫秒)。分析与门规必须相同。 */
export const LOS_SWEEP_GAP_MS = 3_000;

/**
 * 单点位置插值的 grounding 守卫(毫秒)。超过此间隔的插值位置视为伪造 ——
 * 陈旧位置会声称存在 LoS,而真实采样显示早已断开,进而产出「去断视线」的
 * 假建议(2026-07-14 全量审计 G5)。
 */
export const INTERP_MAX_GAP_MS = 1_500;
