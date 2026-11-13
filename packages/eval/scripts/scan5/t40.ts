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
 *  - `lateHandover` (out of the total — a diagnostic) — a listed follow-up
 *    applied between the hand-over constant and `LATE_HANDOVER_MS` after
 *    the end before it: the producer does not follow it and prints the
 *    plain length;
 *  - `nominated` (out of the total — a diagnostic) — any other aura that
 *    followed: mostly coincidence (a proc, another button's buff, Arena
 *    Preparation), named in the detail so a real series shows as a pair that
 *    repeats. On the 605 at 4882aca85, before the list existed: Chimaeral
 *    Sting 353 facts, Aspect of the Cheetah 290, then Eye Beam → Furious
 *    Gaze 176 (a talent's buff when the channel ends, not the press's
 *    effect), Halo → Halo 30.
 */
import {
  PRESS_CHAIN_HANDOVER_MS,
  PRESS_EFFECT_CHAIN_AURAS,
} from "@gladlog/analysis/src/data/pressEffectChains";
import {
  auraInstanceEndMs,
  extractOffListPresses,
  pressChainFollowUps,
} from "@gladlog/analysis/src/utils/offListPress";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";

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
  "pressChainLasts|lateHandover",
]);

/** a follow-up starts this close to the end of the aura before it — the
 * producer's own constant (`pressChainFollowUps`) */
export const CHAIN_GAP_MS = PRESS_CHAIN_HANDOVER_MS;
/** a follow-up applied later than the hand-over but this soon after the
 * end before it is counted (`lateHandover`): how often log lag carries a
 * real hand-over past the constant (codex 85-tk-G-T40-1c #2) */
export const LATE_HANDOVER_MS = 2000;
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

/** when the LISTED series `spellId` heads on `unit` ended, as logged — on
 * the producer's own traversal, not a copy of it (codex 85-tk-G-T40-1c #3 /
 * (e): the copy had no round-end bound and stopped at a REFRESH the
 * producer reads through): the head's end (`auraInstanceEndMs`), then each
 * follow-up `pressChainFollowUps` gives a row, to that row's own end.
 * `untilMs` is the producer's bound — the caster's next press of the
 * button, the round's end. `hops`: the follow-ups seen. `late` (a
 * diagnostic): the first follow-up the producer gave no row was applied
 * `LATE_HANDOVER_MS` or less after the end before it — past the hand-over
 * constant, so the line prints its plain length where the log may show a
 * lengthened one. */
export function listedChainFrom(
  unit: any,
  caster: any,
  spellId: string,
  atMs: number,
  untilMs = Infinity,
): (IChain & { late?: { spellId: string; gapMs: number } }) | undefined {
  const head = ((unit.auraEvents ?? []) as any[]).find(
    (a) =>
      ev(a) === APPLIED &&
      String(a.spellId) === spellId &&
      tsOf(a) === atMs &&
      (a.srcUnitId === caster.id || a.srcUnitId === unit.id) &&
      a.destUnitId === unit.id,
  );
  if (!head) return undefined;
  let endMs = auraInstanceEndMs(unit, head);
  if (endMs === undefined) return undefined;
  const hops: string[] = [];
  let late: { spellId: string; gapMs: number } | undefined;
  for (const f of pressChainFollowUps(caster, unit, head, untilMs)) {
    if (!f.applied) {
      const from = endMs;
      const row = ((unit.auraEvents ?? []) as any[]).find(
        (a) =>
          ev(a) === APPLIED &&
          String(a.spellId) === f.spellId &&
          a.srcUnitId === f.source.id &&
          a.destUnitId === unit.id &&
          tsOf(a) > from + CHAIN_GAP_MS &&
          tsOf(a) <= from + LATE_HANDOVER_MS &&
          tsOf(a) < untilMs,
      );
      if (row) late = { spellId: f.spellId, gapMs: tsOf(row) - from };
      break;
    }
    const end = auraInstanceEndMs(unit, f.applied);
    if (end === undefined) break;
    hops.push(f.spellId);
    endMs = end;
  }
  return { endMs, hops, ...(late ? { late } : {}) };
}

/** What the listed series says of the printed length: `listedChain` — it
 * ran more than `LASTS_SLACK_S` past it; `pastBound` — it did, but its last
 * end is logged at or past the producer's bound and is not measured: what
 * lengthened it there (a Time Stop after the round's end, the next press's
 * refresh) the producer does not read (codex 85-tk-G-T40-1d: Cheetah's
 * second phase held 5 s past the round's end read as a 17 s series against
 * the printed 12). */
export function listedChainVerdict(
  c: IChain | undefined,
  at0: number,
  printedS: number,
  boundMs: number,
): "listedChain" | "pastBound" | undefined {
  if (!c || c.hops.length === 0) return undefined;
  if (!((c.endMs - at0) / 1000 > printedS + LASTS_SLACK_S)) return undefined;
  return c.endMs < boundMs ? "listedChain" : "pastBound";
}

export function run(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  // the producer's own round end (`buildMatchContext`: a series' rows are
  // read up to it), the scan's end of play for which presses count
  const roundEnd = roundEndMs(ctx.legacy as any);
  const presses = extractOffListPresses(
    ctx.players as any,
    ctx.legacy as any,
    roundEnd,
  ).filter((p) => ctx.start + p.timeSeconds * 1000 <= ctx.roundEndAt);
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
    const pressMs = ctx.start + p.timeSeconds * 1000;
    const nextPressMs = successesOf(p.unit)
      .filter((c: any) => String(c.spellId) === String(p.spellId))
      .map(tsOf)
      .find((t: number) => t > pressMs + 1);
    // the producer's bound (`pressDuration`): strictly before the next
    // press, a row AT the round's end inside
    const boundMs = Math.min(nextPressMs ?? Infinity, roundEnd + 1);
    const own = listed
      ? listedChainFrom(unit, p.unit, p.durationAura.spellId, at0, boundMs)
      : undefined;
    if (own?.late)
      ctx.violate(
        "pressChainLasts",
        "lateHandover",
        at0,
        `${p.unit.id}|${p.spellId}|${at0}|late`,
        `${name} prints lasts ${printed}s; ${nameOf(own.late.spellId)} was applied ${own.late.gapMs} ms after the aura before it ended — past the ${CHAIN_GAP_MS} ms hand-over, not followed`,
        line.trim().slice(0, 160),
      );
    const verdict = listedChainVerdict(own, at0, printed, boundMs);
    if (verdict === "listedChain") report("listedChain", own!);
    if (verdict) continue;
    // then whatever else followed (the diagnostic)
    const chain = chainFrom(unit, p.unit, p.durationAura.spellId, at0);
    if (tooLong(chain)) report("nominated", chain);
  }
}
