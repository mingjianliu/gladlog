/* eslint-disable @typescript-eslint/no-explicit-any -- scan over raw parse output */
/**
 * scan5/t159.ts — pipeline T159 (GH #218 3.10), count first: an aligned
 * burst window's `damageInWindow` and `damageRatio` (`enemyCDs.ts`) sum
 * every damage row on the owner's side, whoever dealt it, and the window's
 * `dangerScore` / `dangerLabel` read that ratio. Damage a player did to
 * itself (Burning Rush, Shadow Word: Death's backlash, Stagger) or a
 * teammate did is not the enemy's burst.
 *
 * Counted, per owner context: every aligned burst window of the owner's
 * timeline (the product's own call). The rows are the product's own
 * (pipeline T330): the side's `damageIn` rows the window sums read,
 * `isRoundLandedDamageRow` with the round's roster sides and
 * `roundDamageEndMs` — no moved health (Spirit Link, Void Leech, Tempered
 * in Battle: T223), nothing past the round's end. Of those (`sideRowBucket`):
 *  - `own`: a teammate's straight hit — a same-side source by the
 *    product's reading (`isSameSideSource`: a summon reads as its owner, a
 *    charmed player's row as an attack across the charm), or the row's own
 *    flags put the source or the victim on the other side;
 *  - `self`: the victim's own row (Burning Rush; Shadow Word: Death's
 *    backlash, which the log writes with no source and the victim's side in
 *    its flags), listed apart (user ruling 2026-11-28);
 *  - the enemy's pressure: everything else, including a reflected spell
 *    coming back in its caster's name (`isReflectedReturn`), a transfer
 *    (`isAttackerDamageRow`: a DAMAGE_SPLIT — Blessing of Sacrifice, Soul
 *    Link — or Roar of Sacrifice), a deferral shield's tick
 *    (`isDeferredTickId`: Time Dilation, Stretch Time, Fel Armor,
 *    Refraction) and the enemy-caused own rows
 *    (`ENEMY_CAUSED_SELF_DAMAGE_IDS`: Ultimate Sacrifice's and Blessing of
 *    Dawn's moved damage, the paladin's own 199450 / 210380; Cauterize's burn after it ate a killing blow, the
 *    mage's own 87023). By standing rulings the tick is the damage (FT-T02b,
 *    2026-10-09), and only redistribution leaves the pressure, never a
 *    sacrifice transfer or a charmed teammate's damage (2026-09-30,
 *    `REDISTRIBUTION_DAMAGE_IDS`). B-report section 13 (605 at 3bf27b642):
 *    all 126 in-total rows were those, or moved with the slice average they
 *    moved.
 * The window's ratio is then recomputed with the `own` rows left out of
 * BOTH the window's damage and the slice's average (clamped and spanned as
 * the product's is: `burstWindowRateSpanSeconds`, the two bounds).
 *
 * Check `burstRatioOwnSideDamage`, kinds:
 *  - `label reads high` / `label reads low` — the window's `dangerLabel`
 *    differs from the label of its own score at the ratio without the
 *    teammates' straight hits (`rateVerdict`, the T91 reading);
 *  - `units' own damage: label reads high|low` — out of the total (user
 *    ruling 2026-11-28, pipeline T330: a unit's own damage — Burning Rush,
 *    Shadow Word: Death's backlash — is listed apart, not judged): the
 *    label stands without the teammates' hits and moves once the units' own
 *    rows are left out too;
 *  - `ratio off, same label` — out of the total: the ratio moves by more
 *    than 2 %, the label stands;
 *  - `own side share ≥ 10 %` — out of the total, a measurement: a tenth or
 *    more of the window's damage is the side's own.
 * The examples carry the top own-side spell of the window.
 */
import {
  REFLECT_DAMAGE_WINDOW_S,
  REFLECT_OWN_ID_LEAD_MS,
  reflectedCopyUp,
  reflectRowsByCaster,
} from "@gladlog/analysis/src/context/spellOutcomeLines";
import { ENEMY_CAUSED_SELF_DAMAGE_IDS } from "@gladlog/analysis/src/data/enemyCausedSelfDamage";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import {
  BURST_DAMAGE_RATIO_MAX,
  BURST_DAMAGE_RATIO_MIN,
  burstWindowRateSpanSeconds,
  reconstructEnemyCDTimeline,
} from "@gladlog/analysis/src/utils/enemyCDs";
import {
  isDeferredTickId,
  isRoundLandedDamageRow,
} from "@gladlog/analysis/src/utils/incomingPressure";
import { isAttackerDamageRow } from "@gladlog/analysis/src/utils/killingBlow";
import {
  buildRosterSides,
  isSameSideSource,
  type RosterSides,
} from "@gladlog/analysis/src/utils/rosterSide";
import { roundDamageEndMs } from "@gladlog/analysis/src/utils/roundEnd";
import { CombatUnitReaction, getUnitReaction } from "@gladlog/parser-compat";

import { fmtS, type IRoundCtx, nameOf } from "./ctx";
import { rateVerdict } from "./t91";

export const CHECKS = ["burstRatioOwnSideDamage"] as const;
const NO_UNIT = "0000000000000000";
const LABEL_KINDS: ReadonlySet<string> = new Set([
  "label reads high",
  "label reads low",
]);
const SELF_KIND_PREFIX = "units' own damage: ";
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "burstRatioOwnSideDamage|ratio off, same label",
  "burstRatioOwnSideDamage|own side share ≥ 10 %",
  ...[...LABEL_KINDS].map(
    (k) => `burstRatioOwnSideDamage|${SELF_KIND_PREFIX}${k}`,
  ),
]);

const SHARE_NOTED = 0.1;

/** The row's own flags put its source or its victim on the other side from
 * the roster's: a Mind Control the log writes as a plain hostile player
 * (0x548, no pet type bit, so `isControlledPlayerFlags` misses it —
 * ab7fbe2e r1 4:43, a Balance Druid's Moonfire on its own teammates). */
const flagsCrossSide = (
  e: any,
  side: CombatUnitReaction | undefined,
): boolean =>
  [e.srcUnitFlags, e.destUnitFlags].some((f) => {
    if (typeof f !== "number") return false;
    const r = getUnitReaction(f);
    return (
      (r === CombatUnitReaction.Friendly || r === CombatUnitReaction.Hostile) &&
      r !== side
    );
  });

/** Which bucket a landed row on `u` falls in (see the header):
 *  - `own`: a teammate's straight hit — a same-side source
 *    (`isSameSideSource`) the row's own flags do not show across a charm
 *    (`flagsCrossSide`);
 *  - `self`: `u`'s own row (a summon of `u` reads as `u`, `ownerOf`) —
 *    listed apart, out of the total (user ruling 2026-11-28) — but for the
 *    enemy-caused ones (`ENEMY_CAUSED_SELF_DAMAGE_IDS`: Cauterize's burn,
 *    Ultimate Sacrifice's moved damage);
 *  - `pressure`: everything else — the enemy's hits, a transfer
 *    (`isAttackerDamageRow`), a deferral shield's tick (`isDeferredTickId`),
 *    a charmed unit's hits. */
/** A caster's counted REFLECT rows, for `isReflectedReturn`: the product's
 *  own set (`reflectRowsByCaster`, the rows `reflectedSpells` chains), so a
 *  Spell Reflection return the log wrote no REFLECT row for counts too
 *  (M5 assembly review 80-PIPE-261: a Flame Shock sent back with no REFLECT
 *  row, its 24k tick on the shaman filed as `self`). */
export type ReflectsByCaster = ReadonlyMap<
  string,
  ReadonlyArray<{ t: number; spellId: string; name: string }>
>;

export function reflectsByCaster(units: readonly any[]): ReflectsByCaster {
  const out = new Map<
    string,
    Array<{ t: number; spellId: string; name: string }>
  >();
  for (const [casterId, rows] of reflectRowsByCaster(units as never))
    if (rows.length > 0)
      out.set(
        casterId,
        rows.map((m) => ({
          t: m.logLine.timestamp,
          spellId: String(m.spellId),
          name: getEnglishSpellName(String(m.spellId), ""),
        })),
      );
  return out;
}

/** The row is a reflected spell coming back: its source had that spell (by
 *  id or English name, as the product's reflect chains match — a reflected
 *  Unstable Affliction's dispel backlash 196364 is named as its 1259790)
 *  reflected by an enemy from `REFLECT_OWN_ID_LEAD_MS` before the row to
 *  `REFLECT_DAMAGE_WINDOW_S` after the reflect (`reflectedSpells`' own
 *  bounds), or later while the reflected copy's aura still runs on its caster
 *  (`reflectedCopyUp`). The enemy's doing, written in the caster's name (codex
 *  85-claude-b-T330-1 #2: a912b05a r6 0:21, a Frostfire Bolt Nether Ward
 *  sent back, seven mage → mage rows). */
export function isReflectedReturn(
  u: any,
  e: any,
  reflects: ReflectsByCaster,
): boolean {
  const list = reflects.get(e.srcUnitId ?? "");
  if (!list) return false;
  const id = String(e.spellId ?? "");
  const name = id ? getEnglishSpellName(id, "") : "";
  const t = e.logLine?.timestamp ?? NaN;
  return list.some(
    (r) =>
      (r.spellId === id || (name !== "" && r.name === name)) &&
      t >= r.t - REFLECT_OWN_ID_LEAD_MS &&
      (t - r.t <= REFLECT_DAMAGE_WINDOW_S * 1000 ||
        // the reflected copy's ticks on its caster, for as long as its aura
        // runs (`reflectedCopyUp`, the product's own; codex
        // 85-claude-b-T330-1b: 64d4fe00 r2 Wither, four ticks 21–27 s on)
        (u.id === e.srcUnitId &&
          reflectedCopyUp(u, id, e.srcUnitId, t, r.t, r.t))),
  );
}

export function sideRowBucket(
  u: any,
  e: any,
  sides: RosterSides,
  ownerOf: ReadonlyMap<string, string>,
  reflects: ReflectsByCaster = new Map(),
): "own" | "self" | "pressure" {
  if (
    !isAttackerDamageRow(e) ||
    isDeferredTickId(e.spellId) ||
    isReflectedReturn(u, e, reflects)
  )
    return "pressure";
  const victimSide = sides.get(u.id) ?? u.reaction;
  // no source named, the victim's side in its flags: the unit's own
  // backlash (Shadow Word: Death 32409 `0000000000000000,nil,0x511` — the
  // only spell of that shape in 25 sampled archives, 74 rows)
  const unnamed = !e.srcUnitId || e.srcUnitId === NO_UNIT;
  if (
    (ownerOf.get(e.srcUnitId) ?? e.srcUnitId) === u.id ||
    (unnamed &&
      typeof e.srcUnitFlags === "number" &&
      getUnitReaction(e.srcUnitFlags) === victimSide)
  )
    return ENEMY_CAUSED_SELF_DAMAGE_IDS.has(String(e.spellId ?? ""))
      ? "pressure"
      : "self";
  if (unnamed) return "pressure";
  return isSameSideSource(
    u,
    e.srcUnitId,
    e.srcUnitFlags,
    sides,
    e.destUnitFlags,
  ) && !flagsCrossSide(e, victimSide)
    ? "own"
    : "pressure";
}

export function run(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  const friends = (ctx.players as any[]).filter(
    (p) => p.reaction === owner.reaction,
  );
  const enemies = (ctx.players as any[]).filter(
    (p) => p.reaction !== owner.reaction,
  );
  const ownerOf = new Map<string, string>();
  for (const u of ctx.units as any[])
    if (u.ownerId && u.ownerId !== "0000000000000000")
      ownerOf.set(u.id, u.ownerId);
  // the roster sides the product's window sums read (`enemyCDs.ts`)
  const sides = buildRosterSides(
    Object.values(ctx.legacy.units ?? {}) as never,
  );
  const reflects = reflectsByCaster(ctx.units as any[]);
  const combat = { ...ctx.legacy, startTime: ctx.start, endTime: ctx.end };
  // the round's end the burst readers stop at (`roundDamageEndMs`, T237)
  const dmgEnd = roundDamageEndMs({
    ...(ctx.legacy as any),
    endTime: ctx.end,
  });
  const sliceEndS = (dmgEnd - ctx.start) / 1000;
  if (!(sliceEndS > 0)) return;
  const timeline = reconstructEnemyCDTimeline(
    enemies as never,
    combat as never,
    owner as never,
    friends as never,
  );
  if (timeline.alignedBurstWindows.length === 0) return;

  // the side's damage rows of the slice, each with who dealt it
  const rows: Array<{ t: number; amount: number; side: string; id: string }> =
    [];
  for (const u of friends)
    for (const e of (u.damageIn ?? []) as any[]) {
      if (!isRoundLandedDamageRow(u, e, sides, dmgEnd)) continue;
      rows.push({
        t: (e.logLine.timestamp - ctx.start) / 1000,
        amount: Math.abs(e.effectiveAmount ?? 0),
        side: sideRowBucket(u, e, sides, ownerOf, reflects),
        id: String(e.spellId ?? ""),
      });
    }
  const sum = (rs: typeof rows, side?: string): number =>
    rs.reduce(
      (s, r) => s + (side === undefined || r.side === side ? r.amount : 0),
      0,
    );
  const total = sum(rows);
  const totalOwn = sum(rows, "own");
  const totalSelf = sum(rows, "self");
  if (!(total > 0) || !(total - totalOwn - totalSelf > 0)) return;

  for (const w of timeline.alignedBurstWindows) {
    if (!(w.damageRatio > 0)) continue;
    ctx.bump("burstRatioOwnSideDamage");
    const inW = rows.filter((r) => r.t >= w.fromSeconds && r.t <= w.toSeconds);
    const all = sum(inW);
    const own = sum(inW, "own");
    const self = sum(inW, "self");
    // a window with no row of a bucket still moves when the slice's
    // average does (codex 85-tk-WIN-T159-1 #1)
    if (!(own > 0) && !(self > 0) && totalOwn === 0 && totalSelf === 0)
      continue;
    const span = burstWindowRateSpanSeconds(
      w.fromSeconds,
      w.toSeconds,
      sliceEndS,
    );
    /** the window's ratio with `left` of it and `leftTotal` of the slice out */
    const ratioWithout = (left: number, leftTotal: number): number =>
      Math.min(
        BURST_DAMAGE_RATIO_MAX,
        Math.max(
          (all - left) / span / ((total - leftTotal) / sliceEndS),
          BURST_DAMAGE_RATIO_MIN,
        ),
      );
    const ratio = ratioWithout(own, totalOwn);
    const bySpell = new Map<string, number>();
    for (const r of inW)
      if (r.side === "own")
        bySpell.set(r.id, (bySpell.get(r.id) ?? 0) + r.amount);
    const [topId, topAmount] = [...bySpell].sort((a, b) => b[1] - a[1])[0] ?? [
      "",
      0,
    ];
    const at = ctx.start + w.fromSeconds * 1000;
    const id = `${owner.name}#${Math.round(w.fromSeconds * 1000)}`;
    const share = all > 0 ? own / all : 0;
    const detail = `window ${fmtS(w.fromSeconds)}–${fmtS(w.toSeconds)}: ${(share * 100).toFixed(1)} % of ${(all / 1000).toFixed(0)}k is the side's own (${own > 0 ? `top ${nameOf(topId, topId || "melee")} ${(topAmount / 1000).toFixed(0)}k` : "none in the window; the slice's average moves"}); ratio ${w.damageRatio.toFixed(2)} [${w.dangerLabel}]`;
    const verdict = rateVerdict(w, ratio);
    const { logLabel } = verdict;
    // no teammate's row in the slice: nothing to judge for them
    const kind = own > 0 || totalOwn > 0 ? verdict.kind : undefined;
    if (kind)
      ctx.violate(
        "burstRatioOwnSideDamage",
        kind,
        at,
        id,
        `${detail}, without it ${ratio.toFixed(2)} [${logLabel}]`,
      );
    // the unit's own damage, apart and out of the total (user ruling
    // 2026-11-28): the label moves once it is out too, and did not without it
    if ((self > 0 || totalSelf > 0) && !LABEL_KINDS.has(kind ?? "")) {
      const r2 = ratioWithout(own + self, totalOwn + totalSelf);
      const v2 = rateVerdict(w, r2);
      if (LABEL_KINDS.has(v2.kind ?? ""))
        ctx.violate(
          "burstRatioOwnSideDamage",
          `${SELF_KIND_PREFIX}${v2.kind}`,
          at,
          `${id}#self`,
          `window ${fmtS(w.fromSeconds)}–${fmtS(w.toSeconds)}: ${((all > 0 ? self / all : 0) * 100).toFixed(1)} % of ${(all / 1000).toFixed(0)}k is the units' own damage; ratio ${w.damageRatio.toFixed(2)} [${w.dangerLabel}], without it (and the teammates') ${r2.toFixed(2)} [${v2.logLabel}]`,
        );
    }
    if (share >= SHARE_NOTED)
      ctx.violate(
        "burstRatioOwnSideDamage",
        "own side share ≥ 10 %",
        at,
        `${id}#share`,
        detail,
      );
  }
}
