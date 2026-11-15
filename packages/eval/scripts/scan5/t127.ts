/**
 * scan5/t127.ts — ticket T127 (fact13 D35): an absorb shield pressed on a
 * kill-window target by a unit of the OTHER side ends `defenseless` as an
 * ally's does — the shield absorbs the attackers' damage whoever cast it
 * (b8a9f3e3 r0: a Discipline Priest's Void Shield went onto the warlock it had
 * Mind-Controlled in the ms the control ended, 118k, and absorbed 117k of the
 * priest's team's damage inside `defenseless 0:56–1:12`).
 *
 * `crossTeamShieldDefenseless`: scan5/allyShield's check
 * (`shieldDefenseless`, same log truth: an absorb row on the target inside
 * the span, a press of that shield by its caster at the target or with no
 * target beside the run's start, within a minute) with the caster on the
 * target's other side. Kind `pressed`.
 */
import { shieldDefenseless } from "./allyShield";
import type { IRoundCtx } from "./ctx";

export const CHECKS = ["crossTeamShieldDefenseless"] as const;

export function run(ctx: IRoundCtx): void {
  shieldDefenseless(ctx, "crossTeamShieldDefenseless", "other");
}
