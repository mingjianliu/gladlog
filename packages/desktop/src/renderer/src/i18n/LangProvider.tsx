import { ensureSpellNames, spellNamesReady } from "@gladlog/analysis";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  effectiveLanguage,
  htmlLang,
  type Language,
  makeT,
  type TFn,
} from "../../../shared/i18n";
import { bridge } from "../bridge";
import { LanguagePicker } from "./LanguagePicker";

export interface LangContextValue {
  t: TFn;
  lang: Language;
  /** Switch the UI language: updates every consumer at once (no remount) and
   *  persists `settings.language`. Resolves true when the choice was saved,
   *  false when it applies to this session only (no settings facet, or the
   *  save failed). */
  setLang(l: Language): Promise<boolean>;
  /** Bumped when the spell-name table a language needs finishes loading (en:
   *  the English names `spellLabel` reads, which stream in after first
   *  paint). Every memo or effect that calls `spellLabel` keys on it, so the
   *  English names replace the log's own without a remount. */
  namesVersion: number;
}

// Outside a provider (component tests that render a bare component): zh, so
// the existing Chinese assertions keep holding without wrapping.
const FALLBACK: LangContextValue = {
  t: makeT("zh"),
  lang: "zh",
  setLang: async () => false,
  namesVersion: 0,
};

const LangContext = createContext<LangContextValue | null>(null);

export function useT(): LangContextValue {
  return useContext(LangContext) ?? FALLBACK;
}

type Phase = "loading" | "ready" | "unavailable";

/**
 * Reads `settings.language` once on mount and renders nothing until it has
 * it, so consumers never see a language flip after mounting (a flip would
 * re-run per-language effects such as the AI card's cache query — the GH #26
 * shape). While the stored language is null the effective language is the
 * browser locale's, matching main's `app.getLocale()` fallback, and the
 * first-run picker is shown instead of the app (`firstRunPicker`).
 */
export function LangProvider({
  children,
  firstRunPicker = true,
}: {
  children: ReactNode;
  firstRunPicker?: boolean;
}) {
  const [locale] = useState<string | undefined>(() =>
    typeof navigator === "undefined" ? undefined : navigator.language,
  );
  // The picker's preselection: what the locale alone says.
  const localeLang = effectiveLanguage(null, locale);
  const [chosen, setChosen] = useState<Language | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    let cancelled = false;
    try {
      void bridge()
        .settings.get()
        .then((s) => {
          if (cancelled) return;
          const l = (s as { language?: Language | null } | null)?.language;
          setChosen(l === "zh" || l === "en" ? l : null);
          setPhase("ready");
        })
        .catch(() => {
          if (!cancelled) setPhase("unavailable");
        });
    } catch {
      // No settings facet (fixture / test bed): nothing to read or persist.
      setPhase("unavailable");
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const lang = effectiveLanguage(chosen, locale);

  useEffect(() => {
    document.documentElement.lang = htmlLang(lang);
  }, [lang]);

  // en reads English spell names from the 12 MB table analysis loads in the
  // background; until it lands `spellLabel` shows the log's own names. zh
  // never reads it. Already loaded: nothing to wait for, no extra render.
  const [namesVersion, setNamesVersion] = useState(0);
  useEffect(() => {
    if (lang !== "en" || spellNamesReady()) return;
    let cancelled = false;
    void ensureSpellNames().then(
      () => {
        if (!cancelled) setNamesVersion((v) => v + 1);
      },
      () => {
        /* never loads: the log names stay */
      },
    );
    return () => {
      cancelled = true;
    };
  }, [lang]);

  const setLang = useCallback(async (l: Language): Promise<boolean> => {
    // Context first, so every consumer switches immediately; then persist.
    setChosen(l);
    document.documentElement.lang = htmlLang(l);
    try {
      const next = (await bridge().settings.save({ language: l })) as {
        language?: Language | null;
      } | null;
      // A returned document that carries a different language means the
      // patch was dropped (sanitized away) rather than persisted.
      return next?.language === undefined || next.language === l;
    } catch {
      // No settings facet, or the save failed: this session only.
      return false;
    }
  }, []);

  const value = useMemo<LangContextValue>(
    () => ({ t: makeT(lang), lang, setLang, namesVersion }),
    [lang, setLang, namesVersion],
  );

  if (phase === "loading") return null;
  if (phase === "ready" && chosen === null && firstRunPicker)
    return (
      <LanguagePicker
        defaultLang={localeLang}
        onPick={(l) => void setLang(l)}
      />
    );
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}
