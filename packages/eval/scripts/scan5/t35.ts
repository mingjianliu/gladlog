/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, spellCastEvents) */
/**
 * scan5/t35.ts — pipeline T35 (GH #175 rows 2–17): a 12.1 class set bonus
 * that shortens a cooldown (Protection 4pc Ravager, Augmentation 2pc
 * Upheaval, Shadow 2pc Tentacle Slam — `SET_BONUS_COOLDOWN_ROWS`; the
 * Devastation 4pc on Causality's give-back — an `EVENT_COOLDOWN_REDUCTIONS`
 * row's `setBonus`) or lengthens a buff (Feral 4pc Berserk —
 * `SET_BONUS_DURATION_ROWS`), read at the unworn number. Holders are picked
 * by the product's own gear-and-spec gate (`wearsSetBonus` /
 * `setBonusCooldownReductionSeconds` / `setBonusDurationSeconds`).
 *
 * Check `setCooldownBack`, kind `pressBeforeBack`: a `[PRESS]` line of a
 * holder's bonus spell printing `back M:SS`, while the unit's own next
 * press of it — as the producer reads presses (`extractOffListPresses`:
 * the round's bounds, Stasis copies, unreleased holds) — came before M:SS
 * by more than the
 * ledger's `CD_INSTANT_SLACK_S` — the log pressed what the line called on
 * cooldown. A printed `back` is floored, so the true instant is at or after
 * it: only a press before the printed second itself is a contradiction.
 * Only `[PRESS]` spells are read: on 12.1.5 that is the Devastation
 * empowers (Fire Breath, Eternity Surge); Ravager, Upheaval and Tentacle
 * Slam print no `[PRESS]` line (`isOffListPressId`). For Tentacle Slam
 * (2 charges × 15 s) and Upheaval (40 s) that is a ruling, not a gap (user
 * 2026-11-11, pipeline T57 / R23: neither joins the `[PRESS]` whitelist
 * under the 45 s floor), so their set-bonus cooldown rows are ledger-only.
 *
 * Check `setFadeWhileUp`, kind `estimatedFadeWhileUp`: the owner's
 * `[BUFF FADED] <aura> (expired, estimated)` for an aura a worn bonus
 * lengthens, while the run's logged REMOVED comes after the printed
 * second + 1. With no REMOVED the log is silent and the line is not judged.
 * The run is the one the producer's press for the line put up
 * (`producerPressMs` → `ownAuraRunAt`, t18's chain).
 */
import {
  SET_BONUS_COOLDOWN_ROWS,
  SET_BONUS_DURATION_ROWS,
  setBonusCooldownReductionSeconds,
  setBonusDurationSeconds,
  wearsSetBonus,
} from "@gladlog/analysis/src/data/classSetBonuses";
import { EVENT_COOLDOWN_REDUCTIONS } from "@gladlog/analysis/src/data/talentScriptedCooldowns";
import { ownAuraRunAt } from "@gladlog/analysis/src/utils/buffDuration";
import { CD_INSTANT_SLACK_S } from "@gladlog/analysis/src/utils/cooldowns";
import {
  extractOffListPresses,
  type IOffListPress,
} from "@gladlog/analysis/src/utils/offListPress";

import { type IRoundCtx, nameOf, secOf, tsOf } from "./ctx";
import { producerPressMs } from "./producerPress";

export const CHECKS = ["setCooldownBack", "setFadeWhileUp"] as const;

const PRESS_LINE =
  /^\s*(\d+:\d\d)\s+(\[YOU\] )?\[PRESS\]\s+(?:(\d+)\([^)]*\) \([^)]*\): )?(.+?) \(([^()]*)\)\s*$/;
const BACK = /\bback (\d+:\d\d)\b/;
const FADE_LINE =
  /^\s*(\d+:\d\d)\s+\[BUFF FADED\]\s+(.+?) \(expired, estimated\)\s*$/;

/** spell name → the ids it renders for and the gate that says a unit
 * wears the bonus on it */
function cooldownSpells(): Map<
  string,
  { ids: Set<string>; worn: (u: any) => boolean }
> {
  const out = new Map<
    string,
    { ids: Set<string>; worn: (u: any) => boolean }
  >();
  const add = (id: string, worn: (u: any) => boolean) => {
    const name = nameOf(id, id);
    const e = out.get(name);
    if (e) {
      e.ids.add(id);
      const prev = e.worn;
      e.worn = (u) => prev(u) || worn(u);
    } else out.set(name, { ids: new Set([id]), worn });
  };
  for (const id of Object.keys(SET_BONUS_COOLDOWN_ROWS))
    add(id, (u) => setBonusCooldownReductionSeconds(id, u) > 0);
  for (const r of Object.values(EVENT_COOLDOWN_REDUCTIONS)) {
    const b = r.setBonus;
    if (!b) continue;
    for (const id of r.targets) add(id, (u) => wearsSetBonus(u, b));
  }
  return out;
}
let spells: ReturnType<typeof cooldownSpells> | undefined;

const pressesByCtx = new WeakMap<object, IOffListPress[]>();
function offListPressesOf(ctx: IRoundCtx): IOffListPress[] {
  let out = pressesByCtx.get(ctx);
  if (!out) {
    out = extractOffListPresses(ctx.players, ctx.legacy, ctx.roundEndAt);
    pressesByCtx.set(ctx, out);
  }
  return out;
}

function runCooldown(ctx: IRoundCtx): void {
  spells ??= cooldownSpells();
  for (const line of ctx.lines) {
    const m = PRESS_LINE.exec(line);
    if (!m) continue;
    const spell = spells.get(m[4]!.trim());
    if (!spell) continue;
    const back = BACK.exec(m[5]!);
    if (!back) continue;
    const unit: any = m[2] ? ctx.owner : ctx.unitOfPid(m[3]);
    if (!unit || !spell.worn(unit)) continue;
    ctx.bump("setCooldownBack");
    const sec = secOf(m[1]!);
    const backS = secOf(back[1]!);
    // the unit's next press as the producer reads presses
    // (`extractOffListPresses`: the round's bounds, Stasis copies, unreleased
    // holds — codex 85-tk-A-T35-1 #2)
    const next = offListPressesOf(ctx)
      .filter(
        (p) =>
          p.unit === unit &&
          spell.ids.has(p.spellId) &&
          p.timeSeconds >= sec + 1,
      )
      .map(
        (p) => (ctx.legacy.startTime + p.timeSeconds * 1000 - ctx.start) / 1000,
      )
      .sort((a, b) => a - b)[0];
    if (next === undefined || next >= backS - CD_INSTANT_SLACK_S) continue;
    ctx.violate(
      "setCooldownBack",
      "pressBeforeBack",
      ctx.start + next * 1000,
      `${unit.name}|${m[4]}|${sec}`,
      `printed back ${back[1]}, the unit pressed it again at ${next.toFixed(1)} s`,
      line,
    );
  }
}

function runFade(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  const auras = Object.keys(SET_BONUS_DURATION_ROWS).filter(
    (a) => setBonusDurationSeconds(a, owner) > 0,
  );
  if (auras.length === 0) return;
  const byName = new Map(auras.map((a) => [nameOf(a, a), a]));
  for (const line of ctx.lines) {
    const m = FADE_LINE.exec(line);
    if (!m) continue;
    const auraId = byName.get(m[2]!.trim());
    if (!auraId) continue;
    const sec = secOf(m[1]!);
    // the press the producer printed this line for and the run that press
    // put up — t18's chain (`producerPressMs` → `ownAuraRunAt`; codex B33
    // #2: the latest run by second took a re-press inside the line's second)
    // (the line may be the unworn length's: a removal the producer pairs
    // after the printed second does not rule its press out)
    const anchor = producerPressMs(ctx, owner, auraId, sec, true, {
      keepLaterRemovals: true,
    });
    if (anchor === undefined) continue;
    const run = ownAuraRunAt(owner, auraId, anchor);
    if (!run) continue;
    // only a logged REMOVED shows the run outlived the printed second: with
    // none the log is silent and the estimate stands (codex 85-tk-A-T35-1
    // #1: a correct 20 s Berserk estimate in a round that ran on to 30 s)
    if (!run.to) continue;
    ctx.bump("setFadeWhileUp");
    const upUntil = tsOf(run.to);
    if (upUntil <= ctx.start + (sec + 1) * 1000) continue;
    ctx.violate(
      "setFadeWhileUp",
      "estimatedFadeWhileUp",
      tsOf(run.from),
      `${owner.name}:${auraId}:${tsOf(run.from)}`,
      `estimated fade at ${m[1]}, the log keeps it up to ${((upUntil - ctx.start) / 1000).toFixed(1)} s`,
      line,
    );
  }
}

export function run(ctx: IRoundCtx): void {
  runCooldown(ctx);
  runFade(ctx);
}
