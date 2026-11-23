import {
  bilingual,
  htmlLang,
  type Language,
  LANGUAGES,
  translate,
} from "../../../shared/i18n";

// The first-run language picker (spec §6.7) and the language segmented
// control it shares with the settings page (§6.11b). Neither knows which
// language the user reads, so every label here is shown in both languages —
// each option in its own language (endonym), the title as "zh / en".

export function LanguageSegment({
  value,
  onPick,
  autoFocus = false,
}: {
  value: Language;
  onPick: (l: Language) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="rpt-mode-seg settings-seg" role="group">
      {LANGUAGES.map((l) => (
        <button
          key={l}
          type="button"
          lang={htmlLang(l)}
          className={value === l ? "active" : ""}
          aria-pressed={value === l}
          autoFocus={autoFocus && value === l}
          onClick={() => onPick(l)}
        >
          {translate(l, "settings.language.endonym")}
        </button>
      ))}
    </div>
  );
}

/** Shown before the main UI while `settings.language` is still null;
 *  `defaultLang` (from the OS locale) is the highlighted option.
 *  `saveFailed`: the last pick could not be stored — a one-line notice in
 *  both languages (picking again continues for this session). */
export function LanguagePicker({
  defaultLang,
  onPick,
  saveFailed = false,
}: {
  defaultLang: Language;
  onPick: (l: Language) => void;
  saveFailed?: boolean;
}) {
  return (
    <div className="dash-modal-backdrop lang-picker-backdrop">
      <div
        className="dash-modal lang-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lang-picker-title"
        data-testid="language-picker"
      >
        <h2 id="lang-picker-title">
          {bilingual("settings.language.pickerTitle")}
        </h2>
        <LanguageSegment value={defaultLang} onPick={onPick} autoFocus />
        {saveFailed && (
          <p
            className="settings-note settings-saved-failed"
            role="alert"
            data-testid="language-picker-save-failed"
          >
            {bilingual("settings.language.saveFailed")}
          </p>
        )}
        <p className="settings-note">
          {translate("zh", "settings.language.pickerHint")}
          <br />
          {translate("en", "settings.language.pickerHint")}
        </p>
      </div>
    </div>
  );
}
