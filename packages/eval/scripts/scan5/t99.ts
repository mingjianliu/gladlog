/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (auraEvents, actionIn, healOut) */
/**
 * scan5/t99.ts — ticket T99 (fact13 D18): a `| pressed during it: X ×N`
 * clause counts only presses of the owner's cooldown X — a button — never a
 * triggered sub-spell's refused row that only shares X's name (The Hunt
 * 370966, the charge's impact: "Can't do that while stunned" inside a Cheap
 * Shot, while the button 370965 had gone out). Truth is the recorder's own
 * SPELL_CAST_FAILED rows; DB2 only names what a row's id is.
 *
 *  - `pressedDuringSubSpell`: per item `X ×N` of an owner's `[CC ON TEAM]` /
 *    `[SILENCE]` line, the recorder's refused rows named X from the line's
 *    second to its end (its `| Ns`, else its `after Ns`, else
 *    `FALLBACK_SPAN_S`, plus a second for the floor). A row is a press when
 *    its id has a cooldown of its own in DB2, or DB2 does not know it. A
 *    violation when N is more than the presses and the window holds such a
 *    sub-spell row (the clause counted a row that is no button). The window
 *    is wide on purpose: a press in a neighbouring control only hides a
 *    violation, never makes one; a count the window reads short with no
 *    sub-spell row in it is not this class.
 *    Kind = X. A same-button second stage (`SECOND_STAGE_PRESSES`, user
 *    ruling R45: Alter Time 342247, Stasis 370564) is a press.
 *  - `secondStageUnderControl` (R45 evidence, not a defect — every kind is
 *    out of the total): the user's statement that these second stages fire
 *    through `/cancelaura` while controlled, tested per spell. Population:
 *    a player's ready aura of a listed second stage (Alter Time 342246,
 *    Stasis 370562) REMOVED from itself, before its DB2 duration ran out, not
 *    dispelled or stolen in that ms, not at the unit's death, while a hostile
 *    control aura was on the unit (a DB2 mechanic the game refuses presses
 *    under, `CONTROL_REJECT_MECHANIC`). Kinds `<spell> castRow` (the second
 *    stage logged a SPELL_CAST_SUCCESS within 100 ms), `<spell> released`
 *    (no cast row, and the second stage's effect follows: Alter Time's
 *    return heal 1219545 on itself within 100 ms; Stasis' stored spells —
 *    a SPELL_CAST_SUCCESS of the unit within 150 ms after), `<spell>
 *    noEffect` (neither).
 */
import {
  CONTROL_REJECT_MECHANIC,
  PRESSED_DURING_ITEM_RE_SRC,
} from "@gladlog/analysis/src/context/controlRejectedPresses";
import { SECOND_STAGE_PRESSES } from "@gladlog/analysis/src/data/secondStagePresses";
import {
  effectiveCooldownSeconds,
  spellEffectData,
} from "@gladlog/analysis/src/data/spellEffectData";
import { ccMechanicOf } from "@gladlog/analysis/src/utils/spellMechanics";

import {
  APPLIED,
  deathMs,
  ev,
  type IRoundCtx,
  nameOf,
  REMOVED,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = [
  "pressedDuringSubSpell",
  "secondStageUnderControl",
] as const;

/** evidence counts, not defects: every kind of `secondStageUnderControl` */
const STAGE_KINDS = ["released", "castRow", "noEffect"] as const;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set(
  ["Alter Time", "Stasis"].flatMap((n) =>
    STAGE_KINDS.map((k) => `secondStageUnderControl|${n} ${k}`),
  ),
);

const LINE =
  /^(\d+:\d{2})\s+\[(?:CC ON TEAM|SILENCE)\]\s+.*\| pressed during it: (.+)$/;
/** the producer's own item pattern (a name may hold a comma; an item may
 * carry the `/cancelaura` note) */
const ITEMS = new RegExp(PRESSED_DURING_ITEM_RE_SRC, "g");
/** a line that prints no span of its own */
const FALLBACK_SPAN_S = 12;

/** a press: a same-button second stage (`SECOND_STAGE_PRESSES`, R45), an
 * id with a cooldown of its own in DB2, or one DB2 does not know */
const isButton = (id: string): boolean =>
  SECOND_STAGE_PRESSES.has(id) ||
  !spellEffectData[id] ||
  (effectiveCooldownSeconds(id) ?? 0) > 0;

export function run(ctx: IRoundCtx): void {
  pressedDuringSubSpell(ctx);
  secondStageUnderControl(ctx);
}

const CONTROL_MECHANICS = new Set(Object.values(CONTROL_REJECT_MECHANIC));
/** Alter Time's return heal on its caster */
const ALTER_TIME_RETURN_HEAL = "1219545";

function secondStageUnderControl(ctx: IRoundCtx): void {
  const C = "secondStageUnderControl";
  if (!ctx.firstOwnerOfRound) return;
  for (const u of ctx.players) {
    const auras = ((u.auraEvents ?? []) as any[]).filter(
      (a) => a.destUnitId === u.id,
    );
    // hostile controls on the unit, [from, to] ms
    const controls: Array<{ from: number; to: number }> = [];
    const open = new Map<string, number>();
    for (const a of [...auras].sort((x, y) => tsOf(x) - tsOf(y))) {
      const id = String(a.spellId);
      const mech = ccMechanicOf(id);
      if (mech === undefined || !CONTROL_MECHANICS.has(mech)) continue;
      const src = ctx.units.find((x) => x.id === a.srcUnitId);
      if (!src || src.reaction === u.reaction) continue;
      const key = `${id}|${a.srcUnitId}`;
      if (ev(a) === APPLIED) open.set(key, tsOf(a));
      else if (ev(a) === REMOVED && open.has(key)) {
        controls.push({ from: open.get(key)!, to: tsOf(a) });
        open.delete(key);
      }
    }
    for (const [k, from] of open) {
      void k;
      controls.push({ from, to: ctx.end });
    }
    if (controls.length === 0) continue;
    const dispelled = ((u.actionIn ?? []) as any[]).filter((d) =>
      /DISPEL|STOLEN/.test(ev(d) ?? ""),
    );
    const died = deathMs(u);
    for (const [secondId, st] of SECOND_STAGE_PRESSES) {
      const name = nameOf(st.firstStageId);
      const rows = auras
        .filter(
          (a) => String(a.spellId) === st.readyAuraId && a.srcUnitId === u.id,
        )
        .sort((x, y) => tsOf(x) - tsOf(y));
      const durMs =
        (spellEffectData[st.readyAuraId]?.durationSeconds ?? 0) * 1000;
      let appliedAt: number | undefined;
      for (const a of rows) {
        if (ev(a) === APPLIED) {
          appliedAt = tsOf(a);
          continue;
        }
        if (ev(a) !== REMOVED || appliedAt === undefined) continue;
        const t = tsOf(a);
        const from = appliedAt;
        appliedAt = undefined;
        if (t < ctx.start || t > ctx.roundEndAt) continue;
        if (durMs > 0 && t - from >= durMs - 200) continue;
        if (Math.abs(died - t) <= 500) continue;
        if (
          dispelled.some(
            (d) =>
              String(d.extraSpellId) === st.readyAuraId &&
              Math.abs(tsOf(d) - t) <= 5,
          )
        )
          continue;
        if (!controls.some((c) => c.from < t && c.to > t + 10)) continue;
        ctx.bump(C);
        const castRow = successesOf(u).some(
          (c) => String(c.spellId) === secondId && Math.abs(tsOf(c) - t) <= 100,
        );
        const effect =
          st.readyAuraId === "342246"
            ? ((u.healOut ?? []) as any[]).some(
                (h) =>
                  String(h.spellId) === ALTER_TIME_RETURN_HEAL &&
                  h.destUnitId === u.id &&
                  Math.abs(tsOf(h) - t) <= 100,
              )
            : successesOf(u).some(
                (c) =>
                  String(c.spellId) !== secondId &&
                  tsOf(c) >= t &&
                  tsOf(c) <= t + 150,
              );
        const kind = castRow ? "castRow" : effect ? "released" : "noEffect";
        ctx.violate(
          C,
          `${name} ${kind}`,
          t,
          `${u.id}#${secondId}#${t}`,
          `${u.name}'s ${name} ended under a control at ${((t - ctx.start) / 1000).toFixed(2)}s (${kind})`,
        );
      }
    }
  }
}

function pressedDuringSubSpell(ctx: IRoundCtx): void {
  const C = "pressedDuringSubSpell";
  const streams = ctx.rawStreams();
  if (!streams.available || streams.castFailed.length === 0) return;
  const recorderId = streams.castFailed[0]!.unitGuid;
  if (ctx.owner?.id !== recorderId) return;
  const failed = streams.castFailed.filter((f) => f.unitGuid === recorderId);
  for (const l of ctx.lines) {
    const m = LINE.exec(l.trim());
    if (!m) continue;
    const from = secOf(m[1]!);
    const span =
      Number(/ \| (\d+)s(?: \[| \||$)/.exec(l)?.[1] ?? NaN) ||
      Number(/ after (\d+)s/.exec(l)?.[1] ?? NaN) ||
      FALLBACK_SPAN_S;
    const to = from + span + 1;
    // `X ×N` items; a name may hold a comma (`Invoke Chi-Ji, the Red Crane`)
    for (const it of m[2]!.matchAll(ITEMS)) {
      const name = it[1]!;
      const n = Number(it[2]!);
      ctx.bump(C);
      const rows = failed.filter(
        (f) =>
          f.tSeconds >= from &&
          f.tSeconds <= to &&
          nameOf(String(f.spellId), f.spellName) === name,
      );
      const presses = rows.filter((f) => isButton(String(f.spellId)));
      const sub = rows.filter((f) => !isButton(String(f.spellId)));
      // only a count the sub-spell rows explain: a window this scan reads
      // short (a line's span is printed in whole seconds) is not this class
      if (n <= presses.length || sub.length === 0) continue;
      ctx.violate(
        C,
        name,
        ctx.start + from * 1000,
        `${recorderId}#${name}#${m[1]}`,
        `the clause says ${name} ×${n}; the recorder's refused presses of it there are ${presses.length} (+${sub.length} row(s) of a same-named id with no cooldown: ${[...new Set(sub.map((f) => f.spellId))].join("/")})`,
        l.trim().slice(0, 300),
      );
    }
  }
}
