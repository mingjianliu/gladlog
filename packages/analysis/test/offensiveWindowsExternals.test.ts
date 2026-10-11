/**
 * Triage 2026-09-29, enemy-def F-E2 / F-E3 (rulings A24, A25): the kill-window
 * "defenseless" span ends at an external the target RECEIVED, and Blur /
 * Greater Invisibility / Burrow / Time Stop are roster walls. Mass
 * Invisibility is not (ruling P-b8): its aura outlasts the invisibility.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  isKillWindowMajorDefensive,
  KW_MAJOR_DEFENSIVE_IDS,
  kwCooldownSeconds,
} from "../src/data/abilityProfile";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  extractSpiritOfRedemptionIntervals,
  isGhostAtRenderSecond,
  spanHoldsGhostSecond,
} from "../src/utils/combatStates";
import {
  renderedExternalSpanS,
  renderedObservedSeconds,
} from "../src/utils/enemyDefensives";
import {
  computeOffensiveWindows,
  subtractIntervals,
} from "../src/utils/offensiveWindows";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("subtractIntervals", () => {
  it("cuts the middle, the edges, and nothing when disjoint", () => {
    expect(
      subtractIntervals([{ from: 10, to: 50 }], [{ from: 20, to: 30 }]),
    ).toEqual([
      { from: 10, to: 20 },
      { from: 30, to: 50 },
    ]);
    expect(
      subtractIntervals([{ from: 10, to: 50 }], [{ from: 0, to: 15 }]),
    ).toEqual([{ from: 15, to: 50 }]);
    expect(
      subtractIntervals([{ from: 10, to: 50 }], [{ from: 45, to: 99 }]),
    ).toEqual([{ from: 10, to: 45 }]);
    expect(
      subtractIntervals([{ from: 10, to: 50 }], [{ from: 60, to: 70 }]),
    ).toEqual([{ from: 10, to: 50 }]);
    expect(
      subtractIntervals([{ from: 10, to: 50 }], [{ from: 0, to: 99 }]),
    ).toEqual([]);
  });

  it("an empty cut does not split a span (codex review: a 0.04 s external at 25 s)", () => {
    expect(
      subtractIntervals([{ from: 10, to: 50 }], [{ from: 25, to: 25 }]),
    ).toEqual([{ from: 10, to: 50 }]);
    expect(
      renderedExternalSpanS({ atSeconds: 25, observedSeconds: 0.04 }),
    ).toBeUndefined();
  });

  it("overlapping cuts compose", () => {
    expect(
      subtractIntervals(
        [{ from: 0, to: 100 }],
        [
          { from: 10, to: 30 },
          { from: 20, to: 40 },
        ],
      ),
    ).toEqual([
      { from: 0, to: 10 },
      { from: 40, to: 100 },
    ]);
  });
});

describe("kill-window roster (F-E3)", () => {
  it.each([
    ["198589", "Blur"],
    ["110959", "Greater Invisibility"],
    ["409293", "Burrow"],
    ["378441", "Time Stop"],
  ])(
    "%s (%s) is a kill-window major defensive with an official cooldown ≥ 30 s",
    (id) => {
      expect(KW_MAJOR_DEFENSIVE_IDS.has(id)).toBe(true);
      expect(kwCooldownSeconds(id)).toBeGreaterThanOrEqual(30);
      expect(isKillWindowMajorDefensive(id)).toBe(true);
    },
  );

  // User ruling P-b8 (2026-10-01): the 414664 aura sits on the mage's allies
  // for its full 12 s whatever they do — as a roster wall it named a "major
  // defensive up" on 227 burst lines whose target was being hit.
  it("Mass Invisibility is NOT in the roster", () => {
    expect(KW_MAJOR_DEFENSIVE_IDS.has("414664")).toBe(false);
    expect(isKillWindowMajorDefensive("414664")).toBe(false);
  });
});

describe("computeOffensiveWindows — an external received cuts the span (F-E2)", () => {
  const BARKSKIN = "22812";
  const IRONBARK = "102342";

  const combat = {
    startTime: T0,
    endTime: at(60),
    units: {},
  } as never;

  const druid = (extraAuras: ReturnType<typeof makeAuraEvent>[] = []) =>
    makeUnit("e1", {
      name: "EnemyDruid",
      spec: CombatUnitSpec.Druid_Feral,
      reaction: CombatUnitReaction.Hostile,
      // Barkskin at 2 s: the only tracked wall is spent; the buff runs out
      // and the druid is defenseless until the cooldown returns
      spellCastEvents: [
        makeSpellCastEvent(
          BARKSKIN,
          at(2),
          "e1",
          "EnemyDruid",
          "e1",
          "EnemyDruid",
        ),
      ],
      auraEvents: extraAuras,
    });

  it("without an external the span runs from the buff's end; an Ironbark from a teammate splits it", () => {
    const alone = computeOffensiveWindows([druid()] as never, [], combat);
    expect(alone).toHaveLength(1);
    const { fromSeconds, toSeconds } = alone[0]!;
    expect(toSeconds - fromSeconds).toBeGreaterThan(30);

    // Ironbark on the druid from 25 s to 37 s, cast by the enemy healer
    const ironbark = [
      {
        ...makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          IRONBARK,
          at(25),
          "e2",
          "e1",
          "BUFF",
        ),
        srcUnitName: "EnemyHealer",
      },
      {
        ...makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          IRONBARK,
          at(37),
          "e2",
          "e1",
          "BUFF",
        ),
        srcUnitName: "EnemyHealer",
      },
    ];
    const healer = makeUnit("e2", {
      name: "EnemyHealer",
      spec: CombatUnitSpec.Druid_Restoration,
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: [
        makeSpellCastEvent(
          IRONBARK,
          at(25),
          "e1",
          "EnemyDruid",
          "e2",
          "EnemyHealer",
        ),
      ],
    });
    const cut = computeOffensiveWindows(
      [druid(ironbark), healer] as never,
      [],
      combat,
    ).filter((w) => w.targetUnitId === "e1");
    expect(cut.map((w) => [w.fromSeconds, w.toSeconds])).toEqual([
      [fromSeconds, 25],
      [37, toSeconds],
    ]);
  });

  it("the cut is the pair the [ENEMY DEF] line prints: the rendered second of the cast and the printed length, not the aura's own start", () => {
    const { fromSeconds, toSeconds } = computeOffensiveWindows(
      [druid()] as never,
      [],
      combat,
    )[0]!;
    // cast at 24.4 s; the aura is logged 0.8 s later and runs 12 s. The
    // line reads `0:24 … Ironbark → … (12.0s)`; the span must end at 0:24
    // and the next one start at 0:36, not 0:25 / 0:37.
    const aura = (event: LogEvent, s: number) => ({
      ...makeAuraEvent(event, IRONBARK, at(s), "e2", "e1", "BUFF"),
      srcUnitName: "EnemyHealer",
    });
    const healer = makeUnit("e2", {
      name: "EnemyHealer",
      spec: CombatUnitSpec.Druid_Restoration,
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: [
        makeSpellCastEvent(
          IRONBARK,
          at(24.4),
          "e1",
          "EnemyDruid",
          "e2",
          "EnemyHealer",
        ),
      ],
    });
    const cut = computeOffensiveWindows(
      [
        druid([
          aura(LogEvent.SPELL_AURA_APPLIED, 25.2),
          aura(LogEvent.SPELL_AURA_REMOVED, 37.2),
        ]),
        healer,
      ] as never,
      [],
      combat,
    ).filter((w) => w.targetUnitId === "e1");
    expect(cut).toHaveLength(2);
    expect(cut[0]!.fromSeconds).toBe(fromSeconds);
    // the rendered second, 0:24, and 24 + the printed 12.0 s
    expect(cut[0]!.toSeconds).toBe(24);
    expect(cut[1]!.fromSeconds).toBeCloseTo(36, 6);
    expect(cut[1]!.toSeconds).toBe(toSeconds);
  });

  it("a fractional length crossing a second: the span restarts where the printed facts say (codex review: 0:24 … (11.2s) → 0:35, not 0:36)", () => {
    expect(
      renderedExternalSpanS({ atSeconds: 24.9, observedSeconds: 11.2 }),
    ).toEqual({
      from: 24,
      to: 35.2,
    });
    expect(renderedObservedSeconds(11.249)).toBe(11.2);
    expect(renderedExternalSpanS({ atSeconds: 24.9 })).toBeUndefined();
  });
});

// F17 (user ruling 2026-10-11, option b): a priest in Spirit of Redemption
// form cannot be hit — the span ends where the form begins and the next one
// starts where it ends, on the `[STATE]` tick's own interval.
describe("computeOffensiveWindows — Spirit of Redemption form cuts the span (F17)", () => {
  const BARKSKIN = "22812";
  const FORM_PRESSED = "215769";
  const combat = { startTime: T0, endTime: at(60), units: {} } as never;
  const formAura = (event: LogEvent, s: number, id = FORM_PRESSED) =>
    makeAuraEvent(event, id, at(s), "e1", "e1", "BUFF");
  // Barkskin at 2 s is the only tracked wall: defenseless from its end
  const priest = (auraEvents: ReturnType<typeof makeAuraEvent>[] = []) =>
    makeUnit("e1", {
      name: "EnemyPriest",
      spec: CombatUnitSpec.Priest_Holy,
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: [
        makeSpellCastEvent(
          BARKSKIN,
          at(2),
          "e1",
          "EnemyPriest",
          "e1",
          "EnemyPriest",
        ),
      ],
      auraEvents,
    });

  it("the form's interval is taken out of the span, at the aura's own instants", () => {
    const plain = computeOffensiveWindows([priest()] as never, [], combat);
    expect(plain).toHaveLength(1);
    const { fromSeconds, toSeconds } = plain[0]!;
    const forms = [
      formAura(LogEvent.SPELL_AURA_APPLIED, 28.39),
      formAura(LogEvent.SPELL_AURA_REMOVED, 37.42),
    ];
    expect(extractSpiritOfRedemptionIntervals(priest(forms), combat)).toEqual([
      { startSeconds: 28.39, endSeconds: 37.42 },
    ]);
    const cut = computeOffensiveWindows([priest(forms)] as never, [], combat);
    expect(cut.map((w) => [w.fromSeconds, w.toSeconds])).toEqual([
      [fromSeconds, 28.39],
      [37.42, toSeconds],
    ]);
    // no rendered second strictly inside either span is a `:ghost` second
    const ghost = extractSpiritOfRedemptionIntervals(priest(forms), combat);
    for (const w of cut)
      for (let s = 0; s <= 60; s++)
        if (isGhostAtRenderSecond(ghost, s))
          expect(
            spanHoldsGhostSecond(
              Math.floor(w.fromSeconds),
              Math.floor(w.toSeconds),
              s,
            ),
          ).toBe(false);
  });

  it("a piece the form leaves under the minimum length is dropped; a form held to the log's end closes the span", () => {
    const { fromSeconds } = computeOffensiveWindows(
      [priest()] as never,
      [],
      combat,
    )[0]!;
    // the form begins 3 s into the span: nothing is left before it
    const early = computeOffensiveWindows(
      [
        priest([
          formAura(LogEvent.SPELL_AURA_APPLIED, fromSeconds + 3),
          formAura(LogEvent.SPELL_AURA_REMOVED, fromSeconds + 12),
        ]),
      ] as never,
      [],
      combat,
    );
    expect(early).toHaveLength(1);
    expect(early[0]!.fromSeconds).toBe(fromSeconds + 12);
    // the on-death form (27827), never removed inside the log
    const held = computeOffensiveWindows(
      [priest([formAura(LogEvent.SPELL_AURA_APPLIED, 40, "27827")])] as never,
      [],
      combat,
    );
    expect(held.map((w) => [w.fromSeconds, w.toSeconds])).toEqual([
      [fromSeconds, 40],
    ]);
  });

  it("another unit's form, and an aura that is not the form, cut nothing", () => {
    const plain = computeOffensiveWindows([priest()] as never, [], combat)[0]!;
    const other = makeUnit("e2", {
      name: "OtherPriest",
      spec: CombatUnitSpec.Priest_Holy,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          FORM_PRESSED,
          at(28),
          "e2",
          "e2",
          "BUFF",
        ),
      ],
    });
    const w = computeOffensiveWindows(
      [
        priest([
          // Nullifying Shroud is not read (the ruling: only this form)
          formAura(LogEvent.SPELL_AURA_APPLIED, 28, "378464"),
          formAura(LogEvent.SPELL_AURA_REMOVED, 37, "378464"),
        ]),
        other,
      ] as never,
      [],
      combat,
    ).filter((x) => x.targetUnitId === "e1");
    expect(w.map((x) => [x.fromSeconds, x.toSeconds])).toEqual([
      [plain.fromSeconds, plain.toSeconds],
    ]);
  });
});
