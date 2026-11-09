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
 * overlap seconds whose names are identical (no school label) — kind
 * `unlabelled`; when the rows are byte-identical it is one row printed twice,
 * kind `duplicate` (not this class). Two rows of the same spell over
 * DIFFERENT overlaps are two applications, not a split.
 */
import type { IRoundCtx } from "./ctx";

export const CHECKS = ["auditSplitLabel"] as const;

/** every `formatMitigationAuditLine` form, each with its own duration anchor
 * (codex 85-tk-C-T33-1 #1: one shared tail skipped the immunity, deflection
 * and off-table forms): arith `X blocked ~Nk … over S.Ss`, deferred `X held
 * back ~Nk … over S.Ss`, immunity `X immunity covered S.Ss`, deflection
 * `X (deflects …) covered S.Ss`, off-table `X active S.Ss` */
export const AUDIT_ROW =
  /^\s*Mitigation audit: (.+?) (?:(?:blocked|held back) .*?\bover |immunity covered |\([^)]*\) covered |active )([\d.]+)s\b/;

export function run(ctx: IRoundCtx): void {
  const flush = (grp: string[]) => {
    const seen = new Map<string, string[]>();
    for (const l of grp) {
      const m = AUDIT_ROW.exec(l);
      if (!m) continue;
      ctx.bump("auditSplitLabel");
      const k = `${m[1]}|${m[2]}`;
      seen.set(k, [...(seen.get(k) ?? []), l]);
    }
    for (const [k, rows] of seen) {
      if (rows.length < 2) continue;
      const [name, overlap] = k.split("|");
      // byte-identical rows are one row printed twice (Touch of Karma's
      // off-table rows), not a split's components: kept apart
      const duplicate = rows.every((r) => r === rows[0]);
      ctx.violate(
        "auditSplitLabel",
        duplicate ? "duplicate" : "unlabelled",
        ctx.start,
        k,
        duplicate
          ? `'${name}' printed ${rows.length}× identically over ${overlap}s`
          : `${rows.length} '${name}' rows over ${overlap}s with no school label`,
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
