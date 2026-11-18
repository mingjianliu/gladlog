/* eslint-disable @typescript-eslint/no-explicit-any -- the check walks the untyped legacy parse objects */
/**
 * scan5/t120.ts — ticket T120 (fact12 retest, f22d547e r0 1:35): an enemy
 * control the log wrote as failed on a player with a miss type other than
 * IMMUNE (a Hammer of Justice logged MISS under Searing Glare on its
 * caster) and nothing credited had no line; IMMUNE rows had theirs since
 * corpusFactScan2 immunityTableForward (2026-10-22).
 *
 *  - `failedControlNoLine`: per round, a SPELL_MISSED row on a player of a
 *    `CONTROL_FAILED_MISS_TYPES` type, IMMUNE excluded, of a control (the
 *    product's 1b selection: `ccSpellIds`, a control cast or a silence
 *    mechanic, `controlReachesPlayers`) from a unit hostile to them, inside
 *    the round, the control not landing on them within 1 s. Violation
 *    (kind = the miss type): no timeline line in its second ±1 names the
 *    control and the player — as its subject, or in the miss tag of the
 *    control's cast line (`[MISSED on N(…)`, `CC_MISS_TAG_WORD`). A
 *    REFLECT row of a chain the producer prints (`reflectedSpells`, the
 *    chain its [REFLECTED] line is built from) is stated by that line
 *    alone: at the chain's first row, its caster, spell and reflector
 *    (`parseReflectedLine`; kind REFLECT when missing). Counted: every
 *    such row of a player with a pid.
 *
 * T176 (ruling A13): 24 of the 31 residuals on the 605 were stated — by
 * the miss tag of the cast line of the press the row belongs to, seconds
 * before the row (a ground control lands after its press: Capacitor Totem
 * 2 s, Sigil of Misery, Freezing Trap, Snowdrift, Binding Shot), or under
 * the press's name (`[CC NOT LANDED] … ← Summon Infernal` for an Infernal
 * Awakening row). The check now finds that press the producer's way
 * (`castAndEffectIds` + `missBelongsToCast`, the caster's own or its
 * owner's) and also reads the lines of the press's second and the press's
 * name.
 *    Inventory, not in the total — kind `silence row of another type than
 *    IMMUNE, our side's`: every row the T176 product change newly admits
 *    to `[CC NOT LANDED]` (a silence-mechanic id `missReportsControl` does
 *    not take, of a failed type other than IMMUNE, cast by the context
 *    owner's side at an enemy player), whether or not a line states it —
 *    the archives the change can fire in.
 */
import {
  type IReflected,
  reflectedSpells,
} from "@gladlog/analysis/src/context/spellOutcomeLines";
import { castAndEffectIds } from "@gladlog/analysis/src/data/castEffectAuras";
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import {
  CC_MISS_TAG_WORD,
  CONTROL_FAILED_MISS_TYPES,
  controlReachesPlayers,
  isControlCast,
  missBelongsToCast,
  missReportsControl,
} from "@gladlog/analysis/src/utils/castMissRows";
import { commandReflectRows } from "@gladlog/analysis/src/utils/petCommands";
import { ccMechanicOf } from "@gladlog/analysis/src/utils/spellMechanics";

import {
  APPLIED,
  ev,
  fmtS,
  type IRoundCtx,
  nameOf,
  parseReflectedLine,
  tsOf,
} from "./ctx";

export const CHECKS = ["failedControlNoLine"] as const;
const NEWLY_ADMITTED = "silence row of another type than IMMUNE, our side's";
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  `failedControlNoLine|${NEWLY_ADMITTED}`,
]);

const LINE_AT = /^\s*(\d+):(\d\d)\s/;

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  const C = "failedControlNoLine";
  const bySec = new Map<number, string[]>();
  for (const l of ctx.lines) {
    const m = LINE_AT.exec(l);
    if (!m) continue;
    const s = Number(m[1]) * 60 + Number(m[2]);
    const list = bySec.get(s) ?? [];
    list.push(l);
    bySec.set(s, list);
  }
  const byId = new Map(ctx.units.map((u) => [u.id as string, u]));
  // the producer's reflect chains, once per round
  let chains: IReflected[] | undefined;
  const reflectChains = (): IReflected[] =>
    (chains ??= reflectedSpells(ctx.units, ctx.start));
  // an owner's command row its pet carried out: the pet's own row is the
  // fact, the owner's is dropped (`commandReflectRows`, utils/petCommands.ts; codex
  // 85-tk-L-T120-2f)
  const rowKey = (r: any) => `${r.srcUnitId}@${tsOf(r)}#${r.spellId}`;
  let carried: Set<string> | undefined;
  const carriedOut = (): Set<string> =>
    (carried ??= new Set(
      [...commandReflectRows(ctx.units).carriedOut].map(rowKey),
    ));
  for (const u of ctx.players) {
    const pid = ctx.pidOf(u.name);
    if (!pid) continue;
    for (const m of (u.missesIn ?? []) as any[]) {
      const id = String(m.spellId ?? "");
      if (ev(m) !== "SPELL_MISSED" || !id) continue;
      if (m.missType === "IMMUNE" || !CONTROL_FAILED_MISS_TYPES.has(m.missType))
        continue;
      if (!ccSpellIds.has(id) && !isControlCast(id) && ccMechanicOf(id) !== 9)
        continue;
      if (!controlReachesPlayers(id)) continue;
      const ts = tsOf(m);
      if (ts < ctx.start || ts > ctx.roundEndAt) continue;
      const src = byId.get(m.srcUnitId);
      const owner = src?.ownerId ? byId.get(src.ownerId) : src;
      if (!owner || owner.reaction === u.reaction) continue;
      const name = nameOf(id, m.spellName);
      if (
        ctx.owner &&
        owner.reaction === ctx.owner.reaction &&
        ccMechanicOf(id) === 9 &&
        !missReportsControl(id)
      )
        ctx.violate(
          C,
          NEWLY_ADMITTED,
          ts,
          `${u.id}#${id}#${ts}#admitted`,
          `${fmtS(Math.floor((ts - ctx.start) / 1000))} ${pid}(${u.name}) ← ${name} (by ${owner.name}) logged ${m.missType}`,
        );
      const landed = ((u.auraEvents ?? []) as any[]).some(
        (a) =>
          ev(a) === APPLIED &&
          nameOf(String(a.spellId), a.spellName) === name &&
          Math.abs(tsOf(a) - ts) <= 1000,
      );
      if (landed) continue;
      // a carried-out command row is no fact of its own
      if (m.missType === "REFLECT" && carriedOut().has(rowKey(m))) continue;
      ctx.bump(C);
      const sec = Math.floor((ts - ctx.start) / 1000);
      // a REFLECT row the producer's [REFLECTED] line states — a row of a
      // chain `reflectedSpells` prints (its own caster, reflector, ms and
      // spell: the chain the line is built from, command rows its pet
      // carried out dropped) — must have that line: at the chain's first
      // row, naming its caster, spell and reflector (codex 85-tk-L-T120-2b
      // #2 … 2e: every reading rebuilt beside the producer's chain missed a
      // case). A row of no printed chain needs a line of its own (below).
      if (m.missType === "REFLECT") {
        const chain = reflectChains().find(
          (c) =>
            c.reflectorId === u.id &&
            c.spellName === name &&
            c.rowsMs.some(
              (ms, k) =>
                ms === ts && (c.rowSrcIds[k] ?? c.casterId) === m.srcUnitId,
            ),
        );
        if (chain) {
          const at = Math.floor((chain.rowsMs[0]! - ctx.start) / 1000);
          const casterUnit = byId.get(chain.casterId);
          const casterPid = ctx.pidOf(
            (casterUnit?.ownerId && byId.get(casterUnit.ownerId)?.name) ||
              chain.casterName,
          );
          const stated = (bySec.get(at) ?? []).some((l) => {
            const r = parseReflectedLine(l);
            // a summon's spell prints `N(…)'s pet's X` — the spell is X
            return (
              r?.reflectorPid === pid &&
              (casterPid === undefined || r.casterPid === casterPid) &&
              (r.spell === name || r.spell.endsWith(`'s ${name}`))
            );
          });
          if (stated) continue;
          ctx.violate(
            C,
            "REFLECT",
            ts,
            `${u.id}#${id}#${ts}`,
            `${fmtS(sec)} ${pid}(${u.name}) ← ${name} (by ${owner.name}) reflected; its chain's [REFLECTED] line at ${fmtS(at)} is missing`,
          );
          continue;
        }
      }
      // the press this row belongs to, the producer's attribution (the
      // cast lines' `missBelongsToCast` over the cast→effect family)
      const presses = ((owner.spellCastEvents ?? []) as any[]).filter(
        (e) =>
          ev(e) === "SPELL_CAST_SUCCESS" &&
          !!e.spellId &&
          castAndEffectIds(String(e.spellId)).has(id),
      );
      const press = presses.find((e) =>
        missBelongsToCast(
          presses
            .filter((x) => x.spellId === e.spellId)
            .map((x) => tsOf(x) as number),
          tsOf(e),
          ts,
        ),
      );
      const pressName = press
        ? nameOf(String(press.spellId), press.spellName)
        : name;
      const pressSec = press
        ? Math.floor((tsOf(press) - ctx.start) / 1000)
        : sec;
      const named = [
        ...new Set([
          sec - 1,
          sec,
          sec + 1,
          pressSec - 1,
          pressSec,
          pressSec + 1,
        ]),
      ]
        .flatMap((s) => bySec.get(s) ?? [])
        // the player as the line's subject (`[TAG]   N(…): X` / `N(…) ← X`),
        // never as a caster in `(by N(…))` (codex 85-tk-L-T120-1 #3); or
        // the miss stated against them: a cast line's fail tag (`[MISSED on
        // N(…)`, `[PARRIED by N(…)` — `CC_MISS_TAG_WORD`, the tag the press
        // line of the other side's control carries; T120 605 rerun: most
        // of 276 rows were stated so)
        .some(
          (l) =>
            (l.includes(name) || l.includes(pressName)) &&
            (new RegExp(String.raw`\]\s+${pid}\([^)]*\)(?::| ←) `).test(l) ||
              (m.missType !== undefined &&
                CC_MISS_TAG_WORD[m.missType] !== undefined &&
                l.includes(
                  `[${CC_MISS_TAG_WORD[m.missType] === "MISSED" ? "MISSED on" : CC_MISS_TAG_WORD[m.missType]} ${pid}(`,
                ))),
        );
      if (named) continue;
      ctx.violate(
        C,
        m.missType,
        ts,
        `${u.id}#${id}#${ts}`,
        `${fmtS(sec)} ${pid}(${u.name}) ← ${name} (by ${owner.name}) logged ${m.missType}; no line names it`,
      );
    }
  }
}
