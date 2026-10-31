/**
 * The press line of a friendly utility button that sits under
 * `MIN_CD_SECONDS`, so it has no ledger row, no loadout entry and no [RES]
 * entry: only the line (user ruling 2026-10-30, fact7 D19 / D26: Spell
 * Reflection, 25 s — d2e6e70b 0:21 reflected two spells with nothing in the
 * prompt that the owner pressed it; the 10-26 ruling keeps it Utility).
 */
import { LogEvent } from "@gladlog/parser-compat";

import { getEnglishSpellName } from "../../data/spellEffectData";
import { FRIENDLY_PRESS_LINE_ONLY_IDS } from "../../data/spellIdLists";
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
