/**
 * uncontestedSummonExampleGen.ts — value-gate example generator for BACKLOG #51's
 * original motive ("the most dangerous target is sometimes an NPC": a Psyfiend
 * that lives out its whole life with nobody hitting it). [UNIT DESTROYED] now
 * covers the units that WERE killed; this renders the other half as a context
 * FACT, not an accusation: a listed summon the other team never touched.
 *
 * Deliberately no lifetime claim: 12.x logs give no despawn event, and a hand
 * duration table would be a Game-Behaviour-Rule liability. The line says what
 * the log says — summoned at T, N hits from the other team, killed or not.
 * An accusation form would additionally need reachability and "was there a
 * better target" gates (BACKLOG #51); none of that is attempted here.
 *
 * Usage: npx tsx packages/eval/scripts/uncontestedSummonExampleGen.ts --manifest <txt> [--offset 3000] [--limit 300] [--show 6]
 */
import { CRITICAL_NON_PLAYER_NPC_NAMES } from "@gladlog/analysis/src/context/timelineHelpers";
import { parseLine } from "@gladlog/parser";
import { readFileSync } from "fs";
import { gunzipSync } from "zlib";

const argv = process.argv.slice(2);
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const fmtTime = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const files = readFileSync(flag("--manifest")!, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .slice(Number(flag("--offset") ?? 3000))
  .slice(0, Number(flag("--limit") ?? 300));

type U = {
  npc: string;
  owner: string;
  t: number;
  hits: number;
  hitters: Set<string>;
  killed: boolean;
};
const stats: Record<
  string,
  { summoned: number; untouched: number; hitNotKilled: number; killed: number }
> = {};
const examples: string[] = [];
let rounds = 0;

for (const path of files) {
  let text: string;
  try {
    const raw = readFileSync(path);
    text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  let start = 0;
  let team = new Map<string, string>();
  let units = new Map<string, U>();
  const flush = () => {
    if (!start) return;
    rounds++;
    const out: string[] = [];
    for (const u of units.values()) {
      const name = CRITICAL_NON_PLAYER_NPC_NAMES[u.npc];
      const s = (stats[name] ??= {
        summoned: 0,
        untouched: 0,
        hitNotKilled: 0,
        killed: 0,
      });
      s.summoned++;
      if (u.killed) s.killed++;
      else if (u.hits) s.hitNotKilled++;
      else s.untouched++;
      if (name === "Psyfiend" || name === "Spirit Link Totem")
        out.push(
          `  ${fmtTime((u.t - start) / 1000)}  [SUMMON]   ${name} — ` +
            (u.killed
              ? `killed (${u.hits} hits from ${u.hitters.size} opposing player(s))`
              : u.hits
                ? `hit ${u.hits}× by ${u.hitters.size} opposing player(s), not killed`
                : `untouched: 0 hits from the other team`),
        );
    }
    if (out.length >= 2 && examples.length < Number(flag("--show") ?? 6))
      examples.push(out.join("\n"));
  };
  for (const row of text.split(/\r?\n/)) {
    const p = parseLine(row);
    if (!p) continue;
    if (p.eventName === "ARENA_MATCH_START") {
      flush();
      start = p.timestamp;
      team = new Map();
      units = new Map();
      continue;
    }
    if (p.eventName === "ARENA_MATCH_END") {
      flush();
      start = 0;
      continue;
    }
    if (!start) continue;
    if (p.eventName === "COMBATANT_INFO") {
      team.set(p.params[0], p.params[1]);
      continue;
    }
    if (!p.base) continue;
    const { srcGuid, destGuid } = p.base;
    if (p.eventName === "SPELL_SUMMON") {
      const npc = destGuid.split("-")[5];
      if (
        destGuid.startsWith("Creature-") &&
        npc in CRITICAL_NON_PLAYER_NPC_NAMES
      )
        units.set(destGuid, {
          npc,
          owner: srcGuid,
          t: p.timestamp,
          hits: 0,
          hitters: new Set(),
          killed: false,
        });
      continue;
    }
    const u = units.get(destGuid);
    if (!u || !p.damage || !srcGuid.startsWith("Player-")) continue;
    const a = team.get(srcGuid);
    const b = team.get(u.owner);
    if (a === undefined || b === undefined || a === b) continue;
    u.hits++;
    u.hitters.add(srcGuid);
    if ((p.damage.overkill ?? 0) > 0) u.killed = true;
  }
  flush();
}

console.log(JSON.stringify({ files: files.length, rounds }));
for (const [name, s] of Object.entries(stats).sort(
  (a, b) => b[1].summoned - a[1].summoned,
))
  console.log(
    `${name.padEnd(22)} summoned ${String(s.summoned).padStart(5)}  untouched ${((100 * s.untouched) / s.summoned).toFixed(0).padStart(3)}%  hit-not-killed ${((100 * s.hitNotKilled) / s.summoned).toFixed(0).padStart(3)}%  killed ${((100 * s.killed) / s.summoned).toFixed(0).padStart(3)}%`,
  );
console.log("\n" + examples.join("\n\n"));
