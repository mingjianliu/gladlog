/**
 * Parsing of the model's JSON output (**single source**).
 *
 * Fact: even when the prompt says "Output ONLY a JSON array" verbatim, models
 * still routinely wrap the content in a markdown fence, or add a sentence or
 * two of prose around it — especially when the system prompt also demands a
 * reply in Chinese. Reproduced by measurement on a real match with `claude -p`
 * on 2026-07-20: the reply was **fully compliant** content wrapped in
 * ```json … ```, yet main's JSON.parse(raw.trim()) judged it bad-json and a
 * perfectly good analysis fell back to the deterministic display.
 *
 * eval's three audit scripts had each written their own fence tolerance long
 * ago, but the product side had none — two places holding inconsistent beliefs
 * about the same fact, exactly the kind of rot CLAUDE.md warns about. So the
 * predicate lives here and both sides import it.
 *
 * **Tolerance boundaries** (the negative contract of parseModelJsonArray
 * below; do not loosen them):
 *   - truncated JSON is unrecoverable → null (emitting half is worse than
 *     falling back)
 *   - a top-level object → null (the contract is an array; this is a genuine
 *     contract violation, not formatting noise)
 */

/** ```json … ``` / ``` … ``` (prose before/after is allowed). */
const FENCE = /```(?:json|JSON)?\s*\n([\s\S]*?)\n?```/;

/**
 * Extract candidate JSON texts from the model's raw output, most trustworthy
 * first. This only **locates**, it never repairs — repairing would mean
 * inventing content on the model's behalf.
 */
function candidates(
  raw: string,
  shape: "array" | "object" = "array",
): string[] {
  const t = raw.trim();
  if (!t) return [];

  // Strip the fence first — every later decision is made against the
  // **payload**, not the raw text.
  // (Hit during self-review: with the guard written against the raw text,
  //  ```json {"findings":[…]} ``` passes the slicing guard because the raw
  //  text starts with a backtick, so the inner array gets sliced out and
  //  "rescued", silently changing the contract.)
  const fenced = FENCE.exec(t)?.[1]?.trim();
  const payload = fenced || t;

  const out = [t];
  if (fenced) out.push(fenced);

  // When the payload starts with neither { nor [ (plain prose wrapping a bare
  // array — or, for `shape: "object"`, a bare object: same rule with braces),
  // slice at the outermost square brackets:
  //   starts with [ but fails to parse = truncated / syntax error, and
  //     slicing would only mask it as a half result;
  //   starts with { = the model returned an object, which is a contract
  //     violation and must not be "rescued" by slicing out some inner array.
  if (!payload.startsWith("{") && !payload.startsWith("[")) {
    const [open, close] = shape === "array" ? ["[", "]"] : ["{", "}"];
    const a = payload.indexOf(open);
    const b = payload.lastIndexOf(close);
    if (a !== -1 && b > a) out.push(payload.slice(a, b + 1));
  }
  return out;
}

/**
 * Parse the JSON **object** returned by the model (the self-review reply,
 * selfReview.ts, whose contract is `{"findings": [...], "changes": [...]}`).
 * Same locate-never-repair rules as parseModelJsonArray, mirrored: a top-level
 * array is a contract violation here and is never "rescued"; truncation → null.
 */
export function parseModelJsonObject(
  raw: string,
): Record<string, unknown> | null {
  for (const c of candidates(raw, "object")) {
    try {
      const parsed: unknown = JSON.parse(c);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        return parsed as Record<string, unknown>;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/**
 * Parse the JSON **array** returned by the model. Returns the array on
 * success, null on any failure.
 * Callers take their own fallback on null — do not try/catch JSON.parse
 * yourself anymore.
 */
export function parseModelJsonArray(raw: string): unknown[] | null {
  for (const c of candidates(raw)) {
    try {
      const parsed: unknown = JSON.parse(c);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}
