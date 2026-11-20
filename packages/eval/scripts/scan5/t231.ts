/* eslint-disable @typescript-eslint/no-explicit-any -- scan over raw parse output */
/**
 * scan5/t231.ts — pipeline T231, count first: the readers that still sum a
 * unit's raw `damageIn` rows with a teammate's redistribution inside
 * (`isRedistributedDamageRow`, utils/incomingPressure.ts), or did before
 * T231 migrated them.
 *
 * Where the reader has a producer a scan can call, the count ASKS THE
 * PRODUCT twice — on the round as parsed, and on a copy whose units carry no
 * redistribution row in `damageIn` — and counts the outputs that differ:
 *  - `killAttemptRedistribution`: `extractKillAttempts` per side. Kinds:
 *    `outhealed flips` (killAttempts.ts `attributeFailure`), `primary
 *    differs`, `external account differs` (killAttemptSaveAccount.ts, through
 *    `externalReceived` / `externalTogether` / `externalAccountDropped`),
 *    `other attribution field differs`, `attempt set differs`.
 *  - `cleansePenaltyRedistribution`: `reconstructDispelSummary` per side, the
 *    ally cleanses' `penaltyDamageTaken` / `penaltyDamageBaseline`
 *    (dispelAnalysis.ts). Kinds: `sum differs`, `trend text differs` (the
 *    backlash-dispel fact `selfDmgTrend` restated: thousands, rounded).
 * The copy moves every other reader inside those producers too (a hit's
 * existence, the HP ledger): a difference is an upper bound on the reader
 * named, and `attempt set differs` says how often that happens.
 *
 * Where no producer can be called from here the count is an EXPOSURE (rows
 * the reader would see), not the product's answer:
 *  - `redistributionExposure`: `player-round holds a row` (the desktop
 *    damage-taken breakdown / meter / export and the benchmark pressure
 *    buckets read these), `death window holds a row` (the 15 s before a
 *    player's death: the desktop death recap, the counterfactual window) and
 *    of those `… with a Preservation Evoker on the side` (counterfactual.ts
 *    `savedByTimeDilation` can only be reached there).
 */
import {
  EVENT_COOLDOWN_REDUCTIONS,
  hostileTakenTriggers,
} from "@gladlog/analysis/src/data/talentScriptedCooldowns";
import { playerTalentIdSets } from "@gladlog/analysis/src/utils/cooldowns";
import { reconstructDispelSummary } from "@gladlog/analysis/src/utils/dispelAnalysis";
import {
  isRedistributedDamageRow,
  REDISTRIBUTION_DAMAGE_IDS,
} from "@gladlog/analysis/src/utils/incomingPressure";
import { extractKillAttempts } from "@gladlog/analysis/src/utils/killAttempts";
import {
  buildRosterSides,
  isSameSideSource,
} from "@gladlog/analysis/src/utils/rosterSide";
import { CombatUnitSpec } from "@gladlog/parser-compat";

import { type IRoundCtx, nameOf } from "./ctx";

const KA = "killAttemptRedistribution";
const CP = "cleansePenaltyRedistribution";
const EX = "redistributionExposure";
/** codex 85-tk-WIN-T231-1 #2: a "being attacked" event cooldown reduction
 * (Driven to Madness, Impish Instincts) fired by a moved-health row — an
 * inventory for its own ticket, NOT changed by T231 */
const AT = "attackedReductionRedistribution";
export const CHECKS = [KA, CP, EX, AT] as const;
const KINDS = {
  [KA]: [
    "outhealed flips",
    "primary differs",
    "external account differs",
    "other attribution field differs",
    "attempt set differs",
    "outhealed flips, damage AND heal sides off",
    "primary differs, damage AND heal sides off",
  ],
  [CP]: ["sum differs", "trend text differs"],
  [EX]: [
    "player-round holds a row",
    "death window holds a row",
    "death window holds a row, with a Preservation Evoker on the side",
  ],
  [AT]: [
    "holder of the talent takes a moved-health row",
    "a reduction fires only because of a moved-health row",
  ],
} as const;
/** In the total once T231 migrated the reader: the cleanse penalty sums
 * and the save account must not move when the rows are taken off. The rest
 * stays an inventory — `outhealed` by user ruling R100 (both sides keep
 * counting), the exposure rows by R101 (desktop) and GH #115 (benchmark). */
const IN_TOTAL = new Set([
  `${CP}|sum differs`,
  `${CP}|trend text differs`,
  `${KA}|external account differs`,
]);
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set(
  Object.entries(KINDS)
    .flatMap(([c, ks]) => ks.map((k) => `${c}|${k}`))
    .filter((k) => !IN_TOTAL.has(k)),
);

const DEATH_WINDOW_MS = 15_000;
const k = (n: number) => Math.round(n / 1000);
const sum = (rows: readonly any[]) =>
  rows.reduce((n: number, d: any) => n + Math.abs(d.effectiveAmount ?? 0), 0);
const trend = (b = 0, a = 0) =>
  k(b) === k(a)
    ? `flat at ${k(a)}k`
    : `${a > b ? "rose" : "fell"} ${k(b)}k -> ${k(a)}k`;

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  const legacy = ctx.legacy as any;
  const units = Object.values(legacy.units) as any[];
  const sides = buildRosterSides(units);
  const moved = (u: any) =>
    ((u.damageIn ?? []) as any[]).filter((d) =>
      isRedistributedDamageRow(u, d, sides),
    );
  const players = ctx.players as any[];
  const holders = players.filter((p) => moved(p).length > 0);

  // the "being attacked" reductions, as the product reads them
  // (`hostileTakenTriggers`), with and without the moved-health rows
  const attacked = Object.entries(EVENT_COOLDOWN_REDUCTIONS).filter(
    ([, r]) => r.triggerHostileTaken,
  );
  for (const p of players) {
    const rows = moved(p);
    const pvp = playerTalentIdSets(p).pvpTalentIds;
    for (const [key, r] of attacked) {
      if (!pvp.has(r.talentSpellId ?? key)) continue;
      ctx.bump(AT);
      if (rows.length === 0) continue;
      const at = rows[0].logLine.timestamp;
      ctx.violate(
        AT,
        "holder of the talent takes a moved-health row",
        at,
        `${p.id}#${key}#holds`,
        `${p.name} holds ${nameOf(key, key)}: ${rows.length} moved-health rows`,
      );
      const real = hostileTakenTriggers(p, r).map((t) => t.atMs);
      const cut = hostileTakenTriggers(
        {
          ...p,
          damageIn: (p.damageIn as any[]).filter((d) => !rows.includes(d)),
        },
        r,
      ).map((t) => t.atMs);
      const extra = real.filter((t) => !cut.includes(t));
      if (extra.length)
        ctx.violate(
          AT,
          "a reduction fires only because of a moved-health row",
          extra[0]!,
          `${p.id}#${key}#fires`,
          `${p.name} ${nameOf(key, key)}: ${extra.length} of ${real.length} reductions (${r.seconds} s each) only with the moved-health rows; ${cut.length} without`,
        );
    }
  }

  // exposure
  for (const p of players) {
    ctx.bump(EX);
    const rows = moved(p);
    if (rows.length)
      ctx.violate(
        EX,
        KINDS[EX][0],
        rows[0].logLine.timestamp,
        `${p.id}#round`,
        `${p.name}: ${rows.length} rows, ${k(sum(rows))}k of ${k(sum(p.damageIn ?? []))}k taken in the round (${k(sum(p.damageIn ?? []) - sum(rows))}k without)`,
      );
    for (const dr of (p.deathRecords ?? []) as any[]) {
      const dMs = dr.timestamp as number;
      const inW = rows.filter(
        (d) =>
          d.logLine.timestamp >= dMs - DEATH_WINDOW_MS &&
          d.logLine.timestamp <= dMs,
      );
      if (!inW.length) continue;
      const allW = ((p.damageIn ?? []) as any[]).filter(
        (d) =>
          d.logLine.timestamp >= dMs - DEATH_WINDOW_MS &&
          d.logLine.timestamp <= dMs,
      );
      const detail = `${p.name} death +${dMs - ctx.start}ms: ${inW.length} rows, ${k(sum(inW))}k of ${k(sum(allW))}k in the 15 s`;
      ctx.violate(EX, KINDS[EX][1], dMs, `${p.id}#death#${dMs}`, detail);
      if (
        players.some(
          (q) =>
            q.reaction === p.reaction &&
            q.spec === CombatUnitSpec.Evoker_Preservation,
        )
      )
        ctx.violate(EX, KINDS[EX][2], dMs, `${p.id}#deathTD#${dMs}`, detail);
    }
  }
  if (!units.some((u) => moved(u).length > 0)) {
    // no row anywhere: the two producers cannot differ; count what they
    // would have been asked about only where a row exists
    return;
  }
  void holders;

  // the round with no redistribution row in any unit's damageIn
  const strippedById = new Map<string, any>(
    units.map((u) => {
      const gone = new Set(moved(u));
      return [
        u.id,
        gone.size
          ? {
              ...u,
              damageIn: (u.damageIn as any[]).filter((d) => !gone.has(d)),
            }
          : u,
      ];
    }),
  );
  const stripped = {
    ...legacy,
    units: Object.fromEntries(strippedById),
  };
  const map = (us: any[]) => us.map((u) => strippedById.get(u.id) ?? u);
  // …and with the health the same effects GAVE taken off `healIn` too. No
  // product predicate names those rows: this file's own reading — a heal
  // row from the unit's own side whose spell carries the name of a
  // redistribution damage id (Spirit Link 98021 heals under its own id,
  // Void Leech under 451964).
  const movedNames = new Set(
    [...REDISTRIBUTION_DAMAGE_IDS].map((id) => nameOf(id, id)),
  );
  const bothById = new Map<string, any>(
    units.map((u) => {
      const base = strippedById.get(u.id) ?? u;
      const heals = ((u.healIn ?? []) as any[]).filter(
        (h) =>
          movedNames.has(nameOf(h.spellId, h.spellName ?? "")) &&
          isSameSideSource(
            u,
            h.srcUnitId,
            h.srcUnitFlags,
            sides,
            h.destUnitFlags,
          ),
      );
      if (!heals.length) return [u.id, base];
      const gone = new Set(heals);
      return [
        u.id,
        { ...base, healIn: (u.healIn as any[]).filter((h) => !gone.has(h)) },
      ];
    }),
  );
  const both = { ...legacy, units: Object.fromEntries(bothById) };
  const mapBoth = (us: any[]) => us.map((u) => bothById.get(u.id) ?? u);

  for (const side of new Set(players.map((p) => p.reaction as number))) {
    const friends = players.filter((u) => u.reaction === side);
    const enemies = players.filter((u) => u.reaction !== side);

    // kill attempts on the other side's players
    const key = (a: any) =>
      `${a.targetUnitId}#${a.anchor}#${Math.round(a.fromSeconds * 1000)}`;
    let real: any[] = [];
    let alt: any[] = [];
    try {
      real = extractKillAttempts(friends, enemies, legacy);
      alt = extractKillAttempts(map(friends), map(enemies), stripped);
    } catch {
      real = alt = [];
    }
    const altBy = new Map(alt.map((a) => [key(a), a]));
    let alt2: any[] = [];
    try {
      alt2 = extractKillAttempts(mapBoth(friends), mapBoth(enemies), both);
    } catch {
      alt2 = [];
    }
    const alt2By = new Map(alt2.map((a) => [key(a), a]));
    for (const a of real) {
      ctx.bump(KA);
      const at = ctx.start + a.fromSeconds * 1000;
      const b = altBy.get(key(a));
      const who = `${a.targetName} ${a.fromSeconds.toFixed(1)}–${a.toSeconds.toFixed(1)} s`;
      const b2 = alt2By.get(key(a));
      if (b2 && !!b2.attribution?.outhealed !== !!a.attribution?.outhealed)
        ctx.violate(
          KA,
          KINDS[KA][5],
          at,
          `${side}#${key(a)}#outhealed2`,
          `${who}: outhealed ${a.attribution?.outhealed} -> ${b2.attribution?.outhealed}; primary ${a.attribution?.primary} -> ${b2.attribution?.primary}`,
        );
      if (b2 && b2.attribution?.primary !== a.attribution?.primary)
        ctx.violate(
          KA,
          KINDS[KA][6],
          at,
          `${side}#${key(a)}#primary2`,
          `${who}: primary ${a.attribution?.primary} -> ${b2.attribution?.primary}`,
        );
      if (!b) {
        ctx.violate(KA, KINDS[KA][4], at, `${side}#${key(a)}#set`, who);
        continue;
      }
      const x = a.attribution ?? {};
      const y = b.attribution ?? {};
      const diff = Object.keys({ ...x, ...y }).filter(
        (f) => JSON.stringify(x[f]) !== JSON.stringify(y[f]),
      );
      if (!diff.length) continue;
      const detail = `${who}: ${diff.map((f) => `${f} ${JSON.stringify(x[f])} -> ${JSON.stringify(y[f])}`).join("; ")}`;
      const id = `${side}#${key(a)}`;
      if (diff.includes("outhealed"))
        ctx.violate(KA, KINDS[KA][0], at, `${id}#outhealed`, detail);
      if (diff.includes("primary"))
        ctx.violate(KA, KINDS[KA][1], at, `${id}#primary`, detail);
      if (diff.some((f) => f.startsWith("external")))
        ctx.violate(KA, KINDS[KA][2], at, `${id}#external`, detail);
      if (
        diff.some(
          (f) =>
            f !== "outhealed" && f !== "primary" && !f.startsWith("external"),
        )
      )
        ctx.violate(KA, KINDS[KA][3], at, `${id}#other`, detail);
    }
    if (alt.length !== real.length)
      ctx.violate(
        KA,
        KINDS[KA][4],
        ctx.start,
        `${side}#count`,
        `attempts ${real.length} -> ${alt.length}`,
      );

    // ally cleanses' penalty sums
    const fIds = new Set(friends.map((u) => u.id));
    const eIds = new Set(enemies.map((u) => u.id));
    const fPets = units.filter((u) => u.ownerId && fIds.has(u.ownerId));
    const ePets = units.filter((u) => u.ownerId && eIds.has(u.ownerId));
    let rc: any[] = [];
    let ac: any[] = [];
    try {
      rc = reconstructDispelSummary(friends, enemies, legacy, fPets, ePets)
        .allyCleanse as any[];
      ac = reconstructDispelSummary(
        map(friends),
        map(enemies),
        stripped,
        map(fPets),
        map(ePets),
      ).allyCleanse as any[];
    } catch {
      rc = ac = [];
    }
    const ck = (e: any) =>
      `${e.sourceName}#${e.targetName}#${e.dispelSpellId}#${e.removedSpellId}#${Math.round(e.timeSeconds * 1000)}`;
    const acBy = new Map(ac.map((e) => [ck(e), e]));
    for (const e of rc) {
      if (!e.hasDispelPenalty) continue;
      ctx.bump(CP);
      const o = acBy.get(ck(e));
      if (!o) continue;
      const at = ctx.start + e.timeSeconds * 1000;
      const detail = `${e.sourceName} ${e.dispelSpellName} off ${e.removedSpellName} at ${e.timeSeconds.toFixed(1)} s: before ${e.penaltyDamageBaseline ?? 0} -> ${o.penaltyDamageBaseline ?? 0}, after ${e.penaltyDamageTaken ?? 0} -> ${o.penaltyDamageTaken ?? 0}`;
      if (
        (e.penaltyDamageTaken ?? 0) !== (o.penaltyDamageTaken ?? 0) ||
        (e.penaltyDamageBaseline ?? 0) !== (o.penaltyDamageBaseline ?? 0)
      )
        ctx.violate(CP, KINDS[CP][0], at, `${side}#${ck(e)}#sum`, detail);
      const t1 = trend(e.penaltyDamageBaseline, e.penaltyDamageTaken);
      const t2 = trend(o.penaltyDamageBaseline, o.penaltyDamageTaken);
      if (t1 !== t2)
        ctx.violate(
          CP,
          KINDS[CP][1],
          at,
          `${side}#${ck(e)}#trend`,
          `${detail}; ${t1} => ${t2}`,
        );
    }
  }
}
