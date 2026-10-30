/**
 * Triage 2026-09-29, enemy-def F-E2 / F-E3 (rulings A24, A25): the kill-window
 * "defenseless" span ends at an external the target RECEIVED, and Blur /
 * Greater Invisibility / Burrow / Time Stop are roster walls. Mass
 * Invisibility is not (ruling P-b8): its aura outlasts the invisibility.
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  countsAsKillWindowDefensiveInHand,
  isKillWindowMajorDefensive,
  KW_IN_HAND_ONLY_DEFENSIVE_IDS,
  KW_MAJOR_DEFENSIVE_IDS,
  KW_UNPRESSED_NOT_IN_HAND_IDS,
  kwCooldownSeconds,
  unpressedKitDefensiveInHand,
} from "../src/data/abilityProfile";
import { ensureAnalysisData } from "../src/data/ensure";
import { DEFLECTION_IDS,
  MITIGATION_WALL_IDS } from "../src/data/mitigationData";
import {
  extractSpiritOfRedemptionIntervals,
  isGhostAtRenderSecond,
  spanHoldsGhostSecond,
} from "../src/utils/combatStates";
import {
  enemyDefensiveEvents,
  MITIGATION_AURA_IDS,
  ownWallLineNames,
  ownWallSpanS,
  renderedExternalSpanS,
  renderedObservedSeconds,
  selfSaveReductionNames,
  spanHoldsOwnWallSecond,
} from "../src/utils/enemyDefensives";
import { WALL_IN_HAND_MIT_IDS } from "../src/utils/killWindowTargetSelection";
import {
  computeOffensiveWindows,
  subtractIntervals,
} from "../src/utils/offensiveWindows";
import { unusedKitRows } from "../src/utils/unusedKitRows";
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
    // the on-death form (27827), its REMOVED lost: it ends at its official
    // 15 s (codex 60-POSTHOC-09f #1 — a real log's death follows there)
    const held = computeOffensiveWindows(
      [priest([formAura(LogEvent.SPELL_AURA_APPLIED, 40, "27827")])] as never,
      [],
      combat,
    );
    expect(held.map((w) => [w.fromSeconds, w.toSeconds])).toEqual([
      [fromSeconds, 40],
      [55, 60],
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

// R08 (d), gap 1 (2026-10-13): "defenseless" says nothing was up — the span
// is cut on the target's OWN 20–99 % wall the state machine does not time: a
// wall outside the kill-window roster, and a wall's aura with no cast behind
// it. The interval is the aura its `[ENEMY DEF]` line is rendered from.
describe("computeOffensiveWindows — the target's own 20–99 % wall cuts the span (R08 d)", () => {
  const BARKSKIN = "22812";
  const SURVIVAL_OF_THE_FITTEST = "264735";
  const DIVINE_PROTECTION_RET = "403876";
  const ANCIENT_OF_LORE = "473909";
  const ROAR_OF_SACRIFICE = "53480";
  const combat = { startTime: T0, endTime: at(60), units: {} } as never;
  const own = (event: LogEvent, id: string, s: number, src = "e1") => ({
    ...makeAuraEvent(event, id, at(s), src, "e1", "BUFF"),
    srcUnitName: src === "e1" ? "EnemyHunter" : "EnemyHealer",
  });
  const up = (id: string, from: number, to: number, src = "e1") => [
    own(LogEvent.SPELL_AURA_APPLIED, id, from, src),
    own(LogEvent.SPELL_AURA_REMOVED, id, to, src),
  ];
  const press = (id: string, s: number) =>
    makeSpellCastEvent(id, at(s), "e1", "EnemyHunter", "e1", "EnemyHunter");
  // Barkskin at 2 s is the one roster spell the unit pressed: defenseless
  // from its end
  const hunter = (
    auras: ReturnType<typeof makeAuraEvent>[] = [],
    casts: ReturnType<typeof makeSpellCastEvent>[] = [],
  ) =>
    makeUnit("e1", {
      name: "EnemyHunter",
      spec: CombatUnitSpec.Hunter_BeastMastery,
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: [press(BARKSKIN, 2), ...casts],
      auraEvents: auras,
    });
  const spans = (u: ReturnType<typeof hunter>) =>
    computeOffensiveWindows([u] as never, [], combat).map((w) => [
      w.fromSeconds,
      w.toSeconds,
    ]);

  it("Vanish is a roster member since the user ruling of 2026-10-21 (fact3 D49): a charge in hand is no defenseless span", () => {
    expect(isKillWindowMajorDefensive("1856")).toBe(true);
  });

  it("the two W1g walls are roster members since the user ruling of 2026-10-20 (fact1215 retest idx 45 / 47 / 48)", () => {
    for (const id of [SURVIVAL_OF_THE_FITTEST, DIVINE_PROTECTION_RET]) {
      expect(MITIGATION_WALL_IDS.has(id), id).toBe(true);
      expect(isKillWindowMajorDefensive(id), id).toBe(true);
    }
  });

  it("f4da82c5 round 5's shape: a pressed roster wall is timed — in hand before its press, up for its length, then the span opens", () => {
    const [[, toSeconds]] = spans(hunter()) as [[number, number]];
    // pressed at 24.6 s; before the press it was in hand, so no span opens
    // until the press has run its official 6 s (a press the machine times
    // holds for its official length, ruling D6)
    const cut = spans(
      hunter(up(SURVIVAL_OF_THE_FITTEST, 24.6, 30.6), [
        press(SURVIVAL_OF_THE_FITTEST, 24.6),
      ]),
    );
    expect(cut).toHaveLength(1);
    expect(cut[0]![0]).toBeCloseTo(30.6, 6);
    expect(cut[0]![1]).toBe(toSeconds);
    // Retribution's Divine Protection the same
    expect(
      spans(
        hunter(up(DIVINE_PROTECTION_RET, 30, 38), [
          press(DIVINE_PROTECTION_RET, 30),
        ]),
      ),
    ).toEqual([[38, toSeconds]]);
  });

  it("310e5c6d's shape: a wall's aura with no cast of its id behind it cuts the span too", () => {
    const [[fromSeconds, toSeconds]] = spans(hunter()) as [[number, number]];
    const u = hunter(up(ANCIENT_OF_LORE, 40.4, 44.2));
    const [d] = enemyDefensiveEvents(u as never, [u] as never, combat).filter(
      (e) => e.kind === "self",
    );
    expect(d!.pressSeconds).toBeUndefined();
    const cut = spans(u);
    expect(cut).toHaveLength(2);
    expect(cut[0]).toEqual([fromSeconds, 40.4]);
    expect(cut[1]![0]).toBeCloseTo(44.2, 6);
    expect(cut[1]![1]).toBe(toSeconds);
  });

  it("a wall that lasted a second leaves the pieces on either side; pieces under the minimum length are dropped; an aura of no length cuts nothing", () => {
    const [[fromSeconds, toSeconds]] = spans(hunter()) as [[number, number]];
    // 2c6e85ec round 1's shape: up 1.0 s
    expect(spans(hunter(up(DIVINE_PROTECTION_RET, 30.7, 31.7)))).toEqual([
      [fromSeconds, 30.7],
      [31.7, toSeconds],
    ]);
    // 3 s into the span: nothing is left before it
    expect(
      spans(hunter(up(DIVINE_PROTECTION_RET, fromSeconds + 3, 38))),
    ).toEqual([[38, toSeconds]]);
    expect(spans(hunter(up(DIVINE_PROTECTION_RET, 30, 30)))).toEqual([
      [fromSeconds, toSeconds],
    ]);
  });

  it("a span that ends at the wall's press keeps that last fraction of a second (02c8e3ac round 2: Die by the Sword at 2:38.9 — the hits of that second forced it)", () => {
    const [[fromSeconds]] = spans(hunter()) as [[number, number]];
    const cut = computeOffensiveWindows(
      [hunter(up(DIVINE_PROTECTION_RET, 38.9, 46.9))] as never,
      [],
      combat,
    );
    expect(cut[0]!.fromSeconds).toBe(fromSeconds);
    // not 38: the rendered pair of an external floors its start
    expect(cut[0]!.toSeconds).toBe(38.9);
    expect(
      renderedExternalSpanS({ atSeconds: 38.9, observedSeconds: 8 }),
    ).toEqual({ from: 38, to: 46 });
    expect(
      ownWallSpanS(
        { kind: "self", atSeconds: 38.9, observedSeconds: 8 },
        false,
      ),
    ).toEqual({ from: 38.9, to: 46.9 });
    expect(
      ownWallSpanS(
        { kind: "external", atSeconds: 38.9, observedSeconds: 8 },
        false,
      ),
    ).toBeUndefined();
    expect(
      ownWallSpanS({ kind: "self", atSeconds: 38.9 }, false),
    ).toBeUndefined();
  });

  it("a press the state machine times keeps its reading (ruling D6): the aura is not read, only the gap to a cast line logged after it", () => {
    const [[fromSeconds, toSeconds]] = spans(hunter()) as [[number, number]];
    // the same Barkskin press with its aura logged, running past the
    // official length the machine holds: the span opens where it did
    expect(spans(hunter(up(BARKSKIN, 2, fromSeconds + 6)))).toEqual([
      [fromSeconds, toSeconds],
    ]);
    const d = { kind: "self" as const, atSeconds: 99.98, observedSeconds: 8 };
    // no press behind the aura: the whole aura, roster wall or not
    expect(ownWallSpanS(d, true)).toEqual({ from: 99.98, to: 107.98 });
    // a timed press logged before its aura: the machine already ended the span
    expect(ownWallSpanS({ ...d, pressSeconds: 99.9 }, true)).toBeUndefined();
    // …logged 40 ms after it: the span ends with the aura, not the cast line
    expect(ownWallSpanS({ ...d, pressSeconds: 100.02 }, true)).toEqual({
      from: 99.98,
      to: 100.02,
    });
    // the same press of a wall outside the roster: the whole aura
    expect(ownWallSpanS({ ...d, pressSeconds: 100.02 }, false)).toEqual({
      from: 99.98,
      to: 107.98,
    });
  });

  it("Roar of Sacrifice cuts the span while its aura is up (user ruling 2026-10-25, like Intervene); another unit's wall on itself, or a wall aura somebody else applied, does not", () => {
    const plain = spans(hunter());
    const roar = spans(
      hunter(up(ROAR_OF_SACRIFICE, 30, 40), [press(ROAR_OF_SACRIFICE, 30)]),
    ) as unknown as Array<[number, number]>;
    expect(roar).not.toEqual(plain);
    for (const [f, t] of roar) expect(f >= 40 || t <= 30).toBe(true);
    const other = makeUnit("e2", {
      name: "EnemyHealer",
      spec: CombatUnitSpec.Druid_Restoration,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        {
          ...makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            SURVIVAL_OF_THE_FITTEST,
            at(30),
            "e2",
            "e2",
            "BUFF",
          ),
          srcUnitName: "EnemyHealer",
        },
      ],
    });
    expect(
      computeOffensiveWindows(
        [
          // the same aura on the hunter, applied by the other unit
          hunter(up(SURVIVAL_OF_THE_FITTEST, 30, 38, "e2")),
          other,
        ] as never,
        [],
        combat,
      )
        .filter((w) => w.targetUnitId === "e1")
        .map((w) => [w.fromSeconds, w.toSeconds]),
    ).toEqual(plain);
  });

  it("no rendered second strictly inside a cut span is a wall line's second (the gate's reading)", () => {
    const u = hunter(
      [
        ...up(SURVIVAL_OF_THE_FITTEST, 24.6, 32.6),
        ...up(DIVINE_PROTECTION_RET, 36.7, 37.7),
        ...up(ANCIENT_OF_LORE, 45.95, 50.2),
      ],
      [press(SURVIVAL_OF_THE_FITTEST, 24.6)],
    );
    const walls = enemyDefensiveEvents(u as never, [u] as never, combat)
      .filter((e) => e.kind === "self" && e.spellId !== BARKSKIN)
      .map((e) => Math.floor(e.atSeconds));
    expect(walls).toEqual([24, 36, 45]);
    const cut = computeOffensiveWindows([u] as never, [], combat);
    expect(cut.length).toBeGreaterThanOrEqual(2);
    for (const w of cut)
      for (const s of walls)
        expect(
          spanHoldsOwnWallSecond(
            Math.floor(w.fromSeconds),
            Math.floor(w.toSeconds),
            s,
          ),
        ).toBe(false);
    expect(spanHoldsOwnWallSecond(20, 30, 20)).toBe(false);
    expect(spanHoldsOwnWallSecond(20, 30, 30)).toBe(false);
    expect(spanHoldsOwnWallSecond(20, 30, 21)).toBe(true);
  });
});

describe("the wall slice has one source (R08 d)", () => {
  it("the tier's walls, the [ENEMY DEF] wall auras and the table's 20–99 % rows are the same ids", () => {
    expect(WALL_IN_HAND_MIT_IDS).toBe(MITIGATION_WALL_IDS);
    // the [ENEMY DEF] / KILL ATTEMPTS slice adds the deflections (Aspect of
    // the Turtle, fact4 D6) — never to the tier's "20–99 % wall in hand"
    expect([...MITIGATION_AURA_IDS].sort()).toEqual(
      [...MITIGATION_WALL_IDS, ...DEFLECTION_IDS].sort(),
    );
    expect(DEFLECTION_IDS.has("186265")).toBe(true);
    expect(WALL_IN_HAND_MIT_IDS.has("186265")).toBe(false);
    expect(MITIGATION_WALL_IDS.size).toBeGreaterThanOrEqual(26);
  });

  it("the names a wall line prints: every wall's, the aura of a cast-keyed one, and no percentage line that is not a wall", () => {
    const names = ownWallLineNames();
    for (const n of [
      "Survival of the Fittest",
      "Divine Protection",
      "Ancient of Lore",
      "Barkskin",
      "Blur",
      "Greater Invisibility",
      "Fortifying Brew",
    ])
      expect(names.has(n), n).toBe(true);
    expect(selfSaveReductionNames()).toEqual(["Roar of Sacrifice"]);
    for (const n of selfSaveReductionNames())
      expect(names.has(n), n).toBe(false);
    expect(names.has("Divine Shield")).toBe(false);
    expect(names.has("Mass Invisibility")).toBe(false);
  });
});

// User ruling 2026-10-20 (fact1215 retest idx 54, 「我觉得都算」): a ready
// Alter Time is a major defensive in hand, so the span closes while it is
// back; pressed, it is no defense that was up (fact1215 R7) and holds
// nothing — the span reopens at the press.
describe("computeOffensiveWindows — a ready Alter Time is a defensive in hand", () => {
  const ICE_BLOCK = "45438";
  const ALTER_TIME = "342245";
  const combat = { startTime: T0, endTime: at(120), units: {} } as never;
  const mage = (casts: Array<[string, number]>) =>
    makeUnit("e1", {
      name: "EnemyMage",
      spec: CombatUnitSpec.Mage_Frost,
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: casts.map(([id, s]) =>
        makeSpellCastEvent(id, at(s), "e1", "EnemyMage", "e1", "EnemyMage"),
      ),
    });

  it("is in hand only: never a roster wall, counted while ready", () => {
    expect(isKillWindowMajorDefensive(ICE_BLOCK)).toBe(true);
    expect(isKillWindowMajorDefensive(ALTER_TIME)).toBe(false);
    expect(KW_IN_HAND_ONLY_DEFENSIVE_IDS.has(ALTER_TIME)).toBe(true);
    expect(countsAsKillWindowDefensiveInHand(ALTER_TIME)).toBe(true);
  });

  it("the span stops while Alter Time is back (65 s) and reopens at its press (70 s)", () => {
    const ws = computeOffensiveWindows(
      [
        mage([
          [ICE_BLOCK, 2],
          [ALTER_TIME, 5],
          [ALTER_TIME, 70],
        ]),
      ] as never,
      [],
      combat,
    );
    expect(ws.map((w) => [w.fromSeconds, w.toSeconds])).toEqual([
      [12, 65],
      [70, 120],
    ]);
  });
});

// User ruling 2026-10-20 (fact1215 retest idx 60, 「都要」): a roster
// defensive in the unit's kit that it never pressed is in hand the whole
// round — `target defenseless 0:49–1:47` on a Restoration Druid whose kit
// printed `Barkskin [60s, lasts 12s] [UNUSED]`.
describe("computeOffensiveWindows — an unpressed kit defensive is in hand", () => {
  const IRONBARK = "102342";
  const BARKSKIN = "22812";
  const combat = { startTime: T0, endTime: at(120), units: {} } as never;
  const druid = (casts: Array<[string, number]>) =>
    makeUnit("e1", {
      name: "EnemyDruid",
      class: CombatUnitClass.Druid,
      spec: CombatUnitSpec.Druid_Restoration,
      reaction: CombatUnitReaction.Hostile,
      info: { talents: [], pvpTalents: [] } as never,
      spellCastEvents: casts.map(([id, s]) =>
        makeSpellCastEvent(id, at(s), "e1", "EnemyDruid", "e1", "EnemyDruid"),
      ),
    });

  it("Barkskin is in the Restoration kit: pressed Ironbark alone opens no span", () => {
    const u = druid([[IRONBARK, 2]]);
    expect(
      unusedKitRows(u as never, combat).map((r) => r.spellId),
    ).toContain(BARKSKIN);
    expect(computeOffensiveWindows([u] as never, [], combat)).toEqual([]);
  });

  it("once Barkskin is pressed too, the span is the machine's again", () => {
    const ws = computeOffensiveWindows(
      [
        druid([
          [IRONBARK, 2],
          [BARKSKIN, 3],
        ]),
      ] as never,
      [],
      combat,
    );
    expect(ws.length).toBeGreaterThan(0);
  });
});

// User ruling 2026-10-20 (「去掉治疗和只能给队友的」): an unpressed heal or
// ally-only cooldown does not keep its owner out of a span.
describe("unpressedKitDefensiveInHand — an unpressed heal or ally-only cooldown is not in hand", () => {
  it("heals and Blessing of Sacrifice are out; walls, immunities and self-castable externals stay", () => {
    for (const id of ["19236", "64843", "740", "6940"]) {
      expect(isKillWindowMajorDefensive(id), id).toBe(true);
      expect(unpressedKitDefensiveInHand(id), id).toBe(false);
    }
    for (const id of ["22812", "642", "1022", "33206", "342245"])
      expect(unpressedKitDefensiveInHand(id), id).toBe(true);
    expect([...KW_UNPRESSED_NOT_IN_HAND_IDS].sort()).toEqual(
      ["19236", "64843", "6940", "740"],
    );
  });
});

describe("computeOffensiveWindows — an external pressed on a teammate is no protection on its caster (fact5 D9)", () => {
  const combat = { startTime: T0, endTime: at(60), units: {} } as never;
  const druidPressing = (destId: string) =>
    makeUnit("e1", {
      name: "EnemyDruid",
      spec: CombatUnitSpec.Druid_Restoration,
      reaction: CombatUnitReaction.Hostile,
      // Ironbark (90 s, 12 s buff) at 2 s
      spellCastEvents: [
        makeSpellCastEvent("102342", at(2), destId, "X", "e1", "EnemyDruid"),
      ],
    });
  it("Ironbark on the druid itself holds the span off for the buff; on a teammate the span opens at the press", () => {
    const self = computeOffensiveWindows([druidPressing("e1")] as never, [], combat);
    const ally = computeOffensiveWindows([druidPressing("e2")] as never, [], combat);
    expect(self[0]!.fromSeconds).toBeGreaterThanOrEqual(14);
    expect(ally[0]!.fromSeconds).toBeLessThan(3);
  });
  it("codex 20-F18-02 #1: a cast row naming an ally whose aura also lands on the caster still protects the caster", () => {
    const both = druidPressing("e2");
    both.auraEvents = [
      makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "102342", at(2), "e1", "e1", "BUFF"),
    ] as never;
    const w = computeOffensiveWindows([both] as never, [], combat);
    expect(w[0]!.fromSeconds).toBeGreaterThanOrEqual(14);
  });
});
