/**
 * Client-locale text in a rendered English prompt. The prompt is English by
 * contract; the log writes spell / unit names in the recording client's
 * language. One regex for both sides of the Shared-Predicate Rule: the gate
 * `checkCjkLeak` (eval) and `getEnglishSpellName`'s fallback guard read the
 * same object.
 */
export const CJK_LEAK = /[一-鿿぀-ヿ가-힯]/;
