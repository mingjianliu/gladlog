/* eslint-disable no-console */
/**
 * healerReachExampleGen.ts — value-gate example generator for GH #83 (owner ↔
 * ally geometry, first slice: "a teammate was in crisis while out of the
 * healer's reach or line of sight"). User go-ahead 2026-09-23 for the value
 * gate only: examples + firing rates, nothing wired.
 *
 * Decision points are the product's own `teammateCrisisPoints` (the GH #95
 * predicate: a teammate crossing the crisis line, per healer), which already
 * records healer → teammate distance and, since this change, line of sight
 * for every point (`losClear`). Nothing here re-derives a crisis or a reach
 * rule; the only local helper is the position lookup for the "N s earlier"
 * trend, through the shared `binarySearchClosest`.
 *
 * Renders the target fact line three ways — the healer's own view, the
 * endangered teammate's view, a third teammate's view — with the teammate's
 * [STATE]-grid HP around the moment and, for the reader only, whether they
 * died within 10 s. No model calls.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/healerReachExampleGen.ts --manifest <txt> [--offset 0] [--limit 300]
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  TEAMMATE_CRISIS_REACH_YARDS,
  teammateCrisisPoints,
} from "@gladlog/analysis/src/analysis/teammateCrisis";
import { getSortedAdvancedActions } from "@gladlog/analysis/src/utils/advancedActions";
import { binarySearchClosest } from "@gladlog/analysis/src/utils/binarySearch";
import {
  gridHpPct,
  isHealerSpec,
  specToString,
} from "@gladlog/analysis/src/utils/cooldowns";
import { GladLogParser } from "@gladlog/parser";
import { toLegacyMatch, toLegacyShuffle } from "@gladlog/parser-compat";
import { readFileSync } from "fs";
import { gunzipSync } from "zlib";

const argv = process.argv.slice(2);
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const fmtTime = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const short = (n: string | undefined) => (n ?? "?").split("-")[0];

/** How far back the distance trend looks. */
const TREND_S = 5;
/** A position sample must be this close to be quoted. */
const POS_TOL_MS = 1500;

type Reach = "outOfRange" | "noLoS" | "inReach" | "unknown";

function posAt(u: any, ms: number): { x: number; y: number } | null {
  const s: any = binarySearchClosest(
    getSortedAdvancedActions(u),
    ms,
    (a: any) => a.logLine.timestamp,
  );
  if (!s || s.advancedActorId !== u.id) return null;
  if (Math.abs(s.logLine.timestamp - ms) > POS_TOL_MS) return null;
  return { x: s.advancedActorPositionX, y: s.advancedActorPositionY };
}

async function main(): Promise<void> {
  await ensureAnalysisData();
  const files = readFileSync(flag("--manifest")!, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(Number(flag("--offset") ?? 0))
    .slice(0, Number(flag("--limit") ?? 300));

  type Cell = { n: number; died: number };
  const blank = (): Record<Reach, Cell> => ({
    outOfRange: { n: 0, died: 0 },
    noLoS: { n: 0, died: 0 },
    inReach: { n: 0, died: 0 },
    unknown: { n: 0, died: 0 },
  });
  const byBracket = new Map<string, Record<Reach, Cell>>();
  const alive = new Map<string, Record<Reach, Cell>>(); // nobody dead yet
  let rounds = 0;
  let healerRounds = 0;
  const examples: { reach: Reach; text: string }[] = [];
  const stat = () => ({
    n: 0,
    /** a new heal from this healer landed on the teammate in the window */
    freshHeal: 0,
    answered: 0,
    healerCc: 0,
    priorDeath: 0,
    /** out of range by 5 yd or less */
    within5yd: 0,
    /** distance grew by ≥ 10 yd over the previous TREND_S seconds */
    openedUp: 0,
  });
  const stats = { outOfRange: stat(), noLoS: stat() } as Record<
    Reach,
    ReturnType<typeof stat>
  >;

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
      rounds++;
      const bracket = String(combat.startInfo?.bracket ?? "?");
      const players: any[] = Object.values(combat.units ?? {}).filter(
        (u: any) => u.info,
      );
      for (const healer of players) {
        if (!isHealerSpec(healer.spec)) continue;
        healerRounds++;
        let points;
        try {
          points = teammateCrisisPoints(healer, combat);
        } catch {
          continue;
        }
        const matesById = new Map(players.map((u) => [u.id, u]));
        for (const p of points) {
          const thirdMate = players.find(
            (u) =>
              u.reaction === healer.reaction &&
              u.id !== healer.id &&
              u.id !== p.mateId,
          );
          const reach: Reach =
            p.distanceYd === null
              ? "unknown"
              : p.distanceYd > TEAMMATE_CRISIS_REACH_YARDS
                ? "outOfRange"
                : p.losClear === false
                  ? "noLoS"
                  : p.losClear === null
                    ? "unknown"
                    : "inReach";
          const cell = byBracket.get(bracket) ?? blank();
          byBracket.set(bracket, cell);
          cell[reach].n++;
          if (p.diedWithin10s) cell[reach].died++;
          if (p.priorDeathSide === null) {
            const a = alive.get(bracket) ?? blank();
            alive.set(bracket, a);
            a[reach].n++;
            if (p.diedWithin10s) a[reach].died++;
          }
          if (reach !== "outOfRange" && reach !== "noLoS") continue;

          const mate = matesById.get(p.mateId);
          const t0 = combat.startTime as number;
          const hA = posAt(healer, p.tMs - TREND_S * 1000);
          const mA = mate ? posAt(mate, p.tMs - TREND_S * 1000) : null;
          const before =
            hA && mA ? Math.round(Math.hypot(hA.x - mA.x, hA.y - mA.y)) : null;
          const where =
            reach === "outOfRange"
              ? `${p.distanceYd} yd — beyond ${TEAMMATE_CRISIS_REACH_YARDS} yd heal range`
              : `${p.distanceYd} yd, no line of sight`;
          const trend =
            before === null ? "" : ` (${before} yd ${TREND_S}s earlier)`;
          const what = `dropped to ${Math.round(p.hpPct)}% (−${Math.round(p.dmg2s * 100)}% in 2s, ${p.attackerNames.length} attacking)`;
          const hpTrack = mate
            ? [-2, 0, 2, 4, 6]
                .map((d) => {
                  const v = gridHpPct(mate, t0 + (p.tSec + d) * 1000);
                  return `${fmtTime(p.tSec + d)} ${v ?? "–"}`;
                })
                .join(" · ")
            : "";
          const healerSpec = specToString(healer.spec);
          const cc =
            p.excluded === "healerBlocked"
              ? " — healer was CC'd / locked out at the time"
              : "";
          const st = stats[reach];
          st.n++;
          if (p.healerAnswers.includes("freshHeal")) st.freshHeal++;
          if (p.healerAnswered) st.answered++;
          if (p.excluded === "healerBlocked") st.healerCc++;
          if (p.priorDeathSide) st.priorDeath++;
          if (reach === "outOfRange" && (p.distanceYd ?? 0) <= 45)
            st.within5yd++;
          if (before !== null && p.distanceYd !== null) {
            if (p.distanceYd - before >= 10) st.openedUp++;
          }
          examples.push({
            reach,
            text:
              `${path.split("/").at(-1)} · ${bracket} · ${short(healer.name)} (${healerSpec}) → ${short(p.mateName)}${p.priorDeathSide ? ` · [someone already dead: ${p.priorDeathSide}]` : ""}\n` +
              `  healer view : ${fmtTime(p.tSec)}  [HEAL REACH]  ${short(p.mateName)} ${what} while ${where} from you${trend}${cc}\n` +
              `  victim view : ${fmtTime(p.tSec)}  [HEAL REACH]  you ${what} while ${where} from your healer (${healerSpec})${trend}${cc}\n` +
              (thirdMate
                ? `  3rd view    : ${fmtTime(p.tSec)}  [HEAL REACH]  ${short(p.mateName)} ${what} while ${where} from your healer (${healerSpec})${trend}${cc}\n`
                : "") +
              `  context     : ${short(p.mateName)} HP  ${hpTrack}  | healer answered: ${p.healerAnswered ? p.healerAnswers.join("+") : "no"} | died within 10s (reader only): ${p.diedWithin10s ? "yes" : "no"}`,
          });
        }
      }
    }
  }

  const pct = (a: number, b: number) =>
    b ? `${((100 * a) / b).toFixed(1)}%` : "–";
  const table = (title: string, m: Map<string, Record<Reach, Cell>>) => {
    console.log(`\n${title}`);
    console.log(
      "bracket | crisis points | out of range (>40yd) | no LoS | in reach | unknown | died10s: out / noLoS / in",
    );
    for (const [b, c] of [...m].sort()) {
      const n = c.outOfRange.n + c.noLoS.n + c.inReach.n + c.unknown.n;
      console.log(
        `${b} | ${n} | ${c.outOfRange.n} (${pct(c.outOfRange.n, n)}) | ${c.noLoS.n} (${pct(c.noLoS.n, n)}) | ${c.inReach.n} | ${c.unknown.n} | ${pct(c.outOfRange.died, c.outOfRange.n)} / ${pct(c.noLoS.died, c.noLoS.n)} / ${pct(c.inReach.died, c.inReach.n)}`,
      );
    }
  };
  console.log(
    `files ${files.length} · rounds ${rounds} · healer-rounds ${healerRounds}`,
  );
  table("ALL crisis points", byBracket);
  table("Nobody dead yet (priorDeathSide null)", alive);

  console.log("\nFact population (out of range / no LoS):");
  for (const r of ["outOfRange", "noLoS"] as Reach[]) {
    const s = stats[r];
    console.log(
      `${r}: n ${s.n} · healer still landed a fresh heal on them ${pct(s.freshHeal, s.n)} · any healer answer ${pct(s.answered, s.n)} · healer CC'd ${pct(s.healerCc, s.n)} · someone already dead ${pct(s.priorDeath, s.n)}` +
        (r === "outOfRange" ? ` · ≤ 45 yd ${pct(s.within5yd, s.n)}` : "") +
        ` · gap opened ≥ 10 yd in ${TREND_S}s ${pct(s.openedUp, s.n)}`,
    );
  }

  const pick = (r: Reach, k: number) => {
    const xs = examples.filter((e) => e.reach === r);
    const step = Math.max(1, Math.floor(xs.length / k));
    return xs.filter((_, i) => i % step === 0).slice(0, k);
  };
  console.log(
    `\n=== examples: out of range (${examples.filter((e) => e.reach === "outOfRange").length} total, evenly spaced) ===\n`,
  );
  for (const e of pick("outOfRange", 4)) console.log(e.text + "\n");
  console.log(
    `=== examples: no line of sight (${examples.filter((e) => e.reach === "noLoS").length} total, evenly spaced) ===\n`,
  );
  for (const e of pick("noLoS", 4)) console.log(e.text + "\n");
}
void main();
