/** resRowFactScan.ts — `[RES]` 里「台账没变化」的那些行到底独占了什么事实(GH #99 item 5)。
 *
 * 为什么存在:`[RES] rdy:Δ  cd:—` 行占全部 `[RES]` 行的 32.9%、占 prompt 字符
 * 1.89%,而 2026-09-20 的消融探针(25 局 ×4 次调用)测出删掉整类后结论集合
 * Jaccard 0.800 vs 噪声底 0.802±0.164(z = −0.1)—— **聚合口径上看不出模型在用
 * 它**。但聚合口径按定义看不见 corner case,而这些行「没变化」只对 `rdy:/cd:`
 * 成立:96.4% 仍带 `focus:`、36.6% 带实时 `cc:`、47.9% 带 `enemy:`。
 *
 * 本扫描把「corner case」变成可枚举的确定性问题:**把这些行删掉之后,哪些事实
 * 在整份 prompt 里再也拿不到**——
 *   · focus:某个集火目标的整段存在期只出现在被删的行上(下一条存活的 `[RES]`
 *     已经换了目标)→ 这次集火切换彻底消失;
 *   · cc:被删行上的控制,**没有任何一条同名 `[CC ON …]` 行的落地时刻 + 时长能覆盖
 *     到这一秒**(行本身写了时长,所以能覆盖 = 读者自己能推出来,不算丢);
 *   · enemy:被删行上的敌方 CD,整份 prompt 里**从没有**同名 `[ENEMY CD]` 行
 *     (有的话剩余秒数可由「施放时刻 + 冷却」推出,只是要算一步)。
 *
 * 判据只认「存活文本里能不能重建这条事实」,不猜模型读不读 —— 读不读归消融探针管。
 *
 * 2026-09-22(用户裁决,选项 1):判据搬进了 `packages/analysis/src/context/resLedgerPrune.ts`,
 * 渲染器(`buildMatchTimeline` → `pruneZeroLossResRows`)与门规 `checkResNoChangeRowsPruned`
 * 都 import 同一个 `classifyNoChangeResRows`;本脚本改为消费它,只负责统计与举例。
 * 对照基线(82 份本地重建,改前):[RES] 3,033 / 无变化 954 / 零损失可删 717 / focus 独占 146 /
 * cc 独占 103 / enemy 独占 0;改后:2,316 / 237 / 0 / 146 / 103 / 0。(本脚本 09-16 版用 `\S+`
 * 截字段,多词技能名被截断,当时报 773 / 45;共享模块按双空格分隔符解析后才是上面的数。)
 *
 * 用法:npx tsx packages/eval/scripts/resRowFactScan.ts <prompts 目录> [--examples N]
 *   例:npx tsx packages/eval/scripts/resRowFactScan.ts \
 *         $GLADLOG_EVAL_HOME/runs/gh99c-treat/prompts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  classifyNoChangeResRows,
  isNoChangeResLine,
  isResRow,
} from "@gladlog/analysis";

const dir = process.argv[2];
if (!dir) {
  console.error("用法: resRowFactScan.ts <prompts 目录> [--examples N]");
  process.exit(1);
}
const exIdx = process.argv.indexOf("--examples");
const MAX_EXAMPLES = exIdx > 0 ? Number(process.argv[exIdx + 1]) : 8;

let files = 0;
let resRows = 0;
let noChange = 0;
let lostFocusEpisodes = 0;
let ccLost = 0;
let cdLost = 0;
/** 删掉也不丢任何事实的行 —— 渲染器现在就删这些;改后语料里应为 0。 */
let safeToDrop = 0;
const promptsWithLoss = new Set<string>();
const examples: string[] = [];

for (const f of readdirSync(dir).filter((n) => n.endsWith(".txt"))) {
  files++;
  const lines = readFileSync(join(dir, f), "utf8").split("\n");
  resRows += lines.filter(isResRow).length;
  noChange += lines.filter(isNoChangeResLine).length;
  for (const v of classifyNoChangeResRows(lines)) {
    if (v.uniqueFacts.length === 0) {
      safeToDrop++;
      continue;
    }
    promptsWithLoss.add(f);
    if (v.uniqueFacts.includes("focus")) lostFocusEpisodes++;
    if (v.uniqueFacts.includes("cc")) ccLost++;
    if (v.uniqueFacts.includes("enemy")) cdLost++;
    if (examples.length < MAX_EXAMPLES)
      examples.push(
        `${f} unique=${v.uniqueFacts.join("+")} :: ${lines[v.index]!.trim().slice(0, 120)}`,
      );
  }
}

const pct = (a: number, b: number) =>
  b === 0 ? "—" : `${((a / b) * 100).toFixed(1)}%`;
console.log(
  `prompts=${files}  [RES] rows=${resRows}  no-change=${noChange} (${pct(noChange, resRows)})`,
);
console.log(
  `focus: 只存在于无变化行的集火段  ${lostFocusEpisodes}  (${pct(lostFocusEpisodes, noChange)} of no-change rows)`,
);
console.log(
  `cc:    无变化行上无任何同名 [CC ON …] 落地行覆盖到这一秒的控制  ${ccLost} rows`,
);
console.log(
  `enemy: 无变化行上整份 prompt 无同名 [ENEMY CD] 行的敌方 CD  ${cdLost} rows`,
);
console.log(
  `prompts with >=1 unique fact on a no-change row: ${promptsWithLoss.size}/${files} (${pct(promptsWithLoss.size, files)})`,
);
console.log(
  `零信息损失可删的行: ${safeToDrop}/${noChange} (${pct(safeToDrop, noChange)} of no-change rows, ${pct(safeToDrop, resRows)} of all [RES] rows)`,
);
for (const e of examples) console.log(`  ex: ${e}`);
