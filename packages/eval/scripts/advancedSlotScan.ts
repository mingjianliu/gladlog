/**
 * Direction 2 of the log-observability audit (GH #100): the advanced-block
 * slots L1 skips — everything between maxHp and powerType. No slot is named
 * from its position; each is tested against INDEPENDENT event evidence, and
 * every slot competes in every test so the data picks the match.
 *
 *  - profile: value range, zero share, how often a slot changes
 *  - absorb test: over an interval between two samples of one Player with no
 *    aura event on that Player, does the slot move by exactly
 *    −Σ(SPELL_ABSORBED amounts on that Player)? Non-exact intervals are
 *    classified (snapshot ordering vs genuinely unexplained).
 *  - quiet test: same kind of interval with no absorb at all — unchanged?
 *  - COMBATANT_INFO test: a Player's first in-round slot value vs each raw
 *    COMBATANT_INFO scalar (zeros ignored — a zero matches any zero stat).
 *  - heal-absorb test: clean interval with SPELL_HEAL_ABSORBED on the Player
 *    and no SPELL_ABSORBED — does the winning absorb slot move?
 *  - other actor kinds (Pet/Creature): slot count and the same absorb test on
 *    their last slot.
 *  - ratio test for slots no scalar equals: slot / scalar across players, the
 *    scalars whose ratio is most nearly constant.
 *
 * Diagnostic only, same pilot sample: establishes meaning, not season rates.
 * Usage: npx tsx packages/eval/scripts/advancedSlotScan.ts <pilot.json> <new-output.json>
 * File contents must still match the pilot hashes. Output contains no names/GUIDs.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import { parseLine } from "@gladlog/parser";

const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error("expected pilot.json and new-output.json");
const pilot = JSON.parse(readFileSync(input, "utf8")) as {
  manifestSha256: string;
  files: Array<{ path: string; sha256: string }>;
};

// COMBATANT_INFO scalars sit between the team id and the spec id.
const CI_FIRST = 2;
const CI_LAST = 27;

type Profile = {
  n: number;
  zero: number;
  min: number;
  max: number;
  changes: number;
};
const slotCountHist: Record<string, number> = {};
const profile: Record<string, Profile> = {};
const absorbTest: Record<string, { n: number; exact: number }> = {};
const quietTest: Record<string, { n: number; unchanged: number }> = {};
const ciMatch: Record<string, Record<string, number>> = {};
let ciPlayers = 0;
const healAbsorbTest = { n: 0, lastSlotUnchanged: 0, movedByMinusSum: 0 };
const otherKinds: Record<
  string,
  {
    records: number;
    slotCountHist: Record<string, number>;
    lastSlotNonZero: number;
    absorbTestN: number;
    absorbExact: number;
  }
> = {};
const ratios: Record<string, Record<string, number[]>> = {};
// Residual classes for the slot that wins the absorb test, filled per slot and
// reported for all so nothing is presumed.
const residual: Record<string, Record<string, number>> = {};
const bump = (slot: string, k: string) => {
  const r = (residual[slot] ??= {});
  r[k] = (r[k] ?? 0) + 1;
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

for (const file of pilot.files) {
  let raw: string;
  try {
    const buf = readFileSync(file.path);
    raw = (file.path.endsWith(".gz") ? gunzipSync(buf) : buf).toString("utf8");
    if (createHash("sha256").update(raw).digest("hex") !== file.sha256) {
      process.stderr.write(
        `[warn] pilot content hash mismatch: ${file.path}, skipping\n`,
      );
      continue;
    }
  } catch (err) {
    process.stderr.write(
      `[warn] failed to read ${file.path}: ${err instanceof Error ? err.message : String(err)}, skipping\n`,
    );
    continue;
  }

  const last = new Map<string, number[]>();
  const absorbedSince = new Map<string, number[]>();
  const healAbsorbedSince = new Map<string, number>();
  const auraSince = new Set<string>();
  const combatantInfo = new Map<string, string[]>();
  const firstSlots = new Map<string, number[]>();
  const flushCombatantInfo = () => {
    for (const [guid, ci] of combatantInfo) {
      const slots = firstSlots.get(guid);
      if (!slots) continue;
      ciPlayers++;
      slots.forEach((v, k) => {
        if (v === 0) return;
        for (let j = CI_FIRST; j <= CI_LAST; j++) {
          const scalar = Number(ci[j]);
          if (scalar > 0)
            ((ratios[`slot+${k + 4}`] ??= {})[`ci[${j}]`] ??= []).push(
              v / scalar,
            );
        }
        for (let j = CI_FIRST; j <= CI_LAST; j++)
          if (Number(ci[j]) === v) {
            const m = (ciMatch[`slot+${k + 4}`] ??= {});
            m[`ci[${j}]`] = (m[`ci[${j}]`] ?? 0) + 1;
          }
      });
    }
    combatantInfo.clear();
    firstSlots.clear();
  };

  for (const row of raw.split(/\r?\n/)) {
    const p = parseLine(row);
    if (!p) continue;
    if (
      p.eventName === "ARENA_MATCH_START" ||
      p.eventName === "ARENA_MATCH_END"
    ) {
      flushCombatantInfo();
      last.clear();
      absorbedSince.clear();
      healAbsorbedSince.clear();
      auraSince.clear();
      continue;
    }
    if (p.eventName === "COMBATANT_INFO") {
      combatantInfo.set(p.params[0], p.params);
      continue;
    }
    if (p.eventName === "SPELL_ABSORBED" && p.absorbed) {
      const v = p.absorbed.victimGuid;
      const list = absorbedSince.get(v) ?? [];
      list.push(p.absorbed.absorbedAmount);
      absorbedSince.set(v, list);
    }
    if (p.eventName === "SPELL_HEAL_ABSORBED" && p.healAbsorbed) {
      const v = p.healAbsorbed.victimGuid;
      healAbsorbedSince.set(
        v,
        (healAbsorbedSince.get(v) ?? 0) + p.healAbsorbed.absorbedAmount,
      );
    }
    if (p.eventName.startsWith("SPELL_AURA_") && p.base)
      auraSince.add(p.base.destGuid);

    const a = p.advanced;
    if (!a || !/^(Player|Pet|Creature)-/.test(a.actorGuid)) continue;
    // Locate the block and the coordinates the way decodeAdvanced does.
    const at = p.params.indexOf(a.actorGuid, 8);
    if (at < 0) continue;
    let xIdx = -1;
    for (let k = at + 4; k < p.params.length - 1; k++)
      if (p.params[k].includes(".") && p.params[k + 1].includes(".")) {
        xIdx = k;
        break;
      }
    if (xIdx < 0) continue;
    // powerType/currentPower/maxPower/powerCost are the four before x.
    const slots = p.params.slice(at + 4, xIdx - 4).map(Number);
    if (!a.actorGuid.startsWith("Player-")) {
      const kind = (otherKinds[a.actorGuid.split("-")[0]] ??= {
        records: 0,
        slotCountHist: {},
        lastSlotNonZero: 0,
        absorbTestN: 0,
        absorbExact: 0,
      });
      kind.records++;
      kind.slotCountHist[slots.length] =
        (kind.slotCountHist[slots.length] ?? 0) + 1;
      const v = slots[slots.length - 1];
      if (v > 0) kind.lastSlotNonZero++;
      const before = last.get(a.actorGuid);
      const list = absorbedSince.get(a.actorGuid) ?? [];
      if (
        before &&
        before.length === slots.length &&
        !auraSince.has(a.actorGuid) &&
        list.length
      ) {
        kind.absorbTestN++;
        if (v - before[before.length - 1] === -sum(list)) kind.absorbExact++;
      }
      last.set(a.actorGuid, slots);
      absorbedSince.delete(a.actorGuid);
      auraSince.delete(a.actorGuid);
      continue;
    }
    slotCountHist[slots.length] = (slotCountHist[slots.length] ?? 0) + 1;
    if (!firstSlots.has(a.actorGuid)) firstSlots.set(a.actorGuid, slots);

    const prev = last.get(a.actorGuid);
    const absorbs = absorbedSince.get(a.actorGuid) ?? [];
    const clean =
      prev && prev.length === slots.length && !auraSince.has(a.actorGuid);
    const healAbsorbed = healAbsorbedSince.get(a.actorGuid) ?? 0;
    if (clean && !absorbs.length && healAbsorbed > 0) {
      const d = slots[slots.length - 1] - prev[prev.length - 1];
      healAbsorbTest.n++;
      if (d === 0) healAbsorbTest.lastSlotUnchanged++;
      else if (d === -healAbsorbed) healAbsorbTest.movedByMinusSum++;
    }
    slots.forEach((v, k) => {
      const key = `slot+${k + 4}`;
      const pr = (profile[key] ??= {
        n: 0,
        zero: 0,
        min: Infinity,
        max: -Infinity,
        changes: 0,
      });
      pr.n++;
      if (v === 0) pr.zero++;
      pr.min = Math.min(pr.min, v);
      pr.max = Math.max(pr.max, v);
      if (prev && prev[k] !== v) pr.changes++;
      if (!clean) return;
      const d = v - prev[k];
      if (!absorbs.length) {
        const t = (quietTest[key] ??= { n: 0, unchanged: 0 });
        t.n++;
        if (d === 0) t.unchanged++;
        return;
      }
      const total = sum(absorbs);
      const t = (absorbTest[key] ??= { n: 0, exact: 0 });
      t.n++;
      if (d === -total) {
        t.exact++;
        bump(key, "exact");
      } else if (d === 0) bump(key, "unchanged");
      else if (
        absorbs.some(
          (_, i) =>
            d === -sum(absorbs.slice(0, i)) || d === -sum(absorbs.slice(i)),
        )
      )
        bump(key, "equals a prefix/suffix of the absorbs");
      else if (d < 0 && d > -total) bump(key, "dropped by less");
      else if (d < -total)
        bump(key, v === 0 ? "dropped by more, to zero" : "dropped by more");
      else bump(key, "rose");
    });
    last.set(a.actorGuid, slots);
    absorbedSince.delete(a.actorGuid);
    healAbsorbedSince.delete(a.actorGuid);
    auraSince.delete(a.actorGuid);
  }
  flushCombatantInfo();
}

const median = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const ratioTest = Object.fromEntries(
  Object.entries(ratios)
    .filter(([slot]) => !ciMatch[slot])
    .map(([slot, byScalar]) => [
      slot,
      Object.entries(byScalar)
        .map(([scalar, xs]) => {
          const m = median(xs);
          return {
            scalar,
            players: xs.length,
            medianRatio: +m.toFixed(4),
            within1pct: +(
              xs.filter((x) => Math.abs(x / m - 1) <= 0.01).length / xs.length
            ).toFixed(3),
          };
        })
        .sort((a, b) => b.within1pct - a.within1pct)
        .slice(0, 4),
    ]),
);
const result = {
  manifestSha256: pilot.manifestSha256,
  sampledFiles: pilot.files.length,
  scope:
    "Player actors only, same pilot sample. slot+N = params[advancedBlockStart + N]. Intervals are line-ordered between two samples of one Player; 'clean' = no SPELL_AURA_* event on that Player in between.",
  slotCountHist,
  profile,
  absorbTest,
  residual,
  quietTest,
  ciPlayers,
  ciMatch,
  ratioTest,
  healAbsorbTest,
  otherKinds,
};
writeFileSync(output, JSON.stringify(result, null, 2), { flag: "wx" });
console.log(JSON.stringify(result, null, 2));
