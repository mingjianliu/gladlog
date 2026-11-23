import { type Language, translate } from "../../../shared/i18n";

/**
 * Display label of one batch item: month-day, local HH:MM and bracket
 * ("11月23日 14:05 · 3v3" / "Nov 23 14:05 · 3v3"). Shared by the batch bar
 * and the auto-analyze queue so both name a match the same way.
 */
export function batchItemLabel(
  startTime: number,
  bracket: string,
  lang: Language,
): string {
  const d = new Date(startTime);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const day = translate(lang, "common.monthDay", {
    month: d.getMonth() + 1,
    day: d.getDate(),
  });
  return `${day} ${hh}:${mm} · ${bracket}`;
}
