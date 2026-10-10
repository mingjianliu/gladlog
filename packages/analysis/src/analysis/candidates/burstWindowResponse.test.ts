/**
 * `slow-defensive-response` producer (GH #60 phase 2). Pure function, decision
 * points injected — the engine's own predicates are pinned in
 * `analysis/burstWindowDecisionPoints.test.ts`; what is pinned here is only
 * the selection, the cap, the emitted order and the rendered facts.
 */
import { describe, expect, it } from "vitest";

import type { BurstWindowPriorRef } from "../../data/burstWindowPrior";
import { BURST_REF_MIN_CONTRAST_PP } from "../../data/burstWindowPrior";
import type { BurstWindowDecisionPoint } from "../burstWindowDecisionPoints";
import { burstWindowResponseEvents } from "./burstWindowResponse";

const owner = { id: "h1", name: "Me-R" };

const REF: BurstWindowPriorRef = {
  cellKey: "3v3|360194",
  fellBack: false,
  nResp: 1902,
  deathRespPct: 9,
  nNoResp: 632,
  deathNoRespPct: 23,
  topResponses: [
    ["control", 41],
    ["wall", 22],
  ],
};
const probes = (ref: BurstWindowPriorRef | null = REF) => ({
  lookup: () => ref,
});

const point = (
  over: Partial<BurstWindowDecisionPoint> = {},
): BurstWindowDecisionPoint =>
  ({
    tMs: 0,
    tSec: 40,
    endSec: 55,
    durationSec: 15,
    leadCd: {
      spellId: "360194",
      spellName: "Deathmark",
      casterName: "Rogue-R",
      casterSpec: "Assassination Rogue",
      castSec: 40,
    },
    extraCds: [],
    casterIds: ["e1"],
    pressured: {
      unitId: "f2",
      name: "Mate-R",
      minHpPct: 31,
      minHpSec: 45,
      startHpPct: 92,
      startHpSec: 40,
      died: false,
    },
    responses: {
      wall: false,
      external: false,
      healCd: false,
      control: false,
      kite: false,
    },
    responded: false,
    firstResponseSec: null,
    responseCasts: [],
    feasible: true,
    feasibleUnits: ["Me-R"],
    triaged: true,
    anyFriendlyDeath: false,
    deathsInWindow: 0,
    minFriendlyHpPct: 31,
    friendlyOutcomes: [],
    ...over,
  }) as BurstWindowDecisionPoint;

describe("burstWindowResponseEvents — which windows reach the menu", () => {
  it("a feasible, triaged, unanswered window fires", () => {
    expect(burstWindowResponseEvents([point()], owner, probes())).toHaveLength(
      1,
    );
  });

  it("an ANSWERED window never fires — the team did something", () => {
    expect(
      burstWindowResponseEvents([point({ responded: true })], owner, probes()),
    ).toEqual([]);
  });

  it("an INFEASIBLE window never fires — nobody is accused of not being psychic", () => {
    expect(
      burstWindowResponseEvents([point({ feasible: false })], owner, probes()),
    ).toEqual([]);
  });

  it("an UNTRIAGED window never fires — the burst went nowhere", () => {
    expect(
      burstWindowResponseEvents([point({ triaged: false })], owner, probes()),
    ).toEqual([]);
  });

  it("a window shorter than the 8 s it is judged over never fires", () => {
    expect(
      burstWindowResponseEvents(
        [point({ endSec: 45, durationSec: 5 })],
        owner,
        probes(),
      ),
    ).toEqual([]);
  });

  it("no reference cell → no accusation", () => {
    expect(burstWindowResponseEvents([point()], owner, probes(null))).toEqual(
      [],
    );
  });

  // ── minimum-contrast door (approved tightener, 2026-09-01) ──────────────

  it("a cell whose contrast is under the door never fires — the quoted numbers would argue against the sentence", () => {
    const flat: BurstWindowPriorRef = {
      ...REF,
      deathRespPct: 5,
      deathNoRespPct: 5 + BURST_REF_MIN_CONTRAST_PP - 1,
    };
    expect(burstWindowResponseEvents([point()], owner, probes(flat))).toEqual(
      [],
    );
  });

  it("a REVERSED cell never fires either", () => {
    const reversed: BurstWindowPriorRef = {
      ...REF,
      deathRespPct: 3,
      deathNoRespPct: 2,
    };
    expect(
      burstWindowResponseEvents([point()], owner, probes(reversed)),
    ).toEqual([]);
  });

  it("exactly at the door it fires — the floor is inclusive", () => {
    const edge: BurstWindowPriorRef = {
      ...REF,
      deathRespPct: 5,
      deathNoRespPct: 5 + BURST_REF_MIN_CONTRAST_PP,
    };
    expect(
      burstWindowResponseEvents([point()], owner, probes(edge)),
    ).toHaveLength(1);
  });

  it("a door-failing window does not eat one of the two cap slots", () => {
    const flat: BurstWindowPriorRef = {
      ...REF,
      deathRespPct: 5,
      deathNoRespPct: 5,
    };
    const p = (tSec: number, leadCdId: string) =>
      point({ tSec, leadCd: { ...point().leadCd, spellId: leadCdId } });
    const evts = burstWindowResponseEvents(
      // the two most dangerous windows are the ones with the flat cell; a
      // post-cap door would return nothing at all here
      [p(10, "flat"), p(20, "flat"), p(30, "good")],
      owner,
      { lookup: (id) => (id === "flat" ? flat : REF) },
    );
    expect(evts.map((e) => e.t)).toEqual([30]);
  });
});

describe("burstWindowResponseEvents — cap and order", () => {
  const p = (tSec: number, hp: number, died = false) =>
    point({
      tSec,
      pressured: {
        unitId: "f2",
        name: "Mate-R",
        minHpPct: hp,
        minHpSec: tSec + 2,
        startHpPct: 100,
        startHpSec: tSec,
        died,
      },
      anyFriendlyDeath: died,
      minFriendlyHpPct: hp,
    });

  it("selects by danger (death first, then the deepest dip) but emits in TIME order", () => {
    const evts = burstWindowResponseEvents(
      [p(10, 12), p(30, 38, true), p(50, 25)],
      owner,
      probes(),
    );
    // the 38%-but-died window and the 12% window survive the cap of 2;
    // the 25% one is dropped, and the two survivors come out 10 then 30
    expect(evts.map((e) => e.t)).toEqual([10, 30]);
  });

  it("honours the cap override", () => {
    expect(
      burstWindowResponseEvents([p(10, 12), p(30, 20)], owner, probes(), {
        cap: 1,
      }),
    ).toHaveLength(1);
  });
});

describe("burstWindowResponseEvents — the rendered facts", () => {
  it("renders the window, the pressured friendly and the corpus reference", () => {
    const evts = burstWindowResponseEvents(
      [
        point({
          extraCds: [
            {
              spellId: "1719",
              spellName: "Recklessness",
              casterName: "Warr-R",
              casterSpec: "Arms Warrior",
              castSec: 42,
            },
            {
              // 21 s later — a different exchange, must not be listed
              spellId: "13750",
              spellName: "Adrenaline Rush",
              casterName: "Rogue-R",
              casterSpec: "Assassination Rogue",
              castSec: 61,
            },
          ],
        }),
      ],
      owner,
      probes(),
    );
    expect(evts[0]!.facts).toEqual({
      t: "40",
      leadCd: "Deathmark",
      leadCdId: "360194",
      casterSpec: "Assassination Rogue",
      caster: "Rogue-R",
      extras: "Recklessness 2s later",
      pressured: "Mate-R",
      pressuredHpPct: "31",
      pressuredHpT: "45",
      diedInWindow: "no",
      refN: "2534",
      refDeathResp: "9",
      refDeathNoResp: "23",
      refTop: "control 41%; wall 22%",
      cellKey: "3v3|360194",
      fellBack: "no",
    });
    expect(evts[0]!.id).toBe("slow-defensive-response:h1:40");
    expect(evts[0]!.spellId).toBe("360194");
  });

  // FT-T03 (user ruling 2026-10-10, D7): "fell to N% inside the window" is
  // a trough — the engine's true-minimum pair — while which windows are
  // listed, and in what order, still reads the grid pair.
  it("FT-T03: `pressuredHpPct` / `pressuredHpT` are the engine's trough pair; the order under the cap is still the grid minimum's", () => {
    const withTrough = (
      tSec: number,
      minHpPct: number,
      troughHpPct: number,
      troughHpSec: number,
    ) =>
      point({
        tSec,
        endSec: tSec + 15,
        pressured: {
          ...point().pressured!,
          minHpPct,
          minHpSec: tSec + 5,
          troughHpPct,
          troughHpSec,
        },
      });
    const one = burstWindowResponseEvents(
      [withTrough(40, 31, 8, 43)],
      owner,
      probes(),
    );
    expect(one[0]!.facts.pressuredHpPct).toBe("8");
    expect(one[0]!.facts.pressuredHpT).toBe("43");
    // cap 1: the window with the lower GRID minimum is the one kept, although
    // the other one's trough is lower
    const kept = burstWindowResponseEvents(
      [withTrough(40, 31, 5, 43), withTrough(80, 20, 18, 84)],
      owner,
      probes(),
      { cap: 1 },
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]!.t).toBe(80);
    expect(kept[0]!.facts.pressuredHpPct).toBe("18");
    // a hand-built point without the trough pair: the grid pair stands in
    const plain = burstWindowResponseEvents([point()], owner, probes());
    expect(plain[0]!.facts.pressuredHpPct).toBe("31");
    expect(plain[0]!.facts.pressuredHpT).toBe("45");
  });

  it("`t` and `pressuredHpT` are whole rendered seconds (render-grid rule)", () => {
    const evts = burstWindowResponseEvents([point()], owner, probes());
    for (const key of ["t", "pressuredHpT"]) {
      const v = evts[0]!.facts[key]!;
      expect(Number(v)).toBe(Math.floor(Number(v)));
    }
  });

  it("a death in the window is reported as a fact", () => {
    const evts = burstWindowResponseEvents(
      [point({ anyFriendlyDeath: true, deathsInWindow: 1 })],
      owner,
      probes(),
    );
    expect(evts[0]!.facts["diedInWindow"]).toBe("yes");
  });
});

// triage 2026-09-29 S1 (e10c6bea @156: Blessing of Sacrifice rejected
// "stunned" ×2 at 162.551 / 162.693; two more at 164.259 / 164.401 fall
// after the judged window [154.5, 164.0])
describe("burstWindowResponseEvents — facts.attempted (S1)", () => {
  const fail = (tSeconds: number) => ({
    tSeconds,
    unitGuid: "h1",
    spellId: 6940,
    spellName: "Blessing of Sacrifice",
    reason: "无法在昏迷时那样做",
  });
  const attempts = {
    rawStreams: {
      available: true,
      manaSamples: [],
      castFailed: [fail(162.551), fail(162.693), fail(164.259), fail(164.401)],
    },
    ownerId: "h1",
    tools: [{ spellId: "6940", casts: [] }],
  };
  it("counts only the rejects inside [tSec − 1.5 s, tSec + 8 s]", () => {
    const [e] = burstWindowResponseEvents(
      [point({ tSec: 156 })],
      owner,
      probes(),
      undefined,
      attempts,
    );
    expect(e!.facts!.attempted).toBe("pressed but rejected (无法在昏迷时那样做×2)");
  });
  it("no rejects, or no raw streams → no fact", () => {
    expect(
      burstWindowResponseEvents([point({ tSec: 156 })], owner, probes())[0]!
        .facts!.attempted,
    ).toBeUndefined();
    expect(
      burstWindowResponseEvents(
        [point({ tSec: 120 })],
        owner,
        probes(),
        undefined,
        attempts,
      )[0]!.facts!.attempted,
    ).toBeUndefined();
  });
});
