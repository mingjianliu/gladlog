/* eslint-disable @typescript-eslint/no-explicit-any -- scan over raw parse output */
/**
 * scan5/t160.ts — pipeline T160 (round-13 retest P9), count first: a
 * `[KILL WINDOW]` / `[VULNERABLE]` line's `+Nk absorbed` is "what the
 * target's shields ate of the team's hits". The product sums every
 * SPELL_ABSORBED row whose victim is the target. One kind of row is not a
 * shield on the target: Mindgames (375901 → aura 375902) sits on the
 * ATTACKER and eats what that unit deals.
 *
 * Log truth, on the raw rows: where the absorbing aura was when the row was
 * logged — the latest aura event of the shield's spell (its id, or its
 * English name) on the unit is an APPLIED / REFRESH, or a REMOVED no more
 * than `AURA_GONE_SLACK_MS` before the row (a shield that the hit emptied
 * logs its REMOVED first).
 *
 * `absorbShieldSide` — every absorb row on a player, once per round (the
 * total); a row whose aura was on the attacker and not on the victim:
 *  - `never on the victim, listed / unlisted: <spell> <id>` — the victim
 *    logged no aura event of the spell all round: not a shield on the victim.
 *    The forward check of the product's `ATTACKER_SIDE_ABSORB_IDS`
 *    (Curated-List rule): a listed spell is out of the total, an unlisted
 *    one is a violation;
 *  - `on the attacker only at the row; the victim carried it this round` —
 *    out of the total: both units use the spell and the victim's copy was
 *    gone more than the slack before the row.
 *
 * `kwAbsorbedNotTargets` — per owner context, per window of the product's
 * own `computeOffensiveWindows` (the source of the `[KILL WINDOW]` /
 * `[VULNERABLE]` lines' `+Nk absorbed`) that states an absorbed amount or
 * holds an attacker-side row: the rows of the owner's side on the window's
 * target inside its span whose aura was not on the attacker only. Kinds:
 *  - `says more than the target's shields ate` — the window's
 *    `friendlyAbsorbedInWindow` is above that sum;
 *  - `span holds an attacker-side row` — out of the total, a measurement.
 */
import * as incomingPressure from "@gladlog/analysis/src/utils/incomingPressure";
import { computeOffensiveWindows } from "@gladlog/analysis/src/utils/offensiveWindows";

import {
  APPLIED,
  ev,
  fmtS,
  type IRoundCtx,
  nameOf,
  REFRESH,
  REMOVED,
  tsOf,
} from "./ctx";

const { isDeferralAbsorb } = incomingPressure;
// absent on a tree from before the fix (the scan's "before" runs there):
// nothing is listed
const ATTACKER_SIDE_ABSORB_IDS: ReadonlySet<string> =
  (incomingPressure as { ATTACKER_SIDE_ABSORB_IDS?: ReadonlySet<string> })
    .ATTACKER_SIDE_ABSORB_IDS ?? new Set();

export const CHECKS = ["absorbShieldSide", "kwAbsorbedNotTargets"] as const;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  ...[...ATTACKER_SIDE_ABSORB_IDS].map(
    (id) =>
      `absorbShieldSide|never on the victim, listed: ${nameOf(id, id)} ${id}`,
  ),
  "absorbShieldSide|on the attacker only at the row; the victim carried it this round",
  "kwAbsorbedNotTargets|span holds an attacker-side row",
]);

const AURA_GONE_SLACK_MS = 500;

export function run(ctx: IRoundCtx): void {
  const unitById = new Map<string, any>();
  for (const u of ctx.units as any[]) unitById.set(u.id, u);

  // where an aura of the shield's spell was at `ms`
  const stateCache = new Map<string, Array<{ t: number; up: boolean }>>();
  const eventsOf = (u: any, id: string): Array<{ t: number; up: boolean }> => {
    const key = `${u.id}|${id}`;
    let out = stateCache.get(key);
    if (out) return out;
    const name = nameOf(id, "");
    out = [];
    for (const x of (u.auraEvents ?? []) as any[]) {
      if (x.destUnitId !== u.id) continue;
      const xid = String(x.spellId ?? "");
      if (xid !== id && !(name && nameOf(xid, x.spellName ?? "") === name))
        continue;
      const e = ev(x);
      if (e === APPLIED || e === REFRESH) out.push({ t: tsOf(x), up: true });
      else if (e === REMOVED) out.push({ t: tsOf(x), up: false });
    }
    out.sort((a, b) => a.t - b.t);
    stateCache.set(key, out);
    return out;
  };
  const carried = (u: any, id: string, ms: number): boolean => {
    if (!u) return false;
    let last: { t: number; up: boolean } | undefined;
    for (const e of eventsOf(u, id)) {
      if (e.t > ms) break;
      last = e;
    }
    return !!last && (last.up || ms - last.t <= AURA_GONE_SLACK_MS);
  };
  const sideOf = (victim: any, a: any): string => {
    const id = String(a.spellId ?? "");
    const ms = tsOf(a);
    const onVictim = carried(victim, id, ms);
    const onAttacker =
      a.attackerId !== victim.id &&
      carried(unitById.get(a.attackerId), id, ms);
    return onVictim
      ? onAttacker
        ? "on both"
        : "on the victim"
      : onAttacker
        ? "on the attacker only"
        : "on neither";
  };

  if (ctx.firstOwnerOfRound)
    for (const u of ctx.players as any[])
      for (const a of (u.absorbsIn ?? []) as any[]) {
        if (!(Math.abs(a.absorbedAmount) > 0) || tsOf(a) > ctx.end) continue;
        ctx.bump("absorbShieldSide");
        if (sideOf(u, a) !== "on the attacker only") continue;
        const id = String(a.spellId ?? "");
        ctx.violate(
          "absorbShieldSide",
          eventsOf(u, id).length > 0
            ? "on the attacker only at the row; the victim carried it this round"
            : ATTACKER_SIDE_ABSORB_IDS.has(id)
              ? `never on the victim, listed: ${nameOf(id, id)} ${id}`
              : `never on the victim, unlisted: ${nameOf(id, id)} ${id}`,
          tsOf(a),
          `${u.name}#${a.logLine?.lineIndex ?? tsOf(a)}#${id}#${a.attackerId}#${a.absorbedAmount}`,
          `${nameOf(id, id)} ${id}: ${Math.abs(a.absorbedAmount)} of ${unitById.get(a.attackerId)?.name ?? a.attackerId}'s hit on ${u.name}`,
        );
      }

  const owner = ctx.owner;
  if (!owner) return;
  const ownSide = new Set<string>();
  for (const u of ctx.units as any[]) {
    const who =
      u.ownerId && !/^0+$/.test(u.ownerId) ? unitById.get(u.ownerId) : u;
    if (who?.info && who.reaction === owner.reaction) ownSide.add(u.id);
  }
  const friends = (ctx.players as any[]).filter(
    (p) => p.reaction === owner.reaction,
  );
  const enemies = (ctx.players as any[]).filter(
    (p) => p.reaction !== owner.reaction,
  );
  const combat = { ...ctx.legacy, startTime: ctx.start, endTime: ctx.end };
  for (const w of computeOffensiveWindows(
    enemies as never,
    friends as never,
    combat as never,
  )) {
    const target = unitById.get(w.targetUnitId);
    if (!target) continue;
    const fromMs = ctx.start + w.fromSeconds * 1000;
    const toMs = ctx.start + w.toSeconds * 1000;
    let shields = 0;
    let attackerSide = 0;
    for (const a of (target.absorbsIn ?? []) as any[]) {
      if (!a.attackerId || !ownSide.has(a.attackerId)) continue;
      if (isDeferralAbsorb(a)) continue;
      const t = tsOf(a);
      if (t < fromMs || t > toMs) continue;
      if (sideOf(target, a) === "on the attacker only")
        attackerSide += Math.abs(a.absorbedAmount);
      else shields += Math.abs(a.absorbedAmount);
    }
    const said = w.friendlyAbsorbedInWindow;
    if (!(said > 0) && !(attackerSide > 0)) continue;
    ctx.bump("kwAbsorbedNotTargets");
    const id = `${owner.name}#${w.targetUnitId}#${Math.round(w.fromSeconds * 1000)}`;
    const detail = `window ${fmtS(w.fromSeconds)}–${fmtS(w.toSeconds)} on ${target.name}: the product's absorbed ${(said / 1000).toFixed(1)}k; the target's shields ate ${(shields / 1000).toFixed(1)}k of the side's hits in it, an aura on the attacker ${(attackerSide / 1000).toFixed(1)}k`;
    if (said > shields + 1)
      ctx.violate(
        "kwAbsorbedNotTargets",
        "says more than the target's shields ate",
        fromMs,
        id,
        detail,
      );
    if (attackerSide > 0)
      ctx.violate(
        "kwAbsorbedNotTargets",
        "span holds an attacker-side row",
        fromMs,
        `${id}#holds`,
        detail,
      );
  }
}
