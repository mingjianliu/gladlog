import {
  type AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitSpec,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { makeSpellCastEvent, makeUnit } from "../../test/ported/testHelpers";
import { ensureAnalysisData } from "../data/ensure";
import {
  buildDpsKillWindowLines,
  createKillWindowFactsComputer,
  killWindowAcquittal,
  killWindowFactsSuffix,
} from "./killWindowFacts";

beforeAll(async () => {
  await ensureAnalysisData();
});

const facts = (over: Record<string, unknown> = {}) => ({
  readyOffCds: ["Avenging Wrath"],
  reachable: true as boolean | null,
  healerLocked: false,
  accountable: true,
  ...over,
});

describe("killWindowFacts (GH #31 ①)", () => {
  it("suffix: ready list + healer state; unreachable only when positions disproved it", () => {
    expect(killWindowFactsSuffix(facts({ healerLocked: true }))).toBe(
      "team offensive CDs ready: Avenging Wrath; enemy healer hard-CC'd in window",
    );
    expect(killWindowFactsSuffix(facts({ readyOffCds: [] }))).toBe(
      "no team offensive CD ready",
    );
    // fail-open: null reachability renders NOTHING about reach
    expect(killWindowFactsSuffix(facts({ reachable: null }))).not.toContain(
      "unreachable",
    );
    expect(killWindowFactsSuffix(facts({ reachable: false }))).toContain(
      "target unreachable (positions recorded)",
    );
  });

  it("acquittal names every failed gate", () => {
    expect(
      killWindowAcquittal(facts({ readyOffCds: [], reachable: false })),
    ).toBe("no offensive CD was ready and target unreachable");
  });

  it("DPS lines: burst spans render [KILL WINDOW] facts (never gated); unpunished spans gate the accusation", () => {
    const enemies = [{ id: "e1", name: "Edk" }] as never[];
    const mk = (f: ReturnType<typeof facts>) => ({
      facts: () => f,
    });
    const win = {
      targetUnitId: "e1",
      targetName: "Edk",
      targetSpec: "Frost Death Knight",
      fromSeconds: 40,
      toSeconds: 100,
      friendlyDamageInWindow: 8_000,
      bursts: [] as Array<{
        fromSeconds: number;
        toSeconds: number;
        damage: number;
      }>,
    };
    // accountable unpunished span → accusation stands
    const accused = buildDpsKillWindowLines([win], enemies, mk(facts()));
    expect(accused[0]).toContain("[VULNERABLE]");
    expect(accused[0]).toContain("never punished");
    // gate fails → acquitted state, reason named
    const acquitted = buildDpsKillWindowLines(
      [win],
      enemies,
      mk(facts({ readyOffCds: [], accountable: false })),
    );
    expect(acquitted[0]).toContain(
      "not punished — not accountable (no offensive CD was ready)",
    );
    // burst present → [KILL WINDOW] fact line even when NOT accountable
    // (value-gate smoke 2026-09-02: killable=no bursts still killed — the
    // burst itself is the capability evidence, facts are never a gate here)
    const burstWin = {
      ...win,
      bursts: [{ fromSeconds: 50, toSeconds: 55, damage: 900_000 }],
    };
    const killLines = buildDpsKillWindowLines(
      [burstWin],
      enemies,
      mk(facts({ readyOffCds: [], accountable: false })),
    );
    expect(killLines[0]).toContain("[KILL WINDOW] 0:50–0:55");
    expect(killLines[0]).toContain("team burst 900k");
    expect(killLines[0]).toContain("no team offensive CD ready");
  });
});

// Triage 2026-09-29, group G4: sync-burst F-KW1 + res-readiness F-C8 / F-C9
// (ruling A46) / F-C12 — one grammar for the readiness clause.
describe("kill-window readiness grammar", () => {
  it("names the sampled second; `none` is none AT that second, with what changed inside", () => {
    expect(
      killWindowFactsSuffix(
        facts({
          readyOffCds: [],
          accountable: false,
          readyAtSecond: 207,
          maybeOffCds: [{ name: "Adrenaline Rush", withinSeconds: 144 }],
          pressedInside: [{ name: "Adrenaline Rush", atSeconds: 221.617 }],
        }),
      ),
    ).toBe(
      "team offensive CDs ready at 3:27: none (may already be back: Adrenaline Rush ≤144s; pressed inside: Adrenaline Rush 3:41)",
    );
  });

  it("clause order is fixed: maybe, pressed at start, back inside, pressed inside; empty clauses are left out", () => {
    const all = killWindowFactsSuffix(
      facts({
        readyOffCds: ["Avatar"],
        readyAtSecond: 243,
        maybeOffCds: [{ name: "Recklessness", withinSeconds: 54 }],
        pressedAtStart: [{ name: "Bestial Wrath", atSeconds: 243.34 }],
        backInside: [{ name: "Kingsbane", atSeconds: 249 }],
        pressedInside: [
          { name: "Avenging Wrath", atSeconds: 250.2 },
          { name: "Invoke Xuen, the White Tiger", atSeconds: 251 },
        ],
        healerLocked: true,
      }),
    );
    expect(all).toBe(
      "team offensive CDs ready at 4:03: Avatar (may already be back: Recklessness ≤54s; pressed at start: Bestial Wrath 4:03; back inside: Kingsbane 4:09; pressed inside: Avenging Wrath 4:10、Invoke Xuen, the White Tiger 4:11); enemy healer hard-CC'd in window",
    );
    expect(
      killWindowFactsSuffix(facts({ readyOffCds: [], readyAtSecond: 83 })),
    ).toBe("team offensive CDs ready at 1:23: none");
  });

  it("the acquittal does not state certain unavailability for a maybe-ready cooldown (GH #106 step 3)", () => {
    expect(
      killWindowAcquittal(
        facts({
          readyOffCds: [],
          accountable: false,
          readyAtSecond: 380,
          maybeOffCds: [{ name: "Adrenaline Rush", withinSeconds: 107 }],
        }),
      ),
    ).toBe(
      "no offensive CD certainly ready (may already be back: Adrenaline Rush ≤107s)",
    );
    expect(
      killWindowAcquittal(
        facts({ readyOffCds: [], accountable: false, readyAtSecond: 380 }),
      ),
    ).toBe("no offensive CD was ready");
  });

  describe("facts() on real cooldown data", () => {
    const START = 1_000_000;
    const SMASH = "167105"; // Colossus Smash, 45 s
    const warrior = (castSeconds: number[]) =>
      makeUnit("P1", {
        class: CombatUnitClass.Warrior,
        spec: CombatUnitSpec.Warrior_Arms,
        spellCastEvents: castSeconds.map((s) =>
          makeSpellCastEvent(
            SMASH,
            START + s * 1000,
            "E1",
            "Enemy",
            "P1",
            "P1",
            0,
            "Colossus Smash",
          ),
        ),
      });
    const target = makeUnit("E1");
    const factsFor = (castSeconds: number[], from: number, to: number) => {
      const f = warrior(castSeconds);
      return createKillWindowFactsComputer(
        {
          startTime: START,
          endTime: START + 300_000,
          units: { P1: f, E1: target },
        } as unknown as AtomicArenaCombat,
        [f],
        [target],
      ).facts(target, from, to);
    };

    it("A46: readiness is sampled at the start's rendered second — a press earlier in that second is spent and named `pressed at start`", () => {
      // pressed 48.548, span starts 48.731 → sampled at 0:48
      const f = factsFor([48.548], 48.731, 60);
      expect(f.readyAtSecond).toBe(48);
      expect(f.readyOffCds).not.toContain("Colossus Smash");
      expect(f.pressedAtStart).toEqual([
        { name: "Colossus Smash", atSeconds: 48.548 },
      ]);
      expect(f.pressedInside).toEqual([]);
    });

    it("F-KW1: a cooldown coming back inside the span is named at its first whole second, and later presses as `pressed inside`", () => {
      // pressed at 10 → back at 55; pressed again at 57.3
      const f = factsFor([10, 57.3], 48.731, 60);
      expect(f.readyOffCds).not.toContain("Colossus Smash");
      expect(f.backInside).toEqual([{ name: "Colossus Smash", atSeconds: 55 }]);
      expect(f.pressedInside).toEqual([
        { name: "Colossus Smash", atSeconds: 57.3 },
      ]);
      expect(f.pressedAtStart).toEqual([]);
    });

    it("a cooldown ready at the sampled second is in the certain list and has no `back inside`", () => {
      const f = factsFor([1], 48.731, 60);
      expect(f.readyOffCds).toContain("Colossus Smash");
      expect(f.backInside!.map((b) => b.name)).not.toContain("Colossus Smash");
      expect(f.accountable).toBe(true);
    });
  });
});

// Triage position F-K1 (ruling A61 = A, 2026-09-30): "target unreachable"
// rested on one instant at the span start.
describe("kill-window reach over the span", () => {
  const START = 1_000_000;
  /** positions every 0.5 s for 200 s, x from `xAt(seconds)`, y = 0 */
  const positions = (xAt: (s: number) => number) =>
    Array.from({ length: 401 }, (_, i) => ({
      timestamp: START + i * 500,
      logLine: { timestamp: START + i * 500 },
      advancedActorPositionX: xAt(i / 2),
      advancedActorPositionY: 0,
    }));
  const unit = (
    id: string,
    xAt: ((s: number) => number) | null,
    extra: Parameters<typeof makeUnit>[1] = {},
  ) =>
    makeUnit(id, {
      class: CombatUnitClass.Mage,
      spec: CombatUnitSpec.Mage_Frost,
      advancedActions: xAt ? positions(xAt) : [],
      ...extra,
    });
  const reach = (friends: ReturnType<typeof unit>[], from = 94.4, to = 110) => {
    const target = unit("E1", () => 0);
    return createKillWindowFactsComputer(
      {
        startTime: START,
        endTime: START + 300_000,
        units: Object.fromEntries([...friends, target].map((u) => [u.id, u])),
      } as unknown as AtomicArenaCombat,
      friends,
      [target],
    ).facts(target, from, to).reachable;
  };

  it("539fef93's shape: out of reach at the span start, in reach three seconds later → reachable", () => {
    // 60 yd away until 97 s, then 3 yd
    expect(reach([unit("P1", (s) => (s < 97 ? 60 : 3))])).toBe(true);
  });

  it("out of reach on every second of the span → unreachable", () => {
    expect(reach([unit("P1", () => 60)])).toBe(false);
  });

  it("a dead friendly is not sampled: the corpse in range does not make the target reachable", () => {
    const corpse = unit("P1", () => 3, {
      deathRecords: [{ timestamp: START + 90_000 }],
    });
    const far = unit("P2", () => 60);
    expect(reach([corpse, far])).toBe(false);
    // alive for the first seconds of the span and in range then → reachable
    const diesInside = unit("P1", () => 3, {
      deathRecords: [{ timestamp: START + 96_500 }],
    });
    expect(reach([diesInside, far])).toBe(true);
  });

  it("no recorded position on any second → null (fail open, nothing rendered)", () => {
    expect(reach([unit("P1", null)])).toBeNull();
  });
});
