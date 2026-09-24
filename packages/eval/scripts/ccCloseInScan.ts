/* eslint-disable no-console */
/**
 * ccCloseInScan.ts — how far a crowd-control caster closes in before the CC
 * lands (GH #83, user 2026-09-23: "距离都可以算进来").
 *
 * `[HEALER EXPOSURE]` asks "which enemy could CC the healer around this
 * window", judged on positions at the window's rendered second with a ±2 s
 * LoS sweep. With per-spell reach (`ccThreatReachYards`: Kidney Shot 5,
 * Psychic Scream 8, Polymorph 30) a rogue 15 yd away would read as "no
 * threat" although it lands the Kidney two seconds later. The allowance for
 * that has to come from the corpus, not from memory: for every CC aura an
 * enemy PLAYER applied to a player, the caster → target distance LEAD_S
 * seconds before it landed, minus the spell's reach, = how far they closed.
 * Split by reach (≤ 12 yd: melee / self-centred; > 12: ranged).
 *
 * The close-in depends on the SPELL, not on the caster's role: every caster
 * runs in for an 8 yd Psychic Scream (Holy Priest p85 9.9 yd), melee casters
 * run in for a 15–20 yd Blind / Paralysis / Imprison (p85 10–12 yd), nobody
 * runs in for a 30 yd Polymorph or Storm Bolt (0). Hence a per-spell table.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/ccCloseInScan.ts --manifest <txt> [--every 40] [--limit 1600] [--lead 2]
 *     [--emit <file.json>]   writes the per-spell p85 table (n ≥ EMIT_MIN_N) the
 *                            product reads as data/ccCloseInGenerated.json —
 *                            write to a temp file, then copy it in
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import { getSortedAdvancedActions } from "@gladlog/analysis/src/utils/advancedActions";
import { binarySearchClosest } from "@gladlog/analysis/src/utils/binarySearch";
import {
  isMeleeSpec,
  specToString,
} from "@gladlog/analysis/src/utils/cooldowns";
import { ccThreatReachYards } from "@gladlog/analysis/src/utils/spellRange";
import { GladLogParser } from "@gladlog/parser";
import {
  LogEvent,
  toLegacyMatch,
  toLegacyShuffle,
} from "@gladlog/parser-compat";
import { readFileSync, writeFileSync } from "fs";
import { gunzipSync } from "zlib";

const argv = process.argv.slice(2);
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const POS_TOL_MS = 500;
/** a spell needs this many landed CCs to get its own close-in */
const EMIT_MIN_N = 100;

function pos(u: any, ms: number): [number, number] | null {
  const s: any = binarySearchClosest(
    getSortedAdvancedActions(u),
    ms,
    (x: any) => x.logLine.timestamp,
  );
  if (!s || s.advancedActorId !== u.id) return null;
  if (Math.abs(s.logLine.timestamp - ms) > POS_TOL_MS) return null;
  return [s.advancedActorPositionX, s.advancedActorPositionY];
}

async function main(): Promise<void> {
  await ensureAnalysisData();
  const every = Number(flag("--every") ?? 40);
  const lead = Number(flag("--lead") ?? 2);
  const files = readFileSync(flag("--manifest")!, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((_, i) => i % every === 0)
    .slice(0, Number(flag("--limit") ?? 1600));
  const closeIn = { melee: [] as number[], ranged: [] as number[] };
  const byCaster = { meleeSpec: [] as number[], rangedSpec: [] as number[] };
  const bySpec = new Map<string, number[]>();
  let noReach = 0;
  const noReachBy = new Map<string, number>();
  const bySpell = new Map<string, number[]>();
  const bySpellId = new Map<string, number[]>();
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
      for (const line of text.split(/\r?\n/)) parser.push(line);
      parser.end();
    } catch {
      continue;
    }
    for (const combat of combats) {
      const players: any[] = Object.values(combat.units ?? {}).filter(
        (u: any) => u.info,
      );
      const byId = new Map(players.map((u) => [u.id, u]));
      for (const target of players) {
        for (const a of (target.auraEvents ?? []) as any[]) {
          if (a.logLine?.event !== LogEvent.SPELL_AURA_APPLIED) continue;
          const sid = String(a.spellId);
          if (!ccSpellIds.has(sid)) continue;
          const caster = byId.get(a.srcUnitId);
          if (!caster || caster.reaction === target.reaction) continue;
          const reach = ccThreatReachYards(caster, sid);
          if (reach === null) {
            noReach++;
            noReachBy.set(sid, (noReachBy.get(sid) ?? 0) + 1);
            continue;
          }
          const p = pos(caster, a.timestamp - lead * 1000);
          const q = pos(target, a.timestamp - lead * 1000);
          if (!p || !q) continue;
          const closed = Math.max(
            0,
            Math.hypot(p[0] - q[0], p[1] - q[1]) - reach,
          );
          (reach <= 12 ? closeIn.melee : closeIn.ranged).push(closed);
          (isMeleeSpec(caster.spec)
            ? byCaster.meleeSpec
            : byCaster.rangedSpec
          ).push(closed);
          const sp = specToString(caster.spec);
          const sl = bySpec.get(sp) ?? [];
          sl.push(closed);
          bySpec.set(sp, sl);
          const idl = bySpellId.get(sid) ?? [];
          idl.push(closed);
          bySpellId.set(sid, idl);
          const k = `${sid} (${reach.toFixed(0)} yd)`;
          const list = bySpell.get(k) ?? [];
          list.push(closed);
          bySpell.set(k, list);
        }
      }
    }
  }
  const q = (xs: number[], p: number) =>
    xs.length
      ? [...xs]
          .sort((a, b) => a - b)
          [Math.min(xs.length - 1, Math.floor(p * xs.length))]!.toFixed(1)
      : "–";
  console.log(
    `files ${files.length} · lead ${lead}s · CC auras with no reach fact: ${noReach}`,
  );
  for (const [k, xs] of Object.entries(closeIn))
    console.log(
      `${k}: n ${xs.length} · closed-in yd p50 ${q(xs, 0.5)} p75 ${q(xs, 0.75)} p85 ${q(xs, 0.85)} p90 ${q(xs, 0.9)} p95 ${q(xs, 0.95)} · already in reach ${((100 * xs.filter((x) => x === 0).length) / Math.max(1, xs.length)).toFixed(1)}%`,
    );
  for (const [k, xs] of Object.entries(byCaster))
    console.log(
      `by caster ${k}: n ${xs.length} · p50 ${q(xs, 0.5)} p85 ${q(xs, 0.85)} p95 ${q(xs, 0.95)}`,
    );
  console.log("by caster spec (n ≥ 150): p50 / p85");
  for (const [k, xs] of [...bySpec].sort((a, b) => b[1].length - a[1].length))
    if (xs.length >= 150)
      console.log(`  ${k}: n ${xs.length} · ${q(xs, 0.5)} / ${q(xs, 0.85)}`);
  console.log(
    `no reach fact, top ids: ${[...noReachBy]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([k, n]) => `${k}×${n}`)
      .join(" ")}`,
  );
  const emit = flag("--emit");
  if (emit) {
    const spells: Record<string, { n: number; p85: number }> = {};
    for (const [id, xs] of bySpellId)
      if (xs.length >= EMIT_MIN_N)
        spells[id] = { n: xs.length, p85: Number(q(xs, 0.85)) };
    writeFileSync(
      emit,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          command: `ccCloseInScan.ts --every ${every} --limit ${files.length} --lead ${lead}`,
          leadSeconds: lead,
          minN: EMIT_MIN_N,
          spells,
        },
        null,
        1,
      ) + "\n",
    );
    console.log(`emitted ${Object.keys(spells).length} spells → ${emit}`);
  }
  console.log("\nper spell (n ≥ 200): p50 / p85 / p95");
  for (const [k, xs] of [...bySpell].sort((a, b) => b[1].length - a[1].length))
    if (xs.length >= 200)
      console.log(
        `  ${k}: n ${xs.length} · ${q(xs, 0.5)} / ${q(xs, 0.85)} / ${q(xs, 0.95)}`,
      );
}
void main();
