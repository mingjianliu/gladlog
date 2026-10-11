/**
 * Displacement a unit did not make itself, as far as the log shows it:
 *  - an enemy Death Grip that landed on it — the `[GRIP]` line's own reading
 *    (`deathGripsOn`: the cast row names the target; a SPELL_MISSED row of
 *    the grip next to it means it moved nobody);
 *  - a landed enemy knockback or pull of the cast-stop evidence family
 *    (`forcedStopInstantsMs().displaced`: Thunderstorm, Typhoon, Gorefiend's
 *    Grasp — the instants `[CAST STOPPED]` reads for "as an enemy knockback
 *    or pull landed on you").
 *
 * One reading for the three places that state it: the `[GRIP]` line, the
 * STAYED IN line's "you moved N yd" (FT leftovers 2026-10-11, the I13 fact
 * half: the yards were printed as the player's own with a grip inside the
 * span) and the position-mistake row's `movedIncludes` fact. Nothing here is
 * a table of its own — the grip is one spell id, the family is
 * `DISPLACEMENT_EVIDENCE_IDS`.
 */
import type { ICombatUnit } from "@gladlog/parser-compat";
import { LogEvent } from "@gladlog/parser-compat";

import { DEATH_GRIP_ID } from "../context/resUtilityCds";
import { forcedStopInstantsMs } from "./castStopEvidence";
import { fmtTime, toRenderSecond } from "./renderGrid";

/** A SPELL_MISSED row of the grip sits within this of its cast row. */
export const GRIP_MISS_PAIR_MS = 200;

export interface DeathGripOn {
  castMs: number;
  caster: ICombatUnit;
  /** The log's miss type when the grip did not land (IMMUNE, MISS …). */
  missType?: string;
}

/** Every Death Grip `opponents` cast at `victim`, in cast order. */
export function deathGripsOn(
  victim: Pick<ICombatUnit, "id" | "missesIn">,
  opponents: readonly ICombatUnit[],
): DeathGripOn[] {
  const out: DeathGripOn[] = [];
  for (const dk of opponents) {
    for (const c of dk.spellCastEvents ?? []) {
      if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      if (c.spellId !== DEATH_GRIP_ID || c.destUnitId !== victim.id) continue;
      const castMs = c.logLine.timestamp;
      // a grip the target was immune to (or that missed) moved nobody
      const miss = (victim.missesIn ?? []).find(
        (m) =>
          m.spellId === DEATH_GRIP_ID &&
          m.srcUnitId === dk.id &&
          Math.abs(m.timestamp - castMs) <= GRIP_MISS_PAIR_MS,
      );
      out.push({
        castMs,
        caster: dk,
        ...(miss ? { missType: miss.missType } : {}),
      });
    }
  }
  return out.sort((a, b) => a.castMs - b.castMs);
}

export type ForcedMoveKind = "grip" | "displacement";
export interface ForcedMove {
  atSeconds: number;
  kind: ForcedMoveKind;
}

/**
 * The forced moves on `unit` between two RENDERED seconds — the two instants
 * a start→end displacement is sampled at (`ownerDisplacementYards`): a move
 * whose rendered second is the start's or later and before the end's lies
 * between the two samples. One entry per kind and rendered second (a
 * knockback logs its aura and its damage a few ms apart).
 */
export function forcedMovesInRenderedSpan(
  unit: Pick<ICombatUnit, "id" | "missesIn" | "auraEvents" | "damageIn">,
  opponents: readonly ICombatUnit[],
  matchStartMs: number,
  fromRenderS: number,
  toRenderS: number,
): ForcedMove[] {
  const all: ForcedMove[] = [
    ...deathGripsOn(unit, opponents)
      .filter((g) => g.missType === undefined)
      .map((g) => ({
        atSeconds: (g.castMs - matchStartMs) / 1000,
        kind: "grip" as const,
      })),
    ...forcedStopInstantsMs(unit).displaced.map((ms) => ({
      atSeconds: (ms - matchStartMs) / 1000,
      kind: "displacement" as const,
    })),
  ];
  const seen = new Set<string>();
  return all
    .sort((a, b) => a.atSeconds - b.atSeconds)
    .filter((m) => {
      const s = toRenderSecond(m.atSeconds);
      if (s < fromRenderS || s >= toRenderS) return false;
      const key = `${m.kind}:${s}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** What moved the unit, as the STAYED IN line and the row's fact name it. */
export const FORCED_MOVE_TEXT: Record<ForcedMoveKind, string> = {
  grip: "Death Grip pulled you",
  displacement: "an enemy knockback or pull landed on you",
};

/** `Death Grip pulled you at 0:15, an enemy knockback or pull landed on you
 * at 0:18` — the one wording of a list of forced moves. */
export function forcedMovesText(moves: readonly ForcedMove[]): string {
  return moves
    .map((m) => `${FORCED_MOVE_TEXT[m.kind]} at ${fmtTime(m.atSeconds)}`)
    .join(", ");
}
