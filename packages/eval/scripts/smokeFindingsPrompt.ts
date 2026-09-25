// One-off smoke helper (2026-07-24 team-coordination candidate expansion): pick
// healer matches from the coverage corpus, build the findings prompt and write
// it to disk; with --audit <resp.json>, run auditFindings over the model's
// reply.
import {
  auditFindings,
  buildFindingsPrompt,
  parseModelJsonArray,
  ensureAnalysisData,
} from "@gladlog/analysis";
import { readFileSync, writeFileSync } from "fs";

import { healerOwnerMenu, parseLogCombats } from "../src/corpus/candidateMenu";

// Prompt builders read the background-loaded talent / spell-name tables
// (data/ensure.ts contract) — without this the first combats are degraded.
await ensureAnalysisData();

const argv = process.argv.slice(2);
const logPath = argv[argv.indexOf("--log") + 1]!;
const outPath = argv[argv.indexOf("--out") + 1]!;
const auditIdx = argv.indexOf("--audit");

const combats = parseLogCombats(readFileSync(logPath, "utf8"));

for (const { legacy } of combats) {
  const menu = healerOwnerMenu(legacy);
  if (!menu) continue;
  const { owner, candidates: cands } = menu;
  const newTypes = cands.filter((c) =>
    ["missed-cleanse", "missed-purge", "cc-locked", "kick-eaten"].includes(
      c.type,
    ),
  );
  if (newTypes.length < 3) continue; // keep matches rich in new event types
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
    for (const d of r.dropped)
      console.log(`  drop[${d.reason}] ${d.finding.title}`);
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
