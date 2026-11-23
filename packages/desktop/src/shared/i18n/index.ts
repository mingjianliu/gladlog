// UI-language dictionary core. Pure and side-effect free so both the main
// process and the renderer can import it (lives in src/shared/).
import { enMessages } from "./en/index";
import { zhMessages } from "./zh/index";

export type Language = "zh" | "en";
export const LANGUAGES: readonly Language[] = ["zh", "en"];

export type MessageParams = Record<string, string | number>;
export type MessageValue = string | ((p: MessageParams) => string);
export type MessageKey = keyof typeof zhMessages;
export type Messages = { [K in MessageKey]: MessageValue };

export { enMessages, zhMessages };

const DICTIONARIES: Record<Language, Messages> = {
  zh: zhMessages,
  en: enMessages,
};

const PLACEHOLDER = /\{(\w+)\}/g;

/** Replace `{name}` placeholders; a placeholder with no matching param is kept verbatim. */
function interpolate(
  template: string,
  params: MessageParams | undefined,
): string {
  if (!params) return template;
  return template.replace(PLACEHOLDER, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : whole,
  );
}

export function translate(
  lang: Language,
  key: MessageKey,
  params?: MessageParams,
): string {
  const value = DICTIONARIES[lang][key];
  if (typeof value === "function") return value(params ?? {});
  return interpolate(value, params);
}

export type TFn = (key: MessageKey, params?: MessageParams) => string;

export function makeT(lang: Language): TFn {
  return (key, params) => translate(lang, key, params);
}

/** Map an OS / browser locale to a UI language: any `zh*` locale is zh, everything else en. */
export function localeToLanguage(locale: string | null | undefined): Language {
  return locale && /^zh/i.test(locale) ? "zh" : "en";
}

/** Value for `<html lang>`. */
export function htmlLang(lang: Language): "zh-CN" | "en" {
  return lang === "zh" ? "zh-CN" : "en";
}

/** Locale for `Intl.*` / `toLocaleString` formatting. */
export function intlLocale(lang: Language): "zh-CN" | "en-US" {
  return lang === "zh" ? "zh-CN" : "en-US";
}

/**
 * "zh / en" for the few strings that must read in both languages whatever the
 * current one is (the settings-page language label, the first-run picker):
 * each half comes from its own dictionary, so en stays CJK-free.
 */
export function bilingual(key: MessageKey, params?: MessageParams): string {
  return `${translate("zh", key, params)} / ${translate("en", key, params)}`;
}
