/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, missesOut) */
/**
 * scan5/pressEffect.ts — class 5 of the round-7 audit (fact7 F21, D27 / D36):
 * what an `[ENEMY DEF]` line says about a press against the rows of that press.
 *
 *  - `noPressButPressed` (D27): a line tagged `[no press logged]` for an aura
 *    the unit's own SPELL_CAST_SUCCESS of the same name landed on — within
 *    `PRESS_AFTER_MS` after the aura went up, a REFRESH beside it. 163de8f1
 *    1:00: Exhilaration's Survival of the Fittest at .584, the hunter's own
 *    press at .932 refreshing it.
 *  - `saveThatMissed` (D36): a line for a press whose own cast logged a
 *    SPELL_MISSED on its target, with no aura of the name on the unit around
 *    it. 9121b496 0:20: Touch of Karma, MISS on the warrior, no Karma aura.
 */
import { CRISIS_PROC_ANSWERS } from "@gladlog/analysis/src/data/crisisProcAnswers";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { ENEMY_DEF_TAG_RE_SRC } from "@gladlog/analysis/src/utils/enemyDefensives";

import {
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
  REFRESH,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["noPressButPressed", "saveThatMissed"] as const;

const PRESS_AFTER_MS = 1500;
const LINE = new RegExp(
  String.raw`^\s*(\d+):(\d\d)\s+${ENEMY_DEF_TAG_RE_SRC}\s+(\d+)\([^)]*\)(?: \([^)]*\))?: (.+)$`,
);
const spellOf = (rest: string): string =>
  /^(.+?)(?: \(| \[|$)/.exec(rest)?.[1] ?? rest;
/** How far a proc's marker sits from the aura row it put up: one log batch
 * (the analysis side's `PROC_OWN_ACTIVATION_PAIR_MS`, read here off the rows). */
const PROC_MARKER_PAIR_MS = 100;

/** The aura's activations (APPLIED / REFRESH rows) inside the line's second,
 * in log order. Each press of the name is given to ONE activation: the
 * nearest one it can explain (within 50 ms of it, or in `PRESS_AFTER_MS`
 * after it). An activation is a proc's when a marker of a proc that casts the
 * spell (`CRISIS_PROC_ANSWERS`, the lookup) is given to it, each marker to
 * the nearest activation within `PROC_MARKER_PAIR_MS`. 11346ea9 r1 1:53 (T259 / B192): Frenzied
 * Regeneration APPLIED .197, the druid's press .198, then a REFRESH at .937
 * beside the Well-Honed Instincts marker 382912 (the proc). 11dfa802 r3
 * (B192 review 3): APPLIED .906, press .907, REFRESH .921, marker .922 — the
 * press is the APPLIED's alone. */
export function activationsInSecond(
  auras: readonly { event: string; ts: number }[],
  pressTs: readonly number[],
  markerTs: readonly number[],
  lo: number,
): { refresh: boolean; pressed: boolean; proc: boolean }[] {
  // paired over every row a press or marker of the second's rows could also
  // fit, then cut to the second (B192 review 4, bf679e40 r1: the proc 0:52.172,
  // the press 0:53.500 beside its own REFRESH — the press is the REFRESH's)
  const reach = PRESS_AFTER_MS + PROC_MARKER_PAIR_MS;
  const acts = auras
    .filter(
      (a) =>
        (a.event === APPLIED || a.event === REFRESH) &&
        a.ts >= lo - reach &&
        a.ts < lo + 1000 + reach,
    )
    .sort((x, y) => x.ts - y.ts)
    .map((a) => ({
      ts: a.ts,
      refresh: a.event === REFRESH,
      pressed: false,
      proc: false,
    }));
  // each press, then each marker, goes to ONE activation: the nearest it fits
  const give = (
    ts: readonly number[],
    fits: (t: number, a: { ts: number }) => boolean,
    key: "pressed" | "proc",
  ) => {
    for (const t of [...ts].sort((x, y) => x - y)) {
      const best = acts
        .filter((a) => !a[key] && fits(t, a))
        .sort((x, y) => Math.abs(t - x.ts) - Math.abs(t - y.ts))[0];
      if (best) best[key] = true;
    }
  };
  give(
    pressTs,
    (p, a) =>
      Math.abs(p - a.ts) <= 50 || (p >= a.ts && p <= a.ts + PRESS_AFTER_MS),
    "pressed",
  );
  give(markerTs, (m, a) => Math.abs(m - a.ts) <= PROC_MARKER_PAIR_MS, "proc");
  return acts
    .filter((a) => a.ts >= lo && a.ts < lo + 1000)
    .map(({ refresh, pressed, proc }) => ({ refresh, pressed, proc }));
}

/** Whether the `[no press logged]` line at position `pos` (0-based, in
 * rendered order) among the `lineCount` lines of a unit's spell in one second
 * is a proc's own line: only when the lines and the second's activations pair
 * one to one in order and the activation at `pos` is a proc's (its marker
 * beside it) that no press was given to. B192 reviews: both lines tagged, or
 * the tags swapped, flags the press's line; an unmarked REFRESH a press
 * missed by 83 ms exempts nothing (review 3, constructed). */
export function isProcOwnNoPressLine(
  pos: number,
  lineCount: number,
  activations: readonly { pressed: boolean; proc: boolean }[],
): boolean {
  const a = activations[pos];
  return lineCount === activations.length && !!a && a.proc && !a.pressed;
}

/** The unit's own markers of a proc that casts one of `auras`' spells. */
function procMarkerTs(unit: any, auras: readonly any[]): number[] {
  const ids = new Set(auras.map((a) => String(a.spellId)));
  return ((unit.auraEvents ?? []) as any[])
    .filter((m) => {
      const def = CRISIS_PROC_ANSWERS.get(String(m.spellId ?? ""));
      return (
        def?.via === "aura" &&
        [...def.triggers].some((t) => ids.has(t)) &&
        m.srcUnitId === unit.id &&
        m.destUnitId === unit.id &&
        (ev(m) === APPLIED || ev(m) === REFRESH)
      );
    })
    .map(tsOf);
}

export function run(ctx: IRoundCtx): void {
  // per unit-spell-second: its lines' indices in rendered order
  const keyOf = (m: RegExpExecArray): string =>
    `${m[3]}|${spellOf(m[4]!)}|${+m[1]! * 60 + +m[2]!}`;
  const linesOfKey = new Map<string, number[]>();
  ctx.lines.forEach((line, i) => {
    const m = LINE.exec(line);
    if (!m) return;
    const k = keyOf(m);
    linesOfKey.set(k, [...(linesOfKey.get(k) ?? []), i]);
  });
  for (const [i, line] of ctx.lines.entries()) {
    const m = LINE.exec(line);
    if (!m) continue;
    const unit = ctx.unitOfPid(m[3]);
    if (!unit) continue;
    const name = spellOf(m[4]!);
    const lo = ctx.start + (+m[1]! * 60 + +m[2]!) * 1000;
    const presses = successesOf(unit).filter(
      (c) => nameOf(c.spellId, c.spellName) === name,
    );
    const auras = ((unit.auraEvents ?? []) as any[]).filter(
      (a) =>
        a.destUnitId === unit.id &&
        getEnglishSpellName(a.spellId, a.spellName ?? "") === name,
    );
    if (line.includes("[no press logged]")) {
      const up = auras.find(
        (a) => ev(a) === APPLIED && tsOf(a) >= lo && tsOf(a) < lo + 1000,
      );
      const keyLines = linesOfKey.get(keyOf(m)) ?? [];
      const pos = keyLines.indexOf(i);
      const acts = activationsInSecond(
        auras.map((a) => ({ event: ev(a), ts: tsOf(a) })),
        presses.map(tsOf),
        procMarkerTs(unit, auras),
        lo,
      );
      if (!up) {
        // a second of REFRESH rows only: the line is a press's when its own
        // activation (lines and activations one to one) was given a press
        // (B192 review 5 — bf679e40 r1 0:53 tagged by mutation: the press
        // and its REFRESH at 53.500, no APPLIED in the second) — unless a
        // proc's marker names that REFRESH as the proc's (review 6,
        // constructed: APPLIED 10.970, press 10.999, REFRESH + marker 11.000)
        const own = acts[pos];
        if (!own || keyLines.length !== acts.length) continue;
        ctx.bump("noPressButPressed");
        if (!own.pressed || own.proc) continue;
        const rowTs = auras
          .map(tsOf)
          .filter(
            (t, k) => ev(auras[k]) === REFRESH && t >= lo && t < lo + 1000,
          )
          .sort((x, y) => x - y)[pos]!;
        const press = presses
          .filter(
            (c) =>
              Math.abs(tsOf(c) - rowTs) <= 50 ||
              (tsOf(c) >= rowTs && tsOf(c) <= rowTs + PRESS_AFTER_MS),
          )
          .sort(
            (x, y) => Math.abs(tsOf(x) - rowTs) - Math.abs(tsOf(y) - rowTs),
          )[0];
        if (!press) continue;
        ctx.violate(
          "noPressButPressed",
          "refreshed",
          tsOf(press),
          `${unit.name}#${name}#${tsOf(press)}`,
          `${unit.name} ${name}: refresh +${rowTs - ctx.start}ms, press +${tsOf(press) - ctx.start}ms`,
          line,
        );
        continue;
      }
      ctx.bump("noPressButPressed");
      if (isProcOwnNoPressLine(pos, keyLines.length, acts)) continue;
      const press = presses.find(
        (c) => tsOf(c) >= tsOf(up) && tsOf(c) <= tsOf(up) + PRESS_AFTER_MS,
      );
      if (!press) continue;
      const refreshed = auras.some(
        (a) => ev(a) === REFRESH && Math.abs(tsOf(a) - tsOf(press)) <= 50,
      );
      ctx.violate(
        "noPressButPressed",
        refreshed ? "refreshed" : "noRefreshRow",
        tsOf(press),
        `${unit.name}#${name}#${tsOf(press)}`,
        `${unit.name} ${name}: aura +${tsOf(up) - ctx.start}ms, press +${tsOf(press) - ctx.start}ms`,
        line,
      );
      continue;
    }
    const press = presses.find((c) => tsOf(c) >= lo && tsOf(c) < lo + 1000);
    if (!press) continue;
    ctx.bump("saveThatMissed");
    const missed = ((unit.missesOut ?? []) as any[]).find(
      (x) =>
        String(x.spellId) === String(press.spellId) &&
        Math.abs(x.timestamp - tsOf(press)) <= 200,
    );
    if (!missed) continue;
    const auraUp = auras.some((a) => Math.abs(tsOf(a) - tsOf(press)) <= 1500);
    if (auraUp) continue;
    ctx.violate(
      "saveThatMissed",
      String(missed.missType),
      tsOf(press),
      `${unit.name}#${name}#${tsOf(press)}`,
      `${unit.name} ${name}: press +${tsOf(press) - ctx.start}ms, ${missed.missType} on ${missed.destUnitName ?? missed.destUnitId}, no aura`,
      line,
    );
  }
}
