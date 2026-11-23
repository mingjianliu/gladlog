import { intlLocale, type Language } from "../../../shared/i18n";

// Locale-aware formatting for the renderer (spec §6.3): the locale follows the
// UI language (zh-CN / en-US). Timezone handling is unchanged — no `timeZone`
// option is ever added here, so dates still render in the machine's local
// zone exactly like the bare `toLocaleString()` calls these replace.

/**
 * Same output as `new Date(ms).toLocaleString(locale, opts)`: with no `opts`
 * it prints date and time (an `Intl.DateTimeFormat` with no options would
 * print the date only); with only time fields it prints the time only, which
 * is how `toLocaleTimeString()` call sites are expressed.
 */
export function formatDateTime(
  ms: number,
  lang: Language,
  opts?: Intl.DateTimeFormatOptions,
): string {
  return new Date(ms).toLocaleString(intlLocale(lang), opts);
}

/** Time-of-day options equivalent to `toLocaleTimeString()`'s defaults. */
export const TIME_OF_DAY: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
};

export function formatNumber(
  n: number,
  lang: Language,
  opts?: Intl.NumberFormatOptions,
): string {
  return n.toLocaleString(intlLocale(lang), opts);
}
