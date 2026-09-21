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
 * 用法:npx tsx packages/eval/scripts/resRowFactScan.ts <prompts 目录> [--examples N]
 *   例:npx tsx packages/eval/scripts/resRowFactScan.ts \
 *         $GLADLOG_EVAL_HOME/runs/gh99c-treat/prompts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("用法: resRowFactScan.ts <prompts 目录> [--examples N]");
  process.exit(1);
}
const exIdx = process.argv.indexOf("--examples");
const MAX_EXAMPLES = exIdx > 0 ? Number(process.argv[exIdx + 1]) : 8;

/** 落地行的时长解析不出来时按这个兜底,并给覆盖判定留一点渲染取整的余量。 */
const CC_FALLBACK_S = 3;
const CC_SLACK_S = 1;

const RES_ROW = /\[RES\]\s+rdy:/;
const NO_CHANGE = /\[RES\]\s+rdy:Δ\s+cd:—/;
const TIME_AT_START = /^\s*(\d{1,2}):([0-5]\d)/;
const FOCUS = /\bfocus:(\S+)/;
const CC_FIELD = /\bcc:(\S+)/;
const ENEMY_FIELD = /\benemy:(\S+)/;
/** `3/Wind Shear-1s[kick]` → 法术名。 */
const CC_ENTRY = /^\d+\/(.+?)-\d/;
/** `Trueshot/Marksmanship Hunter(6s left)` → 法术名。 */
const CD_ENTRY = /^(.+?)\//;
/** `… ← Polymorph (by 6(RShaman)) | 6s [DR: …]` → 时长秒数。 */
const CC_LINE_DUR = /\|\s*(\d+(?:\.\d+)?)s\b/;

const secondsOf = (line: string): number | null => {
  const m = line.match(TIME_AT_START);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

let files = 0;
let resRows = 0;
let noChange = 0;
let lostFocusEpisodes = 0;
let ccEntries = 0;
let ccLost = 0;
let cdEntries = 0;
let cdLost = 0;
/** 删掉也不丢任何事实的行 —— 「只删这些」是零信息损失的中间档,本行数就是它的收益上限。 */
let safeToDrop = 0;
const promptsWithLoss = new Set<string>();
const examples: string[] = [];

for (const f of readdirSync(dir).filter((n) => n.endsWith(".txt"))) {
  files++;
  const lines = readFileSync(join(dir, f), "utf8").split("\n");

  // 每行归到它之前最近的时间戳(`[RES]` 行自己不带时间)。
  const at: Array<number | null> = [];
  let last: number | null = null;
  for (const l of lines) {
    const s = secondsOf(l);
    if (s !== null) last = s;
    at.push(last);
  }

  // 同族参照行:CC 落地行与敌方 CD 行。
  const ccLines: Array<{ t: number; text: string }> = [];
  const cdLines: Array<{ t: number; text: string }> = [];
  lines.forEach((l, i) => {
    const t = at[i];
    if (t === null) return;
    if (/\[CC ON /.test(l)) ccLines.push({ t, text: l });
    if (/\[ENEMY CD\]/.test(l)) cdLines.push({ t, text: l });
  });

  const rows = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => RES_ROW.test(l));
  resRows += rows.length;

  // focus:被删行独占的集火段 —— 上一条与下一条**存活**的 [RES] 都不是这个目标。
  rows.forEach((row, k) => {
    const dead = NO_CHANGE.test(row.l);
    if (!dead) return;
    noChange++;
    let uniqueHere = false;
    const focus = row.l.match(FOCUS)?.[1];
    if (focus) {
      const survivingNeighbour = (dir_: -1 | 1): string | undefined => {
        for (let j = k + dir_; j >= 0 && j < rows.length; j += dir_) {
          if (!NO_CHANGE.test(rows[j]!.l)) return rows[j]!.l.match(FOCUS)?.[1];
        }
        return undefined;
      };
      if (survivingNeighbour(-1) !== focus && survivingNeighbour(1) !== focus) {
        lostFocusEpisodes++;
        uniqueHere = true;
        promptsWithLoss.add(f);
        if (examples.length < MAX_EXAMPLES)
          examples.push(`${f} focus=${focus} :: ${row.l.trim().slice(0, 120)}`);
      }
    }

    const t = at[row.i];
    const cc = row.l.match(CC_FIELD)?.[1];
    if (cc && t !== null)
      for (const entry of cc.split(",")) {
        const spell = entry.match(CC_ENTRY)?.[1];
        if (!spell) continue;
        ccEntries++;
        // 落地行自带时长 → 它覆盖 [t0, t0+dur];落在里面就说明这条控制仍然可推。
        const covered = ccLines.some((c) => {
          if (!c.text.includes(spell)) return false;
          const dur = Number(c.text.match(CC_LINE_DUR)?.[1] ?? CC_FALLBACK_S);
          return t >= c.t - CC_SLACK_S && t <= c.t + dur + CC_SLACK_S;
        });
        if (!covered) {
          ccLost++;
          uniqueHere = true;
          promptsWithLoss.add(f);
          if (examples.length < MAX_EXAMPLES)
            examples.push(
              `${f} cc=${spell} @${t}s :: ${row.l.trim().slice(0, 120)}`,
            );
        }
      }

    const en = row.l.match(ENEMY_FIELD)?.[1];
    if (en && t !== null)
      for (const entry of en.split(",")) {
        const spell = entry.match(CD_ENTRY)?.[1];
        if (!spell) continue;
        cdEntries++;
        // 同名 [ENEMY CD] 行在这一秒之前出现过 → 剩余秒数可推(算一步),不算丢。
        const covered = cdLines.some(
          (c) => c.t <= t && c.text.includes(spell),
        );
        if (!covered) {
          cdLost++;
          uniqueHere = true;
        }
      }
    if (!uniqueHere) safeToDrop++;
  });
}

const pct = (a: number, b: number) =>
  b === 0 ? "—" : `${((a / b) * 100).toFixed(1)}%`;
console.log(
  `prompts=${files}  [RES] rows=${resRows}  no-change=${noChange} (${pct(noChange, resRows)})`,
);
console.log(
  `focus: 只存在于被删行的集火段  ${lostFocusEpisodes}  (${pct(lostFocusEpisodes, noChange)} of deleted rows)`,
);
console.log(
  `cc:    被删行上的控制  ${ccEntries},其中无任何同名 [CC ON …] 落地行覆盖到这一秒  ${ccLost} (${pct(ccLost, ccEntries)})`,
);
console.log(
  `enemy: 被删行上的敌方 CD  ${cdEntries},其中整份 prompt 无同名 [ENEMY CD] 行  ${cdLost} (${pct(cdLost, cdEntries)})`,
);
console.log(
  `prompts with >=1 lost fact: ${promptsWithLoss.size}/${files} (${pct(promptsWithLoss.size, files)})`,
);
console.log(
  `零信息损失可删的行: ${safeToDrop}/${noChange} (${pct(safeToDrop, noChange)} of no-change rows, ${pct(safeToDrop, resRows)} of all [RES] rows)`,
);
for (const e of examples) console.log(`  ex: ${e}`);
