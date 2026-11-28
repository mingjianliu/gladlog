/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Pipeline T321: a save pressed while its holder was unseen is first shown
 * in the batch that re-states the unit, so the log shows only its tail. Its
 * `[ENEMY DEF]` line read that tail against the full length and said
 * `— removed early` (0284fcd9 r1 2:37: Cloak of Shadows 2.4 s seen, the
 * rogue unseen 3.1 s since its Vanish, of 5.0 s). The press lies at most
 * `unseenLeadMs` before the batch; an early end on length alone stands only
 * when that life falls short too (`unseenTailCouldBeFull`).
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  enemyDefensiveEventsUncached,
  unseenTailCouldBeFull,
} from "../src/utils/enemyDefensives";
import { RESYNC_BATCH_SPAN_MS, unseenLeadMs } from "../src/utils/hiddenPress";

const T0 = 1_000_000;
const CLOAK = "31224";
const VANISH = "1856";
const BATCH_MS = T0 + 157_729;

const aura = (event: LogEvent, id: string, ms: number, src = "rogue"): any => ({
  spellId: id,
  spellName: id,
  srcUnitId: src,
  destUnitId: "rogue",
  timestamp: ms,
  logLine: { event, timestamp: ms },
});
const cast = (id: string, ms: number): any => ({
  spellId: id,
  srcUnitId: "rogue",
  destUnitId: "",
  timestamp: ms,
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: ms },
});
/** the re-stating batch: 30 APPLIED rows on the rogue, Cloak among them */
const batch = (): any[] => [
  ...Array.from({ length: 29 }, (_, i) =>
    aura(LogEvent.SPELL_AURA_APPLIED, String(900_000 + i), BATCH_MS, "x"),
  ),
  aura(LogEvent.SPELL_AURA_APPLIED, CLOAK, BATCH_MS),
];
const rogue = (over: Record<string, unknown>): any => ({
  id: "rogue",
  name: "rogue",
  auraEvents: [],
  spellCastEvents: [],
  damageOut: [],
  advancedActions: [],
  ...over,
});

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("unseenLeadMs (T321)", () => {
  it("runs from the unit's last own-state row: an aura on it, its cast, its sample — not its damage", () => {
    const u = rogue({
      auraEvents: [aura(LogEvent.SPELL_AURA_APPLIED, "11327", BATCH_MS - 3111)],
      spellCastEvents: [cast(VANISH, BATCH_MS - 3111)],
      advancedActions: [{ timestamp: BATCH_MS - 4000 }],
      // a stealthed rogue's hits are still written
      damageOut: [
        { timestamp: BATCH_MS - 27, logLine: { timestamp: BATCH_MS - 27 } },
      ],
    });
    expect(unseenLeadMs(u, BATCH_MS)).toBe(3111);
  });
  it("a row of the batch itself is no earlier sight; no row before is an unbounded lead", () => {
    const u = rogue({
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "1", BATCH_MS - RESYNC_BATCH_SPAN_MS),
        aura(LogEvent.SPELL_AURA_APPLIED, "2", BATCH_MS - 2000),
      ],
    });
    expect(unseenLeadMs(u, BATCH_MS)).toBe(2000);
    expect(unseenLeadMs(rogue({}), BATCH_MS)).toBe(Infinity);
  });
});

describe("[ENEMY DEF] on a press made unseen: `— removed early` only when even the unseen life falls short (T321)", () => {
  const events = (leadMs: number) => {
    const u = rogue({
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "11327", BATCH_MS - leadMs),
        ...batch(),
        aura(LogEvent.SPELL_AURA_REMOVED, CLOAK, BATCH_MS + 2400),
      ],
      spellCastEvents: [cast(VANISH, BATCH_MS - leadMs)],
    });
    return {
      u,
      cloak: enemyDefensiveEventsUncached(u, [u], {
        startTime: T0,
        endTime: T0 + 300_000,
      }).filter((e) => e.spellId === CLOAK),
    };
  };

  it("2.4 s seen after 3.1 s unseen of a 5.0 s Cloak: its full length fits, no `removed early` (0284fcd9 r1 2:37)", () => {
    const { u, cloak } = events(3111);
    expect(unseenTailCouldBeFull(u, CLOAK, 2.4, BATCH_MS)).toBe(true);
    expect(cloak).toHaveLength(1);
    expect(cloak[0]!.unseenPress).toBe(true);
    expect(cloak[0]!.observedSeconds).toBeCloseTo(2.4, 3);
    expect(cloak[0]!.removedEarly).toBe(false);
  });

  it("2.4 s seen after 0.5 s unseen: even the longest life is short — it stays `removed early`", () => {
    const { u, cloak } = events(500);
    expect(unseenTailCouldBeFull(u, CLOAK, 2.4, BATCH_MS)).toBe(false);
    expect(cloak).toHaveLength(1);
    expect(cloak[0]!.removedEarly).toBe(true);
  });
});
