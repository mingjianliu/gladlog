import { decodeHpTail } from "./l1/decoders";
import type { GladMatchBase, GladUnit } from "./l3/model";

/**
 * Doc-slimming predicate (single source, 2026-07-25 memory incident):
 * positions 13+ of an event's params are the advanced-logging tail
 * (GUID/health/coordinates/item level). Parsing already materializes them into
 * fields such as advancedSamples / hp / crit, so persisting them is almost
 * pure duplication (NOT entirely: facing and the undecoded advanced fields
 * are in that tail and in no L3 field — the stored raw.txt is their only copy,
 * see the retention invariant in docs/log-observability-audit.md) — measured on a single 442MB shuffle doc, params accounted for
 * 53%. The only consumer of 13+ in the whole chain is crit statistics
 * (decodeHpTail), which the materialized GladHpEvent.crit field takes over.
 *
 * The production path (compose) and the legacy fat-doc read path (matchStore)
 * share this predicate: legacy events lacking crit are materialized first, then
 * trimmed; it is idempotent, so re-running it on an already-slim doc changes
 * nothing.
 */
export const SLIM_PARAMS_KEEP = 13;
/** Indices whose content survives trimming: flags [2]/[6] and spell school [10]
 * (consumed by convert); [11]/[12] carry aura type/stacks and the extra spell of
 * a dispel/interrupt (consumed by analysis) — on damage/heal events [11]/[12]
 * are advanced GUIDs with no downstream consumer, so they are cleared too.
 * All other positions (GUID/full name/spell name) are fully redundant with the
 * event's own fields and are set to the empty string. */
const KEEP_ALL = new Set([2, 6, 10]);
const KEEP_NON_HP = new Set([11, 12]);

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
  // 2026-08-23: the misses and empower ends carry params too. healAbsorbsIn is
  // deliberately absent — it stores decoded fields only, never a params array.
  "empowerEnds",
  "missesOut",
  "missesIn",
] as const;

const HP_ARRAYS = new Set(["damageOut", "damageIn", "healOut", "healIn"]);

export function slimMatchParams(m: Pick<GladMatchBase, "units">): boolean {
  let changed = false;
  for (const u of Object.values(m.units) as GladUnit[]) {
    for (const key of EVENT_ARRAYS) {
      const arr = (u[key] ?? []) as {
        eventName?: string;
        params?: string[];
        crit?: boolean;
      }[];
      const isHp = HP_ARRAYS.has(key);
      for (const e of arr) {
        if (!Array.isArray(e.params)) continue;
        // Idempotence marker: an already-slim event has params[0] === "" and
        // length ≤13
        if (e.params.length <= SLIM_PARAMS_KEEP && e.params[0] === "") continue;
        if (isHp && e.crit === undefined) {
          // Legacy docs: materialize the crit flag before the tail is trimmed
          const tail = decodeHpTail(e.eventName ?? "", e.params);
          if (tail) e.crit = tail.critical;
        }

        const len = Math.min(SLIM_PARAMS_KEEP, e.params.length);
        for (let i = 0; i < len; i++) {
          if (!KEEP_ALL.has(i) && (isHp || !KEEP_NON_HP.has(i))) {
            e.params[i] = "";
          }
        }
        e.params.length = len;

        changed = true;
      }
    }
  }
  return changed;
}
