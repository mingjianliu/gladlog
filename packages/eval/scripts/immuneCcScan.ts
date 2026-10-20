/**
 * Completeness check for the CC-immunity table, using the log's own verdict.
 *
 * `CC_AVOIDANCE_BUFF_SPELLS` (ccTrinketAnalysis.ts) is a hand-maintained list of
 * the buffs that dodge CC, and CLAUDE.md's curated-list rule says its
 * COMPLETENESS has to be checked against observable ground truth, separately
 * from whether its entries are right. Until 2026-08-23 there was no ground
 * truth to check it with — `SPELL_MISSED`'s `missType` was parsed away. There
 * is now: when the game says IMMUNE, something on that target granted immunity.
 *
 * ⚠️ The naive version of this scan is wrong and looks fine. Taking "any buff
 * covering the instant" as the immunity returns Power Word: Fortitude, Sign of
 * the Emissary and Atonement at the top, because a target always has buffs up.
 * The discriminator has to contrast the two outcomes of the SAME situation:
 *
 *     immuneRate(X) = immune-with-X / (immune-with-X + landed-with-X)
 *
 * A real immunity is up almost exclusively when CC fails; Fortitude is up just
 * as often when CC lands, so it falls out on its own.
 *
 * Usage: npx tsx packages/eval/scripts/immuneCcScan.ts <archiveRoot> [maxRounds]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import {
  CC_AVOIDANCE_BUFF_SPELLS,
  ensureAnalysisData,
  getDRCategory,
  getEnglishSpellName,
} from "@gladlog/analysis";
import { GladLogParser, type GladMatch } from "@gladlog/parser";

await ensureAnalysisData();

const root = process.argv[2];
const maxRounds = Number(process.argv[3] ?? 1200);

/** An aura counts as "already up" only if it started before the press; a buff
 * applied in the same instant is a reaction, not something the caster saw. */
const VISIBLE_SLACK_MS = 250;
/** Below this many observations an immuneRate is noise. */
const MIN_OBSERVATIONS = 25;

function newSeasonFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const p = path.join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".txt.gz")) out.push(p);
    }
  };
  walk(dir);
  return out
    .filter((p) => {
      const m = /\/2026\/08\/(\d{2})\//.exec(p);
      return m != null && Number(m[1]) >= 12;
    })
    .sort();
}

const isCc = (spellId: string | number) =>
  !getDRCategory(String(spellId)).startsWith("spell:");

let rounds = 0;
let immuneCc = 0;
let landedCc = 0;
/** aura id -> [immune count, landed count] */
const tally = new Map<string, [number, number]>();
const bump = (id: string, idx: 0 | 1) => {
  const t = tally.get(id) ?? ([0, 0] as [number, number]);
  t[idx]++;
  tally.set(id, t);
};

outer: for (const file of newSeasonFiles(root)) {
  const items: GladMatch[] = [];
  try {
    const text = gunzipSync(readFileSync(file)).toString("utf8");
    const p = new GladLogParser();
    p.on("match", (m: GladMatch) => items.push(m));
    p.on("shuffle", (sh) => {
      for (const r of sh.rounds) items.push(r as never);
    });
    for (const line of text.split("\n")) p.push(line);
    p.end();
  } catch {
    continue;
  }

  for (const m of items) {
    if (rounds >= maxRounds) break outer;
    rounds++;

    // Buff intervals per unit.
    const aurasByUnit = new Map<
      string,
      Array<{ spellId: number; from: number; to: number }>
    >();
    for (const u of Object.values(m.units)) {
      const open = new Map<number, number>();
      const out: Array<{ spellId: number; from: number; to: number }> = [];
      for (const a of u.auraEvents) {
        if (a.auraType !== "BUFF") continue;
        if (a.eventName.endsWith("_AURA_APPLIED")) {
          if (!open.has(a.spellId)) open.set(a.spellId, a.timestamp);
        } else if (a.eventName.endsWith("_AURA_REMOVED")) {
          const from = open.get(a.spellId);
          if (from !== undefined) {
            out.push({ spellId: a.spellId, from, to: a.timestamp });
            open.delete(a.spellId);
          }
        }
      }
      for (const [spellId, from] of open) {
        out.push({ spellId, from, to: Number.POSITIVE_INFINITY });
      }
      aurasByUnit.set(u.id, out);
    }

    const visibleAurasOn = (unitId: string, at: number) =>
      (aurasByUnit.get(unitId) ?? []).filter(
        (a) => a.from <= at - VISIBLE_SLACK_MS && a.to >= at,
      );

    for (const u of Object.values(m.units)) {
      // Outcome A: the game said IMMUNE.
      for (const miss of u.missesOut) {
        if (miss.missType !== "IMMUNE" || !isCc(miss.spellId)) continue;
        immuneCc++;
        for (const a of visibleAurasOn(miss.destId, miss.timestamp)) {
          bump(String(a.spellId), 0);
        }
      }
      // Outcome B: the CC landed (its debuff was applied).
      for (const a of u.auraEvents) {
        if (a.auraType !== "DEBUFF") continue;
        if (!a.eventName.endsWith("_AURA_APPLIED")) continue;
        if (!isCc(a.spellId)) continue;
        landedCc++;
        for (const b of visibleAurasOn(u.id, a.timestamp)) {
          bump(String(b.spellId), 1);
        }
      }
    }
  }
}

const n = (x: number) => Math.round(x).toLocaleString();
console.log(
  `rounds=${rounds}  CC immune=${n(immuneCc)}  CC landed=${n(landedCc)}`,
);
console.log(
  `\nAuras ranked by immuneRate = immune / (immune + landed), n>=${MIN_OBSERVATIONS}:`,
);
console.log(
  `(listed = already in CC_AVOIDANCE_BUFF_SPELLS; the point of the scan is the UNLISTED ones)\n`,
);

const rows = [...tally.entries()]
  .map(([id, [imm, landed]]) => ({
    id,
    imm,
    landed,
    total: imm + landed,
    rate: imm / (imm + landed),
  }))
  .filter((r) => r.total >= MIN_OBSERVATIONS)
  .sort((a, b) => b.rate - a.rate);

let shownUnlisted = 0;
for (const r of rows.slice(0, 25)) {
  const listed = CC_AVOIDANCE_BUFF_SPELLS.has(r.id);
  if (!listed && r.rate >= 0.5) shownUnlisted++;
  console.log(
    `  ${(r.rate * 100).toFixed(1).padStart(5)}%  immune=${String(r.imm).padStart(5)} landed=${String(r.landed).padStart(6)}  ` +
      `${listed ? "[listed]  " : "[UNLISTED]"} ${r.id} ${getEnglishSpellName(r.id) ?? "?"}`,
  );
}

console.log(`\nlisted entries and how the corpus sees them:`);
for (const [id, name] of CC_AVOIDANCE_BUFF_SPELLS) {
  const t = tally.get(id);
  if (!t) {
    console.log(`  ${id} ${name}: NO OBSERVATIONS (rot candidate)`);
    continue;
  }
  const [imm, landed] = t;
  console.log(
    `  ${id} ${name}: immune=${imm} landed=${landed} rate=${((imm / (imm + landed)) * 100).toFixed(1)}%`,
  );
}
console.log(
  `\nunlisted auras above 50% immuneRate in the top 25: ${shownUnlisted}`,
);
