/**
 * Which aura-only activations stand for a press on a log of a given date —
 * the dated half of `data/auraActivation.ts` (`logDatedAt`, utils/logEra.ts).
 *
 * Doom Winds 384352 (fact11 D7 / D44, user rulings 2026-11-05): on 12.1.0
 * logs its press was mostly not logged — 27 SPELL_CAST_SUCCESS rows beside
 * 73 buffs 466772 with neither a press nor Ascendance on the 605-file
 * capture — and such a buff was read as an unlogged press (ruling
 * 2026-09-26). On 12.1.5 the press logs (105 rows on the audit rounds'
 * libraries, 8 buffs with neither), and a buff with neither is a proc: two
 * of them 12–34 s apart (3 of 4 pairs on the cover set; 10244184 1:30 /
 * 1:55, 24.9 s) under a 60 s cooldown, each in the millisecond of a
 * Maelstrom Weapon spender. From 12.1.5 the buff is no press: it spends no
 * cooldown, proves no button and the round reads it `(no press)`. The
 * careful side of an undatable log is the press (`uncertainTakes`): a proc
 * read as a press spends a cooldown, a press read as a proc calls it ready.
 */
import {
  AURA_ACTIVATION_PROVES_BUTTON_IDS,
  AURA_IS_THE_PRESS_IDS,
  AURA_ONLY_ACTIVATION_IDS,
} from "../data/auraActivation";
import type { LogInstant } from "./logEra";
import { type ILogDated, logDatedAt } from "./logEra";
import { PATCH_1215_GOLIVE_EPOCH_MS } from "./talents";

/** cooldown id → whether its aura stands for a press, by log date */
export const AURA_PRESS_BY_ERA: Readonly<Record<string, ILogDated<boolean>>> = {
  "384352": {
    cutoverEpochMs: PATCH_1215_GOLIVE_EPOCH_MS,
    before: true,
    since: false,
    uncertainTakes: "before",
  },
};

/** Does this cooldown's aura stand for a press on a log at `logEpochMs`?
 * True for every `AURA_ONLY_ACTIVATION_IDS` key without a dated rule. */
export function auraStandsForPressAt(
  spellId: string,
  logEpochMs: LogInstant,
): boolean {
  const dated = AURA_PRESS_BY_ERA[spellId];
  return dated === undefined || logDatedAt(dated, logEpochMs);
}

/** `AURA_ONLY_ACTIVATION_IDS[spellId]` on a log at `logEpochMs` (undefined
 * when its aura is no press there). */
export function auraOnlyActivationIdsAt(
  spellId: string,
  logEpochMs: LogInstant,
): readonly string[] | undefined {
  return auraStandsForPressAt(spellId, logEpochMs)
    ? AURA_ONLY_ACTIVATION_IDS[spellId]
    : undefined;
}

/** `AURA_IS_THE_PRESS_IDS` on a log at `logEpochMs`. */
export function auraIsThePressAt(
  spellId: string,
  logEpochMs: LogInstant,
): boolean {
  return (
    AURA_IS_THE_PRESS_IDS.has(spellId) &&
    auraStandsForPressAt(spellId, logEpochMs)
  );
}

/** `AURA_ACTIVATION_PROVES_BUTTON_IDS` on a log at `logEpochMs`. */
export function auraActivationProvesButtonAt(
  spellId: string,
  logEpochMs: LogInstant,
): boolean {
  return (
    AURA_ACTIVATION_PROVES_BUTTON_IDS.has(spellId) &&
    auraStandsForPressAt(spellId, logEpochMs)
  );
}
