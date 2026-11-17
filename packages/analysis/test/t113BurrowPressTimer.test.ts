/**
 * Pipeline T113, batch review 80-PIPE-110-B97: the kill windows' press timer
 * (`kwTimedPressLengthS`) held a Burrow for its official 5 s while the
 * aura's own span readers ended it at the holder's first action. Burrow
 * pressed at 20 s, a Healing Surge bar begun at 22 s, no REMOVED, no hit,
 * the kit's other defensive spent: the window opened at 25 s, not 22.
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { aurasActiveAt } from "../src/analysis/momentSnapshot";
import { ensureAnalysisData } from "../src/data/ensure";
import { buildAuraIntervals } from "../src/utils/auraIntervals";
import { castBlockingAuraAt } from "../src/utils/cannotCastIntervals";
import { castingLockIntervalsOf } from "../src/utils/castingLocks";
import { ccAvoidanceBuffsUpAt } from "../src/utils/ccTrinketAnalysis";
import {
  stealthImmunityPressActionEndS,
  withStealthActionEnds,
} from "../src/utils/enemyDefensives";
import { computeOffensiveWindowsUncached } from "../src/utils/offensiveWindows";
import { visionObscuringWindows } from "../src/utils/visionObscured";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);
const BURROW = "409293";

beforeAll(async () => {
  await ensureAnalysisData();
});

const shaman = (barAtS: number | null) => {
  const u = makeUnit("e1", {
    name: "EnemyShaman",
    class: CombatUnitClass.Shaman,
    spec: CombatUnitSpec.Shaman_Enhancement,
    reaction: CombatUnitReaction.Hostile,
    info: { talents: [], pvpTalents: [] } as never,
    spellCastEvents: [
      // Astral Shift: the kit's other defensive, spent
      makeSpellCastEvent(
        "108271",
        at(2),
        "e1",
        "EnemyShaman",
        "e1",
        "EnemyShaman",
      ),
      makeSpellCastEvent(
        BURROW,
        at(20),
        "e1",
        "EnemyShaman",
        "e1",
        "EnemyShaman",
      ),
    ],
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        BURROW,
        at(20),
        "e1",
        "e1",
        "BUFF",
      ),
    ],
  });
  Object.assign(u, {
    castStartEvents:
      barAtS === null
        ? []
        : [
            {
              spellId: "8004",
              spellName: "Healing Surge",
              timestamp: at(barAtS),
              srcUnitId: "e1",
              logLine: { event: "SPELL_CAST_START", timestamp: at(barAtS) },
            },
          ],
    damageIn: [],
  });
  return u;
};
const combatOf = (u: ReturnType<typeof shaman>) =>
  ({ startTime: T0, endTime: at(120), units: { e1: u } }) as never;
const startsOf = (u: ReturnType<typeof shaman>) =>
  computeOffensiveWindowsUncached([u] as never, [], combatOf(u)).map(
    (w) => w.fromSeconds,
  );

describe("T113 — a timed Burrow press ends at its holder's action (B97)", () => {
  it("the shared reading: 22 s", () => {
    const u = shaman(22);
    expect(
      stealthImmunityPressActionEndS(u, combatOf(u), 20, "409293"),
    ).toBeCloseTo(22);
  });
  it("the window opens at 22 s, not at the 5 s official length (25 s)", () => {
    const s = startsOf(shaman(22));
    expect(s.some((f) => Math.abs(f - 22) < 0.01)).toBe(true);
    expect(s.some((f) => Math.abs(f - 25) < 0.01)).toBe(false);
  });
  it("no action inside it: the official length stands", () => {
    const u = shaman(null);
    expect(
      stealthImmunityPressActionEndS(u, combatOf(u), 20, "409293"),
    ).toBeUndefined();
    expect(startsOf(u).some((f) => Math.abs(f - 25) < 0.01)).toBe(true);
  });
  it("acting before its own cast row (bar 20.005 s, row 20.010 s): the press holds nothing and the unit is not protected for the rest of the round", () => {
    const u = shaman(20.005);
    const press = u.spellCastEvents.find((c) => c.spellId === BURROW)!;
    Object.assign(press, { timestamp: at(20.01) });
    Object.assign(press.logLine, { timestamp: at(20.01) });
    const s = startsOf(u);
    expect(s.some((f) => f >= 20 && f < 20.1)).toBe(true);
  });
  it("another press a second away (Greater Invisibility 110959) is not the Burrow's: undefined (D6 keeps its official length)", () => {
    const u = shaman(22);
    expect(
      stealthImmunityPressActionEndS(u, combatOf(u), 20, "110959"),
    ).toBeUndefined();
    expect(
      stealthImmunityPressActionEndS(u, combatOf(u), 21, "110959"),
    ).toBeUndefined();
  });
});

describe("T113 — every reader of the Burrow ends it at the shaman's action (B97 reader list)", () => {
  const u = shaman(22);
  const combat = combatOf(u);
  it("the shared interval reading", () => {
    const iv = withStealthActionEnds(
      u,
      buildAuraIntervals(u, combat),
      combat,
    ).find((x) => x.spellId === BURROW)!;
    expect(iv.toS).toBeCloseTo(22);
  });
  it("the moment snapshot does not list it at 23 s", () => {
    expect(aurasActiveAt(u, combat, 21)).toContain(BURROW);
    expect(aurasActiveAt(u, combat, 23)).not.toContain(BURROW);
  });
  it("the casting lock ends at 22 s", () => {
    const lock = castingLockIntervalsOf(u, combat).find(
      (l) => l.spellId === BURROW,
    );
    expect(lock?.to).toBe(at(22));
  });
  it("the CC-avoidance reading drops it at 23 s", () => {
    const ids = (ms: number) =>
      ccAvoidanceBuffsUpAt(u, ms).map((b) => b.spellId);
    expect(ids(at(21))).toContain(BURROW);
    expect(ids(at(23))).not.toContain(BURROW);
  });
  it("the CC-avoidance reading also ends it at an opener debuff with no cast row (codex 85-tk-N-T113-4: Hex on another unit at 22 s)", () => {
    const h = shaman(null);
    const victim = makeUnit("p1", {
      name: "Victim",
      reaction: CombatUnitReaction.Friendly,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "51514",
          at(22),
          "e1",
          "p1",
          "DEBUFF",
        ),
      ],
    });
    const ids = (ms: number, units?: never[]) =>
      ccAvoidanceBuffsUpAt(h, ms, units ? { units } : {}).map((b) => b.spellId);
    const units = [h, victim] as never[];
    expect(ids(at(21), units)).toContain(BURROW);
    expect(ids(at(23), units)).not.toContain(BURROW);
  });
  it("the vision window ends at 22 s", () => {
    const w = visionObscuringWindows(combat).find(
      (x) => x.onUnit && x.holderId === "e1",
    );
    expect(w?.toS).toBeCloseTo(22);
  });
});

describe("T113 — batch review 80-PIPE-111-B98", () => {
  it("#1 the interrupt-readiness reader (castBlockingAuraAt) ends the Burrow at an opener debuff with no cast row (Hex on another unit at 22 s): no lock at 23 s", () => {
    const h = shaman(null);
    const victim = makeUnit("p1", {
      name: "Victim",
      reaction: CombatUnitReaction.Friendly,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "51514",
          at(22),
          "e1",
          "p1",
          "DEBUFF",
        ),
      ],
    });
    const units = [h, victim] as never[];
    const blocker = (ms: number) =>
      castBlockingAuraAt(h, new Set(["p1"]), ms, "57994", units)?.spellId;
    expect(blocker(at(21))).toBe(BURROW);
    expect(blocker(at(23))).toBeUndefined();
  });

  /** Burrow APPLIED at 20.000, a Healing Surge START in the same ms logged
   * below (`below`) or above it, the Burrow's SUCCESS row at 20.010 */
  const sameMs = (below: boolean) => {
    const u = shaman(20);
    const applied = u.auraEvents.find((a) => a.spellId === BURROW)!;
    const press = u.spellCastEvents.find((c) => c.spellId === BURROW)!;
    Object.assign(press, { timestamp: at(20.01) });
    Object.assign(press.logLine, { timestamp: at(20.01) });
    const bar = (u as unknown as { castStartEvents: { logLine: object }[] })
      .castStartEvents[0]!;
    Object.assign(bar.logLine, {
      lineIndex: applied.logLine.lineIndex! + (below ? 1 : -1),
    });
    return u;
  };
  it("#2 an action in the APPLIED's millisecond logged below it ends the Burrow there: a zero-length press, the window opens at 20.010 s, not 25.010 s", () => {
    const s = startsOf(sameMs(true));
    expect(s.some((f) => Math.abs(f - 20.01) < 0.01)).toBe(true);
    expect(s.some((f) => Math.abs(f - 25.01) < 0.01)).toBe(false);
  });
  it("#2 the same action logged above the APPLIED came before it: the official length stands (25.010 s)", () => {
    const s = startsOf(sameMs(false));
    expect(s.some((f) => Math.abs(f - 25.01) < 0.01)).toBe(true);
  });
});
