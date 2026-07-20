/** 视觉回归的固定基准时刻(2026-07-19T12:00:00Z)。
 *
 *  谓词单源:场景 fixture(浏览器侧)与 Playwright 的 clock.setFixedTime
 *  (Node 侧)必须钉在同一时刻,否则「今天/昨天」分组与仪表盘周期会随真实
 *  时间漂移 → 截图 flaky。
 *
 *  **本文件必须保持零 import**:Playwright 的测试进程是 Node ESM,顺着
 *  import 链吃到 JSON 导入(fixtureBridge → report-match.json)会直接报
 *  `needs an import attribute of "type: json"`。叶子模块才能两边共用。 */
export const FIXED_NOW = Date.UTC(2026, 6, 19, 12, 0, 0);
