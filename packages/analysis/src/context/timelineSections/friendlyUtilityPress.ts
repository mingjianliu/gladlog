/**
 * The press line of a friendly utility button that sits under
 * `MIN_CD_SECONDS`, so it has no ledger row, no loadout entry and no [RES]
 * entry: only the line (user ruling 2026-10-30, fact7 D19 / D26: Spell
 * Reflection, 25 s — d2e6e70b 0:21 reflected two spells with nothing in the
 * prompt that the owner pressed it; the 10-26 ruling keeps it Utility).
 */
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { getEnglishSpellName } from "../../data/spellEffectData";
import { FRIENDLY_PRESS_LINE_ONLY_IDS } from "../../data/spellIdLists";
import { reachesAlly } from "../../data/spellTargeting";
import { isControlCast } from "../../utils/castMissRows";
import { specToString } from "../../utils/cooldowns";
import { fmtTime } from "../../utils/renderGrid";
import type { TimelineCtx } from "./ctx";

export function emitFriendlyUtilityPressEntries(
  ctx: Pick<
    TimelineCtx,
    "owner" | "friends" | "pid" | "addEntry" | "matchStartMs"
  >,
): void {
  const { owner, friends, pid, addEntry } = ctx;
  for (const unit of friends) {
    for (const c of unit.spellCastEvents ?? []) {
      if (
        c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS ||
        !c.spellId ||
        !FRIENDLY_PRESS_LINE_ONLY_IDS.has(c.spellId)
      )
        continue;
      const t = (c.logLine.timestamp - ctx.matchStartMs) / 1000;
      const name = getEnglishSpellName(c.spellId, c.spellName ?? "");
      addEntry(
        t,
        unit.id === owner.id
          ? `${fmtTime(t)}  [YOU] [CD]   ${name}`
          : `${fmtTime(t)}  [TEAM] [CD]   ${pid(unit.name)} (${specToString(unit.spec)}): ${name}`,
      );
    }
  }
}

/** Dark Simulacrum's press, and the buff on the Death Knight that holds the
 *  spell it copied; the buff comes off in the ms the copy is cast */
export const DARK_SIMULACRUM_ID = "77606";
export const DARK_SIMULACRUM_COPY_BUFF_ID = "77616";
/** the copy's cast row and its buff's REMOVED share the ms (b8a9f3e3 r0:
 *  0:39.419 both); a few ms of slack for the log's row order */
export const DARK_SIMULACRUM_SPEND_MS = 5;

/**
 * A unit's casts of spells it copied with Dark Simulacrum — another class's
 * spell, in no kit and no ledger of its: each SPELL_CAST_SUCCESS (not Dark
 * Simulacrum itself) within `DARK_SIMULACRUM_SPEND_MS` of its copy buff
 * coming off it.
 */
export function darkSimulacrumCopyCasts(
  unit: Pick<ICombatUnit, "id" | "auraEvents" | "spellCastEvents">,
): ICombatUnit["spellCastEvents"] {
  const spentMs = (unit.auraEvents ?? [])
    .filter(
      (a) =>
        a.spellId === DARK_SIMULACRUM_COPY_BUFF_ID &&
        a.destUnitId === unit.id &&
        a.logLine.event === LogEvent.SPELL_AURA_REMOVED,
    )
    .map((a) => a.logLine.timestamp);
  if (spentMs.length === 0) return [];
  return (unit.spellCastEvents ?? []).filter(
    (c) =>
      c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
      !!c.spellId &&
      c.spellId !== DARK_SIMULACRUM_ID &&
      spentMs.some(
        (t) => Math.abs(t - c.logLine.timestamp) <= DARK_SIMULACRUM_SPEND_MS,
      ),
  );
}

/**
 * The press line of a spell a friendly Death Knight cast through Dark
 * Simulacrum (user ruling R41 2026-11-14, fact13 D20: "print it" — b8a9f3e3
 * r0, a Frost DK's copied Pain Suppression on himself at 0:39, 8 s, with no
 * line anywhere). The existing press shapes, nothing else: `[YOU] [CD]   X` /
 * `[TEAM] [CD]   N (Spec): X[ → ally]`, a control `[TEAM] [CC]   N (Spec)
 * cast X → enemy`. No ledger row, kit entry or defensive value (the
 * 2026-10-30 ruling on stolen shields stands).
 */
export function emitDarkSimulacrumPressEntries(
  ctx: Pick<
    TimelineCtx,
    | "owner"
    | "friends"
    | "pid"
    | "friendlyPid"
    | "enemyPid"
    | "addEntry"
    | "matchStartMs"
  >,
): void {
  const { owner, friends, pid, friendlyPid, enemyPid, addEntry } = ctx;
  for (const unit of friends) {
    for (const c of darkSimulacrumCopyCasts(unit)) {
      const t = (c.logLine.timestamp - ctx.matchStartMs) / 1000;
      const name = getEnglishSpellName(c.spellId!, c.spellName ?? "");
      const dest =
        c.destUnitName && c.destUnitName !== "nil" && c.destUnitId !== unit.id
          ? c.destUnitName
          : undefined;
      if (isControlCast(c.spellId!)) {
        const tgt = dest ? enemyPid(dest) : "";
        const onTgt =
          tgt && ![...tgt].some((ch) => ch.charCodeAt(0) > 127)
            ? ` → ${tgt}`
            : "";
        addEntry(
          t,
          unit.id === owner.id
            ? `${fmtTime(t)}  [YOU] [CC]   ${name}${onTgt}`
            : `${fmtTime(t)}  [TEAM] [CC]   ${pid(unit.name)} (${specToString(unit.spec)}) cast ${name}${onTgt}`,
        );
        continue;
      }
      const ally =
        dest && reachesAlly(c.spellId!) ? friendlyPid(dest) : undefined;
      addEntry(
        t,
        unit.id === owner.id
          ? `${fmtTime(t)}  [YOU] [CD]   ${name}${ally ? ` → ${ally}` : ""}`
          : `${fmtTime(t)}  [TEAM] [CD]   ${pid(unit.name)} (${specToString(unit.spec)}): ${name}${ally ? ` → ${ally}` : ""}`,
      );
    }
  }
}
