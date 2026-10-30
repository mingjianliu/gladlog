// Deep-dive A/B (audit + assembling the judge input): run auditDeepDives over
// both arms' responses, report the discipline pass rate plus the after arm's
// "honest abstention rate" (an empty array = the model proactively said there
// was nothing to report); then write the surviving deep dives, interleaved and
// anonymized, as the judge input (the judge scores blind and does not know
// which entry is before/after).
import { auditDeepDives, type DeepDivePack,
  parseModelJsonArray,
} from "@gladlog/analysis";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const AB = process.argv[2]!;

interface Row {
  tag: string;
  arm: "before" | "after";
  finding: string;
  text: string | null; // null = left blank / dropped
  omitted: boolean; // the after arm proactively emitted []
}

function loadArm(arm: "before" | "after"): Row[] {
  const rows: Row[] = [];
  for (const pf of readdirSync(AB)
    .filter((f) => f.endsWith(".pack.json"))
    .sort()) {
    const tag = pf.replace(".pack.json", "");
    const respPath = join(AB, `${arm}-resp`, `${tag}.txt`);
    if (!existsSync(respPath)) continue;
    const { pack, finding } = JSON.parse(
      readFileSync(join(AB, pf), "utf8"),
    ) as { pack: DeepDivePack; finding: { title: string } };
    const raw = readFileSync(respPath, "utf8");
    // Code-fence tolerance goes through the shared predicate (the same source
    // as the desktop product path)
    const parsed = parseModelJsonArray(raw);
    if (!parsed) {
      rows.push({
        tag,
        arm,
        finding: finding.title,
        text: null,
        omitted: false,
      });
      continue;
    }
    const omitted = Array.isArray(parsed) && parsed.length === 0;
    const dives = auditDeepDives(parsed, [pack]);
    rows.push({
      tag,
      arm,
      finding: finding.title,
      text: dives[0]?.text ?? null,
      omitted,
    });
  }
  return rows;
}

const before = loadArm("before");
const after = loadArm("after");

const survRate = (rows: Row[]) =>
  `${rows.filter((r) => r.text).length}/${rows.length}`;
console.warn(
  `纪律通过(有过审深挖):before ${survRate(before)} · after ${survRate(after)}`,
);
console.warn(
  `after 诚实留白(模型主动输出 []):${after.filter((r) => r.omitted).length}/${after.length}`,
);

// Judge input: interleaved and anonymized (A/B shuffled), scored blind
const graded = [...before, ...after].filter((r) => r.text);
// Stable shuffle (by tag+arm) so all the before entries don't come first
graded.sort((a, b) => (a.tag + a.arm).localeCompare(b.tag + b.arm));
const lines: string[] = [];
const key: Array<{ label: number; arm: string; tag: string }> = [];
graded.forEach((r, i) => {
  const label = i + 1;
  key.push({ label, arm: r.arm, tag: r.tag });
  lines.push(
    `## ITEM ${label}\nFINDING (all the coach had): "${r.finding} — teammate died in a kill window; no surrounding context"\nDEEP-DIVE: ${r.text}\n`,
  );
});
writeFileSync(join(AB, "judge-input.md"), lines.join("\n"));
writeFileSync(join(AB, "judge-key.json"), JSON.stringify(key, null, 1));
console.warn(
  `\njudge 输入:${graded.length} 条(匿名交错)→ ${AB}/judge-input.md`,
);
