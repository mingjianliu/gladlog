/**
 * F193 CONTESTED safety-contract assertions (backlog #4 reprise) -- run over
 * every prompt in the corpus:
 *
 *  C1 anchoring complete: every [CONTESTED] line must match the full template
 *     (time span, duration, team min HP, CC spell name, named enemy healer,
 *     the literal "DR Full", trinket status, amount healed, CC cast count,
 *     and one of the three tails: enemy interrupts ready count + cast risk /
 *     instant / neither) -- 0 unanchored.
 *  C2 HP band: 70 ≤ team min HP < 85 (CONTESTED_TEAM_HP_MIN /
 *     SLACK_TEAM_HP_THRESHOLD) -- 0 sub-70%.
 *  C3 EV wording: the line must end with the complete disclaimer
 *     "(EV question, not a verdict)" -- 0 turned into verdicts.
 *  C4 count cap: ≤ MAX_CONTESTED_FACTS (2) per match.
 *  C5 position constraint (negative control): [CONTESTED] may appear only
 *     inside the <healer_offense> block; anywhere else is a violation.
 *
 * Usage: BASE_DIR=<run dir> npx tsx packages/eval/scripts/contestedContract.ts
 * Exits 1 on any violation.
 */
import {
  CONTESTED_LINE_RE_SRC,
  contestedTailForm,
} from "@gladlog/analysis/src/utils/healerOffenseAnalysis";
import fs from "fs-extra";
import path from "path";

const MAX_CONTESTED_FACTS = 2;
const HP_MIN = 70;
const HP_MAX_EXCLUSIVE = 85;

// The producer's own line pattern and tail reader (FT I12: the tail has three
// forms — cast risk with the interrupt count, instant, neither — and every
// one ends with the EV disclaimer; whether a line's form fits its control is
// `checkContestedCastRisk`'s class in promptQualityCheck.ts).
const LINE_RE = new RegExp(CONTESTED_LINE_RE_SRC);

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
      if (!m || !contestedTailForm(m[10]!)) {
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
