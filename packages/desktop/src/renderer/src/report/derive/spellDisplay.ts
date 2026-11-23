import { getEnglishSpellName } from "@gladlog/analysis";

import type { Language } from "../../../../shared/i18n";
import { spellLabel } from "./spellLabel";

/** Single source for spell names in the render layer (P2-1): by default it
 * returns the logged name verbatim (same criterion as the GCD lanes and the
 * meter details — a CN log stays Chinese everywhere, an EN log stays English
 * everywhere); only when the logged name is missing (e.g. a spell that was
 * never cast and is known by id alone) does it fall back to the English
 * dictionary name. In the en UI it is `spellLabel`'s English name (spec §8
 * item 1). The analysis side (prompt/audits) does not go through this. */
export function displaySpellName(
  spellId: string | null | undefined,
  logName: string | null | undefined,
  lang: Language = "zh",
): string {
  return (
    (lang === "en" ? spellLabel(spellId, logName, lang) : logName) ||
    getEnglishSpellName(spellId ?? "", null)
  );
}
