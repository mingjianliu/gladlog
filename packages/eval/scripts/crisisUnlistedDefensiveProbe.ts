/**
 * crisisUnlistedDefensiveProbe.ts — GH #96 M4 (design D4): when crisis-no-response
 * would call a healer "did nothing", did they actually press a protective
 * ability the response lists do not know?
 *
 * Why: `crisisDecisionPoints` credits a wall / external only through two hand
 * lists (`bigDefensiveSpellIds`, `externalDefensiveSpellIds`). The talent
 * catalog found 29 active defensives outside every list. D4 ruling: an
 * INTENTIONAL, unlisted OWNER cast with protective capability makes the
 * owner-response verdict indeterminate; procs and teammate protection never
 * change it; no invented magnitude thresholds; pick rate only orders the
 * membership review list. This probe produces that list and the size of the
 * verdict change BEFORE any product code moves.
 *
 * Definitions (all official or already-signed sources, none new):
 *  - point set: role "healer", `feasible && dangerous && !responded` — the
 *    points crisis-no-response may accuse (before its reference / cap gates);
 *  - owner cast: the owner's own SPELL_CAST_SUCCESS inside the response window
 *    [t − RESPONSE_PRE_MS, t + RESPONSE_WINDOW_MS];
 *  - unlisted: not in the wall, external or control sets the predicate reads;
 *  - protective: `abilityProfile` says mitigation %, absorb, immunity schools
 *    or healing-received %, or the tooltip mitigation table
 *    (`talentMitigationGenerated.json`) has the spell with beneficiary self /
 *    other. Plain self-heals are excluded (the predicate measures self-heal
 *    by amount already);
 *  - intentional: the spell is a node of the owner's spec talent trees, in the
 *    spec's PvP pool, or a `classMetadata` ability — a proc aura's spell id is
 *    none of those. A baseline ability outside `classMetadata` is missed
 *    (stated limitation, counted as "not pressable" in the output).
 *
 * Review follow-up (codex astra, 2026-09-13): D4 says "relevant" owner
 * response, and a healer's Reversion on a teammate protects the teammate, not
 * the endangered healer. The headline now counts only casts on the owner or
 * with no unit target; casts on another unit are reported separately.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/crisisUnlistedDefensiveProbe.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-2026-08-28-newseason.txt [--every 30]
 * Output: stdout summary + $GLADLOG_EVAL_HOME/reports/talent-integration-2026-09-13/crisisUnlistedDefensive.json
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  crisisDecisionPoints,
  RESPONSE_PRE_MS,
  RESPONSE_WINDOW_MS,
} from "@gladlog/analysis/src/analysis/crisisDecisionPoints";
import { abilityProfile } from "@gladlog/analysis/src/data/abilityProfile";
import { classMetadata } from "@gladlog/analysis/src/data/classSpells";
import { PVP_TALENT_POOL_GENERATED } from "@gladlog/analysis/src/data/pvpTalentPoolGenerated";
import spellIdLists from "@gladlog/analysis/src/data/spellIdLists";
import talentMitigationGenerated from "@gladlog/analysis/src/data/talentMitigationGenerated.json";
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { getSpecTalentTreeSpellInfo } from "@gladlog/analysis/src/utils/talents";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { LogEvent, toLegacyMatch } from "@gladlog/parser-compat";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { gunzipSync } from "zlib";

import { arg } from "./lib/cli";

const manifest = arg("--manifest", "");
const every = Number(arg("--every", "30"));

const LISTED = new Set<string>([
  ...spellIdLists.bigDefensiveSpellIds.map(String),
  ...spellIdLists.externalDefensiveSpellIds.map(String),
]);
const CLASS_ABILITY_IDS = new Set<string>(
  classMetadata.flatMap((c: any) =>
    (c.abilities ?? []).map((x: any) => String(x.spellId)),
  ),
);
const TOOLTIP_MIT = (
  talentMitigationGenerated as unknown as {
    entries: Record<string, { beneficiary: string; pct: number }>;
  }
).entries;

function protectiveReason(id: string): string | null {
  const p = abilityProfile(id);
  if (p.hitsEnemy && !p.absorbs && p.mitigationPct === undefined) {
    // enemy-directed spells: their immunity flags are the victim's (Cyclone)
    const t = TOOLTIP_MIT[id];
    return t && t.beneficiary !== "pet" ? `tooltip-mitigation ${t.pct}%` : null;
  }
  if (p.mitigationPct !== undefined) return `mitigation ${p.mitigationPct}%`;
  if (p.immuneSchools !== undefined) return `immune schools ${p.immuneSchools}`;
  if (p.absorbs) return "absorb";
  if (p.healingReceivedPct !== undefined)
    return `healing received +${p.healingReceivedPct}%`;
  const t = TOOLTIP_MIT[id];
  if (t && t.beneficiary !== "pet") return `tooltip-mitigation ${t.pct}%`;
  return null;
}

function pressable(spec: string, id: string): boolean {
  const specId = parseInt(spec, 10);
  return (
    CLASS_ABILITY_IDS.has(id) ||
    (!Number.isNaN(specId) && getSpecTalentTreeSpellInfo(specId).has(id)) ||
    PVP_TALENT_POOL_GENERATED[spec]?.[id] !== undefined
  );
}

await ensureAnalysisData();
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);

let rounds = 0;
let accusable = 0;
let withUnlisted = 0;
let withUnpressable = 0;
let withUnlistedOnOthersOnly = 0;
const bySpell = new Map<
  string,
  { reason: string; points: number; players: Set<string>; specs: Set<string> }
>();
const unpressable = new Map<string, number>();
const examples: Array<Record<string, unknown>> = [];

for (const f of files) {
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  let text: string;
  try {
    const raw = readFileSync(resolve(f));
    text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  for (const m of items) {
    let legacy: any;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    rounds++;
    const healers = (Object.values(legacy.units ?? {}) as any[]).filter(
      (u) => u.info && isHealerSpec(u.spec),
    );
    for (const owner of healers) {
      for (const p of crisisDecisionPoints(owner, legacy, "healer")) {
        if (!(p.feasible && p.dangerous && !p.responded)) continue;
        accusable++;
        const w0 = p.tMs - RESPONSE_PRE_MS;
        const w1 = p.tMs + RESPONSE_WINDOW_MS;
        const hits = new Map<string, string>();
        let onOthers = false;
        let sawUnpressable = false;
        for (const c of (owner.spellCastEvents ?? []) as any[]) {
          if (c.logLine?.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
          if (c.timestamp < w0 || c.timestamp > w1) continue;
          const id = String(c.spellId ?? "");
          if (!id || LISTED.has(id)) continue;
          const reason = protectiveReason(id);
          if (!reason) continue;
          if (!pressable(owner.spec, id)) {
            sawUnpressable = true;
            unpressable.set(id, (unpressable.get(id) ?? 0) + 1);
            continue;
          }
          const dest = String(c.destUnitId ?? "");
          const onOwner =
            !dest || dest === owner.id || /^0+$/.test(dest) || dest === "nil";
          if (!onOwner) {
            onOthers = true;
            continue;
          }
          hits.set(id, reason);
        }
        if (onOthers && !hits.size) withUnlistedOnOthersOnly++;
        if (sawUnpressable && !hits.size) withUnpressable++;
        if (!hits.size) continue;
        withUnlisted++;
        for (const [id, reason] of hits) {
          const row = bySpell.get(id) ?? {
            reason,
            points: 0,
            players: new Set<string>(),
            specs: new Set<string>(),
          };
          row.points++;
          row.players.add(owner.name);
          row.specs.add(String(owner.spec));
          bySpell.set(id, row);
        }
        if (examples.length < 12)
          examples.push({
            file: f,
            round: rounds,
            owner: owner.name,
            spec: owner.spec,
            tSec: p.tSec,
            hpPct: p.hpPct,
            dmg2s: p.dmg2s,
            casts: [...hits].map(
              ([id, r]) => `${getEnglishSpellName(id, "")} ${id} (${r})`,
            ),
          });
      }
    }
  }
}

const list = [...bySpell]
  .map(([id, r]) => ({
    spellId: id,
    name: getEnglishSpellName(id, ""),
    reason: r.reason,
    points: r.points,
    players: r.players.size,
    specs: [...r.specs],
  }))
  .sort((x, y) => y.points - x.points);
const summary = {
  files: files.length,
  rounds,
  accusablePoints: accusable,
  withUnlistedProtectiveCast: withUnlisted,
  onlyUnpressableProtectiveCast: withUnpressable,
  onlyOnAnotherUnit: withUnlistedOnOthersOnly,
  list,
  unpressable: [...unpressable]
    .map(([id, n]) => ({ spellId: id, name: getEnglishSpellName(id, ""), n }))
    .sort((x, y) => y.n - x.n)
    .slice(0, 30),
  examples,
};
const home =
  process.env.GLADLOG_EVAL_HOME ??
  join(process.env.HOME ?? "", "code/gladlog-eval-private");
const outDir = join(home, "reports/talent-integration-2026-09-13");
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, "crisisUnlistedDefensive.json"),
  JSON.stringify(summary, null, 1),
);
console.log(
  `files ${files.length} rounds ${rounds} accusable ${accusable} with-unlisted-protective ${withUnlisted} only-unpressable ${withUnpressable} only-on-another-unit ${withUnlistedOnOthersOnly}`,
);
for (const r of list)
  console.log(
    `${String(r.points).padStart(4)} pts ${String(r.players).padStart(3)} players  ${r.spellId.padEnd(8)} ${r.name.padEnd(28)} ${r.reason}  specs ${r.specs.join(",")}`,
  );
