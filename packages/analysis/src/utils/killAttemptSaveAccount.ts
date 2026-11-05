/**
 * killAttemptSaveAccount.ts — the damage account behind "was the external
 * that was ALREADY UP when a kill attempt began what saved the target?"
 * (GH #146 item 2; user rulings 2026-11-03 / 2026-11-04).
 *
 * The rule: such an external is named in `FAILED: saved by external (…)`
 * only when the log's own damage shows the target would have died without
 * it. Taking it away, hit by hit, inside the attempt's credit window:
 *  - a percentage reduction (`MITIGATION_TABLE` row): every hit it covered
 *    (its school mask, while its aura was on the target) was
 *    `landed / (1 − pct)` before it — reductions MULTIPLY, so taking one away
 *    divides by its own factor alone, whatever else was up (measured on the
 *    605 corpus 2026-11-04 through `damage.baseAmount`, the pre-reduction
 *    amount the parser decodes: Ironbark + Die by the Sword 0.55 landed of
 *    base vs 0.56 multiplied / 0.50 added; Ironbark + Survival of the Fittest
 *    0.60 vs 0.60 / 0.55; Defensive Stance + Die by the Sword 0.59 vs 0.595 /
 *    0.55; Barkskin + Ironbark 0.57 vs 0.56 / 0.50);
 *  - a shield (DB2 aura 69): what its own `SPELL_ABSORBED` rows ate.
 * The extra damage builds a deficit; a heal's overhealing pays it back (the
 * lower target would have taken that healing). The target "would have died"
 * when any HP reading of its own inside the window, minus the deficit so far,
 * is at or below zero — user ruling A (2026-11-04): strictly, no margin.
 *
 * Taken away one at a time (user, 2026-11-04 「逐个去掉分析」). When no single
 * one decides it but the target would have died without all of the
 * already-up reductions together, those are named together
 * (`X [up since m:ss] + Y together`).
 *
 * Not accounted — named as before whenever up (user ruling 2026-11-04, A for
 * every save that is no percentage and no shield): Guardian Spirit, Blessing
 * of Protection, Rallying Cry, … and the three below whose table row or
 * shield is not what they do.
 */
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { ABILITY_EFFECTS_GENERATED } from "../data/abilityEffectsGenerated";
import { castAndEffectIds } from "../data/castEffectAuras";
import {
  resolveMitigation,
  strongestComponentPct,
} from "../data/mitigationComponents";
import { MITIGATION_TABLE } from "../data/mitigationData";
import { TIME_DILATION_ID } from "./deferralShield";
import { wallTableIdOfAura } from "./enemyDefensives";
import {
  absorbedHitSchoolMask,
  hitSchoolId,
  logSchoolMask,
} from "./incomingPressure";

/**
 * Saves whose table row or shield rows do not measure what they prevent,
 * kept on "named whenever up" with the non-percentage saves (user ruling A,
 * 2026-11-04): Time Dilation defers half of each hit to later (its
 * `SPELL_ABSORBED` rows come back as damage), Blessing of Sacrifice moves
 * damage onto the paladin, Spirit Link Totem redistributes health (its 10 %
 * row is the small part of it).
 */
export const UNACCOUNTED_SAVE_IDS: ReadonlySet<string> = new Set([
  TIME_DILATION_ID,
  "6940", // Blessing of Sacrifice
  // …and its talented press, Ultimate Sacrifice (cast and aura), the same
  // transfer: its DB2 row carries an absorb effect, so the account took it
  // for a shield and dropped one already-up "Blessing of Sacrifice" (605
  // preview 2026-11-04, 0:53 Bestial Wrath burst)
  "199448",
  "98008", // Spirit Link Totem (cast)
  "325174", // Spirit Link Totem (aura)
]);

/** One save the account can take away. */
export interface IAccountedSave {
  name: string;
  kind: "pct" | "absorb";
  /** pct kind: the reduction, 0–100 */
  pct: number;
  schoolMask: number;
  /** absorb kind: the shield ids its `SPELL_ABSORBED` rows carry */
  shieldIds: ReadonlySet<string>;
  /** round seconds the save was on the target */
  fromS: number;
  toS: number;
}

/**
 * The save as the account prices it, or undefined when it is not accounted
 * (no percentage row, no shield, or `UNACCOUNTED_SAVE_IDS`). A percentage is
 * the strongest component's LOWER bound, as the wall loop of
 * `attributeFailure` prices a wall — the strict reading can only name a save
 * the log proves.
 */
export function accountedSave(
  save: {
    name: string;
    /** the aura (or area save) id on the target */
    spellId: string;
    /** the cast id, when it differs */
    castId?: string;
    fromS: number;
    toS: number;
  },
  carrier: { unit: ICombatUnit; isCaster: boolean },
): IAccountedSave | undefined {
  const ids = [save.spellId, save.castId].filter((x): x is string => !!x);
  if (ids.some((id) => UNACCOUNTED_SAVE_IDS.has(id))) return undefined;
  for (const id of ids) {
    const key = wallTableIdOfAura(id);
    const entry = MITIGATION_TABLE[key];
    if (!entry || entry.positional || entry.pct >= 100) continue;
    const res = resolveMitigation(key, {
      carrierIsCaster: carrier.isCaster,
      caster: carrier.isCaster ? carrier.unit : undefined,
    });
    const pct = res && strongestComponentPct(res)?.pctMin;
    if (!pct || pct <= 0 || pct >= 100) continue;
    return {
      name: save.name,
      kind: "pct",
      pct,
      schoolMask: entry.schoolMask,
      shieldIds: new Set(),
      fromS: save.fromS,
      toS: save.toS,
    };
  }
  const shieldIds = new Set(ids.flatMap((id) => [...castAndEffectIds(id)]));
  if (![...shieldIds].some((id) => ABILITY_EFFECTS_GENERATED[id]?.absorbs))
    return undefined;
  return {
    name: save.name,
    kind: "absorb",
    pct: 0,
    schoolMask: 0x7f,
    shieldIds,
    fromS: save.fromS,
    toS: save.toS,
  };
}

/**
 * Would the target have died inside [fromMs, toMs] with `removed` taken
 * away? See the file header for the arithmetic.
 */
export function wouldHaveDiedWithout(
  target: ICombatUnit,
  matchStartMs: number,
  fromMs: number,
  toMs: number,
  removed: readonly IAccountedSave[],
): boolean {
  if (!removed.length) return false;
  const inWindow = (ts: number) => ts >= fromMs && ts <= toMs;
  const tS = (ts: number) => (ts - matchStartMs) / 1000;
  const pcts = removed.filter((s) => s.kind === "pct");
  const shields = removed.filter((s) => s.kind === "absorb");
  // 0 hit, 1 shield row, 2 heal, 3 HP reading, in log order: by
  // millisecond, then by source line where both carry one (a reading is the
  // HP after its own row — and before the next row of the same millisecond,
  // codex review 2026-11-04), then by kind
  type Ev = {
    ts: number;
    line?: number;
    k: 0 | 1 | 2 | 3;
    v: number;
    school?: number;
  };
  const evs: Ev[] = [];
  for (const d of target.damageIn) {
    const ts = d.logLine.timestamp;
    if (!inWindow(ts) || d.logLine.event === LogEvent.SPELL_ABSORBED) continue;
    const v = Math.abs(d.effectiveAmount);
    if (v > 0)
      evs.push({
        ts,
        line: d.logLine.lineIndex,
        k: 0,
        v,
        school: logSchoolMask(hitSchoolId(d)),
      });
  }
  // a row without the attack's spell is a swing only on documents that
  // record the field at all — `incomingPressureBySchool`'s era rule
  const swingWhenNoSpell = (target.absorbsIn ?? []).some(
    (a) => a.attackSpellId !== undefined,
  );
  if (shields.length)
    for (const a of target.absorbsIn ?? []) {
      const ts = a.logLine.timestamp;
      const shield = a.spellId ?? a.shieldSpellId;
      if (!inWindow(ts) || !shield) continue;
      const t = tS(ts);
      if (
        shields.some(
          (s) => s.shieldIds.has(shield) && t >= s.fromS && t <= s.toS,
        )
      )
        evs.push({
          ts,
          line: a.logLine.lineIndex,
          k: 1,
          v: a.absorbedAmount,
          // the school of the hit the shield ate, when the row says it
          // (codex review 2026-11-04, round 2: a Frost hit under Anti-Magic
          // Zone)
          school: absorbedHitSchoolMask(a, swingWhenNoSpell),
        });
    }
  for (const h of target.healIn) {
    const ts = h.logLine.timestamp;
    if (!inWindow(ts)) continue;
    const over = Math.abs(h.amount) - Math.abs(h.effectiveAmount);
    if (over > 0) evs.push({ ts, line: h.logLine.lineIndex, k: 2, v: over });
  }
  for (const s of target.advancedActions)
    if (s.advancedActorId === target.id && inWindow(s.timestamp))
      evs.push({
        ts: s.timestamp,
        line: s.logLine.lineIndex,
        k: 3,
        v: s.advancedActorCurrentHp,
      });
  evs.sort(
    (a, b) =>
      a.ts - b.ts ||
      (a.line !== undefined && b.line !== undefined ? a.line - b.line : 0) ||
      a.k - b.k,
  );
  /** the removed reductions' factor at `t` on a hit of `school` (undefined =
   * unknown school: only the reductions that cover every school apply) */
  const factorAt = (t: number, school: number | undefined) => {
    let f = 1;
    for (const r of pcts)
      if (
        t >= r.fromS &&
        t <= r.toS &&
        (school === undefined
          ? (r.schoolMask & 0x7f) === 0x7f
          : (r.schoolMask & school) !== 0)
      )
        f *= 1 - r.pct / 100;
    return f;
  };
  let deficit = 0;
  for (const e of evs) {
    if (e.k === 0) deficit += e.v / factorAt(tS(e.ts), e.school) - e.v;
    // a removed shield's hit lands — before the removed reductions too
    // (codex review 2026-11-04: a cocoon under an Ironbark ate 80 % of it)
    else if (e.k === 1) deficit += e.v / factorAt(tS(e.ts), e.school);
    else if (e.k === 2) deficit = Math.max(0, deficit - e.v);
    else if (e.v - deficit <= 0) return true;
  }
  return false;
}

/** What the account decided for one already-up external. */
export type AlreadyUpExternalVerdict =
  | { kind: "alone" }
  | { kind: "together"; with: string[] }
  | { kind: "dropped" }
  | { kind: "unaccounted" };

/**
 * The verdict for every already-up external at once: `externals[i]` →
 * verdict i. `ownUp` = the target's own accounted reductions that were up
 * when the attempt began (they join a "together" set, are never dropped —
 * only externals are on trial, user 2026-11-04). An external with no account
 * (`undefined` entry) is `unaccounted` and named as before, and so is
 * every one when the target has no HP reading of its own in the window.
 */
export function judgeAlreadyUpExternals(
  target: ICombatUnit,
  matchStartMs: number,
  fromMs: number,
  toMs: number,
  externals: readonly (IAccountedSave | undefined)[],
  ownUp: readonly IAccountedSave[],
): AlreadyUpExternalVerdict[] {
  // no HP reading of the target's own inside the window (a log without
  // advanced logging): nothing to account with — every external is named
  // as before
  if (
    !target.advancedActions.some(
      (s) =>
        s.advancedActorId === target.id &&
        s.timestamp >= fromMs &&
        s.timestamp <= toMs,
    )
  )
    return externals.map(() => ({ kind: "unaccounted" }));
  const died = (r: readonly IAccountedSave[]) =>
    wouldHaveDiedWithout(target, matchStartMs, fromMs, toMs, r);
  const accounted = externals.filter((e): e is IAccountedSave => !!e);
  const all = [...accounted, ...ownUp];
  const alone = new Map(accounted.map((e) => [e, died([e])]));
  // "together" only when no single one of the set decides it
  const together =
    all.length >= 2 &&
    ![...alone.values()].some(Boolean) &&
    !ownUp.some((o) => died([o])) &&
    died(all);
  const order = [...all].sort((a, b) => a.fromS - b.fromS);
  return externals.map((e) => {
    if (!e) return { kind: "unaccounted" };
    if (alone.get(e)) return { kind: "alone" };
    if (together)
      return {
        kind: "together",
        with: order.filter((o) => o !== e).map((o) => o.name),
      };
    return { kind: "dropped" };
  });
}
