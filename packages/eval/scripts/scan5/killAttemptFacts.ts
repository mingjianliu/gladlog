/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (damageOut, spellCastEvents) */
/**
 * scan5/killAttemptFacts.ts — the KILL ATTEMPTS single items of the round-7
 * audit (fact7 F21, class 14), against the rows.
 *
 *  - `killAnchorSkippedOpener` (D4): `[a–b] on T — X burst (no stun)` naming a
 *    press later than the bracket's opening second while an untargeted press
 *    of an offensive cooldown that is a friendly's self-buff opened it, the
 *    caster's bracket mostly on T. 96fb4d42 1:25: Avenging Wrath at 1:25.276,
 *    the line named Ultimate Penitence at 1:30.855.
 *  - `killOwnAreaSaveUncredited` (D10): a FAILED clause that does not name an
 *    area save the target pressed on itself inside the bracket, with the
 *    save's aura on the target, and names no cause that outranks a self-save.
 *    07367f6e 1:13: Rallying Cry, `FAILED: not enough damage`.
 *  - `killFocusOverSpan` (D67): `team focus P%` against the team's landed +
 *    absorbed damage on enemy players over the printed bracket + 5 s (never
 *    past the round's end, fact9 D16).
 *    6ac699c9 2:05–2:12: 50 % printed, 71 % over that span.
 */
import { effectAurasOfCast } from "@gladlog/analysis/src/data/castEffectAuras";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import {
  ENEMY_AREA_SAVE_IDS,
  ENEMY_IMMUNITY_SAVE_AURAS,
} from "@gladlog/analysis/src/data/spellIdLists";
import { IMMUNITY_IDS } from "@gladlog/analysis/src/utils/enemyDefensives";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";
import {
  isOffensiveSpell,
  offensiveEffectCdId,
} from "@gladlog/analysis/src/utils/spellDanger";
import { CombatUnitSpec } from "@gladlog/parser-compat";

import {
  ABSORBED,
  APPLIED,
  deathMs,
  ev,
  type IRoundCtx,
  REMOVED,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";
import { DEFERRAL_SHIELDS } from "./damageBasis";

export const CHECKS = [
  "killAnchorSkippedOpener",
  "killOwnAreaSaveUncredited",
  "killFocusOverSpan",
] as const;

/** a bracket the death did not cut: the printed floor of both ends is too
 * coarse for a short bracket's share, so it is shown and not counted */
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "killFocusOverSpan|open",
]);

const LINE =
  /^\s*\[(\d+):(\d\d)–(\d+):(\d\d)\] on (\S.*?) — (.+?)(?: opener \([^)]*\), \d+ stuns?| burst \(no stun\)) \| .*team focus (\d+)% .*\| (.*)$/;
const NIL = "0000000000000000";
/** Gladiator's Medallion's press, Adaptation's logged trigger aura */
const MEDALLION = "336126";
const ADAPTATION_TRIGGER = "283167";
/** a press no burst-anchored attempt opens on: a Holy Paladin's Avenging Wrath
 * (signed, `KILL_ATTEMPT_NON_ANCHOR_CDS`). No row can say so; written here
 * again on purpose, so an entry added to the product's table shows up here
 * instead of quieting the check. */
const NOT_AN_OPENER = (f: any, id: string): boolean =>
  f.spec === CombatUnitSpec.Paladin_Holy &&
  (offensiveEffectCdId(id) ?? id) === "31884";

/** was an aura `pick` takes on `target` up at some point in [from, to): its own
 * APPLIED → REMOVED rows, the next REMOVED ending that run */
function auraUpIn(
  target: any,
  pick: (a: any) => boolean,
  fromMs: number,
  toMs: number,
): boolean {
  const rows = ((target.auraEvents ?? []) as any[]).filter(
    (a) => a.destUnitId === target.id && pick(a),
  );
  return rows.some((a) => {
    if (ev(a) === REMOVED) return tsOf(a) >= fromMs && tsOf(a) < toMs;
    if (ev(a) !== APPLIED || tsOf(a) >= toMs) return false;
    const end = rows.find(
      (r) => ev(r) === REMOVED && r.spellId === a.spellId && tsOf(r) > tsOf(a),
    );
    return end === undefined || tsOf(end) >= fromMs;
  });
}

/** does the clause open with a cause `primary` ranks above a self-save, and do
 * the target's rows hold it inside the bracket (or, `[up since]`, still up from
 * before it)? Which auras are an immunity is a lookup; that one was on the
 * target is the rows' to say. */
function causeOutranksInRows(
  target: any,
  tail: string,
  fromMs: number,
  toMs: number,
): boolean {
  const clause = tail.replace(/^FAILED: /, "");
  const pressedIn = (test: (name: string, id: string) => boolean) =>
    successesOf(target).some(
      (c) =>
        tsOf(c) >= fromMs &&
        tsOf(c) < toMs + 5000 &&
        test(
          getEnglishSpellName(c.spellId, c.spellName ?? ""),
          String(c.spellId),
        ),
    );
  if (clause.startsWith("target trinketed out"))
    return (
      pressedIn((_n, id) => id === MEDALLION) ||
      ((target.auraEvents ?? []) as any[]).some(
        (a) =>
          a.spellId === ADAPTATION_TRIGGER &&
          ev(a) === APPLIED &&
          tsOf(a) >= fromMs &&
          tsOf(a) < toMs + 5000,
      )
    );
  const broke = /^broke out \(([^)]*)\)/.exec(clause);
  if (broke) {
    const names = broke[1]!.split("/");
    return pressedIn((n) => names.includes(n));
  }
  if (clause.startsWith("forced a full immunity"))
    return auraUpIn(
      target,
      (a) =>
        IMMUNITY_IDS.has(String(a.spellId)) ||
        String(a.spellId) in ENEMY_IMMUNITY_SAVE_AURAS,
      fromMs,
      toMs + 5000,
    );
  const popped = /^popped ([^;|]*)/.exec(clause);
  if (!popped) return false;
  return popped[1]!.split("/").every((raw) => {
    const name = raw.replace(/ \[[^\]]*\]/, "").trim();
    return auraUpIn(
      target,
      (a) => getEnglishSpellName(a.spellId, a.spellName ?? "") === name,
      fromMs,
      toMs,
    );
  });
}

function run1(ctx: IRoundCtx, line: string): void {
  const m = LINE.exec(line);
  if (!m) return;
  const fromSec = secOf(`${m[1]}:${m[2]}`);
  const toSec = secOf(`${m[3]}:${m[4]}`);
  const target = ctx.byName.get(m[5]!);
  if (!target) return;
  const name = m[6]!;
  const burst = line.includes(" burst (no stun) ");
  const focus = +m[7]!;
  const tail = m[8]!;
  const fromMs = ctx.start + fromSec * 1000;
  const toMs = ctx.start + (toSec + 1) * 1000;
  const friends = ctx.units.filter(
    (u) => u.reaction !== target.reaction && u.info,
  );
  const enemyIds = new Set(
    ctx.players.filter((u) => u.reaction === target.reaction).map((u) => u.id),
  );

  if (burst) {
    ctx.bump("killAnchorSkippedOpener");
    // what the line names, its own rows: a press, or the aura of an occurrence
    // no press carries (`Metamorphosis (Demonic)`: Eye Beam's proc form on
    // 162264, `X (no press)`). The suffixes are the renderer's, not the spell's.
    const bare = name.replace(/ \((?:cast into [^)]*|no press|Demonic)\)$/, "");
    const inBracket = (t: number) => t >= fromMs && t < toMs;
    const named = friends
      .flatMap((f) => [
        ...successesOf(f),
        ...((f.auraEvents ?? []) as any[]).filter(
          (a) => a.destUnitId === f.id && ev(a) === "SPELL_AURA_APPLIED",
        ),
      ])
      .filter(
        (c) =>
          getEnglishSpellName(c.spellId, c.spellName ?? "") === bare &&
          inBracket(tsOf(c)),
      )
      .map(tsOf);
    const opensAt = Math.min(Infinity, ...named);
    if (opensAt >= fromMs + 2000) {
      for (const f of friends)
        for (const c of successesOf(f)) {
          if (tsOf(c) < fromMs || tsOf(c) >= fromMs + 1000) continue;
          // only an offensive cooldown opens a bracket: a Blink or a Dark Pact
          // in its first second is not what the line could have named
          if (
            !isOffensiveSpell(String(c.spellId)) ||
            NOT_AN_OPENER(f, String(c.spellId))
          )
            continue;
          const dest = c.destUnitId;
          if (dest && dest !== NIL && dest !== f.id) continue;
          // the self-copy of a press aimed at a teammate (Power Infusion
          // writes two SUCCESS rows, 25 ms apart): the press went there
          if (
            successesOf(f).some(
              (o) =>
                o !== c &&
                String(o.spellId) === String(c.spellId) &&
                Math.abs(tsOf(o) - tsOf(c)) <= 100 &&
                o.destUnitId !== f.id,
            )
          )
            continue;
          const ids = new Set([
            String(c.spellId),
            ...effectAurasOfCast(c.spellId),
          ]);
          const selfBuff = (f.auraEvents ?? []).some(
            (a: any) =>
              ids.has(String(a.spellId)) &&
              a.destUnitId === f.id &&
              a.auraType === "BUFF" &&
              ev(a) === "SPELL_AURA_APPLIED" &&
              Math.abs(tsOf(a) - tsOf(c)) <= 300,
          );
          // where the press went: the caster's own damage from the press to
          // the bracket's end, the target its most-hit enemy (a splash on the
          // press aims nothing). The product sums from the press's own
          // millisecond to the bracket's own end; the line prints both floored
          // to the second, so the end is read at both edges of its printed
          // second and the press is an opener only when the target leads at
          // both (GH #173 item 18: a Volley at 4:57.67 whose caster led on the
          // target only with the 0.67 s before it counted in)
          const leadsTo = (endMs: number): boolean => {
            const dealt = new Map<string, number>();
            for (const d of (f.damageOut ?? []) as any[]) {
              const t = d.logLine.timestamp;
              if (t < tsOf(c) || t > endMs || !enemyIds.has(d.destUnitId))
                continue;
              dealt.set(
                d.destUnitId,
                (dealt.get(d.destUnitId) ?? 0) +
                  Math.abs(d.effectiveAmount ?? 0),
              );
            }
            const onTarget = dealt.get(target.id) ?? 0;
            return (
              onTarget > 0 && [...dealt.values()].every((v) => v <= onTarget)
            );
          };
          // …and at every damage row of the caster inside that second: the
          // lead can change hands between the two edges (codex 85-tk-J-T74-1
          // #2), and the bracket's own end is any millisecond of it
          const ends = [
            toMs - 1000,
            toMs,
            ...((f.damageOut ?? []) as any[])
              .map((d) => d.logLine.timestamp as number)
              .filter((t) => t > toMs - 1000 && t < toMs),
          ];
          const hitTarget = ends.every(leadsTo);
          if (selfBuff && hitTarget)
            ctx.violate(
              "killAnchorSkippedOpener",
              "selfBuffOpener",
              fromMs,
              `${m[1]}:${m[2]}`,
              `opened by ${getEnglishSpellName(c.spellId, c.spellName ?? "")}, named ${name}`,
              line,
            );
        }
    }
  }

  ctx.bump("killFocusOverSpan");
  const dead = deathMs(target);
  // the printed ends are floored and the share is not monotonic in either end
  // (ec7bd3f5 1:53: 81 % from 1:53.0, 84 % from 1:53.999, 78 % from the stun's
  // own landing): every start and end those seconds allow, one per row they hold
  const inside = dead >= fromMs && dead < toMs;
  // the 5 s after stop at the round's end (fact9 D16: `creditEndMs`, read
  // through the product's `roundEndMs`)
  const roundEnd = roundEndMs(ctx.legacy);
  const endFrom = Math.min(
    inside ? dead + 5000 : ctx.start + toSec * 1000 + 5000,
    roundEnd,
  );
  const endTo = Math.min(inside ? dead + 5000 : toMs + 5000, roundEnd);
  const rows = friends
    .flatMap((f) => (f.damageOut ?? []) as any[])
    .filter(
      (d) =>
        d.logLine.timestamp >= fromMs &&
        d.logLine.timestamp <= endTo &&
        enemyIds.has(d.destUnitId) &&
        // a deferral shield held the hit back: it counts when it lands, not
        // here (FT-T02b; 5c48e842 1:09: 0.41M of Stretch Time rows, 50 % with
        // them out, 62 % in)
        !(ev(d) === ABSORBED && DEFERRAL_SHIELDS.has(String(d.spellId))),
    )
    .map((d) => ({
      t: d.logLine.timestamp as number,
      v: Math.abs(d.effectiveAmount ?? 0),
      on: d.destUnitId === target.id,
    }));
  const shareOver = (startMs: number, endMs: number) => {
    let on = 0;
    let all = 0;
    for (const r of rows) {
      if (r.t < startMs || r.t > endMs) continue;
      all += r.v;
      if (r.on) on += r.v;
    }
    return all > 0 ? (100 * on) / all : 0;
  };
  const starts = [
    fromMs,
    fromMs + 999,
    ...rows.filter((r) => r.t < fromMs + 1000).map((r) => r.t + 1),
  ];
  const ends = [
    endFrom,
    endTo,
    ...rows.filter((r) => r.t >= endFrom).map((r) => r.t - 1),
  ];
  const shares = starts.flatMap((a) => ends.map((b) => shareOver(a, b)));
  const lo = Math.min(...shares) - 3;
  const hi = Math.max(...shares) + 3;
  if (focus < lo || focus > hi)
    ctx.violate(
      "killFocusOverSpan",
      inside ? "bracketCutAtDeath" : "open",
      fromMs,
      `${m[5]}|${m[1]}:${m[2]}`,
      `printed ${focus}%, rows ${(lo + 3).toFixed(0)}–${(hi - 3).toFixed(0)}%`,
      line,
    );

  if (!tail.startsWith("FAILED")) return;
  for (const c of successesOf(target)) {
    const id = String(c.spellId);
    if (!ENEMY_AREA_SAVE_IDS.has(id)) continue;
    if (tsOf(c) < fromMs || tsOf(c) >= toMs) continue;
    const effects = new Set(effectAurasOfCast(id));
    const onIt = (target.auraEvents ?? []).some(
      (a: any) =>
        effects.has(String(a.spellId)) &&
        a.destUnitId === target.id &&
        Math.abs(tsOf(a) - tsOf(c)) <= 1000,
    );
    if (!onIt) continue;
    ctx.bump("killOwnAreaSaveUncredited");
    const saveName = getEnglishSpellName(id, c.spellName ?? "");
    // the clause is the first cause of `primary`'s order, not a list (B16b:
    // only an external is named beside a wall): an own save behind a trinket,
    // a break, an immunity or a wall stays unnamed when that cause is in the
    // rows. 287ee68f r3: its Rallying Cry 0:27, Pain Suppression on it 0:34.
    if (
      !tail.includes(saveName) &&
      !causeOutranksInRows(target, tail, fromMs, toMs)
    )
      ctx.violate(
        "killOwnAreaSaveUncredited",
        tail.includes("not enough damage") ? "readAsPressure" : "other",
        tsOf(c),
        `${m[5]}|${id}|${tsOf(c)}`,
        `${saveName} pressed ${((tsOf(c) - ctx.start) / 1000).toFixed(1)}s, clause: ${tail.slice(0, 60)}`,
        line,
      );
  }
}

export function run(ctx: IRoundCtx): void {
  for (const line of ctx.lines) run1(ctx, line);
}
