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
 *    (`PRESS_EFFECT_CHAIN_AURAS`) and that series, followed on its own
 *    rows (`listedChainFrom`), ran past the printed length: the line is
 *    short of an effect the tooltip names;
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

/** when the LISTED series `spellId` heads on `unit` ended, as logged: the
 * head's REMOVED, then each listed follow-up applied within `CHAIN_GAP_MS`
 * of the end before it (by the press's caster or by the unit itself — a
 * holder-sourced series) and its REMOVED. Only the list's own auras, in the
 * list's order — an unrelated aura at the last end changes nothing (codex
 * 85-tk-G-T40-1 #4). `hops`: the follow-ups seen. */
export function listedChainFrom(
  unit: any,
  caster: any,
  spellId: string,
  atMs: number,
  listed: readonly string[],
): IChain | undefined {
  const rows = ((unit.auraEvents ?? []) as any[]).filter(
    (a) =>
      (a.srcUnitId === caster.id || a.srcUnitId === unit.id) &&
      a.destUnitId === unit.id,
  );
  const endAfter = (id: string, from: number): number | undefined => {
    const r = rows.find(
      (a) => ev(a) === REMOVED && String(a.spellId) === id && tsOf(a) > from,
    );
    return r ? tsOf(r) : undefined;
  };
  let endMs = endAfter(spellId, atMs);
  if (endMs === undefined) return undefined;
  const hops: string[] = [];
  for (const id of listed) {
    const next = rows.find(
      (a) =>
        ev(a) === APPLIED &&
        String(a.spellId) === id &&
        Math.abs(tsOf(a) - endMs!) <= CHAIN_GAP_MS,
    );
    if (!next) break;
    const end = endAfter(id, tsOf(next) - 1);
    if (end === undefined) break;
    hops.push(id);
    endMs = end;
  }
  return { endMs, hops };
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
    const at0 = p.durationAura.atMs;
    const report = (kind: string, c: IChain): void =>
      ctx.violate(
        "pressChainLasts",
        kind,
        at0,
        `${p.unit.id}|${p.spellId}|${at0}`,
        `${name} prints lasts ${printed}s; its auras ran one after another for ${((c.endMs - at0) / 1000).toFixed(1)}s (${nameOf(p.durationAura!.spellId)} → ${c.hops.map((h) => nameOf(h)).join(" → ")})`,
        line.trim().slice(0, 160),
      );
    const tooLong = (c: IChain | undefined): c is IChain =>
      c !== undefined &&
      c.hops.length > 0 &&
      (c.endMs - at0) / 1000 > printed + LASTS_SLACK_S;
    // the listed series first, on its own rows
    const listed = PRESS_EFFECT_CHAIN_AURAS[p.durationAura.spellId];
    const own = listed
      ? listedChainFrom(unit, p.unit, p.durationAura.spellId, at0, listed)
      : undefined;
    if (tooLong(own)) {
      report("listedChain", own);
      continue;
    }
    // then whatever else followed (the diagnostic)
    const chain = chainFrom(unit, p.unit, p.durationAura.spellId, at0);
    if (tooLong(chain)) report("nominated", chain);
  }
}
