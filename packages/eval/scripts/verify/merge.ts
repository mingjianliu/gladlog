/* eslint-disable @typescript-eslint/no-explicit-any -- the merge is generic over every scan's accumulators */
/**
 * verify/merge.ts — join what the worker processes accumulated, in run order.
 * Numbers add, arrays append, Maps and Sets join in first-seen order, objects
 * merge field by field and a string keeps its first non-empty value: exactly what one
 * process reading the runs in order would have ended with. A field that does
 * not add (a capped example list, a fixed-length array) names its own rule in
 * `IScan.merge`.
 */
export type MergeRule = (a: any, b: any) => any;

export function mergeValue(a: any, b: any): any {
  if (a === undefined || a === null) return b;
  if (b === undefined || b === null) return a;
  if (typeof a === "number" && typeof b === "number") return a + b;
  if (typeof a === "boolean" && typeof b === "boolean") return a || b;
  if (typeof a === "string" && typeof b === "string") return a || b;
  if (Array.isArray(a) && Array.isArray(b)) {
    for (const x of b) a.push(x);
    return a;
  }
  if (a instanceof Set && b instanceof Set) {
    for (const x of b) a.add(x);
    return a;
  }
  if (a instanceof Map && b instanceof Map) {
    for (const [k, v] of b) a.set(k, a.has(k) ? mergeValue(a.get(k), v) : v);
    return a;
  }
  if (typeof a === "object" && typeof b === "object") {
    for (const k of Object.keys(b)) a[k] = mergeValue(a[k], b[k]);
    return a;
  }
  throw new Error(`cannot merge ${typeof a} with ${typeof b}`);
}

export function mergeState(
  a: Record<string, any>,
  b: Record<string, any>,
  rules: Record<string, MergeRule> = {},
): Record<string, any> {
  for (const k of Object.keys(b)) {
    const rule = rules[k];
    a[k] = rule ? rule(a[k], b[k]) : mergeValue(a[k], b[k]);
  }
  return a;
}

/** a fixed-length tally: element-wise */
export const addEach: MergeRule = (a: number[], b: number[]) =>
  a.map((x, i) => x + (b[i] ?? 0));
