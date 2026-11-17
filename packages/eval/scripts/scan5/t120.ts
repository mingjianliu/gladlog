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
 *    control's cast line (`[MISSED on N(…)`, `CC_MISS_TAG_WORD`) or the
 *    `[REFLECTED]` line's `reflected[ ×N] by N(…)` (`parseReflectedLine`). Counted: every such row of a player
 *    with a pid.
 */
import { REFLECT_CHAIN_GAP_MS } from "@gladlog/analysis/src/context/spellOutcomeLines";
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import {
  CC_MISS_TAG_WORD,
  CONTROL_FAILED_MISS_TYPES,
  controlReachesPlayers,
  isControlCast,
} from "@gladlog/analysis/src/utils/castMissRows";
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
  const ownerIdOf = (id: string): string => {
    const u = byId.get(id);
    return (u?.ownerId as string | undefined) || id;
  };
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
      const landed = ((u.auraEvents ?? []) as any[]).some(
        (a) =>
          ev(a) === APPLIED &&
          nameOf(String(a.spellId), a.spellName) === name &&
          Math.abs(tsOf(a) - ts) <= 1000,
      );
      if (landed) continue;
      ctx.bump(C);
      const sec = Math.floor((ts - ctx.start) / 1000);
      // a reflected row is printed at its chain's first row — the same
      // spell's REFLECT rows from that caster on this player, each within
      // `REFLECT_CHAIN_GAP_MS` of the one before (`reflectedSpells`' chain;
      // codex 85-tk-L-T120-2b #2: a second Polymorph 2.5 s later is the
      // first's `reflected ×2` line)
      let chainFirst = ts;
      if (m.missType === "REFLECT") {
        const prior = ((u.missesIn ?? []) as any[])
          .filter(
            (r) =>
              r.missType === "REFLECT" &&
              // one caster: a pet's rows and its owner's command rows
              // (`petCommands` moves the latter to the pet; codex
              // 85-tk-L-T120-2c #2)
              ownerIdOf(r.srcUnitId) === ownerIdOf(m.srcUnitId) &&
              nameOf(String(r.spellId ?? ""), r.spellName) === name &&
              tsOf(r) < ts,
          )
          .map(tsOf)
          .sort((a, b) => b - a);
        for (const t of prior)
          if (chainFirst - t <= REFLECT_CHAIN_GAP_MS) chainFirst = t;
          else break;
      }
      const firstSec = Math.floor((chainFirst - ctx.start) / 1000);
      const reflectedNamed = (bySec.get(firstSec) ?? []).some((l) => {
        const r = parseReflectedLine(l);
        // a summon's spell prints `N(…)'s pet's X` — the spell is X
        return (
          r?.reflectorPid === pid &&
          (r.spell === name || r.spell.endsWith(`'s ${name}`))
        );
      });
      if (m.missType === "REFLECT" && reflectedNamed) continue;
      const named = [sec - 1, sec, sec + 1]
        .flatMap((s) => bySec.get(s) ?? [])
        // the player as the line's subject (`[TAG]   N(…): X` / `N(…) ← X`),
        // never as a caster in `(by N(…))` (codex 85-tk-L-T120-1 #3); or
        // the miss stated against them: a cast line's fail tag (`[MISSED on
        // N(…)`, `[PARRIED by N(…)` — `CC_MISS_TAG_WORD`, the tag the press
        // line of the other side's control carries) or the `[REFLECTED]`
        // line's `reflected by N(…)` (T120 605 rerun: 243 of 276 rows were
        // stated so)
        .some(
          (l) =>
            l.includes(name) &&
            (new RegExp(String.raw`\]\s+${pid}\([^)]*\)(?::| ←) `).test(l) ||
              (m.missType !== undefined &&
                CC_MISS_TAG_WORD[m.missType] !== undefined &&
                l.includes(
                  `[${CC_MISS_TAG_WORD[m.missType] === "MISSED" ? "MISSED on" : CC_MISS_TAG_WORD[m.missType]} ${pid}(`,
                )) ||
              // a grouped return prints `reflected ×N by` (codex
              // 85-tk-L-T120-2 #2: the shared parser)
              (m.missType === "REFLECT" &&
                parseReflectedLine(l)?.reflectorPid === pid)),
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
