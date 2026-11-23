import { getEnglishSpellName } from "@gladlog/analysis";

import type { Language } from "../../../../shared/i18n";

/**
 * A log spell name in the UI language (spec §8 item 1).
 *
 * zh: the log's own name, unchanged — a CN log stays Chinese, an EN log
 * English, exactly as before the language switch existed.
 *
 * en: the English name the prompt path uses (`getEnglishSpellName`, the one
 * source), so a log recorded on a Chinese client reads in English. An id the
 * tables lack keeps the log's own name: unlike the prompt, which falls back to
 * the bare id rather than print a localized name, the UI shows the name the
 * player saw. Until the 12 MB name table has streamed in, most ids miss too and
 * the log name shows; `useT().namesVersion` bumps when it lands, and every
 * caller keys its memo on it, so the English names appear without a remount.
 *
 * Per row in big lists: two hash lookups, no allocation.
 */
export function spellLabel(
  spellId: string | number | null | undefined,
  logName: string | null | undefined,
  lang: Language,
): string {
  const name = logName ?? "";
  if (lang !== "en") return name;
  const id = spellId == null ? "" : String(spellId);
  if (id === "") return name;
  // `null` fallback: a miss comes back as the id itself, which is how a miss
  // is told apart from a hit (no English name equals its numeric id). The
  // table also holds a few ids whose name is "" (9 in the current build):
  // those count as misses too.
  const en = getEnglishSpellName(id, null);
  return en && en !== id ? en : name;
}
