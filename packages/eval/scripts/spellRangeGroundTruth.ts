/* eslint-disable no-console */
/**
 * spellRangeGroundTruth.ts — every targeted cast's range model against the
 * game's own verdict (range audit, user 2026-09-26 "做更全面射程审查").
 *
 * Ground truth: a SPELL_CAST_SUCCESS with a player destination means the game
 * accepted the range at that instant. For every such cast the model's range
 * (`spellRangeForCaster`: the DB2 range row plus the caster's range talents)
 * must be at least the caster → target distance, give or take hitbox and
 * sampling error. healReachGroundTruth.ts does this for seven healer heal
 * ranges; this does it for every spell the table knows, per spell and spec.
 *
 * Flags (per spell × spec, n ≥ --min-n):
 *   SHORT        ≥ --short-share of casts land more than --slack yd past the
 *                model — the model is too short (a missing range talent or
 *                spec passive, a wrong range row): a "could not reach" claim
 *                built on it is false.
 *   LONG         the model exceeds the observed p99 by ≥ --long-gap yd with
 *                n ≥ --long-min-n — possibly too long (a "could reach" claim
 *                would be optimistic). Weak evidence: players rarely use full
 *                range, so this lists candidates, it does not convict.
 *   PLACEHOLDER  the model is ≥ 100 yd (DB2's vision-range row / unlimited):
 *                the row is not a cast range; the observed p99 is printed
 *                instead.
 * Distances are between model centres; the game measures to the hitbox edge
 * and the target sample can be up to TARGET_TOL_MS away, so a few yards past
 * the nominal range is expected (default --slack 5).
 *
 * Only a lower bound on the TRUE range is observable: SPELL_CAST_FAILED
 * ("Out of range") carries no destination (see healReachGroundTruth.ts).
 * Area reach (range + radius) is not checked — a placed area has no unit
 * destination.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/spellRangeGroundTruth.ts --manifest <txt>
 *     [--every 20] [--limit 1000] [--min-n 30] [--slack 5]
 *     [--short-share 0.02] [--long-gap 10] [--long-min-n 200]
 *     [--spells 433895,375576] [--out <json>]
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { getSortedAdvancedActions } from "@gladlog/analysis/src/utils/advancedActions";
import { binarySearchClosest } from "@gladlog/analysis/src/utils/binarySearch";
import { specToString } from "@gladlog/analysis/src/utils/cooldowns";
import { spellRangeForCaster } from "@gladlog/analysis/src/utils/spellRange";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
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
const num = (f: string, d: number) => Number(flag(f) ?? d);
const TARGET_TOL_MS = 500;
const CASTER_TOL_MS = 50;
const PLACEHOLDER_YD = 100;

function sampleAt(u: any, ms: number, tol: number) {
  const s: any = binarySearchClosest(
    getSortedAdvancedActions(u),
    ms,
    (a: any) => a.logLine.timestamp,
  );
  if (!s || s.advancedActorId !== u.id) return null;
  if (Math.abs(s.logLine.timestamp - ms) > tol) return null;
  return { x: s.advancedActorPositionX, y: s.advancedActorPositionY };
}

const q = (sorted: number[], p: number) =>
  sorted.length === 0
    ? NaN
    : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
const r1 = (x: number) => Math.round(x * 10) / 10;

async function main(): Promise<void> {
  await ensureAnalysisData();
  const every = num("--every", 20);
  const minN = num("--min-n", 30);
  const slack = num("--slack", 5);
  const shortShare = num("--short-share", 0.02);
  const longGap = num("--long-gap", 10);
  const longMinN = num("--long-min-n", 200);
  const focus = new Set((flag("--spells") ?? "").split(",").filter(Boolean));
  const files = readFileSync(flag("--manifest")!, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((_, i) => i % every === 0)
    .slice(0, num("--limit", 1000));

  type Agg = { dist: number[]; model: number[]; beyond: number };
  const agg = new Map<string, Agg>();
  const names = new Map<string, string>();
  let casts = 0;
  let scanned = 0;

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
    scanned++;
    for (const combat of combats) {
      const players: any[] = Object.values(combat.units ?? {}).filter(
        (u: any) => u.info,
      );
      const byId = new Map(players.map((u) => [u.id, u]));
      for (const caster of players) {
        const spec = specToString(caster.spec);
        for (const c of (caster.spellCastEvents ?? []) as any[]) {
          if (c.logLine?.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
          const target = byId.get(c.destUnitId);
          if (!target || target.id === caster.id) continue;
          const spellId = String(c.spellId);
          const model = spellRangeForCaster(caster, spellId);
          if (model === null) continue;
          const a = sampleAt(caster, c.logLine.timestamp, CASTER_TOL_MS);
          const b = sampleAt(target, c.logLine.timestamp, TARGET_TOL_MS);
          if (!a || !b) continue;
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          const key = `${spellId}\u0000${spec}`;
          const g = agg.get(key) ?? { dist: [], model: [], beyond: 0 };
          g.dist.push(dist);
          g.model.push(model);
          if (model < PLACEHOLDER_YD && dist > model + slack) g.beyond++;
          agg.set(key, g);
          if (!names.has(spellId))
            names.set(spellId, getEnglishSpellName(spellId, c.spellName));
          casts++;
        }
      }
    }
    if (scanned % 100 === 0)
      console.error(`… ${scanned} files, ${casts} casts, ${agg.size} keys`);
  }

  type Row = {
    spellId: string;
    name: string;
    spec: string;
    n: number;
    model: number;
    p50: number;
    p99: number;
    max: number;
    beyondShare: number;
    flags: string[];
  };
  const rows: Row[] = [];
  for (const [key, g] of agg) {
    const [spellId, spec] = key.split("\u0000") as [string, string];
    if (g.dist.length < minN && !focus.has(spellId)) continue;
    const d = [...g.dist].sort((x, y) => x - y);
    const m = [...g.model].sort((x, y) => x - y);
    const model = q(m, 0.5);
    const p99 = q(d, 0.99);
    const beyondShare = g.beyond / g.dist.length;
    const flags: string[] = [];
    if (model >= PLACEHOLDER_YD) flags.push("PLACEHOLDER");
    else {
      if (beyondShare >= shortShare) flags.push("SHORT");
      if (g.dist.length >= longMinN && model - p99 >= longGap)
        flags.push("LONG");
    }
    rows.push({
      spellId,
      name: names.get(spellId) ?? spellId,
      spec,
      n: g.dist.length,
      model: r1(model),
      p50: r1(q(d, 0.5)),
      p99: r1(p99),
      max: r1(d[d.length - 1]!),
      beyondShare: Math.round(beyondShare * 1000) / 1000,
      flags,
    });
  }
  rows.sort((x, y) => y.n - x.n);
  const print = (r: Row) =>
    console.log(
      `${r.spellId.padEnd(8)} ${r.name.slice(0, 26).padEnd(26)} ${r.spec.slice(0, 22).padEnd(22)} n=${String(r.n).padStart(6)} model=${String(r.model).padStart(6)} p50=${String(r.p50).padStart(5)} p99=${String(r.p99).padStart(5)} max=${String(r.max).padStart(6)} beyond+${slack}=${(r.beyondShare * 100).toFixed(1)}% ${r.flags.join(",")}`,
    );
  console.log(
    `files ${scanned}/${files.length}, targeted casts measured ${casts}, spell×spec keys ${agg.size}, reported (n ≥ ${minN}) ${rows.length}`,
  );
  for (const f of ["SHORT", "PLACEHOLDER", "LONG"]) {
    const hit = rows.filter((r) => r.flags.includes(f));
    console.log(`\n== ${f}: ${hit.length}`);
    hit.forEach(print);
  }
  if (focus.size) {
    console.log(`\n== focus`);
    rows.filter((r) => focus.has(r.spellId)).forEach(print);
  }
  const out = flag("--out");
  if (out) writeFileSync(out, JSON.stringify({ slack, rows }, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
