/**
 * Direction 3 of the log-observability audit (GH #100): resource gains, drains
 * and cast costs versus the advanced-block power snapshot. L1 today decodes
 * only the snapshot (powerType/current/max); SPELL_ENERGIZE and SPELL_DRAIN get
 * base+spell through the catch-all branch with NO advanced block and no tail,
 * SPELL_PERIODIC_ENERGIZE is `known:false`, and powerCost is never read.
 *
 * Nothing is named from its position. Each claim is an identity the log must
 * satisfy if the reading is right:
 *  - tail layout (amount, over, powerType, maxPower): tail powerType appears in
 *    the block's own power list; tail maxPower equals the block's max for it;
 *    over > 0 ⇒ block current == max.
 *  - cost snapshot timing (mana, which regenerates, so closest-of-two): is the
 *    NEXT sample nearer current − cost (snapshot BEFORE the cost) or current?
 *  - secondary-resource ledger: discrete types appear in a block only on the
 *    cast that spends them; between two spender casts of one actor,
 *    next.current == prev.current − prev.cost + Σ(ENERGIZE amounts)?
 *  - what L3 loses: advanced blocks on these events that never become samples.
 *
 * Diagnostic only, same pilot sample: meaning and mechanism, not season rates.
 * Usage: npx tsx packages/eval/scripts/resourceFlowScan.ts <pilot.json> <new-output.json>
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import { decodeAdvanced, parseLine } from "@gladlog/parser";

const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error("expected pilot.json and new-output.json");
const pilot = JSON.parse(readFileSync(input, "utf8")) as {
  manifestSha256: string;
  files: Array<{ path: string; sha256: string }>;
};

// Power types that only move in whole steps through logged events (no passive
// regeneration or decay inside a 1.5 s pair): combo points, soul shards, holy
// power, chi, arcane charges, essence.
const DISCRETE = new Set([4, 7, 9, 12, 16, 19]);
const PAIR_MS = 1500;
const GAIN_EVENTS = new Set(["SPELL_ENERGIZE", "SPELL_PERIODIC_ENERGIZE"]);

const inventory: Record<
  string,
  { n: number; known: number; paramLengths: Record<string, number> }
> = {};
type Layout = {
  n: number;
  actorIsDest: number;
  tailTypeInBlock: number;
  tailMaxEqualsBlockMax: number;
  overPositive: number;
  overPositiveAndCurrentIsMax: number;
  byPowerType: Record<string, number>;
};
const layout: Record<string, Layout> = {};
const costTiming = {
  castsWithCost: 0,
  costTypeInBlock: 0,
  // mana regenerates, so closest-of-two instead of exact
  mana: { pairs: 0, closerToBeforeCost: 0, closerToAfterCost: 0 },
};
const blockPowerTypes: Record<string, number> = {};
// Discrete types turn out to appear in a block ONLY on the cast that spends
// them. Ledger test: between two spender casts of one actor,
// next.current == prev.current − prev.cost + Σ(ENERGIZE amounts of that type).
const secondaryBlocks: Record<
  string,
  { blocks: number; onCastSuccess: number; withCost: number }
> = {};
const ledger: Record<
  string,
  { pairs: number; exact: number; offByUnderOneGain: number; other: number }
> = {};
const lostSamples = { playerBlocks: 0, withMana: 0, otherActorBlocks: 0 };

type Snap = {
  t: number;
  powers: Map<number, { current: number; max: number }>;
};

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

  const lastSnap = new Map<string, Snap>();
  const lastSpend = new Map<
    string,
    { current: number; cost: number; gained: number; maxGain: number }
  >();
  // actors whose power moved through a logged event since their last sample
  const dirty = new Set<string>();
  // a cast waiting for the actor's next sample
  const pendingCost = new Map<
    string,
    { t: number; type: number; current: number; cost: number }
  >();

  for (const row of raw.split(/\r?\n/)) {
    const p = parseLine(row);
    if (!p) continue;
    if (
      p.eventName === "ARENA_MATCH_START" ||
      p.eventName === "ARENA_MATCH_END"
    ) {
      lastSnap.clear();
      lastSpend.clear();
      dirty.clear();
      pendingCost.clear();
      continue;
    }
    const isResourceEvent = /ENERGIZE|DRAIN|LEECH/.test(p.eventName);
    if (isResourceEvent) {
      const inv = (inventory[p.eventName] ??= {
        n: 0,
        known: 0,
        paramLengths: {},
      });
      inv.n++;
      if (p.known) inv.known++;
      inv.paramLengths[p.params.length] =
        (inv.paramLengths[p.params.length] ?? 0) + 1;
    }
    // L1 attaches no advanced block to resource events; decode it the same way.
    const adv =
      p.advanced ??
      (isResourceEvent ? decodeAdvanced(p.params, 11) : undefined);
    if (!adv || !adv.actorGuid || adv.actorGuid === "0000000000000000")
      continue;
    const powers = new Map(
      adv.powers.map((x) => [x.powerType, { current: x.current, max: x.max }]),
    );
    const actor = adv.actorGuid;

    if (isResourceEvent) {
      if (actor.startsWith("Player-")) {
        lostSamples.playerBlocks++;
        if (powers.has(0)) lostSamples.withMana++;
      } else lostSamples.otherActorBlocks++;
    }

    if (GAIN_EVENTS.has(p.eventName)) {
      const n = p.params.length;
      const amount = Number(p.params[n - 4]);
      const over = Number(p.params[n - 3]);
      const type = Number(p.params[n - 2]);
      const tailMax = Number(p.params[n - 1]);
      const L = (layout[p.eventName] ??= {
        n: 0,
        actorIsDest: 0,
        tailTypeInBlock: 0,
        tailMaxEqualsBlockMax: 0,
        overPositive: 0,
        overPositiveAndCurrentIsMax: 0,
        byPowerType: {},
      });
      L.n++;
      // PERIODIC events get no `base` from L1, so read the raw dest GUID.
      if (actor === p.params[4]) L.actorIsDest++;
      L.byPowerType[type] = (L.byPowerType[type] ?? 0) + 1;
      const open = lastSpend.get(`${actor}|${type}`);
      if (open && amount > 0) {
        open.gained += amount;
        open.maxGain = Math.max(open.maxGain, amount);
      }
      const inBlock = powers.get(type);
      if (inBlock) {
        L.tailTypeInBlock++;
        if (inBlock.max === tailMax) L.tailMaxEqualsBlockMax++;
        if (over > 0) {
          L.overPositive++;
          if (inBlock.current === inBlock.max) L.overPositiveAndCurrentIsMax++;
        }
      }
    }

    // Resolve a pending cast cost against this (the actor's next) sample.
    const pending = pendingCost.get(actor);
    if (pending) {
      pendingCost.delete(actor);
      const now = powers.get(pending.type);
      if (now && p.timestamp - pending.t <= PAIR_MS && !isResourceEvent) {
        const d = now.current - pending.current;
        if (pending.type === 0) {
          costTiming.mana.pairs++;
          if (Math.abs(d + pending.cost) < Math.abs(d))
            costTiming.mana.closerToBeforeCost++;
          else costTiming.mana.closerToAfterCost++;
        }
      }
    }

    if (p.eventName === "SPELL_CAST_SUCCESS" && actor === p.base?.srcGuid) {
      // powerCost sits just before x; decodeAdvanced found x, so mirror it.
      const at = p.params.indexOf(actor, 8);
      let xIdx = -1;
      for (let k = at + 4; k < p.params.length - 1; k++)
        if (p.params[k].includes(".") && p.params[k + 1].includes(".")) {
          xIdx = k;
          break;
        }
      const costs = (p.params[xIdx - 1] ?? "").split("|").map(Number);
      const types = (p.params[xIdx - 4] ?? "").split("|").map(Number);
      const i = costs.findIndex((c) => c > 0);
      types.forEach((type, k) => {
        if (!DISCRETE.has(type)) return;
        const cur = powers.get(type);
        if (!cur) return;
        const sb = (secondaryBlocks[`type ${type}`] ??= {
          blocks: 0,
          onCastSuccess: 0,
          withCost: 0,
        });
        sb.onCastSuccess++;
        if (!(costs[k] > 0)) return;
        sb.withCost++;
        const key = `${actor}|${type}`;
        const before = lastSpend.get(key);
        if (before) {
          const L = (ledger[`type ${type}`] ??= {
            pairs: 0,
            exact: 0,
            offByUnderOneGain: 0,
            other: 0,
          });
          L.pairs++;
          const miss =
            cur.current - (before.current - before.cost + before.gained);
          if (miss === 0) L.exact++;
          else if (Math.abs(miss) <= before.maxGain) L.offByUnderOneGain++;
          else L.other++;
        }
        lastSpend.set(key, {
          current: cur.current,
          cost: costs[k],
          gained: 0,
          maxGain: 0,
        });
      });
      if (xIdx > 0 && i >= 0) {
        costTiming.castsWithCost++;
        costTiming.costTypeInBlock += powers.has(types[i]) ? 1 : 0;
        const cur = powers.get(types[i]);
        if (cur)
          pendingCost.set(actor, {
            t: p.timestamp,
            type: types[i],
            current: cur.current,
            cost: costs[i],
          });
        // only a cast that actually spent something muddies the next pair
        dirty.add(actor);
      } else dirty.delete(actor);
    } else if (isResourceEvent) dirty.add(actor);
    else dirty.delete(actor);
    for (const t of powers.keys()) {
      blockPowerTypes[t] = (blockPowerTypes[t] ?? 0) + 1;
      if (DISCRETE.has(t))
        (secondaryBlocks[`type ${t}`] ??= {
          blocks: 0,
          onCastSuccess: 0,
          withCost: 0,
        }).blocks++;
    }

    lastSnap.set(actor, { t: p.timestamp, powers });
  }
}

const result = {
  manifestSha256: pilot.manifestSha256,
  sampledFiles: pilot.files.length,
  scope:
    "Same pilot sample. Tail read as the last four params (amount, over, powerType, maxPower). Timing pairs: same actor, within 1.5 s, discrete power types only for exact tests; mana uses closest-of-two because it regenerates.",
  inventory,
  layout,
  costTiming,
  lostSamples,
  blockPowerTypes,
  secondaryBlocks,
  ledger,
};
writeFileSync(output, JSON.stringify(result, null, 2), { flag: "wx" });
console.log(JSON.stringify(result, null, 2));
