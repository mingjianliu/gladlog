import type { AnalysisFallbackReason } from "../../../../shared/analysisFallback";
import { type Language, translate } from "../../../../shared/i18n";

/**
 * The sentence the analysis panel shows under the key-moment axis when a
 * result has no findings — one per reason, so a 0-finding result says why.
 * In the UI language, like the rest of the panel's own text.
 *
 * `empty-reply` is a fresh analysis that ran and wrote nothing; before it had
 * its own value it fell to the last branch and read as a stale cache. That
 * branch is unchanged: a result with no reason and nothing dropped is a cache
 * from before the field existed.
 */
export function zeroFindingText(
  r: {
    dropped: number;
    fallbackReason?: AnalysisFallbackReason;
  },
  lang: Language = "zh",
): string {
  if (r.dropped > 0)
    return translate(lang, "report.zeroFinding.dropped", { n: r.dropped });
  switch (r.fallbackReason) {
    case "no-candidates":
      return translate(lang, "report.zeroFinding.noCandidates");
    case "no-client":
      return translate(lang, "report.zeroFinding.noClient");
    case "bad-json":
      return translate(lang, "report.zeroFinding.badJson");
    case "empty-reply":
      return translate(lang, "report.zeroFinding.emptyReply");
    default:
      return translate(lang, "report.zeroFinding.stale");
  }
}
