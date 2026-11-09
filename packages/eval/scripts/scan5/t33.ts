/**
 * scan5/t33.ts — pipeline T33 (ruling R07 (5)): a split defensive's
 * components print as unlabelled death-audit rows. `computeMitigationAudit`
 * emits one `Mitigation audit:` row per component of a split entry (Evasion
 * with Elusiveness and Bait and Switch: physical and magic; Cloak of Shadows
 * with Bait and Switch: the magic immunity and physical 20 %) — same spell,
 * same overlap seconds — and the reader cannot tell which school each row
 * prices.
 *
 * Check `auditSplitLabel`: inside one consecutive run of `Mitigation audit:`
 * lines (one death block), two or more rows of the same spell over the same
 * overlap seconds whose names are identical (no school label). Two rows of
 * the same spell over DIFFERENT overlaps are two applications, not a split.
 */
import type { IRoundCtx } from "./ctx";

export const CHECKS = ["auditSplitLabel"] as const;

const ROW =
  /^\s*Mitigation audit: (.+?) (?:blocked|held back|immunity covered|active|covered).*?(?:over |covered |active )([\d.]+)s/;

export function run(ctx: IRoundCtx): void {
  const flush = (grp: string[]) => {
    const seen = new Map<string, string[]>();
    for (const l of grp) {
      const m = ROW.exec(l);
      if (!m) continue;
      ctx.bump("auditSplitLabel");
      const k = `${m[1]}|${m[2]}`;
      seen.set(k, [...(seen.get(k) ?? []), l]);
    }
    for (const [k, rows] of seen) {
      if (rows.length < 2) continue;
      const [name, overlap] = k.split("|");
      ctx.violate(
        "auditSplitLabel",
        "unlabelled",
        ctx.start,
        k,
        `${rows.length} '${name}' rows over ${overlap}s with no school label`,
        rows[0],
      );
    }
  };
  let grp: string[] = [];
  for (const line of ctx.lines) {
    if (line.includes("Mitigation audit:")) grp.push(line);
    else if (grp.length > 0) {
      flush(grp);
      grp = [];
    }
  }
  if (grp.length > 0) flush(grp);
}
