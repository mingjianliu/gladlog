/**
 * offensiveCdGapScan.ts — FORWARD completeness scan for the canonical
 * offensive-cooldown table `OFFENSIVE_CD_SPELL_IDS` (spellDanger.ts): which
 * long-cooldown buttons do DPS players actually press, and which of them
 * lift the presser's damage the way the registered cooldowns do, while being
 * absent from the table? (CLAUDE.md Curated-List Completeness Rule — the
 * pair of `curatedRotScan`, which finds registered entries that are DEAD;
 * this one finds live ones that are UNREGISTERED.)
 *
 * Why it exists (2026-09-18): Storm, Earth, and Fire 137639 was correctly
 * moved to OFFENSIVE_CD_DEAD_IDS, but its successor Zenith 1249625 was never
 * listed — every "the enemy opened a cooldown" consumer was blind to a
 * Windwalker's go, and nothing could have told us. The official ability
 * profile has no "raises own damage" dimension (abilityProfile answers all
 * false for Combustion / Recklessness / Avenging Wrath / Xuen / Zenith), so
 * the list cannot be derived from DB2 alone today; this scan nominates from
 * official SHAPE and measures the EFFECT in the corpus.
 *
 * The definition it measures (user rulings 2026-09-18: "可以做", and
 * "45-60秒的也可能是大招" → the shape floor is 45 s, not 60):
 *   1. shape (official): cooldown — or charge recharge — >= MIN_CD_S;
 *   2. pressed (corpus): SPELL_CAST_SUCCESS by a DPS player; the
 *      casts-vs-self-aura-applications ratio is reported so a proc that
 *      shares the id is visible (Game-Behaviour Rule 6);
 *   3. effect (corpus): LIFT = the presser's damage per second inside
 *      [cast, cast + window] over their damage per second in the rest of
 *      the SAME round, the round ending for that player at their death
 *      (pets / guardians are already folded into the owner by the legacy
 *      converter — do not add them again). A within-player, within-round ratio, so
 *      rating and bracket composition cannot manufacture it. It is a
 *      screening statistic, NOT a causal claim about winning.
 *
 * Known confound, reported not hidden: cooldowns are pressed TOGETHER, so a
 * minor button macro'd into the go inherits the go's lift. `coPressed` is
 * the share of its casts within CO_PRESS_S of a REGISTERED offensive
 * cooldown by the same player; read a high lift with a high coPressed as
 * "rides along", not as "is one". (It is a cast within +-CO_PRESS_S of
 * another registered cast — it does NOT see a burst that was already
 * running for longer than that.) Still uncorrected: time spent in CC
 * outside the windows deflates the outside rate the same way death did.
 *
 * No threshold is baked in: `report` prints the registered cooldowns' own
 * lift distribution as the yardstick and lists every unregistered spell
 * beside it. The cut is a user ruling, to be taken on the printed list.
 *
 *   scan    tsx offensiveCdGapScan.ts scan --manifest <file> --out <cells.json>
 *             [--every N] [--offset N] [--limit N] [--min-rating 2100]
 *   report  tsx offensiveCdGapScan.ts report --in <cells.json> [--min-n 30]
 *             [--min-share 0.05] [--json <out.json>]
 */
import {
  ensureAnalysisData,
  isHealerSpec,
  specToString,
} from "@gladlog/analysis";
import {
  abilityProfile,
  isSurvivalWall,
} from "@gladlog/analysis/src/data/abilityProfile";
import { RACIAL_ABILITIES } from "@gladlog/analysis/src/data/racialAbilities";
import {
  effectiveCooldownSeconds,
  getEnglishSpellName,
  spellEffectData,
} from "@gladlog/analysis/src/data/spellEffectData";
import { PATCH_121_GOLIVE_EPOCH_MS } from "@gladlog/analysis/src/utils/drAnalysis";
import { OFFENSIVE_CD_SPELL_IDS } from "@gladlog/analysis/src/utils/spellDanger";
import { GladLogParser } from "@gladlog/parser";
import {
  CombatUnitReaction,
  LogEvent,
  toLegacyMatch,
  toLegacyShuffle,
} from "@gladlog/parser-compat";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { gunzipSync } from "zlib";

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const num = (f: string, d: number): number => Number(flag(f) ?? d);

/** Shape floor — user ruling 2026-09-18 ("45-60秒的也可能是大招"). */
export const MIN_CD_S = 45;
/** Measurement window when the official duration is missing or implausible
 * for a buff window (instant nukes, 1 s triggers, 60 s stances). */
const DEFAULT_WINDOW_S = 10;
const WINDOW_MIN_S = 4;
const WINDOW_MAX_S = 30;
const CO_PRESS_S = 3;
const MIN_ROUND_S = 45;
/** A round's ratio needs this much time OUTSIDE the windows to be a rate. */
const MIN_OUTSIDE_S = 15;

interface Cell {
  /** rounds (by this spec) in which the spell was pressed */
  rounds: number;
  casts: number;
  /** SPELL_AURA_APPLIED of the same id on the caster, from the caster */
  selfAuras: number;
  coPressed: number;
  /** per-round in/out dps ratios (rounds with a usable outside rate) */
  lifts: number[];
}
interface Cells {
  meta: { files: number; rounds: number; minRating: number; startedAt: string };
  specs: Record<
    string,
    {
      rounds: number;
      byBracket: Record<string, number>;
      spells: Record<string, Cell>;
    }
  >;
}

function cdOf(id: string): number {
  return effectiveCooldownSeconds(id) ?? 0;
}
function windowOf(id: string): number {
  const d = (spellEffectData as Record<string, any>)[id]?.durationSeconds;
  return typeof d === "number" && d >= WINDOW_MIN_S && d <= WINDOW_MAX_S
    ? d
    : DEFAULT_WINDOW_S;
}

async function scan(): Promise<void> {
  const manifest = flag("--manifest");
  const out = flag("--out");
  if (!manifest || !out) {
    console.error(
      "usage: scan --manifest <file> --out <cells.json> [--every N] [--offset N] [--limit N] [--min-rating N]",
    );
    process.exit(1);
  }
  await ensureAnalysisData();
  const minRating = num("--min-rating", 2100);
  let files = readFileSync(manifest, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const every = num("--every", 1);
  const offset = num("--offset", 0);
  const limit = num("--limit", 0);
  if (offset) files = files.slice(offset);
  if (every > 1) files = files.filter((_, i) => i % every === 0);
  if (limit) files = files.slice(0, limit);
  const cells: Cells = {
    meta: {
      files: 0,
      rounds: 0,
      minRating,
      startedAt: new Date().toISOString(),
    },
    specs: {},
  };
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
    cells.meta.files++;
    for (const c of combats) {
      if ((c.startTime ?? 0) < PATCH_121_GOLIVE_EPOCH_MS) continue;
      const t0 = c.startTime as number;
      const t1 = c.endTime as number;
      if (!(t1 - t0 >= MIN_ROUND_S * 1000)) continue;
      cells.meta.rounds++;
      const bracket = String(c.startInfo?.bracket ?? "?");
      const all = Object.values(c.units ?? {}) as any[];
      for (const u of all) {
        if (!u.info || !u.spec || isHealerSpec(u.spec)) continue;
        if (
          u.reaction !== CombatUnitReaction.Friendly &&
          u.reaction !== CombatUnitReaction.Hostile
        )
          continue;
        if ((u.info.personalRating ?? 0) < minRating) continue;
        const spec = specToString(u.spec);
        const s = (cells.specs[spec] ??= {
          rounds: 0,
          byBracket: {},
          spells: {},
        });
        s.rounds++;
        s.byBracket[bracket] = (s.byBracket[bracket] ?? 0) + 1;

        // The presser's damage stream. toLegacyMatch / toLegacyShuffle already
        // fold pet / guardian damage into the owner (convert.ts mergePetEvents,
        // GH #57) — adding the pet rows again double-counted every summon
        // window (codex astra review 2026-09-18: 2.0 reported as 3.0).
        // A dead player deals 0: the round ends, for this unit, at its death,
        // or "outside" fills with zero-dps time and ANY button pressed while
        // alive shows a lift (same review: 2.5x for an inert button).
        const deathTs = (u.deathRecords ?? [])
          .map((d: any) => d.timestamp)
          .filter((t: number) => t > t0)
          .sort((x: number, y: number) => x - y)[0];
        const uEnd = Math.min(t1, deathTs ?? t1);
        const dmg: Array<[number, number]> = [];
        for (const d of u.damageOut ?? []) {
          const ts = d.timestamp ?? d.logLine?.timestamp;
          if (ts <= uEnd)
            dmg.push([ts, Math.abs(d.effectiveAmount ?? d.amount ?? 0)]);
        }
        const total = dmg.reduce((a, d) => a + d[1], 0);

        const castsBySpell = new Map<string, number[]>();
        const registeredCasts: Array<[number, string]> = [];
        for (const e of u.spellCastEvents ?? []) {
          if (e.logLine?.event !== LogEvent.SPELL_CAST_SUCCESS || !e.spellId)
            continue;
          const id = String(e.spellId);
          if (OFFENSIVE_CD_SPELL_IDS.has(id))
            registeredCasts.push([e.timestamp, id]);
          if (cdOf(id) < MIN_CD_S) continue;
          (castsBySpell.get(id) ?? castsBySpell.set(id, []).get(id)!).push(
            e.timestamp,
          );
        }
        const selfAura = new Map<string, number>();
        for (const a of u.auraEvents ?? []) {
          if (
            a.logLine?.event !== LogEvent.SPELL_AURA_APPLIED ||
            a.srcUnitId !== u.id
          )
            continue;
          const id = String(a.spellId);
          if (castsBySpell.has(id))
            selfAura.set(id, (selfAura.get(id) ?? 0) + 1);
        }
        for (const [id, ts] of castsBySpell) {
          const cell = (s.spells[id] ??= {
            rounds: 0,
            casts: 0,
            selfAuras: 0,
            coPressed: 0,
            lifts: [],
          });
          cell.rounds++;
          cell.casts += ts.length;
          cell.selfAuras += selfAura.get(id) ?? 0;
          for (const t of ts)
            if (
              registeredCasts.some(
                ([r, rid]) =>
                  rid !== id && Math.abs(r - t) <= CO_PRESS_S * 1000,
              )
            )
              cell.coPressed++;
          // union of the windows, clipped to the round
          const w = windowOf(id) * 1000;
          const iv = ts
            .map(
              (t) =>
                [Math.max(t, t0), Math.min(t + w, uEnd)] as [number, number],
            )
            .filter((x) => x[1] > x[0])
            .sort((a, b) => a[0] - b[0]);
          const merged: Array<[number, number]> = [];
          for (const x of iv) {
            const last = merged[merged.length - 1];
            if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]);
            else merged.push([x[0], x[1]]);
          }
          const inS = merged.reduce((a, x) => a + (x[1] - x[0]), 0) / 1000;
          const outS = (uEnd - t0) / 1000 - inS;
          if (inS < 1 || outS < MIN_OUTSIDE_S) continue;
          const inDmg = dmg.reduce(
            (a, d) =>
              a + (merged.some((x) => d[0] >= x[0] && d[0] <= x[1]) ? d[1] : 0),
            0,
          );
          const outRate = (total - inDmg) / outS;
          if (!(outRate > 0)) continue;
          cell.lifts.push(Math.round((inDmg / inS / outRate) * 100) / 100);
        }
      }
    }
    if (cells.meta.files % 100 === 0)
      console.error(
        `scanned ${cells.meta.files} files, ${cells.meta.rounds} rounds`,
      );
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(cells) + "\n");
  console.error(
    `done: ${cells.meta.files} files, ${cells.meta.rounds} rounds → ${out}`,
  );
}

/** "Havoc Demon Hunter" and "Beast Mastery Hunter" must not both be "Hunter"
 * (codex astra review 2026-09-18) — match the two-word classes first. */
function classOfSpec(spec: string): string {
  for (const c of ["Death Knight", "Demon Hunter"])
    if (spec.endsWith(c)) return c;
  return spec.split(" ").slice(-1)[0]!;
}

const q = (xs: number[], p: number): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
};

interface Row {
  spec: string;
  spellId: string;
  name: string;
  cd: number;
  windowS: number;
  share: number;
  n: number;
  liftP25: number;
  liftP50: number;
  castsPerAura: number | null;
  coPressed: number;
  registered: boolean;
  note: string;
}

async function report(): Promise<void> {
  const inPath = flag("--in");
  if (!inPath) {
    console.error(
      "usage: report --in <cells.json> [--min-n 30] [--min-share 0.05] [--json <out.json>]",
    );
    process.exit(1);
  }
  await ensureAnalysisData();
  const minN = num("--min-n", 30);
  const minShare = num("--min-share", 0.05);
  const cells = JSON.parse(readFileSync(inPath, "utf8")) as Cells;

  // "pressed by more than one class" = item / racial, not the class kit
  // (same corpus rule as healerSaveCdScan's multiClassSpells)
  const classesBySpell = new Map<string, Set<string>>();
  for (const [spec, s] of Object.entries(cells.specs)) {
    const cls = classOfSpec(spec);
    for (const id of Object.keys(s.spells))
      (
        classesBySpell.get(id) ?? classesBySpell.set(id, new Set()).get(id)!
      ).add(cls);
  }

  const rows: Row[] = [];
  for (const [spec, s] of Object.entries(cells.specs).sort()) {
    for (const [id, c] of Object.entries(s.spells)) {
      const share = c.rounds / s.rounds;
      const registered = OFFENSIVE_CD_SPELL_IDS.has(id);
      if (!registered && (share < minShare || c.lifts.length < minN)) continue;
      if (registered && c.lifts.length < minN) continue;
      const p = abilityProfile(id);
      const notes: string[] = [];
      if (isSurvivalWall(id) || p.mitigationPct || p.absorbs || p.immuneSchools)
        notes.push("defensive-profile");
      if (p.healsSelf || p.healsOthers) notes.push("heal-profile");
      if (p.moveSpeedPct) notes.push("mobility-profile");
      if (p.dealsDamage || p.hitsEnemy) notes.push("hits-enemy");
      if (Object.prototype.hasOwnProperty.call(RACIAL_ABILITIES, id))
        notes.push("racial");
      else if ((classesBySpell.get(id)?.size ?? 0) > 1)
        notes.push("multi-class(item?)");
      const eff = (spellEffectData as Record<string, any>)[id];
      rows.push({
        spec,
        spellId: id,
        name: getEnglishSpellName(id, eff?.name ?? id),
        cd: cdOf(id),
        windowS: windowOf(id),
        share: Math.round(share * 1000) / 1000,
        n: c.lifts.length,
        liftP25: q(c.lifts, 0.25),
        liftP50: q(c.lifts, 0.5),
        castsPerAura: c.selfAuras
          ? Math.round((c.casts / c.selfAuras) * 100) / 100
          : null,
        coPressed: Math.round((c.coPressed / c.casts) * 100) / 100,
        registered,
        note: notes.join(","),
      });
    }
  }
  const reg = rows.filter((r) => r.registered);
  const regLifts = reg.map((r) => r.liftP50);
  console.log(
    `# offensiveCdGapScan — ${cells.meta.files} files, ${cells.meta.rounds} rounds, rating >= ${cells.meta.minRating}, cd >= ${MIN_CD_S}s`,
  );
  console.log(
    `\n## Yardstick — REGISTERED cooldowns' median lift, per (spec, spell), n >= ${minN}: ${reg.length} cells`,
  );
  console.log(
    `p10 ${q(regLifts, 0.1)} · p25 ${q(regLifts, 0.25)} · p50 ${q(regLifts, 0.5)} · p75 ${q(regLifts, 0.75)} · p90 ${q(regLifts, 0.9)}`,
  );
  const fmt = (r: Row) =>
    `| ${r.spec} | ${r.name} | ${r.spellId} | ${r.cd} | ${r.windowS} | ${(r.share * 100).toFixed(1)}% | ${r.n} | ${r.liftP25} | **${r.liftP50}** | ${r.castsPerAura ?? "—"} | ${r.coPressed} | ${r.note} |`;
  const head =
    "| spec | spell | id | cd | win | share | n | lift p25 | lift p50 | casts/aura | coPressed | profile |\n|---|---|---|---|---|---|---|---|---|---|---|---|";
  console.log(`\n### registered\n${head}`);
  for (const r of reg.sort(
    (a, b) => a.spec.localeCompare(b.spec) || b.liftP50 - a.liftP50,
  ))
    console.log(fmt(r));
  console.log(
    `\n## GAP — unregistered, share >= ${minShare * 100}%, n >= ${minN}, sorted by median lift\n${head}`,
  );
  for (const r of rows
    .filter((x) => !x.registered)
    .sort((a, b) => b.liftP50 - a.liftP50))
    console.log(fmt(r));
  const json = flag("--json");
  if (json)
    writeFileSync(
      json,
      JSON.stringify({ meta: cells.meta, rows }, null, 1) + "\n",
    );
}

if (cmd === "scan") void scan();
else if (cmd === "report") void report();
else {
  console.error("usage: offensiveCdGapScan.ts scan|report …");
  process.exit(1);
}
