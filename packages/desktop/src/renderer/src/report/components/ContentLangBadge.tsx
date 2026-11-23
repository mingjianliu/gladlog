import type { Language } from "../../../../shared/i18n/index";
import { useT } from "../../i18n/LangProvider";

/**
 * Language label for AI content generated in the other language (spec §6.13):
 * renders nothing when `contentLang` is the current UI language, otherwise a
 * small tag ("Analyzed in Chinese" in English mode, 「英文分析」 in Chinese
 * mode). The content itself is shown as stored; only the label is added.
 */
export function ContentLangBadge({ contentLang }: { contentLang: Language }) {
  const { lang, t } = useT();
  if (contentLang === lang) return null;
  return (
    <span
      className="rpt-content-lang"
      data-testid="content-lang-badge"
      title={t("report.contentLang.title")}
    >
      {t(
        contentLang === "zh"
          ? "report.contentLang.otherZh"
          : "report.contentLang.otherEn",
      )}
    </span>
  );
}
