/**
 * F193 CONTESTED 安全契约断言(backlog #4 复刻)——对语料 prompts 全量跑:
 *
 *  C1 锚定完整:每条 [CONTESTED] 行必须匹配完整模板(时间段、时长、team min HP、
 *     CC 法术名、敌方治疗具名、"DR Full" 字面量、trinket 状态、healed 数额、
 *     CC cast 计数、enemy interrupts ready 计数)——0 unanchored。
 *  C2 HP 带:70 ≤ team min HP < 85(CONTESTED_TEAM_HP_MIN / SLACK_TEAM_HP_THRESHOLD)——0 sub-70%。
 *  C3 EV 措辞:行尾必须带 "(EV question, not a verdict)" 完整免责语——0 verdict 化。
 *  C4 数量上限:每场 ≤ MAX_CONTESTED_FACTS(2)。
 *  C5 位置约束(阴性对照):[CONTESTED] 只允许出现在 <healer_offense> 块内;
 *     块外出现即违规。
 *
 * 用法:BASE_DIR=<run 目录> npx tsx packages/eval/scripts/contestedContract.ts
 * 违规时 exit 1。
 */
import fs from "fs-extra";
import path from "path";

const MAX_CONTESTED_FACTS = 2;
const HP_MIN = 70;
const HP_MAX_EXCLUSIVE = 85;

const LINE_RE =
  /^ {2}\[CONTESTED\] (\d+:\d{2})–(\d+:\d{2}) \((\d+)s, team min HP (\d+)%\): (.+?) ready on enemy healer (\S+) \(DR Full, trinket ([\w ]+?)\); you healed (\d+)k, cast (\d+) CC; enemy interrupts ready: (\d+) — contested trade: a CC here competed with continued healing AND carried cast risk \(EV question, not a verdict\)\.$/;

async function main() {
  const baseDir = process.env.BASE_DIR;
  if (!baseDir) {
    console.error("BASE_DIR not set");
    process.exit(1);
  }
  const promptsDir = path.join(baseDir, "prompts");
  const files = (await fs.readdir(promptsDir))
    .filter((f) => f.endsWith(".txt"))
    .sort();

  let totalLines = 0;
  let filesWithLines = 0;
  const violations: string[] = [];

  for (const f of files) {
    const content = await fs.readFile(path.join(promptsDir, f), "utf-8");
    const lines = content.split("\n");
    let inOffense = false;
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes("<healer_offense>")) inOffense = true;
      if (line.includes("</healer_offense>")) inOffense = false;
      if (!line.includes("[CONTESTED]")) continue;
      totalLines++;
      count++;
      if (!inOffense) {
        violations.push(
          `${f}:${i + 1} C5 [CONTESTED] outside <healer_offense> block`,
        );
      }
      const m = line.match(LINE_RE);
      if (!m) {
        violations.push(
          `${f}:${i + 1} C1/C3 unanchored or missing EV framing: ${line.trim().slice(0, 120)}`,
        );
        continue;
      }
      const hp = Number(m[4]);
      if (hp < HP_MIN || hp >= HP_MAX_EXCLUSIVE) {
        violations.push(
          `${f}:${i + 1} C2 team min HP ${hp}% outside [${HP_MIN}, ${HP_MAX_EXCLUSIVE})`,
        );
      }
    }
    if (count > 0) filesWithLines++;
    if (count > MAX_CONTESTED_FACTS) {
      violations.push(
        `${f} C4 ${count} [CONTESTED] lines > max ${MAX_CONTESTED_FACTS}`,
      );
    }
  }

  console.log(
    `Scanned ${files.length} prompts: ${totalLines} [CONTESTED] lines across ${filesWithLines} matches.`,
  );
  if (violations.length > 0) {
    console.error(`\n${violations.length} VIOLATION(S):`);
    for (const v of violations) console.error("  " + v);
    process.exit(1);
  }
  console.log(
    "Contract clean: 0 unanchored / 0 out-of-band / 0 missing-EV / 0 over-cap / 0 out-of-block.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
