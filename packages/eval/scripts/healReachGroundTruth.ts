/* eslint-disable no-console */
/**
 * healReachGroundTruth.ts — checks the reach / line-of-sight model behind the
 * GH #83 [HEAL REACH] probe against the game's own verdict (user go-ahead
 * 2026-09-23, "做1").
 *
 * Ground truth: a healer's SPELL_CAST_SUCCESS on a friendly player means the
 * game accepted range and line of sight at that instant. For every such cast
 * of a spell whose official range is the healer's base heal range, the model
 * (`hasLineOfSight` over arenaGeometry, distance vs the per-spec + talent
 * reach used by healerReachExampleGen.ts) should say "in reach". Every "no
 * LoS" or "out of range" it returns there is a false positive — per map and
 * per spec. It also shows whether the ruled reach is right (Discipline with
 * Phantom Reach should land casts out to 46 yd, not beyond).
 *
 * The opposite direction cannot be measured this way: SPELL_CAST_FAILED
 * ("Target not in line of sight" / "Out of range") carries no destination —
 * 89,109 failed casts on a 211-file slice, 0 with a target GUID.
 *
 * Positions: the caster's from the cast line's own advanced block (nearest
 * sample), the target's from its nearest sample within TARGET_TOL_MS.
 * Distances are between model centres; the game measures to the hitbox edge,
 * so a cast landing 1–2 yd past the nominal range is expected.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/healReachGroundTruth.ts --manifest <txt> [--every 100] [--limit 400]
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { getSortedAdvancedActions } from "@gladlog/analysis/src/utils/advancedActions";
import { binarySearchClosest } from "@gladlog/analysis/src/utils/binarySearch";
import {
  isHealerSpec,
  specToString,
} from "@gladlog/analysis/src/utils/cooldowns";
import { hasLineOfSight } from "@gladlog/analysis/src/utils/losAnalysis";
import { talentModifierOwnershipOf } from "@gladlog/analysis/src/utils/talentOwnership";
import { GladLogParser, splitTopLevel } from "@gladlog/parser";
import {
  LogEvent,
  toLegacyMatch,
  toLegacyShuffle,
} from "@gladlog/parser-compat";
import { readdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { gunzipSync } from "zlib";

const argv = process.argv.slice(2);
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const TARGET_TOL_MS = 500;

/** same probe table as healerReachExampleGen.ts */
const REACH: Record<
  string,
  { base: number; talent?: { id: string; pct?: number; flat?: number } }
> = {
  "Discipline Priest": { base: 40, talent: { id: "459559", pct: 15 } },
  "Holy Priest": { base: 40, talent: { id: "459559", pct: 15 } },
  "Restoration Druid": { base: 40, talent: { id: "197524", flat: 5 } },
  "Preservation Evoker": { base: 30, talent: { id: "454983", flat: 5 } },
  "Restoration Shaman": { base: 40 },
  "Holy Paladin": { base: 40 },
  "Mistweaver Monk": { base: 40 },
};

/** official cast range per spell id from the datagen cache (SpellMisc →
 * SpellRange), newest build present */
function loadSpellRanges(): Map<string, number> {
  const dir = join(homedir(), ".cache/gladlog-datagen");
  const pick = (prefix: string) =>
    readdirSync(dir)
      .filter((f) => f.startsWith(prefix + "-") && f.endsWith(".csv"))
      .sort()
      .at(-1)!;
  const csv = (f: string) => {
    const [head, ...rows] = readFileSync(join(dir, f), "utf8").split("\n");
    const cols = head!.split(",");
    return rows.filter(Boolean).map((r) => {
      // quote-aware: SpellRange carries display names
      const v = splitTopLevel(r);
      return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? ""]));
    });
  };
  const rangeMax = new Map<string, number>();
  for (const r of csv(pick("SpellRange")))
    rangeMax.set(r.ID!, Number(r.RangeMax_1 || r.RangeMax_0));
  const out = new Map<string, number>();
  for (const r of csv(pick("SpellMisc"))) {
    const m = rangeMax.get(r.RangeIndex!);
    if (m !== undefined) out.set(r.SpellID!, m);
  }
  return out;
}

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

async function main(): Promise<void> {
  await ensureAnalysisData();
  const spellRange = loadSpellRanges();
  const every = Number(flag("--every") ?? 100);
  const files = readFileSync(flag("--manifest")!, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((_, i) => i % every === 0)
    .slice(0, Number(flag("--limit") ?? 400));

  type Agg = {
    n: number;
    noLos: number;
    losNull: number;
    out: number;
    beyondPlus2: number;
  };
  const blank = (): Agg => ({
    n: 0,
    noLos: 0,
    losNull: 0,
    out: 0,
    beyondPlus2: 0,
  });
  const bySpec = new Map<string, Agg>();
  const byZone = new Map<string, Agg>();
  const distBySpec = new Map<string, number[]>();
  let casts = 0;

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
      const zoneId = String(combat.startInfo?.zoneId ?? "");
      const players: any[] = Object.values(combat.units ?? {}).filter(
        (u: any) => u.info,
      );
      const byId = new Map(players.map((u) => [u.id, u]));
      for (const healer of players) {
        if (!isHealerSpec(healer.spec)) continue;
        const spec = specToString(healer.spec);
        const rule = REACH[spec] ?? { base: 40 };
        let reach = rule.base;
        if (
          rule.talent &&
          talentModifierOwnershipOf(healer, rule.talent.id) === "yes"
        )
          reach = rule.talent.pct
            ? Math.round(rule.base * (1 + rule.talent.pct / 100))
            : rule.base + (rule.talent.flat ?? 0);
        for (const c of (healer.spellCastEvents ?? []) as any[]) {
          if (c.logLine?.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
          const mate = byId.get(c.destUnitId);
          if (
            !mate ||
            mate.id === healer.id ||
            mate.reaction !== healer.reaction
          )
            continue;
          const r = spellRange.get(String(c.spellId));
          // only spells at the spec's base heal range (evoker: 25 or 30)
          if (r === undefined) continue;
          if (
            spec === "Preservation Evoker"
              ? r !== 25 && r !== 30
              : r !== rule.base
          )
            continue;
          const a = sampleAt(healer, c.timestamp, 50);
          const b = sampleAt(mate, c.timestamp, TARGET_TOL_MS);
          if (!a || !b) continue;
          casts++;
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          const los = hasLineOfSight(zoneId, a, b);
          // range the model would use for THIS spell: its own official range
          // with the talent applied the same way
          const spellReach =
            rule.talent && reach !== rule.base
              ? rule.talent.pct
                ? Math.round(r * (1 + rule.talent.pct / 100))
                : r + (rule.talent.flat ?? 0)
              : r;
          for (const [m, k] of [
            [bySpec, spec],
            [byZone, zoneId],
          ] as const) {
            const g = m.get(k) ?? blank();
            m.set(k, g);
            g.n++;
            if (los === false) g.noLos++;
            if (los === null) g.losNull++;
            if (dist > spellReach) g.out++;
            if (dist > spellReach + 2) g.beyondPlus2++;
          }
          const ds = distBySpec.get(spec) ?? [];
          ds.push(dist);
          distBySpec.set(spec, ds);
        }
      }
    }
  }

  const pct = (a: number, b: number) =>
    b ? ((100 * a) / b).toFixed(2) + "%" : "–";
  console.log(
    `files ${files.length} · successful friendly casts checked ${casts}`,
  );
  const show = (title: string, m: Map<string, Agg>) => {
    console.log(
      `\n${title}: n | model says NO LoS (false positive) | LoS unknown | beyond reach | beyond reach +2yd`,
    );
    for (const [k, g] of [...m].sort((x, y) => y[1].n - x[1].n))
      console.log(
        `  ${k} | ${g.n} | ${g.noLos} (${pct(g.noLos, g.n)}) | ${pct(g.losNull, g.n)} | ${pct(g.out, g.n)} | ${pct(g.beyondPlus2, g.n)}`,
      );
  };
  show("By healer spec", bySpec);
  show("By zone", byZone);
  console.log(
    "\nCast distance at success, by spec (yd): p50 / p90 / p99 / p99.9 / max",
  );
  for (const [s, ds] of distBySpec) {
    ds.sort((a, b) => a - b);
    const q = (p: number) =>
      ds[Math.min(ds.length - 1, Math.floor(p * ds.length))]!.toFixed(1);
    console.log(
      `  ${s}: ${q(0.5)} / ${q(0.9)} / ${q(0.99)} / ${q(0.999)} / ${ds.at(-1)!.toFixed(1)}  (n ${ds.length})`,
    );
  }
}
void main();
