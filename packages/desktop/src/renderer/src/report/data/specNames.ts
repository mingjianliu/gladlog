/** Re-export shim — the tables live in @gladlog/analysis since 2026-09-26
 * (eval scripts consume them too; eval must not import from desktop). */
export {
  CLASS_NAMES_ZH,
  SPEC_ID_BY_EN,
  SPEC_NAMES_ZH,
} from "@gladlog/analysis/src/data/specNames";
