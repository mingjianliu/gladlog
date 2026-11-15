/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, spellCastEvents) */
/**
 * scan5/t124.ts — pipeline T124: a friendly's area cooldown whose aura the
 * log writes with no source. Anti-Magic Zone 51052 runs as 145629 on the
 * players standing in it, every row of it source-less; the cast → effect
 * table verifies a pair only on the caster's own rows, so it never paired
 * 145629 with 51052, and the death's mitigation audit keyed the aura by
 * itself, found no whitelist entry and printed no row (fbbf2500: the zone
 * covered the victim for the 2.6 s before his death).
 *
 *  - `nilSourceMitigationUnaudited`: a death on the owner's side, and a run
 *    of an aura on the victim (`buildAuraIntervals`) whose rows carry no
 *    source, overlapping the audit's window (`COUNTERFACTUAL_WINDOW_S`
 *    before the death's instant), the aura not on the audit's whitelist by
 *    its own id, and a cast DB2 nominates it for by name
 *    (`castEffectNominationsGenerated.json`, a lookup) that is on the
 *    whitelist (`isMitigationAuditKey`) and that a player of the victim's
 *    side pressed in the 60 s before the run started. The death's block
 *    must print a `Mitigation audit: <that cast's name> …` row. Counted per
 *    such run; kind = the cast's name.
 */
import nominationsData from "@gladlog/analysis/src/data/castEffectNominationsGenerated.json";
import { buildAuraIntervals } from "@gladlog/analysis/src/utils/auraIntervals";
import { isMitigationAuditKey } from "@gladlog/analysis/src/utils/counterfactual";
import { COUNTERFACTUAL_WINDOW_S } from "@gladlog/analysis/src/utils/deathOutcomeAnalysis";

import { fmtS, type IRoundCtx, nameOf, secOf, successesOf, tsOf } from "./ctx";

export const CHECKS = ["nilSourceMitigationUnaudited"] as const;

/** the cast → effect generator's window (castEffectAuraScan WINDOW_S) */
const CAST_BEFORE_MS = 60_000;
const DEATH_LINE = /^(\d+:\d\d)\s+\[DEATH\]\s+(\d+)\(/;
const TIMED_LINE = /^(\d+:\d\d)\s/;
const AUDIT_ROW = "Mitigation audit: ";
const AUDIT_NOTE = "Mitigation audit note:";

/** aura → the whitelisted casts DB2 nominates it for by name */
const castsByName = new Map<string, string[]>();
for (const [cast, list] of Object.entries(
  (
    nominationsData as unknown as {
      nominations: Record<string, Array<{ aura: string; via: string }>>;
    }
  ).nominations,
)) {
  if (!isMitigationAuditKey(cast)) continue;
  for (const { aura, via } of list) {
    if (via !== "name") continue;
    if (!castsByName.has(aura)) castsByName.set(aura, []);
    castsByName.get(aura)!.push(cast);
  }
}

const isNoSource = (iv: { srcUnitId?: string; srcUnitName: string }) =>
  (!iv.srcUnitId || /^0+$/.test(iv.srcUnitId)) &&
  (!iv.srcUnitName || iv.srcUnitName === "nil");

export function run(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  const combat = {
    startTime: ctx.start,
    endTime: ctx.end,
    units: ctx.legacy.units,
  };
  for (const victim of ctx.players as any[]) {
    if (victim.reaction !== ctx.owner.reaction) continue;
    const pid = ctx.pidOf(victim.name);
    if (!pid) continue;
    const deaths = [
      ...new Set(
        ((victim.deathRecords ?? []) as any[]).map((d) => Number(d.timestamp)),
      ),
    ].filter((ms) => Number.isFinite(ms) && ms <= ctx.roundEndAt);
    if (deaths.length === 0) continue;
    const runs = buildAuraIntervals(victim, combat as any).filter(
      (iv) =>
        isNoSource(iv) &&
        !isMitigationAuditKey(iv.spellId) &&
        castsByName.has(iv.spellId),
    );
    if (runs.length === 0) continue;
    const side = (ctx.players as any[]).filter(
      (u) => u.reaction === victim.reaction,
    );
    for (const diedMs of deaths) {
      const deathS = (diedMs - ctx.start) / 1000;
      const at = ctx.lines.findIndex((l) => {
        const m = DEATH_LINE.exec(l);
        return !!m && m[2] === pid && secOf(m[1]!) === Math.floor(deathS);
      });
      if (at < 0) continue;
      const rows: string[] = [];
      for (let i = at + 1; i < ctx.lines.length; i++) {
        const l = ctx.lines[i]!;
        const t = TIMED_LINE.exec(l);
        if (t) {
          if (secOf(t[1]!) !== Math.floor(deathS) || DEATH_LINE.test(l)) break;
          continue;
        }
        const k = l.indexOf(AUDIT_ROW);
        if (k >= 0 && !l.includes(AUDIT_NOTE))
          rows.push(l.slice(k + AUDIT_ROW.length));
      }
      const fromS = Math.max(0, deathS - COUNTERFACTUAL_WINDOW_S);
      runs.forEach((iv, idx) => {
        if (Math.min(iv.toS, deathS) <= Math.max(iv.fromS, fromS)) return;
        const startMs = ctx.start + iv.fromS * 1000;
        const cast = castsByName
          .get(iv.spellId)!
          .find((c) =>
            side.some((u) =>
              successesOf(u).some(
                (s) =>
                  String(s.spellId) === c &&
                  tsOf(s) <= startMs + 100 &&
                  tsOf(s) >= startMs - CAST_BEFORE_MS,
              ),
            ),
          );
        if (cast === undefined) return;
        ctx.bump("nilSourceMitigationUnaudited");
        const name = nameOf(cast);
        if (rows.some((r) => r.startsWith(`${name} `))) return;
        ctx.violate(
          "nilSourceMitigationUnaudited",
          name,
          diedMs,
          `${victim.name}:${diedMs}:${iv.spellId}:${idx}`,
          `${victim.name} died at ${fmtS(deathS)} inside ${nameOf(iv.spellId)} ${iv.spellId} (source-less, ${fmtS(iv.fromS)}–${fmtS(iv.toS)}) from a ${name} ${cast} pressed on their side; the block's audit rows: ${rows.length ? rows.map((r) => r.split(" ").slice(0, 4).join(" ")).join(" | ") : "none"}`,
          ctx.lines[at]!.trim().slice(0, 160),
        );
      });
    }
  }
}
