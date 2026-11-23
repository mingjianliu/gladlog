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
  htmlLang,
  type Language,
  localeToLanguage,
  makeT,
  type TFn,
} from "../../../shared/i18n";
import { bridge } from "../bridge";
import { LanguagePicker } from "./LanguagePicker";

export interface LangContextValue {
  t: TFn;
  lang: Language;
  /** Switch the UI language: updates every consumer at once (no remount) and
   *  persists `settings.language`. */
  setLang(l: Language): Promise<void>;
  /** Bumped when the spell-name tables a language needs finish loading;
   *  constant 0 for now. */
  namesVersion: number;
}

// Outside a provider (component tests that render a bare component): zh, so
// the existing Chinese assertions keep holding without wrapping.
const FALLBACK: LangContextValue = {
  t: makeT("zh"),
  lang: "zh",
  setLang: async () => {},
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
  const [localeLang] = useState<Language>(() =>
    localeToLanguage(
      typeof navigator === "undefined" ? undefined : navigator.language,
    ),
  );
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

  const lang = chosen ?? localeLang;

  useEffect(() => {
    document.documentElement.lang = htmlLang(lang);
  }, [lang]);

  const setLang = useCallback(async (l: Language) => {
    // Context first, so every consumer switches immediately; then persist.
    setChosen(l);
    document.documentElement.lang = htmlLang(l);
    try {
      await bridge().settings.save({ language: l });
    } catch {
      /* no settings facet: switch for this session only */
    }
  }, []);

  const value = useMemo<LangContextValue>(
    () => ({ t: makeT(lang), lang, setLang, namesVersion: 0 }),
    [lang, setLang],
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
