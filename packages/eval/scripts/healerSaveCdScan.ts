/**
 * healerSaveCdScan.ts — generate the healer SAVE-cooldown roster from official
 * data + the corpus instead of the hand-written class catalog (GH #63,
 * user ruling 2026-09-04: "先把这些数据上的问题补上").
 *
 * Why: `extractMajorCooldowns` only tracks spells that `classSpells.ts`
 * lists by hand, and `isSpendableDefensiveCd` only counts the ones tagged
 * Defensive there (plus a name regex). Measured against the 2026-08-23
 * healer study, 23 of the 53 save cooldowns healers actually press were not
 * in the catalog at all (Healing Tide Totem, Lay on Hands, Revival, Chi-Ji,
 * Rewind, Emerald Communion, …) — so cd-hoarded and [CD PRIOR] were blind to
 * them (CLAUDE.md Curated-List Completeness Rule, same shape as the 2026-08-17
 * dispel gap).
 *
 *   scan        tsx healerSaveCdScan.ts scan --manifest <file> --out <counts.json>
 *                 [--every N] [--offset N] [--limit N]
 *                 # per healer spec: rounds, and per spell the rounds that
 *                 # pressed it + casts (SPELL_CAST_SUCCESS, both sides)
 *   emit-table  tsx healerSaveCdScan.ts emit-table --in <counts.json>
 *                 --out packages/analysis/src/data/healerSaveCdGenerated.json
 *                 # roster = pressed by >= HEALER_SAVE_CD_MIN_SHARE of the spec's
 *                 # rounds × official cooldown >= MIN_CD_SECONDS × official
 *                 # ability profile says it can save (ally or self). Also
 *                 # writes the REJECTED-BY-PROFILE list (high share, long
 *                 # cooldown, profile silent) — that list is for a ruling,
 *                 # e.g. instant-cast empowers (Nature's Swiftness) whose
 *                 # official face is a haste/cast-time aura, not a heal.
 *
 * emit-table writes temp-then-cp; the --out may be the imported json.
 */
import { ensureAnalysisData, isHealerSpec, specToString } from "@gladlog/analysis";
import { abilityProfile } from "@gladlog/analysis/src/data/abilityProfile";
import { CURATED_ABILITY_FACTS } from "@gladlog/analysis/src/data/curatedAbilityFacts";
import { getEnglishSpellName, spellEffectData } from "@gladlog/analysis/src/data/spellEffectData";
import { MIN_CD_SECONDS, TEAM_HEAL_CD_IDS } from "@gladlog/analysis/src/utils/cooldowns";
import { PATCH_121_GOLIVE_EPOCH_MS } from "@gladlog/analysis/src/utils/drAnalysis";
import { GladLogParser } from "@gladlog/parser";
import {
  CombatUnitReaction,
  LogEvent,
  toLegacyMatch,
  toLegacyShuffle,
} from "@gladlog/parser-compat";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";
import { gunzipSync } from "zlib";

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const num = (f: string, d: number): number => Number(flag(f) ?? d);

/** A spell enters the roster only if at least this share of the spec's
 * rounds pressed it — filters one-off casts (a swapped PvP talent, a
 * mis-attributed pet) without a hand list. 2% ≈ "one in fifty rounds";
 * the study's least-used save CD (Restoral, Mistweaver) sits at 7%. */
export const HEALER_SAVE_CD_MIN_SHARE = 0.02;
/** Rejected-by-profile spells are listed for review from this share up. */
const REVIEW_MIN_SHARE = 0.05;

/**
 * The user-ruled DOOR (2026-09-04, GH #63): measured by saveCdImpactScan.ts
 * per (spec, spell) — protection delivered to the lowest friendly in the 5 s
 * after the press minus the same at control moments (`Δ`, pp of max HP), and
 * the death-within-10 s contrast (control − press, pp). A spell enters the
 * roster when n ≥ SAVE_CD_DOOR_MIN_N and (Δ ≥ SAVE_CD_DOOR_MIN_DELTA_PP or
 * contrast ≥ SAVE_CD_DOOR_MIN_DEATH_CONTRAST_PP). Applied only when
 * `--impact <rows.jsonl>` is given; without it the table is profile-only and
 * says so in meta.
 */
export const SAVE_CD_DOOR_MIN_N = 100;
export const SAVE_CD_DOOR_MIN_DELTA_PP = 10;
export const SAVE_CD_DOOR_MIN_DEATH_CONTRAST_PP = 5;

const SAVE_ROLE_IDS = new Set(
  CURATED_ABILITY_FACTS.filter((f) => f.kind === "save_role").map((f) => f.id),
);
const NOT_SAVE_ROLE_IDS = new Set(
  CURATED_ABILITY_FACTS.filter((f) => f.kind === "not_save_role").map((f) => f.id),
);

interface ImpactCell {
  n: number;
  deltaPp: number;
  deathContrastPp: number;
}
const med = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) : NaN;
};
function loadImpact(path: string): Map<string, ImpactCell> {
  const groups = new Map<string, any[]>();
  for (const l of readFileSync(path, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try {
      const r = JSON.parse(l);
      const k = `${r.spec}|${r.spellId}`;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
    } catch {
      /* torn */
    }
  }
  const out = new Map<string, ImpactCell>();
  for (const [k, g] of groups) {
    const withCtrl = g.filter((r) => r.control);
    const press = med(g.map((r) => r.press.protectionPct));
    const ctrl = med(withCtrl.map((r) => r.control.protectionPct));
    const died = g.filter((r) => r.press.died10).length / g.length;
    const diedC = withCtrl.length ? withCtrl.reduce((a, r) => a + r.control.died10, 0) / withCtrl.length : NaN;
    out.set(k, { n: g.length, deltaPp: press - ctrl, deathContrastPp: 100 * (diedC - died) });
  }
  return out;
}
function clearsDoor(c: ImpactCell | undefined): boolean {
  return (
    !!c &&
    c.n >= SAVE_CD_DOOR_MIN_N &&
    (c.deltaPp >= SAVE_CD_DOOR_MIN_DELTA_PP ||
      c.deathContrastPp >= SAVE_CD_DOOR_MIN_DEATH_CONTRAST_PP)
  );
}

interface Counts {
  meta: { files: number; startedAt: string };
  specs: Record<
    string,
    { rounds: number; spells: Record<string, { rounds: number; casts: number }> }
  >;
}

function scan(): void {
  const manifest = flag("--manifest");
  const out = flag("--out");
  if (!manifest || !out) {
    console.error("usage: scan --manifest <file> --out <counts.json> [--every N] [--offset N] [--limit N]");
    process.exit(1);
  }
  let files = readFileSync(manifest, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  const every = num("--every", 1);
  const offset = num("--offset", 0);
  const limit = num("--limit", 0);
  if (offset) files = files.slice(offset);
  if (every > 1) files = files.filter((_, i) => i % every === 0);
  if (limit) files = files.slice(0, limit);
  const counts: Counts = { meta: { files: 0, startedAt: new Date().toISOString() }, specs: {} };
  for (const path of files) {
    let text: string;
    try {
      const raw = readFileSync(path);
      text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
    } catch {
      continue;
    }
    const combats: any[] = [];
    try {
      const parser = new GladLogParser();
      parser.on("match", (m: any) => combats.push(toLegacyMatch(m)));
      parser.on("shuffle", (sh: any) => {
        for (const r of toLegacyShuffle(sh).rounds ?? []) combats.push(r);
      });
      for (const line of text.split("\n")) parser.push(line);
      parser.end();
    } catch {
      continue;
    }
    counts.meta.files++;
    for (const c of combats) {
      if ((c.startTime ?? 0) < PATCH_121_GOLIVE_EPOCH_MS) continue;
      for (const u of Object.values(c.units ?? {}) as any[]) {
        if (!u.info || !isHealerSpec(u.spec)) continue;
        if (u.reaction !== CombatUnitReaction.Friendly && u.reaction !== CombatUnitReaction.Hostile) continue;
        const spec = specToString(u.spec);
        const s = (counts.specs[spec] ??= { rounds: 0, spells: {} });
        s.rounds++;
        const seen = new Set<string>();
        for (const e of u.spellCastEvents ?? []) {
          if (e.logLine?.event !== LogEvent.SPELL_CAST_SUCCESS || !e.spellId) continue;
          const sp = (s.spells[e.spellId] ??= { rounds: 0, casts: 0 });
          sp.casts++;
          if (!seen.has(e.spellId)) {
            seen.add(e.spellId);
            sp.rounds++;
          }
        }
      }
    }
    if (counts.meta.files % 200 === 0) console.error(`scanned ${counts.meta.files} files`);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(counts, null, 1) + "\n");
  console.error(`done: ${counts.meta.files} files → ${out}`);
}

export interface HealerSaveCdEntry {
  spellId: string;
  name: string;
  cooldownSeconds: number;
  share: number;
  rounds: number;
  casts: number;
  savesAlly: boolean;
  savesSelf: boolean;
  why: string[];
}

async function emitTable(): Promise<void> {
  const inPath = flag("--in");
  const outPath = flag("--out");
  if (!inPath || !outPath) {
    console.error("usage: emit-table --in <counts.json> --out <file.json>");
    process.exit(1);
  }
  await ensureAnalysisData();
  const counts = JSON.parse(readFileSync(inPath, "utf8")) as Counts;
  const impactPath = flag("--impact");
  const impact = impactPath ? loadImpact(impactPath) : null;
  const specs: Record<string, { rounds: number; spells: HealerSaveCdEntry[]; stripDefensive: string[] }> = {};
  const rejected: Record<string, Array<{ spellId: string; name: string; cooldownSeconds: number; share: number; reason: string }>> = {};
  for (const [spec, s] of Object.entries(counts.specs).sort()) {
    const roster: HealerSaveCdEntry[] = [];
    const rej: (typeof rejected)[string] = [];
    // Ids the injector must DE-tag if the hand catalog / name regex calls them
    // Defensive: (1) user-ruled out, (2) profile-ineligible (CC relief,
    // mobility — never a save), (3) MEASURED below the door (n >= door min).
    // Unmeasured-but-eligible spells (Power Word: Barrier, n < 100) keep
    // whatever the catalog says: only evidence overrides the hand list.
    const strip = new Set<string>();
    for (const [id, sp] of Object.entries(s.spells)) {
      const share = sp.rounds / s.rounds;
      if (share < HEALER_SAVE_CD_MIN_SHARE) continue;
      const eff = (spellEffectData as Record<string, any>)[id];
      const cd = eff?.cooldownSeconds ?? eff?.charges?.chargeCooldownSeconds ?? 0;
      const name = getEnglishSpellName(id, eff?.name ?? id);
      if (cd < MIN_CD_SECONDS) continue;
      const p = abilityProfile(id);
      const why: string[] = [];
      // Immunity counts only when it is to DAMAGE schools (Divine Shield 127,
      // Blessing of Protection 1, Spellwarding 126). Mechanic-only immunity
      // (stun/root/…) is CC relief — Gladiator's Medallion, Will of the
      // Forsaken, Spirit Walk — not a save.
      const immune = !!p.immuneSchools;
      const allyEffect =
        (p.mitigationPct ? ["mitigation"] : [])
          .concat(p.absorbs ? ["absorb"] : [])
          .concat(p.healsOthers ? ["heals-others"] : [])
          .concat(p.healingReceivedPct ? ["healing-received"] : [])
          .concat(immune ? ["immunity"] : []);
      // Layer 2 of canHelpAnotherUnit: team-heal cooldowns whose healing is
      // cast by a summoned unit (Healing Tide Totem, Chi-Ji) have a silent
      // official profile; the registered TEAM_HEAL_CD_IDS list is the floor.
      if (TEAM_HEAL_CD_IDS.has(id) && !allyEffect.includes("heals-others"))
        allyEffect.push("team-heal (registered)");
      const savesAlly =
        (p.reachesAlly && allyEffect.length > 0) || TEAM_HEAL_CD_IDS.has(id);
      const selfEffect = (p.mitigationPct ? ["mitigation"] : [])
        .concat(p.absorbs ? ["absorb"] : [])
        .concat(immune ? ["immunity"] : [])
        .concat(p.healsSelf ? ["self-heal"] : []);
      const savesSelf = !p.reachesAlly && selfEffect.length > 0;
      if (savesAlly) why.push(`ally: ${allyEffect.join("+")}`);
      if (savesSelf) why.push(`self: ${selfEffect.join("+")}`);
      if (p.throughputRole) why.push("throughput-role (user-signed save)");
      if (SAVE_ROLE_IDS.has(id)) why.push("save-role (user-signed, 2026-09-04)");
      const eligible = savesAlly || savesSelf || p.throughputRole || SAVE_ROLE_IDS.has(id);
      const cell = impact?.get(`${spec}|${id}`);
      if (impact && eligible) {
        if (cell) why.push(`door: n=${cell.n} Δ${cell.deltaPp.toFixed(1)}pp death-contrast ${cell.deathContrastPp.toFixed(1)}pp`);
        else why.push("door: no impact rows");
      }
      const entry: HealerSaveCdEntry = {
        spellId: id,
        name,
        cooldownSeconds: cd,
        share: Math.round(share * 1000) / 1000,
        rounds: sp.rounds,
        casts: sp.casts,
        savesAlly,
        savesSelf,
        why,
      };
      if (NOT_SAVE_ROLE_IDS.has(id)) {
        rej.push({ spellId: id, name, cooldownSeconds: cd, share: entry.share, reason: "user-ruled not a save tool (not_save_role, 2026-09-04)" });
        strip.add(id);
        continue;
      }
      // A user-signed save_role is a ruling, not a measurement — it enters
      // regardless of the door (Nature's Swiftness (Druid) Δ +2 was signed in
      // on 2026-09-04 with that number on the table).
      if (SAVE_ROLE_IDS.has(id) || (eligible && (!impact || clearsDoor(cell)))) roster.push(entry);
      else if (eligible && impact) {
        rej.push({ spellId: id, name, cooldownSeconds: cd, share: entry.share, reason: cell ? `below the door: n=${cell.n} Δ${cell.deltaPp.toFixed(1)}pp death-contrast ${cell.deathContrastPp.toFixed(1)}pp` : "no impact rows (n < door)" });
        if (cell && cell.n >= SAVE_CD_DOOR_MIN_N) strip.add(id); // measured negative
      } else if (!eligible) strip.add(id); // profile says never a save (CC relief, mobility)
      if (!eligible && share >= REVIEW_MIN_SHARE)
        rej.push({
          spellId: id,
          name,
          cooldownSeconds: cd,
          share: entry.share,
          reason: `official profile silent (reachesAlly=${p.reachesAlly}, hitsEnemy=${p.hitsEnemy}, dealsDamage=${p.dealsDamage}, moveSpeed=${p.moveSpeedPct ?? "-"})`,
        });
    }
    roster.sort((a, b) => b.share - a.share);
    rej.sort((a, b) => b.share - a.share);
    specs[spec] = { rounds: s.rounds, spells: roster, stripDefensive: [...strip].sort() };
    rejected[spec] = rej;
  }
  const table = {
    meta: {
      generatedAt: new Date().toISOString().slice(0, 10),
      corpus: `${counts.meta.files} archived files (12.1+ rounds only)`,
      command: "npx tsx packages/eval/scripts/healerSaveCdScan.ts emit-table --in <counts.json> --out <file.json>",
      minShare: HEALER_SAVE_CD_MIN_SHARE,
      minCooldownSeconds: MIN_CD_SECONDS,
      criterion:
        "pressed in >= minShare of the spec's rounds AND official cooldown >= minCooldownSeconds AND (official ability profile can save (ally: mitigation/absorb/heals-others/healing-received/damage-school immunity via official targeting; self: mitigation/absorb/immunity/self-heal) OR user-signed throughput_role/save_role) AND NOT user-signed not_save_role" +
        (impact
          ? ` AND the impact door: n >= ${SAVE_CD_DOOR_MIN_N} and (Δ >= ${SAVE_CD_DOOR_MIN_DELTA_PP} pp or death-contrast >= ${SAVE_CD_DOOR_MIN_DEATH_CONTRAST_PP} pp)`
          : " (NO impact door applied — profile-only table)"),
      impact: impactPath ? basename(impactPath) : null,
    },
    specs,
    rejectedForReview: rejected,
  };
  const tmp = join(dirname(outPath), `.${basename(outPath)}.tmp`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(tmp, JSON.stringify(table, null, 2) + "\n");
  copyFileSync(tmp, outPath);
  rmSync(tmp, { force: true });
  for (const [spec, s] of Object.entries(specs)) {
    console.log(`== ${spec} (${s.rounds} rounds): ${s.spells.length} roster spells`);
    for (const e of s.spells) console.log(`   ${e.name} (${e.spellId}) cd=${e.cooldownSeconds}s share=${(e.share * 100).toFixed(0)}% — ${e.why.join("; ")}`);
    const r = rejected[spec] ?? [];
    if (r.length) console.log(`   rejected for review (${r.length}): ` + r.map((x) => `${x.name} (${x.spellId}) cd=${x.cooldownSeconds}s ${(x.share * 100).toFixed(0)}%`).join(", "));
  }
}

(cmd === "scan" ? Promise.resolve(scan()) : cmd === "emit-table" ? emitTable() : Promise.reject(new Error("usage: scan | emit-table"))).catch((e) => {
  console.error(e);
  process.exit(1);
});
