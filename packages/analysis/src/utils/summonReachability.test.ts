import { describe, expect, it, vi, beforeEach } from "vitest";
import { summonReach } from "./summonReachability";
import { LogEvent, CombatUnitSpec, type ICombatUnit } from "@gladlog/parser-compat";

vi.mock("../data/spellEffectData", () => ({
  spellEffectData: {
    "123": { durationSeconds: 5 },
  },
}));

vi.mock("./cannotCastIntervals", () => ({
  buildCannotCastIntervals: vi.fn(() => []),
}));

vi.mock("./cooldowns", () => ({
  isHealerSpec: vi.fn((spec) => spec === CombatUnitSpec.Priest_Discipline),
  isMeleeSpec: vi.fn((spec) => spec === CombatUnitSpec.Rogue_Assassination),
}));

vi.mock("./losAnalysis", () => ({
  getUnitPositionAtTime: vi.fn(),
}));

vi.mock("./rootReachability", () => ({
  canReachTargetAt: vi.fn(),
}));

// Mock modules so we can change implementations
import { getUnitPositionAtTime } from "./losAnalysis";
import { canReachTargetAt } from "./rootReachability";
import { buildCannotCastIntervals } from "./cannotCastIntervals";

const mockGetUnitPositionAtTime = getUnitPositionAtTime as any;
const mockCanReachTargetAt = canReachTargetAt as any;
const mockBuildCannotCastIntervals = buildCannotCastIntervals as any;

describe("summonReach", () => {
  const createUnit = (id: string, spec: CombatUnitSpec = CombatUnitSpec.None, actionIn: any[] = []): ICombatUnit =>
    ({ id, spec, actionIn } as unknown as ICombatUnit);

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUnitPositionAtTime.mockReturnValue({ x: 0, y: 0 });
    mockCanReachTargetAt.mockReturnValue(true);
    mockBuildCannotCastIntervals.mockReturnValue([]);
  });

  it("returns null when unit has no SPELL_SUMMON event", () => {
    const summon = createUnit("s1", CombatUnitSpec.None, []);
    expect(summonReach(summon, { endTime: 10000 }, [], [])).toBeNull();
  });

  it("returns null when spell has no known duration in spellEffectData", () => {
    const summon = createUnit("s1", CombatUnitSpec.None, [
      { logLine: { event: LogEvent.SPELL_SUMMON, timestamp: 0 }, spellId: 999 },
    ]);
    expect(summonReach(summon, { endTime: 10000 }, [], [])).toBeNull();
  });

  it("returns null when no position samples exist for the summon", () => {
    const summon = createUnit("s1", CombatUnitSpec.None, [
      { logLine: { event: LogEvent.SPELL_SUMMON, timestamp: 0 }, spellId: 123 },
    ]);
    mockGetUnitPositionAtTime.mockReturnValue(null);
    expect(summonReach(summon, { endTime: 10000 }, [], [])).toBeNull();
  });

  it("returns best: null when no friend is in range (all friends are healers, filtered out)", () => {
    const summon = createUnit("s1", CombatUnitSpec.None, [
      { logLine: { event: LogEvent.SPELL_SUMMON, timestamp: 0 }, spellId: 123 },
    ]);
    const friend = createUnit("f1", CombatUnitSpec.Priest_Discipline);
    const result = summonReach(summon, { endTime: 10000 }, [friend], []);
    expect(result?.windowSeconds).toBe(5);
    expect(result?.best).toBeNull();
  });

  it("returns correct windowSeconds based on duration clipped to combat end", () => {
    const summon = createUnit("s1", CombatUnitSpec.None, [
      { logLine: { event: LogEvent.SPELL_SUMMON, timestamp: 0 }, spellId: 123 },
    ]); // Duration is 5s
    const friend = createUnit("f1", CombatUnitSpec.Rogue_Assassination);
    
    // Combat ends at 3500ms, which means we can only fit 3 full seconds.
    // windowSeconds counts the number of 1-second ticks.
    // 0 to 3500 means ticks at 500, 1500, 2500 (3 ticks).
    const result = summonReach(summon, { endTime: 3500 }, [friend], []);
    expect(result?.windowSeconds).toBe(3);
    expect(result?.best?.unit).toBe(friend);
    expect(result?.best?.seconds).toBe(3);
    expect(result?.best?.melee).toBe(true);
  });

  it("factors in cannotCastIntervals correctly (friend blocked)", () => {
    const summon = createUnit("s1", CombatUnitSpec.None, [
      { logLine: { event: LogEvent.SPELL_SUMMON, timestamp: 0 }, spellId: 123 },
    ]);
    const friend = createUnit("f1", CombatUnitSpec.Rogue_Assassination);
    
    // Blocked from 1000 to 2000, overlapping the 1500ms tick.
    mockBuildCannotCastIntervals.mockReturnValue([{ from: 1000, to: 2000 }]);
    
    const result = summonReach(summon, { endTime: 5000 }, [friend], []);
    expect(result?.windowSeconds).toBe(5);
    expect(result?.best?.seconds).toBe(4); // 5 total, 1 blocked
  });

  it("excludes dead teammates", () => {
    const summon = createUnit("s1", CombatUnitSpec.None, [
      { logLine: { event: LogEvent.SPELL_SUMMON, timestamp: 0 }, spellId: 123 },
    ]);
    const friend = createUnit("f1", CombatUnitSpec.Rogue_Assassination);
    (friend as any).deathRecords = [{ timestamp: 0 }];

    const result = summonReach(summon, { endTime: 5000 }, [friend], []);
    expect(result?.windowSeconds).toBe(5);
    expect(result?.best).toBeNull();
  });
});
