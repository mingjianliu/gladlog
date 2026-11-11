/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t40.ts — pipeline T40: a `[PRESS]` line's `lasts Ns` read off the
 * first aura of a chain. 1122db73: `Chimaeral Sting (lasts 3s, …)` while its
 * venoms ran one after another for 9.0 s (Scorpid 46.410 → Spider 49.419 →
 * Viper, removed 55.426).
 *
 * Check `pressChainLasts`. Counted: every press the producer gives a length
 * (`extractOffListPresses` → `durationSeconds` / `durationAura`: the unit
 * and the APPLIED row the length was read from — the scan picks no row of
 * its own) whose line the context prints with that `lasts`. The row's aura
 * is followed on its unit: its REMOVED, then an aura of ANOTHER spell the
 * same caster put on the same unit within `CHAIN_GAP_MS` of that end, with
 * no press of the caster's beside it (`NO_PRESS_MS` — a follow-up the
 * caster pressed is its own button), and so on. A violation is a chain
 * whose last logged end lies more than `LASTS_SLACK_S` past the printed
 * length:
 *  - `listedChain` — the row's aura heads a series the producer lists
 *    (`PRESS_EFFECT_CHAIN_AURAS`) and the follow-ups seen are that series':
 *    the line is short of an effect the tooltip names;
 *  - `nominated` (out of the total — a diagnostic) — any other aura that
 *    followed: mostly coincidence (a proc, another button's buff, Arena
 *    Preparation), named in the detail so a real series shows as a pair that
 *    repeats. On the 605 at 4882aca85, before the list existed: Chimaeral
 *    Sting 353 facts, Aspect of the Cheetah 290, then Eye Beam → Furious
 *    Gaze 176 (a talent's buff when the channel ends, not the press's
 *    effect), Halo → Halo 30.
 */
import { PRESS_EFFECT_CHAIN_AURAS } from "@gladlog/analysis/src/data/pressEffectChains";
import { extractOffListPresses } from "@gladlog/analysis/src/utils/offListPress";

import {
  APPLIED,
  ev,
  fmtS,
  type IRoundCtx,
  nameOf,
  REMOVED,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["pressChainLasts"] as const;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "pressChainLasts|nominated",
]);

/** a follow-up starts this close to the end of the aura before it */
export const CHAIN_GAP_MS = 150;
/** a press of the caster's this close to a follow-up's start made it */
export const NO_PRESS_MS = 300;
/** the same slack the press scan gives a logged life past the printed one */
export const LASTS_SLACK_S = 0.65;
const MAX_HOPS = 6;

export interface IChain {
  endMs: number;
  /** the follow-up auras, in order */
  hops: string[];
}

/** the chain that starts at `caster`'s `spellId` applied on `unit` at
 * `atMs`: undefined when the first aura's end is not logged */
export function chainFrom(
  unit: any,
  caster: any,
  spellId: string,
  atMs: number,
): IChain | undefined {
  const rows = ((unit.auraEvents ?? []) as any[]).filter(
    (a) => a.srcUnitId === caster.id && a.destUnitId === unit.id,
  );
  const pressTimes = successesOf(caster).map(tsOf);
  const hops: string[] = [];
  let id = spellId;
  let from = atMs;
  let endMs: number | undefined;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const removed = rows.find(
      (a) => ev(a) === REMOVED && String(a.spellId) === id && tsOf(a) > from,
    );
    if (!removed) break;
    endMs = tsOf(removed);
    const next = rows.find(
      (a) =>
        ev(a) === APPLIED &&
        String(a.spellId) !== id &&
        !hops.includes(String(a.spellId)) &&
        String(a.spellId) !== spellId &&
        Math.abs(tsOf(a) - endMs!) <= CHAIN_GAP_MS &&
        !pressTimes.some((t) => Math.abs(t - tsOf(a)) <= NO_PRESS_MS),
    );
    if (!next) break;
    id = String(next.spellId);
    from = tsOf(next) - 1;
    hops.push(id);
  }
  return endMs === undefined ? undefined : { endMs, hops };
}

export function run(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  const presses = extractOffListPresses(
    ctx.players as any,
    ctx.legacy as any,
    ctx.roundEndAt,
  );
  const byId: Record<string, any> = {};
  for (const u of ctx.units as any[]) byId[u.id] = u;
  for (const p of presses) {
    if (p.durationSeconds === undefined || !p.durationAura) continue;
    const name = nameOf(p.spellId);
    const printed = Math.round(p.durationSeconds * 10) / 10;
    const at = fmtS(p.timeSeconds);
    // the press's own line, with the producer's length on it
    const line = ctx.lines.find(
      (l) =>
        l.startsWith(at) &&
        l.includes("[PRESS]") &&
        l.includes(`${name} (lasts ${printed}s`),
    );
    if (!line) continue;
    ctx.bump("pressChainLasts");
    const unit = byId[p.durationAura.unitId];
    if (!unit) continue;
    const chain = chainFrom(
      unit,
      p.unit,
      p.durationAura.spellId,
      p.durationAura.atMs,
    );
    if (!chain || chain.hops.length === 0) continue;
    const ranS = (chain.endMs - p.durationAura.atMs) / 1000;
    if (ranS <= printed + LASTS_SLACK_S) continue;
    const listed = PRESS_EFFECT_CHAIN_AURAS[p.durationAura.spellId];
    ctx.violate(
      "pressChainLasts",
      listed && chain.hops.every((h) => listed.includes(h))
        ? "listedChain"
        : "nominated",
      p.durationAura.atMs,
      `${p.unit.id}|${p.spellId}|${p.durationAura.atMs}`,
      `${name} prints lasts ${printed}s; its auras ran one after another for ${ranS.toFixed(1)}s (${nameOf(p.durationAura.spellId)} → ${chain.hops.map((h) => nameOf(h)).join(" → ")})`,
      line.trim().slice(0, 160),
    );
  }
}
