/**
 * crisisResponseCompletenessScan.ts — which healer casts inside crisis windows
 * does crisis-no-response's "responded" predicate fail to credit? (GH #96 M4,
 * Curated-List Completeness Rule, forward direction.)
 *
 * Why (user, 2026-09-14): the first probe (crisisUnlistedDefensiveProbe.ts)
 * only looked at points already accused, on a 1-in-30 slice, with a narrow
 * "protective" test and a "pressable" test that dropped Power Word: Shield.
 * The user ruled its five spells count and asked whether the data was
 * complete. This scan asks the complete question instead: across EVERY
 * dangerous feasible healer crisis point (responded or not), list EVERY owner
 * SPELL_CAST_SUCCESS in the response window that no response category
 * credits, with what official DB2 says the spell does.
 *
 * Classification (DB2 SpellEffect of the build, the spell's own effects plus
 * one EffectTriggerSpell hop; labels, not a verdict):
 *  dr        aura 87 MOD_DAMAGE_PERCENT_TAKEN with negative points
 *  absorb    aura 69 SCHOOL_ABSORB
 *  immune    aura 39 SCHOOL_IMMUNITY
 *  cc-immune aura 77 MECHANIC_IMMUNITY
 *  maxhp     aura 34 / 133 MOD_INCREASE_HEALTH(_PERCENT) positive
 *  heal-recv aura 118 MOD_HEALING_PCT positive
 *  avoid     aura 184 / 185 / 186 attacker hit chance negative
 *  heal      effect 10 HEAL / effect 136 HEAL_PCT / aura 8 PERIODIC_HEAL
 *  scripted  aura 4 DUMMY or effect 3 DUMMY only
 * Nothing is filtered by these labels: every uncredited cast is listed, so a
 * spell the labels miss still shows up by frequency.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/crisisResponseCompletenessScan.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-2026-08-28-newseason.txt [--every 5] \
 *     [--db2 ~/.cache/gladlog-datagen/SpellEffect-12.1.0.69587.csv]
 * Output: stdout + $GLADLOG_EVAL_HOME/reports/talent-integration-2026-09-13/crisisResponseCompleteness.json
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  crisisDecisionPoints,
  RESPONSE_PRE_MS,
  RESPONSE_WINDOW_MS,
} from "@gladlog/analysis/src/analysis/crisisDecisionPoints";
import spellIdLists from "@gladlog/analysis/src/data/spellIdLists";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { ccSpellIds, rootSpellIds } from "@gladlog/analysis/src/data/spellTags";
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { LogEvent, toLegacyMatch } from "@gladlog/parser-compat";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { gunzipSync } from "zlib";

const a = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = a.indexOf(k);
  return i >= 0 ? (a[i + 1] ?? d) : d;
};
const home =
  process.env.GLADLOG_EVAL_HOME ??
  join(process.env.HOME ?? "", "code/gladlog-eval-private");
const manifest = arg("--manifest", "");
const every = Number(arg("--every", "5"));
const db2 = arg(
  "--db2",
  join(
    process.env.HOME ?? "",
    ".cache/gladlog-datagen/SpellEffect-12.1.0.69587.csv",
  ),
);

// ---- DB2 effects ----------------------------------------------------------
type Eff = { effect: number; aura: number; bp: number; trigger: string };
const effects = new Map<string, Eff[]>();
{
  const lines = readFileSync(db2, "utf8").split("\n");
  const header = lines[0]!.split(",");
  const col = (n: string) => header.indexOf(n);
  const cSpell = col("SpellID"),
    cEffect = col("Effect"),
    cAura = col("EffectAura"),
    cBp = col("EffectBasePointsF"),
    cTrig = col("EffectTriggerSpell"),
    cDiff = col("DifficultyID");
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i]!.split(",");
    if (f.length < header.length || f[cDiff] !== "0") continue;
    const id = f[cSpell]!;
    const list = effects.get(id) ?? [];
    list.push({
      effect: Number(f[cEffect]),
      aura: Number(f[cAura]),
      bp: Number(f[cBp]),
      trigger: f[cTrig]!,
    });
    effects.set(id, list);
  }
}
function labelsOf(id: string): string[] {
  const out = new Set<string>();
  const visit = (sid: string, hop: number) => {
    for (const e of effects.get(sid) ?? []) {
      if (e.aura === 87 && e.bp < 0) out.add("dr");
      if (e.aura === 69) out.add("absorb");
      if (e.aura === 39) out.add("immune");
      if (e.aura === 77) out.add("cc-immune");
      if ((e.aura === 34 || e.aura === 133) && e.bp > 0) out.add("maxhp");
      if (e.aura === 118 && e.bp > 0) out.add("heal-recv");
      if ([184, 185, 186].includes(e.aura) && e.bp < 0) out.add("avoid");
      if (e.effect === 10 || e.effect === 136 || e.aura === 8) out.add("heal");
      if (hop < 1 && e.trigger && e.trigger !== "0") visit(e.trigger, hop + 1);
    }
  };
  visit(id, 0);
  if (!out.size) {
    const own = effects.get(id) ?? [];
    if (own.length && own.every((e) => e.aura === 4 || e.effect === 3))
      out.add("scripted");
  }
  return [...out];
}

// ---- what "responded" already credits (crisisDecisionPoints) ---------------
const WALL = new Set(spellIdLists.bigDefensiveSpellIds.map(String));
const EXTERNAL = new Set(spellIdLists.externalDefensiveSpellIds.map(String));
const CONTROL = new Set<string>([...ccSpellIds, ...rootSpellIds]);

await ensureAnalysisData();
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);

let rounds = 0;
let points = 0;
let unresponded = 0;
const bySpell = new Map<
  string,
  {
    points: number;
    unrespondedPoints: number;
    onSelf: number;
    onOther: number;
    players: Set<string>;
    specs: Set<string>;
  }
>();

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
        if (!(p.feasible && p.dangerous)) continue;
        points++;
        if (!p.responded) unresponded++;
        const w0 = p.tMs - RESPONSE_PRE_MS;
        const w1 = p.tMs + RESPONSE_WINDOW_MS;
        const seen = new Set<string>();
        for (const c of (owner.spellCastEvents ?? []) as any[]) {
          if (c.logLine?.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
          if (c.timestamp < w0 || c.timestamp > w1) continue;
          const id = String(c.spellId ?? "");
          if (!id || WALL.has(id) || EXTERNAL.has(id) || CONTROL.has(id))
            continue;
          const dest = String(c.destUnitId ?? "");
          const self = !dest || dest === owner.id || /^0+$/.test(dest);
          const row = bySpell.get(id) ?? {
            points: 0,
            unrespondedPoints: 0,
            onSelf: 0,
            onOther: 0,
            players: new Set<string>(),
            specs: new Set<string>(),
          };
          if (self) row.onSelf++;
          else row.onOther++;
          if (!seen.has(id)) {
            seen.add(id);
            row.points++;
            if (!p.responded) row.unrespondedPoints++;
          }
          row.players.add(owner.name);
          row.specs.add(String(owner.spec));
          bySpell.set(id, row);
        }
      }
    }
  }
}

const list = [...bySpell]
  .map(([id, r]) => ({
    spellId: id,
    name: getEnglishSpellName(id, ""),
    labels: labelsOf(id),
    points: r.points,
    unrespondedPoints: r.unrespondedPoints,
    onSelf: r.onSelf,
    onOther: r.onOther,
    players: r.players.size,
    specs: [...r.specs],
  }))
  .sort((x, y) => y.unrespondedPoints - x.unrespondedPoints);

const PROTECTIVE = new Set([
  "dr",
  "absorb",
  "immune",
  "cc-immune",
  "maxhp",
  "heal-recv",
  "avoid",
]);
const outDir = join(home, "reports/talent-integration-2026-09-13");
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, "crisisResponseCompleteness.json"),
  JSON.stringify(
    { files: files.length, rounds, points, unresponded, list },
    null,
    1,
  ),
);
console.log(
  `files ${files.length} rounds ${rounds} dangerous-feasible points ${points} unresponded ${unresponded}`,
);
console.log("\n== casts with a protective DB2 label ==");
for (const r of list.filter((r) => r.labels.some((l) => PROTECTIVE.has(l))))
  console.log(
    `${String(r.unrespondedPoints).padStart(5)} unresp / ${String(r.points).padStart(5)} pts  self ${String(r.onSelf).padStart(5)} other ${String(r.onOther).padStart(5)}  ${r.spellId.padEnd(8)} ${r.name.padEnd(30)} [${r.labels.join(",")}] specs ${r.specs.join(",")}`,
  );
console.log("\n== top 40 other uncredited casts (heal / scripted / none) ==");
for (const r of list
  .filter((r) => !r.labels.some((l) => PROTECTIVE.has(l)))
  .slice(0, 40))
  console.log(
    `${String(r.unrespondedPoints).padStart(5)} unresp / ${String(r.points).padStart(5)} pts  self ${String(r.onSelf).padStart(5)} other ${String(r.onOther).padStart(5)}  ${r.spellId.padEnd(8)} ${r.name.padEnd(30)} [${r.labels.join(",") || "none"}] specs ${r.specs.join(",")}`,
  );
