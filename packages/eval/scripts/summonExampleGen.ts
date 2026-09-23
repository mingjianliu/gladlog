/**
 * summonExampleGen.ts — value-gate generator for GH #86 (user ruling
 * 2026-09-22: most summons fold into their owner; record only the FUNCTIONAL or
 * high-impact ones — Grounding / Tremor, control or healing-reduction summons,
 * the warlock pet BY ITS FUNCTION, and above all WHEN the Shadow Priest's
 * Shadowfiend was killed).
 *
 * Renders, on real archive rounds, the lines the ruling asks for, using only
 * predicates that already exist (never a second copy):
 *   summonedAtMs / nonPlayerUnitKill / opposingHitsOnUnit  (timelineHelpers)
 *   buffFullDurationForCaster(summon spell, owner)          (expected lifetime,
 *     DB2 PvP duration + the owner's talents — Subservient Shadows ×1.2 etc.)
 * and tallies how often each line would fire, so the noise question ("a line
 * per totem would be noise", 2026-09-20) is answered with numbers before
 * anything enters the prompt.
 *
 * The warlock pet is identified by the PET unit's npcId (permanent pets have
 * no SPELL_SUMMON in-round — they are out before the gates open), falling back
 * to the pet's own casts; its FUNCTION is the hand table below.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/summonExampleGen.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-<date>.txt [--every 100] [--show 3]
 */
import { ensureAnalysisData, specToString } from "@gladlog/analysis";
import {
  CRITICAL_NON_PLAYER_NPC_NAMES,
  getNpcIdFromGuid,
  nonPlayerUnitKill,
  opposingHitsOnUnit,
  summonedAtMs,
} from "@gladlog/analysis/src/context/timelineHelpers";
import { buffFullDurationForCaster } from "@gladlog/analysis/src/utils/buffDuration";
import { talentRankOf } from "@gladlog/analysis/src/utils/talentOwnership";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import {
  CombatUnitReaction,
  type ICombatUnit,
  LogEvent,
  toLegacyMatch,
} from "@gladlog/parser-compat";
import { readFileSync } from "fs";
import { resolve } from "path";
import { gunzipSync } from "zlib";

import { splitTeams } from "../src/explore/storeAccess";

const a = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = a.indexOf(k);
  return i >= 0 ? (a[i + 1] ?? d) : d;
};
const manifest = arg("--manifest", "");
const every = Number(arg("--every", "100"));
const show = Number(arg("--show", "3"));
if (!manifest) {
  console.error(
    "usage: summonExampleGen.ts --manifest <path> [--every N] [--show N]",
  );
  process.exit(1);
}

/** Warlock pets by npcId → what the pet DOES (the ruling: "驱散、诱惑、恐惧、晕眩"). */
const WARLOCK_PET_FUNCTION: Record<string, { pet: string; does: string }> = {
  "417": { pet: "Felhunter", does: "Spell Lock (kick) + Devour Magic (purge)" },
  "1863": { pet: "Sayaad", does: "Seduction (incapacitate)" },
  "17252": { pet: "Felguard", does: "Axe Toss (stun)" },
  "416": { pet: "Imp", does: "Singe Magic (friendly dispel)" },
  "1860": { pet: "Voidwalker", does: "no control / dispel" },
};
/** Fallback when the pet's npcId is not in the table: its signature cast. */
const PET_CAST_TO_FUNCTION: Record<string, { pet: string; does: string }> = {
  "19647": WARLOCK_PET_FUNCTION["417"]!,
  "19505": WARLOCK_PET_FUNCTION["417"]!,
  "6358": WARLOCK_PET_FUNCTION["1863"]!,
  "89766": WARLOCK_PET_FUNCTION["17252"]!,
  "89808": WARLOCK_PET_FUNCTION["416"]!,
};
const WARLOCK_SPECS = new Set(["265", "266", "267"]);

const fmt = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const r1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);

await ensureAnalysisData();
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);

type Tally = {
  summons: number;
  killed: number;
  hitNotKilled: number;
  untouched: number;
  noExpected: number;
  livedShare: number[];
};
const tally = new Map<string, Tally>();
const examples = new Map<string, string[]>();
/** Totemic Focus 382201 (Shaman class tree): +3 s on Healing Stream / Tremor /
 * Wind Rush / Poison Cleansing, +10 s on Earthbind / Earthgrab — SpellLabel
 * rows in the M6 inventory (GH #65 batch 2), not yet registered because the
 * AURA scan has no cells for totems: a totem's life is a unit's life. */
const TOTEMIC_FOCUS = "382201";
const overLived = new Map<string, number>();
const killedByRank = new Map<string, number>();
let rounds = 0;
let warlockRounds = 0;
let warlockPetKnown = 0;
const petExamples: string[] = [];

function push(cat: string, line: string) {
  const list = examples.get(cat) ?? [];
  if (list.length < show) list.push(line);
  examples.set(cat, list);
}

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
  const tag = f.split("/").slice(-1)[0]!.slice(0, 8);
  for (const m of items) {
    let legacy: ReturnType<typeof toLegacyMatch>;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    rounds++;
    const { friends, enemies } = splitTeams(legacy);
    const startMs = legacy.startTime;
    const endMs = legacy.endTime;
    const units = Object.values(legacy.units) as ICombatUnit[];
    const label = (u: ICombatUnit, side: ICombatUnit[]) =>
      `${side.indexOf(u) + 1}(${specToString(u.spec).replace(/[^A-Z]/g, "")})`;

    // Both perspectives, so a Shadowfiend counts whichever team owns it.
    for (const [mine, theirs] of [
      [friends, enemies],
      [enemies, friends],
    ] as const) {
      const theirIds = new Set(theirs.map((u) => u.id));
      const mySide = mine[0]?.reaction ?? CombatUnitReaction.Friendly;
      for (const u of units) {
        if (!u.ownerId || !theirIds.has(u.ownerId)) continue;
        const npcId = getNpcIdFromGuid(u.id);
        if (!npcId || !CRITICAL_NON_PLAYER_NPC_NAMES[npcId]) continue;
        const name = CRITICAL_NON_PLAYER_NPC_NAMES[npcId]!;
        const summonMs = summonedAtMs(u);
        if (summonMs === null) continue;
        const summonEv = u.actionIn.find(
          (e) => e.logLine.event === LogEvent.SPELL_SUMMON,
        );
        const owner = units.find((x) => x.id === u.ownerId);
        const expected =
          summonEv?.spellId !== undefined
            ? buffFullDurationForCaster(String(summonEv.spellId), owner)
            : undefined;
        const t = tally.get(name) ?? {
          summons: 0,
          killed: 0,
          hitNotKilled: 0,
          untouched: 0,
          noExpected: 0,
          livedShare: [],
        };
        t.summons++;
        if (expected === undefined) t.noExpected++;
        const kill = nonPlayerUnitKill(u);
        const theirSide =
          u.reaction === CombatUnitReaction.Hostile ||
          u.reaction === CombatUnitReaction.Friendly
            ? u.reaction
            : owner?.reaction;
        const { hits, hitters } = opposingHitsOnUnit(
          u,
          theirSide ??
            (mySide === CombatUnitReaction.Friendly
              ? CombatUnitReaction.Hostile
              : CombatUnitReaction.Friendly),
        );
        const by = owner ? ` (by ${label(owner, theirs)})` : "";
        // Dedupe by LABEL: several ghouls of one owner are one "1(UDK)'s pet".
        const who = [
          ...new Set(
            hitters.map((id) => {
              const h = units.find((x) => x.id === id);
              if (!h) return "?";
              if (mine.includes(h)) return label(h, mine);
              const o = units.find((x) => x.id === h.ownerId);
              return o && mine.includes(o) ? `${label(o, mine)}'s pet` : "?";
            }),
          ),
        ].join(", ");
        const exp =
          expected !== undefined ? `expected ${r1(expected)} s` : "expected ?";
        const sAt = (summonMs - startMs) / 1000;
        if (kill && kill.timestamp <= endMs) {
          t.killed++;
          const lived = (kill.timestamp - summonMs) / 1000;
          if (expected) t.livedShare.push(lived / expected);
          // A totem living PAST its DB2 duration before the killing blow is
          // leg (c) for a lifetime modifier on the SUMMON spell (Totemic Focus
          // +3 s / +10 s by SpellLabel): split by the owner's rank.
          if (expected && lived > expected + 0.5 && owner) {
            const rk = talentRankOf(owner, TOTEMIC_FOCUS);
            const k = `${name}|r${rk}`;
            overLived.set(k, (overLived.get(k) ?? 0) + 1);
          }
          if (expected && owner) {
            const rk = talentRankOf(owner, TOTEMIC_FOCUS);
            const k = `${name}|r${rk}`;
            killedByRank.set(k, (killedByRank.get(k) ?? 0) + 1);
          }
          // At or past the expected end the blow lands on a summon that was
          // about to expire anyway — say so instead of claiming a kill.
          const atEnd = expected !== undefined && lived >= expected - 0.5;
          push(
            `${name} killed`,
            `${tag} ${fmt(sAt)}  [ENEMY SUMMON]   ${name}${by} — killed at ${fmt((kill.timestamp - startMs) / 1000)} by ${who || "?"} after ${r1(lived)} s of its ${exp}${atEnd ? " (at its expected end)" : ""}`,
          );
        } else if (hits > 0) {
          t.hitNotKilled++;
          push(
            `${name} hit-not-killed`,
            `${tag} ${fmt(sAt)}  [ENEMY SUMMON]   ${name}${by} — not killed: hit ${hits}× by ${who}; ${exp}`,
          );
        } else {
          t.untouched++;
          push(
            `${name} untouched`,
            `${tag} ${fmt(sAt)}  [ENEMY SUMMON]   ${name}${by} — not killed: 0 hits from your team; ${exp}`,
          );
        }
        tally.set(name, t);
      }
    }

    // Warlock pet by function — one roster fact per warlock.
    for (const w of [...friends, ...enemies]) {
      if (!WARLOCK_SPECS.has(String(w.spec))) continue;
      warlockRounds++;
      const pets = units.filter((u) => u.ownerId === w.id);
      let fn: { pet: string; does: string } | undefined;
      for (const p of pets) {
        const npc = getNpcIdFromGuid(p.id);
        if (npc && WARLOCK_PET_FUNCTION[npc]) {
          fn = WARLOCK_PET_FUNCTION[npc];
          break;
        }
        for (const c of p.spellCastEvents ?? []) {
          const k = PET_CAST_TO_FUNCTION[String(c.spellId)];
          if (k) {
            fn = k;
            break;
          }
        }
        if (fn) break;
      }
      if (!fn) continue;
      warlockPetKnown++;
      if (petExamples.length < show * 2)
        petExamples.push(
          `${tag} roster: ${specToString(w.spec)} (${w.name}) — pet ${fn.pet}: ${fn.does}`,
        );
    }
  }
}

console.log(`files=${files.length} rounds=${rounds}`);
console.log("\n=== per-summon tally (both perspectives) ===");
console.log(
  "summon                      n   killed  hit-not-killed  untouched  no-expected  lived/expected(med)",
);
for (const [name, t] of [...tally].sort(
  (p, q) => q[1].summons - p[1].summons,
)) {
  const ls = [...t.livedShare].sort((x, y) => x - y);
  const med = ls.length ? r1(ls[Math.floor(ls.length / 2)]!) : "-";
  console.log(
    `${name.padEnd(26)} ${String(t.summons).padStart(4)}  ${String(t.killed).padStart(6)}  ${String(t.hitNotKilled).padStart(14)}  ${String(t.untouched).padStart(9)}  ${String(t.noExpected).padStart(11)}  ${med}`,
  );
}
console.log(
  `\nwarlock rounds ${warlockRounds}, pet function identified ${warlockPetKnown}`,
);
console.log(
  "\n=== totems killed AFTER their DB2 duration (+0.5 s), by the owner's Totemic Focus rank — leg (c) for the summon-spell modifier ===",
);
for (const [k, n] of [...killedByRank].sort()) {
  const [name, rk] = k.split("|");
  console.log(
    `  ${name!.padEnd(24)} ${rk}: killed ${String(n).padStart(4)}, of which past DB2 duration ${String(overLived.get(k) ?? 0).padStart(4)}`,
  );
}
console.log("\n=== example lines ===");
for (const [cat, lines] of [...examples].sort()) {
  console.log(`-- ${cat}`);
  for (const l of lines) console.log("  " + l);
}
console.log("-- warlock pet roster facts");
for (const l of petExamples) console.log("  " + l);
