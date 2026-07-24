// 一次性 smoke 辅助(2026-07-24 团队协作候选扩充):从覆盖语料取治疗场,
// 建 findings prompt 落盘;--audit <resp.json> 时用 auditFindings 审模型回复。
import { readFileSync, writeFileSync } from "fs";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch, CombatUnitReaction } from "@gladlog/parser-compat";
import {
  extractCandidateFindings,
  buildFindingsPrompt,
  auditFindings,
  parseModelJsonArray,
  isHealerSpec,
} from "@gladlog/analysis";

const argv = process.argv.slice(2);
const logPath = argv[argv.indexOf("--log") + 1]!;
const outPath = argv[argv.indexOf("--out") + 1]!;
const auditIdx = argv.indexOf("--audit");

const parser = new GladLogParser();
const items: GladMatch[] = [];
parser.on("match", (m) => items.push(m));
parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
for (const line of readFileSync(logPath, "utf8").split("\n")) parser.push(line);
parser.end();

for (const m of items) {
  const legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
  const players = Object.values(legacy.units).filter((u) => u.info);
  const owner = players.find(
    (u) => isHealerSpec(u.spec) && u.reaction === CombatUnitReaction.Friendly,
  );
  if (!owner) continue;
  const cands = extractCandidateFindings(legacy, owner.id);
  const newTypes = cands.filter((c) =>
    ["missed-cleanse", "missed-purge", "cc-locked", "kick-eaten"].includes(
      c.type,
    ),
  );
  if (newTypes.length < 3) continue; // 挑新类型丰富的场
  if (auditIdx >= 0) {
    const raw = readFileSync(argv[auditIdx + 1]!, "utf8");
    const parsed = parseModelJsonArray(raw);
    if (!parsed) {
      console.log("BAD-JSON");
      process.exit(1);
    }
    const r = auditFindings(parsed as never, cands);
    console.log(
      `kept=${r.findings.length} dropped=${r.dropped.length}` +
        ` newTypeAnchored=${r.findings.filter((f) => f.eventIds.some((id) => cands.find((c) => c.id === id && newTypes.includes(c)))).length}`,
    );
    for (const d of r.dropped) console.log(`  drop[${d.reason}] ${d.title}`);
    for (const f of r.findings)
      console.log(`  keep ${f.severity} ${f.title} <- ${f.eventIds.join(",")}`);
  } else {
    writeFileSync(outPath, buildFindingsPrompt(cands, "", owner.spec));
    console.log(
      `menu=${cands.length} new=${newTypes.length} types=${[...new Set(cands.map((c) => c.type))].join(",")}`,
    );
  }
  break;
}
