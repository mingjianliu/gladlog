/**
 * loadoutChangeScan.ts — direction 5 mini-probe of the log-observability audit
 * (GH #100). Within one Solo Shuffle lobby, how often does a player's
 * COMBATANT_INFO change between rounds (talents / PvP talents / equipment)?
 * The parser builds every shuffle round's `info` from that round's own
 * COMBATANT_INFO (l3/compose.ts buildShuffleRound), so per-round analysis
 * already describes the right loadout; this measures how much that matters.
 *
 * Usage: npx tsx packages/eval/scripts/loadoutChangeScan.ts <manifest.txt> [limit=400] [offset=3000]
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import { parseLine } from "@gladlog/parser";
const files = readFileSync(process.argv[2], "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .slice(Number(process.argv[4] ?? 3000))
  .slice(0, Number(process.argv[3] ?? 400));
let lobbies = 0,
  playerLobbies = 0;
const changed = { talents: 0, pvpTalents: 0, equipment: 0, any: 0 };
const talentDiffSizes: number[] = [];
const whenChanged: Record<string, number> = {};
for (const f of files) {
  let text: string;
  try {
    const raw = readFileSync(f);
    text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  const perPlayer = new Map<
    string,
    { talents: string; pvp: string; gear: string }[]
  >();
  let rounds = 0;
  for (const row of text.split(/\r?\n/)) {
    if (!row.includes("ARENA_MATCH_START") && !row.includes("COMBATANT_INFO"))
      continue;
    const p = parseLine(row);
    if (!p) continue;
    if (p.eventName === "ARENA_MATCH_START") {
      rounds++;
      continue;
    }
    if (p.eventName !== "COMBATANT_INFO") continue;
    const i = p.params.findIndex((x) => x.startsWith("[") || x.startsWith("("));
    if (i < 0) continue;
    // params after spec id: [talents], (pvp talents), [equipment], [interesting auras], ...
    const rec = {
      talents: p.params[i] ?? "",
      pvp: p.params[i + 1] ?? "",
      gear: p.params[i + 2] ?? "",
    };
    (
      perPlayer.get(p.params[0]) ??
      perPlayer.set(p.params[0], []).get(p.params[0])!
    ).push(rec);
  }
  if (rounds < 4) continue;
  lobbies++;
  for (const [, recs] of perPlayer) {
    if (recs.length < 2) continue;
    playerLobbies++;
    let t = false,
      v = false,
      g = false;
    for (let k = 1; k < recs.length; k++) {
      if (recs[k].talents !== recs[k - 1].talents) {
        t = true;
        whenChanged[`round ${k}→${k + 1}`] =
          (whenChanged[`round ${k}→${k + 1}`] ?? 0) + 1;
        const A = new Set(recs[k - 1].talents.match(/\(\d+,\d+,\d+\)/g) ?? []),
          B = new Set(recs[k].talents.match(/\(\d+,\d+,\d+\)/g) ?? []);
        let d = 0;
        for (const x of A) if (!B.has(x)) d++;
        for (const x of B) if (!A.has(x)) d++;
        talentDiffSizes.push(d);
      }
      if (recs[k].pvp !== recs[k - 1].pvp) v = true;
      if (recs[k].gear !== recs[k - 1].gear) g = true;
    }
    if (t) changed.talents++;
    if (v) changed.pvpTalents++;
    if (g) changed.equipment++;
    if (t || v || g) changed.any++;
  }
}
talentDiffSizes.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      files: files.length,
      shuffleLobbies: lobbies,
      playerLobbies,
      changed,
      shareAny: +(changed.any / Math.max(playerLobbies, 1)).toFixed(3),
      shareTalents: +(changed.talents / Math.max(playerLobbies, 1)).toFixed(3),
      talentEntriesChanged: {
        n: talentDiffSizes.length,
        p50: talentDiffSizes[Math.floor(talentDiffSizes.length / 2)],
        max: talentDiffSizes.at(-1),
      },
      whenChanged,
    },
    null,
    1,
  ),
);
