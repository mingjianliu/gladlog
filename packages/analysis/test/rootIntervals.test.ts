/**
 * Reliability round 3 W1a (6954, 2026-09-26): the one root predicate —
 * ROOT_SPELL_IDS (DB2 root DR class ∪ observed root auras 26/455) applied by
 * ANOTHER unit — read by [ROOT] reachability and the kick run budget.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { ROOT_SPELL_IDS, rootIntervalsOf } from "../src/utils/rootReachability";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;
const combat = { startTime: T0, endTime: at(120) };

const aura = (
  event: LogEvent,
  id: string,
  s: number,
  srcName: string,
): ReturnType<typeof makeAuraEvent> => ({
  ...makeAuraEvent(event, id, at(s), "src", "p1", "DEBUFF"),
  srcUnitName: srcName,
});

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("ROOT_SPELL_IDS / rootIntervalsOf", () => {
  it("knows Ice Nova 157997 (root aura 455, outside the root DR class) as a root; not The Hunt's damage aura", () => {
    expect(ROOT_SPELL_IDS.has("157997")).toBe(true);
    expect(ROOT_SPELL_IDS.has("122")).toBe(true); // Frost Nova, DR class
    expect(ROOT_SPELL_IDS.has("370965")).toBe(false); // The Hunt cast / damage aura
    expect(ROOT_SPELL_IDS.has("370970")).toBe(true); // The Hunt's actual root
  });

  it("an Ice Nova another player put on the unit is a root interval", () => {
    const u = makeUnit("p1", {
      name: "Pally",
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "157997", 10, "Mage"),
        aura(LogEvent.SPELL_AURA_REMOVED, "157997", 12, "Mage"),
      ],
    });
    const iv = rootIntervalsOf(u as never, combat);
    expect(iv).toHaveLength(1);
    expect(iv[0]!.fromS).toBe(10);
    expect(iv[0]!.toS).toBe(12);
  });

  it("a mechanic-7 aura the unit applied to itself (its own charge) is not a root", () => {
    const u = makeUnit("p1", {
      name: "Warrior",
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "157997", 10, "Warrior"),
        aura(LogEvent.SPELL_AURA_REMOVED, "157997", 12, "Warrior"),
      ],
    });
    expect(rootIntervalsOf(u as never, combat)).toHaveLength(0);
  });

  it("a reflected root-DR-class root (the druid as source and target) still counts (codex review)", () => {
    const u = makeUnit("p1", {
      name: "Druid",
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "339", 9, "Druid"),
        aura(LogEvent.SPELL_AURA_REMOVED, "339", 13, "Druid"),
      ],
    });
    expect(rootIntervalsOf(u as never, combat)).toHaveLength(1);
  });
});
