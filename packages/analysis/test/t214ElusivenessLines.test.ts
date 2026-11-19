/**
 * Pipeline T214 (fact14 D39 / D40, user rulings R52 + R56, 2026-11-18):
 * Elusiveness 79008 gives a rogue's Feint a 20 % reduction of non-area
 * damage and its Evasion a 20 % reduction of all damage.
 *  (a) a holder's Feint prints a FACT line `Feint (20%, 6.0s)` no wall
 *      reader counts; a non-holder's Feint prints nothing, as before;
 *  (b) a holder's Evasion prints `Evasion (dodge, 20% all damage)`; a
 *      non-holder's stays `Evasion (dodge)`.
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  enemyDefensiveEvents,
  ownSaveSpanS,
  ownWallLineNames,
  ownWallSpanS,
  selfSaveCasts,
  TALENT_REDUCTION_FACT_LINE_IDS,
} from "../src/utils/enemyDefensives";
import {
  carriesDodgeAllDamageLabel,
  DODGE_ALL_DAMAGE_LEGEND,
  labelLegendsWithoutCarrier,
  selfDefensiveLabelLegends,
  selfDefensiveLabelWords,
  statesSelfDefensiveLabel,
  TALENT_REDUCTION_FACT_LEGEND,
  TALENT_REDUCTION_FACT_LINE_NAMES,
} from "../src/utils/selfDefensiveMechanism";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

vi.mock("../src/utils/talentOwnership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/utils/talentOwnership")>()),
  talentModifierOwnershipOf: (
    unit: { info: { holds?: string[] } },
    talentSpellId: string,
  ) => (unit.info?.holds?.includes(talentSpellId) ? "yes" : "no"),
}));

const T0 = 1_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);
const FEINT = "1966";
const EVASION = "5277";
const ELUSIVENESS = "79008";

beforeAll(async () => {
  await ensureAnalysisData();
});

const rogue = (holds: string[]) =>
  makeUnit("e1", {
    name: "EnemyRogue",
    class: CombatUnitClass.Rogue,
    spec: CombatUnitSpec.Rogue_Assassination,
    reaction: CombatUnitReaction.Hostile,
    info: { talents: [], pvpTalents: [], holds } as never,
    spellCastEvents: [
      makeSpellCastEvent(FEINT, at(20), "e1", "EnemyRogue", "e1", "EnemyRogue"),
      makeSpellCastEvent(
        EVASION,
        at(40),
        "e1",
        "EnemyRogue",
        "e1",
        "EnemyRogue",
      ),
    ],
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        FEINT,
        at(20),
        "e1",
        "e1",
        "BUFF",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        FEINT,
        at(26),
        "e1",
        "e1",
        "BUFF",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        EVASION,
        at(40),
        "e1",
        "e1",
        "BUFF",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        EVASION,
        at(50),
        "e1",
        "e1",
        "BUFF",
      ),
    ],
  });
const eventsOf = (u: ReturnType<typeof rogue>) =>
  enemyDefensiveEvents(u, [u], {
    startTime: T0,
    endTime: at(120),
    units: { e1: u },
  } as never);

describe("T214 — Elusiveness: a holder's Feint is a fact line, its Evasion says the 20 % (rulings R52 / R56)", () => {
  it("a holder's Feint: one self-save line with the reduction form, 20 % for 6 s — and no reader's wall", () => {
    const u = rogue([ELUSIVENESS]);
    const feint = eventsOf(u).filter((d) => d.spellId === FEINT);
    expect(feint).toHaveLength(1);
    const d = feint[0]!;
    expect(d).toMatchObject({
      kind: "self-save",
      atSeconds: 20,
      mechanism: { kind: "reduction", pct: 20 },
    });
    expect(d.observedSeconds).toBeCloseTo(6);
    // no `defenseless` cut
    expect(ownWallSpanS(d, true)).toBeUndefined();
    expect(ownSaveSpanS(d, true)).toBeUndefined();
    // no KILL ATTEMPTS cause: its reader of self-saves does not list it
    expect(selfSaveCasts(u, T0).map((c) => c.spellId)).not.toContain(FEINT);
    // not a wall line for the gate that reads the spans back
    expect(ownWallLineNames().has("Feint")).toBe(false);
    expect([...TALENT_REDUCTION_FACT_LINE_IDS]).toEqual([FEINT]);
    expect(TALENT_REDUCTION_FACT_LINE_NAMES).toEqual(["Feint"]);
  });

  it("a non-holder's Feint prints no line", () => {
    expect(eventsOf(rogue([])).filter((d) => d.spellId === FEINT)).toEqual([]);
  });

  it("Evasion: `(dodge, 20% all damage)` for a holder, `(dodge)` without the talent", () => {
    const label = (holds: string[]) => {
      const d = eventsOf(rogue(holds)).find((x) => x.spellId === EVASION)!;
      expect(d.kind).toBe("self-save");
      return selfDefensiveLabelWords(d.mechanism!);
    };
    expect(label([ELUSIVENESS])).toBe("dodge, 20% all damage");
    expect(label([])).toBe("dodge");
    // Bait and Switch 457034 adds 15 % on MAGIC alone (20 % physical / 32 %
    // magic): what all damage loses is still 20 %, and with no Elusiveness
    // nothing is taken off every school (codex 85-tk-WIN-T214-2 #1)
    expect(label([ELUSIVENESS, "457034"])).toBe("dodge, 20% all damage");
    expect(label(["457034"])).toBe("dodge");
    // the gate's reader takes either form for the dodge, and nothing else
    for (const [text, ok] of [
      ["(dodge)", true],
      ["(dodge, 20% all damage)", true],
      ["(dodge, 20%)", false],
      ["(dodge, 8.0s)", false],
    ] as const)
      expect(statesSelfDefensiveLabel(text, { kind: "dodge" })).toBe(ok);
  });

  it("legends (R56): each prints only beside its own label, and the plain `(dodge)` sentence not beside the new one", () => {
    const feintLine =
      "0:20  [ENEMY DEF]   4(ARogue) (Assassination Rogue): Feint (20%, 6.0s)";
    const evasionLine =
      "0:40  [ENEMY DEF]   4(ARogue) (Assassination Rogue): Evasion (dodge, 20% all damage) (at 60% HP)";
    const plainLine =
      "0:40  [ENEMY DEF]   4(ARogue) (Assassination Rogue): Evasion (dodge) (at 60% HP)";
    expect(TALENT_REDUCTION_FACT_LEGEND).toBe(
      "`Feint (N%, Ts)` = NOT one of the walls: N% less non-area damage on the unit while it is up; kill windows and KILL ATTEMPTS do not count it;",
    );
    expect(DODGE_ALL_DAMAGE_LEGEND).toBe(
      "`(dodge, N% all damage)` = a dodge-chance buff that also takes N% off all damage on this unit (its Elusiveness talent) while it is up;",
    );
    expect(selfDefensiveLabelLegends([feintLine])).toEqual([
      TALENT_REDUCTION_FACT_LEGEND,
    ]);
    expect(selfDefensiveLabelLegends([evasionLine])).toEqual([
      DODGE_ALL_DAMAGE_LEGEND,
    ]);
    const plain = selfDefensiveLabelLegends([plainLine]);
    expect(plain).toHaveLength(1);
    expect(plain[0]).toContain("`(dodge)` =");
    expect(carriesDodgeAllDamageLabel(plainLine)).toBe(false);
    // the gate: a legend with no line of its label
    expect(
      labelLegendsWithoutCarrier([evasionLine, `    ${plain[0]}`]),
    ).toEqual(plain);
    expect(
      labelLegendsWithoutCarrier([
        evasionLine,
        `    ${DODGE_ALL_DAMAGE_LEGEND}`,
        feintLine,
        `    ${TALENT_REDUCTION_FACT_LEGEND}`,
      ]),
    ).toEqual([]);
  });
});
