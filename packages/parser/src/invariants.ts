import { parseLine } from "./l1/parseLine";
import type { GladMatchBase, GladUnit } from "./l3/model";

/**
 * A2 parser invariants (verifiability roadmap): physical assertions that must
 * hold for **any** successfully parsed match. measure-then-lock: first
 * packages/eval/scripts/parserInvariants.ts measures each assertion's violation
 * count over the full corpus, then once it reaches zero (or every case has been
 * adjudicated) the tests lock it down. Complementary to the A1 differential
 * oracle -- A1 checks against the old parser, this checks physical facts
 * themselves.
 */

export interface InvariantViolation {
  /** Stable assertion code (report aggregation groups by it). */
  code:
    | "time-bounds"
    | "monotonic"
    | "hp-range"
    | "hp-amount-finite"
    | "death-has-damage"
    | "pet-owner-resolves"
    | "start-before-end"
    | "line-resolves";
  unitId?: string;
  detail: string;
}

/** Grace (ms) for events falling outside the match window. Bounds measured over
 *  the full corpus (1245 matches) on 2026-07-23:
 *  - match: events never pass endTime (max overrun 0ms) and lead the start by
 *    at most 1ms -> the 2s grace is pure headroom;
 *  - shuffleRound: inter-round events are attributed to the previous round,
 *    max trailing 34.1s -> upper bound set at 60s. */
const TIME_GRACE_MS = 2_000;
const ROUND_TRAILING_GRACE_MS = 60_000;
/** Timestamp regression tolerance (ms): real logs jitter out of order; the
 * largest regression measured over the full corpus is 2084ms, so only beyond 5s
 * counts as genuinely out of order. */
const MONOTONIC_TOLERANCE_MS = 5_000;
/** How far hp may exceed maxHp: the ordering of max-health gains/losses can make
 * instantaneous hp higher than the current maxHp; across the full corpus 3841
 * samples gave p99=1.49, max=1.58 -> upper bound 1.75 (beyond that is genuinely
 * broken). */
const HP_OVER_MAX_RATIO = 1.75;
/** Within how many seconds before a death incoming damage must be seen ("every
 * death has a source"). */
const DEATH_DAMAGE_LOOKBACK_S = 10;

const EVENT_ARRAYS = [
  "damageOut",
  "damageIn",
  "healOut",
  "healIn",
  "absorbsOut",
  "absorbsIn",
  "casts",
  "castStarts",
  "petCasts",
  "auraEvents",
  "actionsOut",
  "actionsIn",
  "deaths",
  "unconsciousEvents",
  "advancedSamples",
  "healAbsorbsIn",
  "empowerEnds",
  "missesOut",
  "missesIn",
] as const;

export function checkParserInvariants(m: GladMatchBase): InvariantViolation[] {
  const out: InvariantViolation[] = [];

  if (!(m.startTime < m.endTime)) {
    out.push({
      code: "start-before-end",
      detail: `startTime ${m.startTime} !< endTime ${m.endTime}`,
    });
  }
  const isRound = (m as { kind?: string }).kind === "shuffleRound";
  const lo = m.startTime - TIME_GRACE_MS;
  const hi = m.endTime + (isRound ? ROUND_TRAILING_GRACE_MS : TIME_GRACE_MS);

  const unitIds = new Set(Object.keys(m.units));

  for (const [id, u] of Object.entries(m.units) as [string, GladUnit][]) {
    for (const key of EVENT_ARRAYS) {
      const arr = (u[key] ?? []) as { timestamp: number }[];
      let prev = -Infinity;
      for (const e of arr) {
        if (e.timestamp < prev - MONOTONIC_TOLERANCE_MS) {
          out.push({
            code: "monotonic",
            unitId: id,
            detail: `${key} 时间戳回退 ${prev} → ${e.timestamp}(超 ${MONOTONIC_TOLERANCE_MS}ms 容忍)`,
          });
          break; // at most one report per array, to avoid flooding
        }
        prev = Math.max(prev, e.timestamp);
        if (e.timestamp < lo || e.timestamp > hi) {
          out.push({
            code: "time-bounds",
            unitId: id,
            detail: `${key} 事件越界 ${e.timestamp} ∉ [${lo}, ${hi}]`,
          });
          break;
        }
      }
    }

    for (const s of u.advancedSamples ?? []) {
      if (!(s.maxHp > 0) || s.hp < 0 || s.hp > s.maxHp * HP_OVER_MAX_RATIO) {
        out.push({
          code: "hp-range",
          unitId: id,
          detail: `advancedSample hp=${s.hp} maxHp=${s.maxHp} @${s.timestamp}`,
        });
        break;
      }
    }

    // Every damage/heal event carries finite amounts. One NaN in a unit's
    // damageIn silently poisons every sum over it — ENVIRONMENTAL_DAMAGE read
    // through the spell-damage offsets did exactly that (65 events in 57 of a
    // 2,110-file archive slice; burst-tier labels drifted in 77 of 159 owner
    // contexts), and no gate saw it because NaN never renders (GH #100).
    for (const key of ["damageIn", "damageOut", "healIn", "healOut"] as const) {
      const bad = (u[key] ?? []).find(
        (e) =>
          !Number.isFinite(e.amount) || !Number.isFinite(e.effectiveAmount),
      );
      if (bad) {
        out.push({
          code: "hp-amount-finite",
          unitId: id,
          detail: `${key} ${bad.eventName} amount=${bad.amount} effectiveAmount=${bad.effectiveAmount} @${bad.timestamp}`,
        });
      }
    }

    if (u.ownerId && !unitIds.has(u.ownerId)) {
      out.push({
        code: "pet-owner-resolves",
        unitId: id,
        detail: `ownerId ${u.ownerId} 不在 units 里`,
      });
    }

    // "Every event traces back to a source line" (the gate for the B2 deep
    // provenance chain): an event must carry a lineIndex, and re-parsing
    // rawLines[lineIndex] must yield the same eventName/timestamp -- this
    // catches segmenter records/rawLines misalignment and lost lineIndex
    // (advancedSamples are synthesized and have no source line, so they are
    // exempt). Only the first event of each array per unit is checked:
    // alignment is a structural property, so if the first is misaligned they
    // all are, and re-parsing everything would be an O(all events) waste over
    // a 1245-match corpus.
    for (const key of EVENT_ARRAYS) {
      if (key === "advancedSamples") continue;
      const e = (
        (u[key] ?? []) as {
          timestamp: number;
          eventName?: string;
          lineIndex?: number;
        }[]
      )[0];
      if (!e) continue;
      if (e.lineIndex == null) {
        out.push({
          code: "line-resolves",
          unitId: id,
          detail: `${key}[0] 缺 lineIndex(@${e.timestamp})`,
        });
        continue;
      }
      const raw = m.rawLines[e.lineIndex];
      const reparsed = raw === undefined ? null : parseLine(raw);
      // healAbsorbsIn stores decoded fields only, no eventName; its source line
      // is always a SPELL_HEAL_ABSORBED. Without this the check compared
      // undefined against the line and flagged every such unit (23 on a
      // 57-file slice, 2026-09-23) — unnoticed because the scan read .gz
      // archives as text and parsed nothing.
      const eventName =
        e.eventName ??
        (key === "healAbsorbsIn" ? "SPELL_HEAL_ABSORBED" : undefined);
      if (
        !reparsed ||
        reparsed.eventName !== eventName ||
        reparsed.timestamp !== e.timestamp
      ) {
        out.push({
          code: "line-resolves",
          unitId: id,
          detail: `${key}[0] lineIndex=${e.lineIndex} 与 rawLines 不对齐(事件 ${eventName}@${e.timestamp} vs 行 ${reparsed?.eventName}@${reparsed?.timestamp})`,
        });
      }
    }

    // "Every death has a source": a real player death (not unconscious) must
    // have incoming damage within the preceding 10s
    if (u.kind === "Player") {
      for (const d of u.deaths ?? []) {
        if (d.unconscious) continue;
        const hasDamage = (u.damageIn ?? []).some(
          (e) =>
            e.timestamp <= d.timestamp &&
            e.timestamp >= d.timestamp - DEATH_DAMAGE_LOOKBACK_S * 1000,
        );
        if (!hasDamage) {
          out.push({
            code: "death-has-damage",
            unitId: id,
            detail: `死亡 @${d.timestamp} 前 ${DEATH_DAMAGE_LOOKBACK_S}s 无任何承伤事件`,
          });
        }
      }
    }
  }

  return out;
}
