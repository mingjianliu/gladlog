// Effective UI language for the main process (spec 2026-11-23 §6.1 / §6.6).
// Electron-free so it can be unit tested in plain node: callers pass in
// app.getLocale() and the exe directory.
import { readFileSync } from "fs";
import { join } from "path";

import {
  effectiveLanguage as resolveLanguage,
  type Language,
  LANGUAGES,
} from "../shared/i18n/index";

/** The stored choice if there is one, otherwise a guess from the OS locale.
 * The guess is never written back to settings. */
export function effectiveLanguage(
  s: { language?: Language | null },
  systemLocale: string,
): Language {
  return resolveLanguage(s.language, systemLocale);
}

/** Settings with `language` resolved to a concrete value -- what main-side
 * services receive from their `getSettings` dependency. */
export function withEffectiveLanguage<T extends { language: Language | null }>(
  s: T,
  systemLocale: string,
): Omit<T, "language"> & { language: Language } {
  return { ...s, language: effectiveLanguage(s, systemLocale) };
}

/** File the Windows NSIS installer writes next to the exe on an interactive
 * install (build/installer.nsh, §6.6). */
export const INSTALLER_LANGUAGE_FILE = "installer-language.txt";

/** Language picked in the Windows installer, or null when the file is missing,
 * unreadable or holds anything other than `zh` / `en`. Never throws. */
export function readInstallerLanguage(exeDir: string): Language | null {
  try {
    const v = readFileSync(join(exeDir, INSTALLER_LANGUAGE_FILE), "utf-8")
      .replace(/^\uFEFF/, "")
      .trim();
    return (LANGUAGES as readonly string[]).includes(v)
      ? (v as Language)
      : null;
  } catch {
    return null;
  }
}

/** §6.1 step 3: the installer's language to adopt into settings, or null.
 * Only on Windows, and only while the user has not chosen a language -- an
 * existing choice survives any later reinstall. `exeDir` is called only when
 * the file is actually read. */
export function installerLanguageToAdopt(
  platform: NodeJS.Platform,
  current: Language | null,
  exeDir: () => string,
): Language | null {
  if (current !== null) return null;
  if (platform !== "win32") return null;
  return readInstallerLanguage(exeDir());
}
