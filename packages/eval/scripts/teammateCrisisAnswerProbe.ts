/**
 * teammateCrisisAnswerProbe.ts — GH #95 step 1 (value gate: incidence and
 * overlap BEFORE any product predicate).
 *
 * User ruling 2026-09-13: "我觉得不管重复不重复 队友被打也要算进去" — the healer
 * crisis signal must also cover crises where a TEAMMATE takes the damage.
 * User 2026-09-13 on the shapes to look for: timing (should have pre-empted),
 * double-ups (teammate answered and the healer answered too), under-reaction
 * (neither answered).
 *
 * What this measures, per (healer owner, teammate) pair:
 *  - crossings on the TEAMMATE's HP, found by the product's own predicate
 *    (`crisisDecisionPoints(teammate, …)`) so the crossing, danger floor and
 *    the teammate's own answer taxonomy are the shipped ones;
 *  - the healer's answer TOWARD that teammate inside the same window:
 *    external (externalDefensiveSpellIds cast on them), protective
 *    (CRISIS_PROTECTIVE_ANSWER_IDS cast on them), ANY heal that landed on them
 *    (2026-09-16: the self-heal 15 % floor is about the owner healing
 *    themselves — a healer topping a teammate with two small heals is working,
 *    not idle, so any heal counts here and the big-heal case is reported
 *    separately), control on one of their attackers;
 *  - for the points where nobody answered: did the healer have an external OFF
 *    COOLDOWN, and was the healer casting anything at all (busy elsewhere)?
 *  - the teammate's own answer (`responded` from the same point);
 *  - distance healer → teammate at the crossing (a 40 yd reach question the
 *    product predicate would need);
 *  - overlap with the four signals that already reach teammate crises:
 *    cd-hoarded, external-unused, healing-gap, slow-defensive-response — a
 *    candidate of that type within RESPONSE_WINDOW_MS of the crossing.
 *
 * Shapes reported: double = both answered; healerOnly; teammateOnly;
 * neither = under-reaction (nobody answered) — the accusable population.
 *
 * 2026-09-16 refinement: the user's "给重了" is about two SPENT DEFENSIVES, not
 * "the teammate popped a wall and the healer topped them up", so a second
 * counter pair reports doubleDefensive (the teammate spent wall / protective
 * AND the healer spent external / protective on them) against the case where
 * only one side spent one. The teammate's own arms exclude `peel` (a third
 * player's action) — it was never part of `responded` either.
 *
 * Usage: npx tsx packages/eval/scripts/teammateCrisisAnswerProbe.ts --manifest <m> [--every 10]
 */
import {
  ensureAnalysisData,
  extractCandidateFindings,
} from "@gladlog/analysis";
import {
  actionBlockedAt,
  CRISIS_PROTECTIVE_ANSWER_IDS,
  crisisDecisionPoints,
  RESPONSE_PRE_MS,
  RESPONSE_WINDOW_MS,
  SELF_HEAL_BIG,
} from "@gladlog/analysis/src/analysis/crisisDecisionPoints";
import spellIdLists from "@gladlog/analysis/src/data/spellIdLists";
import {
  cdAvailableAt,
  extractMajorCooldowns,
} from "@gladlog/analysis/src/utils/cooldowns";
import { ccSpellIds, rootSpellIds } from "@gladlog/analysis/src/data/spellTags";
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";
import {
  resolveMitigation,
  strongestComponentPct,
} from "@gladlog/analysis/src/data/mitigationComponents";
import { buildAuraIntervals } from "@gladlog/analysis/src/utils/auraIntervals";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { LogEvent, toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { gunzipSync } from "zlib";

const a = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = a.indexOf(k);
  return i >= 0 ? (a[i + 1] ?? d) : d;
};
const manifest = arg("--manifest", "");
const every = Number(arg("--every", "10"));

const EXTERNAL_IDS = new Set(
  spellIdLists.externalDefensiveSpellIds.map(String),
);
const CONTROL_IDS = new Set<string>([...ccSpellIds, ...rootSpellIds]);
const OVERLAP_TYPES = new Set([
  "cd-hoarded",
  "external-unused",
  "healing-gap",
  "slow-defensive-response",
]);

await ensureAnalysisData();
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);

const t = {
  files: files.length,
  rounds: 0,
  teammatePoints: 0,
  dangerousFeasible: 0,
  inReach40: 0,
  /** healer-side feasibility at the teammate's crossing (shared predicate
   * actionBlockedAt + a 40 yd reach): a healer who was stunned, kicked,
   * silenced, dead or out of range could not answer, so those points are not
   * accusable and are excluded from the shapes below. */
  healerBlocked: 0,
  healerBlockedInCC: 0,
  healerBlockedLockedOut: 0,
  healerBlockedDead: 0,
  outOfReach: 0,
  accusable: 0,
  double: 0,
  healerOnly: 0,
  teammateOnly: 0,
  neither: 0,
  healerAnswerKind: {} as Record<string, number>,
  /** breakdown of the accusable "nobody answered" population */
  neitherWithExternalReady: 0,
  neitherBusyElsewhere: 0,
  neitherIdleNoExternal: 0,
  /** windows whose only healing on the teammate was a tick of a HoT cast
   * before the window (GH #93 shape): never an answer, counted here */
  carriedHealOnly: 0,
  /** both sides spent a defensive cooldown on the same crossing */
  doubleDefensive: 0,
  /** only the teammate spent one / only the healer spent one */
  teammateDefensiveOnly: 0,
  healerDefensiveOnly: 0,
  defensiveShape: {} as Record<string, { n: number; died: number }>,
  /** the wide "nobody answered" population split by what the healer had /
   * was doing, each with its outcome */
  neitherSlice: {} as Record<string, { n: number; died: number }>,
  /**
   * doubleDefensive marginal value (user 2026-09-13: "如果只给一个的话哪个更有用"):
   * with the teammate's own wall a and the healer's external b stacking
   * multiplicatively (measured), the second aura's extra blocked damage over
   * the overlap is D × b / (1 − b) where D is the damage the teammate actually
   * took while both were up; expressed as % of the teammate's max HP. Both
   * percentages come from resolveMitigation (talent-aware, carrier-aware).
   * `second` = the aura applied later.
   */
  doubleMarginal: [] as number[],
  doubleMarginalUnpriced: 0,
  /** why a doubleDefensive point could not be priced, by aura id on each side */
  unpricedReason: {} as Record<string, number>,
  unpricedAuras: {} as Record<string, number>,
  /** the idle slice (healer cast nothing) re-examined for two innocent
   * explanations: a hard cast in progress (SPELL_CAST_START in the window with
   * no success) and the healer repositioning (moved >= 8 yd across the window) */
  idleCastStartInWindow: 0,
  idleMovedFar: 0,
  idleClean: 0,
  idleCleanDied: 0,
  overlapAny: 0,
  overlapByType: {} as Record<string, number>,
  neitherOverlapAny: 0,
  /** outcome per shape: teammate death within DEATH_LOOKAHEAD_MS of the
   * crossing (the reference table's own outcome), and the same split by
   * 2 s-damage severity — without an outcome gap the shape is not teachable
   * (CLAUDE.md Value-Gate rule 4: normalise by opportunity first). */
  shape: {} as Record<string, Record<string, { n: number; died: number }>>,
  byBracket: {} as Record<
    string,
    { points: number; neither: number; double: number }
  >,
};
const examples: Array<Record<string, unknown>> = [];
const posOf = (u: any, ms: number) => {
  let best: any = null;
  for (const s of u.advancedActions ?? []) {
    if ((s.advancedActorMaxHp ?? 0) <= 0) continue;
    const d = Math.abs(s.timestamp - ms);
    if (d <= 1500 && (!best || d < Math.abs(best.timestamp - ms))) best = s;
  }
  return best?.advancedActorPositionX == null
    ? null
    : { x: best.advancedActorPositionX, y: best.advancedActorPositionY };
};

for (const f of files) {
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  let text: string;
  try {
    const raw = readFileSync(resolve(f));
    text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  for (const m of items) {
    let legacy: any;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    t.rounds++;
    const bracket = String(legacy.startInfo?.bracket ?? "?");
    const players = (Object.values(legacy.units ?? {}) as any[]).filter(
      (u) => u.info,
    );
    for (const owner of players.filter((u) => isHealerSpec(u.spec))) {
      const friends = players.filter(
        (u) => u.reaction === owner.reaction && u.id !== owner.id,
      );
      const enemyIds = new Set(
        players.filter((u) => u.reaction !== owner.reaction).map((u) => u.id),
      );
      let cands: any[] = [];
      try {
        cands = extractCandidateFindings(legacy, owner.id);
      } catch {
        cands = [];
      }
      const ownerCasts = ((owner.spellCastEvents ?? []) as any[]).filter(
        (c) => c.logLine?.event === LogEvent.SPELL_CAST_SUCCESS,
      );
      let ledger: any[] = [];
      try {
        ledger = extractMajorCooldowns(owner, legacy);
      } catch {
        ledger = [];
      }
      for (const mate of friends) {
        const mateMax = Math.max(
          1,
          ...((mate.advancedActions ?? []) as any[]).map(
            (x) => x.advancedActorMaxHp ?? 0,
          ),
        );
        const role = isHealerSpec(mate.spec) ? "healer" : "dps";
        for (const p of crisisDecisionPoints(mate, legacy, role as never)) {
          t.teammatePoints++;
          if (!(p.feasible && p.dangerous)) continue;
          t.dangerousFeasible++;
          const b = (t.byBracket[bracket] ??= {
            points: 0,
            neither: 0,
            double: 0,
          });
          b.points++;
          const w0 = p.tMs - RESPONSE_PRE_MS;
          const w1 = p.tMs + RESPONSE_WINDOW_MS;
          const attackers = new Set(
            ((mate.damageIn ?? []) as any[])
              .filter((d) => d.timestamp > p.tMs - 2000 && d.timestamp <= p.tMs)
              .map((d) => {
                const src = legacy.units[d.srcUnitId];
                return src?.info ? src.id : src?.ownerId;
              })
              .filter((id: string | undefined) => id && enemyIds.has(id)),
          );
          const inWin = (ms: number) => ms >= w0 && ms <= w1;
          const kinds: string[] = [];
          for (const c of ownerCasts) {
            if (!inWin(c.timestamp)) continue;
            const id = String(c.spellId ?? "");
            const onMate = c.destUnitId === mate.id;
            if (onMate && EXTERNAL_IDS.has(id)) kinds.push("external");
            if (onMate && CRISIS_PROTECTIVE_ANSWER_IDS.has(id))
              kinds.push("protective");
            if (
              CONTROL_IDS.has(id) &&
              c.destUnitId &&
              attackers.has(c.destUnitId)
            )
              kinds.push("peel");
          }
          const healed =
            ((mate.healIn ?? []) as any[])
              .filter(
                (h) =>
                  h.srcUnitId === owner.id &&
                  h.timestamp > p.tMs &&
                  h.timestamp <= w1,
              )
              .reduce(
                (n, h) => n + Math.abs(h.effectiveAmount ?? h.amount ?? 0),
                0,
              ) / mateMax;
          // GH #93's lesson applied here: a heal EVENT inside the window can be
          // a tick of a HoT the healer placed long before the crisis. Only
          // heals whose spell the healer cast INSIDE the window count as the
          // healer answering; a window whose only healing is carried ticks is
          // reported separately and never counts as an answer.
          const castIdsInWin = new Set(
            ownerCasts
              .filter((c) => inWin(c.timestamp))
              .map((c) => String(c.spellId ?? "")),
          );
          const healEvents = ((mate.healIn ?? []) as any[]).filter(
            (h) =>
              h.srcUnitId === owner.id && h.timestamp > w0 && h.timestamp <= w1,
          );
          const freshHeals = healEvents.filter((h) =>
            castIdsInWin.has(String(h.spellId ?? "")),
          );
          if (freshHeals.length) kinds.push("freshHeal");
          else if (healEvents.length) t.carriedHealOnly++;
          if (healed >= SELF_HEAL_BIG && freshHeals.length)
            kinds.push("bigHeal");
          const healerAnswered = kinds.length > 0;
          for (const k of new Set(kinds))
            t.healerAnswerKind[k] = (t.healerAnswerKind[k] ?? 0) + 1;
          const pos1 = posOf(owner, p.tMs);
          const pos2 = posOf(mate, p.tMs);
          const dist =
            pos1 && pos2 ? Math.hypot(pos1.x - pos2.x, pos1.y - pos2.y) : null;
          if (dist !== null && dist <= 40) t.inReach40++;
          const blocked = actionBlockedAt(owner, legacy, p.tMs);
          if (blocked.blocked) {
            t.healerBlocked++;
            if (blocked.inCC) t.healerBlockedInCC++;
            if (blocked.lockedOut) t.healerBlockedLockedOut++;
            if (blocked.dead) t.healerBlockedDead++;
            continue;
          }
          if (dist === null || dist > 40) {
            t.outOfReach++;
            continue;
          }
          t.accusable++;
          const overlaps = cands.filter(
            (c) =>
              OVERLAP_TYPES.has(c.type) &&
              Math.abs(c.t * 1000 - (p.tMs - legacy.startTime)) <=
                RESPONSE_WINDOW_MS,
          );
          if (overlaps.length) {
            t.overlapAny++;
            for (const c of new Set(overlaps.map((c) => c.type)))
              t.overlapByType[c] = (t.overlapByType[c] ?? 0) + 1;
          }
          // defensive-spend shapes (user's 给重了 / 给轻了 in its strict form)
          const mateSpentDefensive =
            p.responses.wall || p.responses.protective || p.responses.external;
          const healerSpentDefensive = kinds.some(
            (k) => k === "external" || k === "protective",
          );
          const defShape = mateSpentDefensive
            ? healerSpentDefensive
              ? "doubleDefensive"
              : "teammateDefensiveOnly"
            : healerSpentDefensive
              ? "healerDefensiveOnly"
              : "neitherDefensive";
          if (defShape === "doubleDefensive") {
            t.doubleDefensive++;
            // the two auras: the teammate's own (self-cast) and the healer's on them
            const ivs = buildAuraIntervals(mate, legacy).filter(
              (iv) =>
                iv.toS * 1000 + legacy.startTime >= w0 &&
                iv.fromS * 1000 + legacy.startTime <= w1,
            );
            const priced = ivs
              .map((iv) => {
                const fromSelf = iv.srcUnitName === mate.name;
                const fromHealer = iv.srcUnitName === owner.name;
                if (!fromSelf && !fromHealer) return null;
                const res = resolveMitigation(iv.spellId, {
                  carrierIsCaster: fromSelf,
                  caster: fromSelf ? mate : owner,
                });
                const pct = res
                  ? strongestComponentPct(res, { includeImmunity: true })
                  : undefined;
                if (!res || res.positional || !pct) return null;
                return { iv, pct: pct.pctMin, fromSelf };
              })
              .filter((x): x is NonNullable<typeof x> => x !== null);
            const own = priced.find((x) => x.fromSelf);
            const ext = priced.find((x) => !x.fromSelf);
            if (!own || !ext || own.pct >= 100 || ext.pct >= 100) {
              t.doubleMarginalUnpriced++;
              const reason = !own
                ? !ext
                  ? "neither-aura-on-table"
                  : "teammate-aura-not-on-table"
                : !ext
                  ? "healer-aura-not-on-table"
                  : "immunity-involved";
              t.unpricedReason[reason] = (t.unpricedReason[reason] ?? 0) + 1;
              // which auras were up but off the mitigation table
              for (const iv of ivs) {
                if (
                  iv.srcUnitName !== mate.name &&
                  iv.srcUnitName !== owner.name
                )
                  continue;
                if (priced.some((x) => x.iv === iv)) continue;
                const key = `${iv.srcUnitName === mate.name ? "self" : "healer"}:${iv.spellId}`;
                t.unpricedAuras[key] = (t.unpricedAuras[key] ?? 0) + 1;
              }
            } else {
              const second = own.iv.fromS <= ext.iv.fromS ? ext : own;
              const oFrom = Math.max(own.iv.fromS, ext.iv.fromS);
              const oTo = Math.min(own.iv.toS, ext.iv.toS);
              const dmg = ((mate.damageIn ?? []) as any[])
                .filter((d) => {
                  const ts = (d.timestamp - legacy.startTime) / 1000;
                  return ts >= oFrom && ts <= oTo;
                })
                .reduce(
                  (n, d) => n + Math.abs(d.effectiveAmount ?? d.amount ?? 0),
                  0,
                );
              const b = second.pct / 100;
              const marginal = (dmg * b) / (1 - b) / mateMax;
              t.doubleMarginal.push(Math.round(marginal * 1000) / 10);
            }
          } else if (defShape === "teammateDefensiveOnly")
            t.teammateDefensiveOnly++;
          else if (defShape === "healerDefensiveOnly") t.healerDefensiveOnly++;
          {
            const row = (t.defensiveShape[defShape] ??= { n: 0, died: 0 });
            row.n++;
            if (p.diedWithin10s) row.died++;
          }
          const shapeName =
            healerAnswered && p.responded
              ? "double"
              : healerAnswered
                ? "healerOnly"
                : p.responded
                  ? "teammateOnly"
                  : "neither";
          const sev =
            p.dmg2s >= 0.3 ? ">=30%" : p.dmg2s >= 0.2 ? "20-30%" : "10-20%";
          for (const key of ["all", sev]) {
            const row = ((t.shape[shapeName] ??= {})[key] ??= {
              n: 0,
              died: 0,
            });
            row.n++;
            if (p.diedWithin10s) row.died++;
          }
          if (healerAnswered && p.responded) t.double++;
          else if (healerAnswered) t.healerOnly++;
          else if (p.responded) t.teammateOnly++;
          else {
            t.neither++;
            b.neither++;
            const externalReady = ledger.some(
              (cd: any) =>
                EXTERNAL_IDS.has(String(cd.spellId)) &&
                cdAvailableAt(cd, p.tSec),
            );
            const busy = ownerCasts.some((c) => inWin(c.timestamp));
            if (externalReady) t.neitherWithExternalReady++;
            if (busy) t.neitherBusyElsewhere++;
            if (!externalReady && !busy) t.neitherIdleNoExternal++;
            if (!busy) {
              // SPELL_CAST_START lives in castStartEvents, not spellCastEvents
              const castStart = ((owner.castStartEvents ?? []) as any[]).some(
                (c) => c.timestamp >= w0 && c.timestamp <= w1,
              );
              const pA = posOf(owner, w0);
              const pB = posOf(owner, w1);
              const moved =
                !!pA && !!pB && Math.hypot(pA.x - pB.x, pA.y - pB.y) >= 8;
              if (castStart) t.idleCastStartInWindow++;
              if (moved) t.idleMovedFar++;
              if (!castStart && !moved) {
                t.idleClean++;
                if (p.diedWithin10s) t.idleCleanDied++;
              }
            }
            const sliceKey = `${busy ? "busy" : "idle"}|${externalReady ? "externalReady" : "noExternal"}`;
            const slice = (t.neitherSlice[sliceKey] ??= { n: 0, died: 0 });
            slice.n++;
            if (p.diedWithin10s) slice.died++;
            if (!overlaps.length) t.neitherOverlapAny++;
            if (examples.length < 15)
              examples.push({
                file: f,
                bracket,
                healer: owner.name,
                healerSpec: owner.spec,
                mate: mate.name,
                mateSpec: mate.spec,
                tSec: p.tSec,
                mateHpPct: p.hpPct,
                dmg2sPct: Math.round(p.dmg2s * 100),
                distYd: dist === null ? null : Math.round(dist),
                mateDiedWithin10s: p.diedWithin10s,
                overlapTypes: [...new Set(overlaps.map((c) => c.type))],
              });
          }
          if (healerAnswered && p.responded) b.double++;
        }
      }
    }
  }
}
const home =
  process.env.GLADLOG_EVAL_HOME ??
  join(process.env.HOME ?? "", "code/gladlog-eval-private");
writeFileSync(
  join(home, "reports/teammate-crisis-2026-09-16.json"),
  JSON.stringify({ ...t, examples }, null, 1),
);
console.log(JSON.stringify(t, null, 1));
