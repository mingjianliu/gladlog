/**
 * Candidate-evidence confidence audit (permanent tool, 2026-07-24): the
 * numbers in findings are all deterministic facts, so confidence really
 * depends on the data quality of the predicate behind each candidate type.
 * This script quantifies, over the full corpus, the "observed vs inferred"
 * share of each candidate type's key facts:
 *
 *  - The dispellability claim of missed-cleanse / missed-purge: has that
 *    debuff/buff spellId **actually been dispelled/stolen by anyone** in the
 *    corpus? (DB2 saying Magic != dispellable in practice -- for an id that
 *    is never observed being removed yet appears often, "you should have
 *    dispelled it" is a low-confidence claim.)
 *  - The trinketState distribution of cc-locked (available_unused is the most
 *    inference-heavy tier).
 *  - kick-eaten: a pure hard event (SPELL_INTERRUPT), inherently full
 *    confidence, used as the control anchor.
 *
 * Usage: npx tsx packages/eval/scripts/confidenceAudit.ts --manifest <file>
 *        [--emit-table [--date YYYY-MM-DD]]
 * Manifest entries may be `.txt` or `.txt.gz` (PvP archive); with --emit-table
 * the per-match candidate extraction is skipped (the table only needs the
 * observation side), so the full archive is affordable.
 */
import {
  buildCastMatchIndex,
  classifyDispel,
  type DispelKind,
  extractCandidateFindings,
  isHealerSpec,
  ensureAnalysisData,
} from "@gladlog/analysis";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import {
  CombatUnitReaction,
  LogEvent,
  toLegacyMatch,
} from "@gladlog/parser-compat";
import { readFileSync } from "fs";
import { gunzipSync } from "zlib";

// Prompt builders read the background-loaded talent / spell-name tables
// (data/ensure.ts contract) — without this the first combats are degraded.
await ensureAnalysisData();

const argv = process.argv.slice(2);
const emitTable = argv.includes("--emit-table");
const mIdx = argv.indexOf("--manifest");
if (mIdx < 0) {
  console.error("Usage: confidenceAudit --manifest <file>");
  process.exit(1);
}
const files = readFileSync(argv[mIdx + 1]!, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

// Corpus observation: spellId that has been dispelled/stolen -> count (either
// side, any match). GH #32: counted under the product's `classifyDispel`
// predicate — riders (Cat Form shaking off a snare is logged as SPELL_DISPEL)
// are NOT evidence that anyone dispelled the debuff, so they are excluded.
// Procs (Cleanse the Weak …) do remove the aura and stay in.
const dispelledIds = new Map<string, number>();
// Per-kind tally of the same events, for the before/after ledger
const kindTally: Record<DispelKind, number> = {
  deliberate: 0,
  proc: 0,
  rider: 0,
};
const riderOnlyIds = new Map<string, number>();
// Candidate references: type -> spellId -> { candidate count, match sample }
const cleanseCands = new Map<string, { n: number; name: string }>();
const purgeCands = new Map<string, { n: number; name: string }>();
const trinketStates = new Map<string, number>();
let matches = 0;
let kickEaten = 0;
let ccLocked = 0;
const ccLockedDur: number[] = [];

for (const f of files) {
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  // Manifest entries ending in `.gz` are gunzipped in memory (the PvP log
  // archive stores raw gzip bytes) — same convention as observedSpellIds.ts.
  const raw = readFileSync(f);
  const text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  for (const m of items) {
    try {
      const legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
      const units = Object.values(legacy.units);
      // Observation side: the removed id of every non-rider SPELL_DISPEL /
      // SPELL_STOLEN in the match (same cast index + predicate as
      // reconstructDispelSummary)
      const castIndex = buildCastMatchIndex(units);
      for (const u of units)
        for (const a of u.actionOut ?? []) {
          const ev = a.logLine?.event;
          if (ev !== LogEvent.SPELL_DISPEL && ev !== LogEvent.SPELL_STOLEN)
            continue;
          const removed = (a as { extraSpellId?: string }).extraSpellId;
          if (!removed) continue;
          const kind = classifyDispel(castIndex, {
            srcUnitId: a.srcUnitId,
            spellId: a.spellId,
            spellName: a.spellName,
            timestamp: a.timestamp,
          });
          kindTally[kind]++;
          if (kind === "rider") {
            riderOnlyIds.set(removed, (riderOnlyIds.get(removed) ?? 0) + 1);
            continue;
          }
          dispelledIds.set(removed, (dispelledIds.get(removed) ?? 0) + 1);
        }

      const players = units.filter((u) => u.info);
      const owner =
        players.find(
          (u) =>
            u.id === legacy.playerId &&
            u.reaction === CombatUnitReaction.Friendly,
        ) ??
        players.find(
          (u) =>
            isHealerSpec(u.spec) && u.reaction === CombatUnitReaction.Friendly,
        );
      if (!owner) continue;
      matches++;
      // --emit-table only needs the observation side (dispelledIds /
      // kindTally / riderOnlyIds / matches); skip the candidate extraction,
      // which is the expensive half, when nothing below will be printed.
      if (emitTable) continue;
      for (const c of extractCandidateFindings(legacy, owner.id)) {
        if (c.type === "missed-cleanse" && c.spellId) {
          const e = cleanseCands.get(c.spellId) ?? {
            n: 0,
            name: c.spell ?? "",
          };
          e.n++;
          cleanseCands.set(c.spellId, e);
        } else if (c.type === "missed-purge" && c.spellId) {
          const e = purgeCands.get(c.spellId) ?? { n: 0, name: c.spell ?? "" };
          e.n++;
          purgeCands.set(c.spellId, e);
        } else if (c.type === "cc-locked") {
          ccLocked++;
          const st = c.facts.trinketState ?? "?";
          trinketStates.set(st, (trinketStates.get(st) ?? 0) + 1);
          ccLockedDur.push(Number(c.facts.duration));
        } else if (c.type === "kick-eaten") kickEaten++;
      }
    } catch {
      /* Skip broken matches */
    }
  }
}

function reportSide(
  label: string,
  cands: Map<string, { n: number; name: string }>,
) {
  const total = [...cands.values()].reduce((s, e) => s + e.n, 0);
  const verified = [...cands.entries()].filter(([id]) => dispelledIds.has(id));
  const unverified = [...cands.entries()].filter(
    ([id]) => !dispelledIds.has(id),
  );
  const vN = verified.reduce((s, [, e]) => s + e.n, 0);
  console.log(
    `\n${label}: 候选 ${total} 条 / ${cands.size} 个 id;` +
      `语料实证可解 ${vN} 条(${((100 * vN) / Math.max(1, total)).toFixed(0)}%)`,
  );
  console.log(`  从未被观测解除的 id(低置信,按候选数排):`);
  for (const [id, e] of unverified.sort((a, b) => b[1].n - a[1].n).slice(0, 12))
    console.log(`    ${id} ${e.name} ×${e.n}`);
  console.log(`  实证 top:`);
  for (const [id, e] of verified.sort((a, b) => b[1].n - a[1].n).slice(0, 6))
    console.log(
      `    ${id} ${e.name} ×${e.n}(语料被解 ${dispelledIds.get(id)} 次)`,
    );
}

// --emit-table: write the observed set out as an analysis generated data file
// (part of the update-wow-data flow)
const eIdx = argv.indexOf("--emit-table");
if (eIdx >= 0) {
  const riderOnly = [...riderOnlyIds.keys()].filter(
    (id) => !dispelledIds.has(id),
  );
  const dIdx = argv.indexOf("--date");
  const args = {
    date: dIdx >= 0 ? argv[dIdx + 1] : "unknown date",
    manifest: argv[mIdx + 1]!.replace(process.env.HOME ?? "~", "~"),
  };
  const rows = [...dispelledIds.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `  "${id}", // ×${n}`)
    .join("\n");
  const body = `/**
 * Corpus-attested dispellable id set (GENERATED — do not hand-edit): spellIds
 * that were actually removed by SPELL_DISPEL / SPELL_STOLEN somewhere in the
 * full corpus. It gates the dispellability claim behind missed-cleanse /
 * missed-purge candidates — DB2's dispelType is "theoretically dispellable",
 * this is "someone actually dispelled it in a real match". Ids never observed
 * being dispelled (Paralysis / Intimidating Shout / Blessing of Sacrifice) emit
 * no candidate: "you should have dispelled that" does not hold up at the corpus
 * level.
 *
 * Generated under the dispelKind predicate (utils/dispelKind.ts, GH #32):
 * only deliberate + proc removals count; rider dispels (a form shift /
 * movement ability shaking off its own root or snare) are excluded, so a
 * debuff that was only ever shaken off never opens this gate.
 * Kind tally at generation: deliberate ${kindTally.deliberate}, proc ${kindTally.proc},
 * rider ${kindTally.rider} (excluded); ${riderOnly.length} ids were rider-only.
 *
 * Regenerate: npx tsx packages/eval/scripts/confidenceAudit.ts \\
 *   --manifest <manifest> --emit-table --date YYYY-MM-DD \\
 *   > packages/analysis/src/data/dispelObservedGenerated.ts
 * Manifest: ${args.manifest}
 * Corpus snapshot: ${matches} matches, ${dispelledIds.size} ids (${args.date}).
 */
export const CORPUS_OBSERVED_DISPEL_IDS: ReadonlySet<string> = new Set([
${rows}
]);
`;
  process.stdout.write(body);
  process.exit(0);
}

console.log(
  `matches=${matches};语料观测到被驱散/偷取的不同 spellId:${dispelledIds.size}` +
    `(kind: deliberate ${kindTally.deliberate} / proc ${kindTally.proc} / rider ${kindTally.rider} excluded;` +
    ` rider-only ids ${[...riderOnlyIds.keys()].filter((id) => !dispelledIds.has(id)).length})`,
);
reportSide("missed-cleanse(可解性主张)", cleanseCands);
reportSide("missed-purge(可 purge 主张)", purgeCands);
console.log(`\ncc-locked: ${ccLocked} 条;trinketState 分布:`);
for (const [st, n] of [...trinketStates.entries()].sort((a, b) => b[1] - a[1]))
  console.log(
    `  ${st}: ${n}(${((100 * n) / Math.max(1, ccLocked)).toFixed(0)}%)`,
  );
ccLockedDur.sort((a, b) => a - b);
console.log(
  `  duration p50=${ccLockedDur[Math.floor(ccLockedDur.length / 2)] ?? "-"}s max=${ccLockedDur[ccLockedDur.length - 1] ?? "-"}s(APPLIED→REMOVED 观测对)`,
);
console.log(`kick-eaten: ${kickEaten} 条(SPELL_INTERRUPT 硬事件,满置信锚)`);
