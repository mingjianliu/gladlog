// 深挖 A/B(审计 + judge 输入组装):双臂回复各跑 auditDeepDives,统计纪律
// 通过率 + after 臂的"诚实留白率"(空数组=模型主动说干净);再把过审的
// 深挖交错匿名写成 judge 输入(judge 盲评,不知哪条是 before/after)。
import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { auditDeepDives, type DeepDivePack,
  parseModelJsonArray,
} from "@gladlog/analysis";

const AB = process.argv[2]!;

interface Row {
  tag: string;
  arm: "before" | "after";
  finding: string;
  text: string | null; // null = 留空/被丢
  omitted: boolean; // after 臂主动输出 []
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
    // 围栏容错走共享谓词(与 desktop 产品路径同源)
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

// judge 输入:交错匿名(A/B 打乱),judge 盲评
const graded = [...before, ...after].filter((r) => r.text);
// 稳定打乱(按 tag+arm 哈希)避免全 before 在前
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
