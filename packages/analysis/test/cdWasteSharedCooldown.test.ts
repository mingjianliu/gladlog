/**
 * X1 (user ruling 2026-10-11) — one cd-waste row per cooldown, not per
 * button: two never-spent defensives of one DB2 charge pool
 * (`sharesChargePool`, the relation readiness reads) are named in ONE row.
 * fe1a9355: a Holy Paladin's menu carried `Blessing of Protection` and
 * `Blessing of Spellwarding` as two unused cooldowns (ChargeCategory 1392).
 */
import { describe, expect, it } from "vitest";

import { buildFindingsPrompt } from "../src/analysis/buildFindingsPrompt";
import {
  CD_WASTE_SHARED_COOLDOWN_NOTE,
  cdWasteEvents,
  cdWasteSpellFact,
  cdWasteSpellNames,
} from "../src/analysis/candidateFindings";
import { SHARED_CHARGE_CATEGORY } from "../src/data/sharedChargeGenerated";
import { sharesChargePool, spendsSharedChargeOf } from "../src/utils/cooldowns";
import { makeSpellCastEvent } from "./ported/testHelpers";

const me = { id: "Player-57-0DAA1122", name: "Bumbiing-Illidan-US" };
const cd = (spellId: string, spellName: string) => ({
  spellId,
  spellName,
  neverUsed: true,
  isThroughput: false,
});
const BOP = cd("1022", "Blessing of Protection");
const SW = cd("204018", "Blessing of Spellwarding");
const DS = cd("642", "Divine Shield");
const LOH = cd("471195", "Lay on Hands");

describe("sharesChargePool", () => {
  it("Blessing of Protection and Blessing of Spellwarding are one pool, either way round", () => {
    expect(sharesChargePool("1022", "204018")).toBe(true);
    expect(sharesChargePool("204018", "1022")).toBe(true);
  });

  it("a spell is not its own pool mate; spells of two pools, or of none, are not mates", () => {
    expect(sharesChargePool("1022", "1022")).toBe(false);
    expect(sharesChargePool("1022", "642")).toBe(false);
    // Ice Block's pool is another one
    expect(SHARED_CHARGE_CATEGORY["45438"]).toBeDefined();
    expect(sharesChargePool("1022", "45438")).toBe(false);
  });

  it("is the relation `spendsSharedChargeOf` answers with — on every pair of the table", () => {
    const ids = Object.keys(SHARED_CHARGE_CATEGORY);
    let mates = 0;
    for (const a of ids)
      for (const b of ids) {
        const press = makeSpellCastEvent(b, 1_000, "p1") as unknown as {
          spellId: string;
          logLine: { event: string };
        };
        expect(spendsSharedChargeOf(press, a)).toBe(sharesChargePool(a, b));
        if (sharesChargePool(a, b)) mates++;
      }
    expect(mates).toBeGreaterThan(0);
  });
});

describe("cdWasteSpellFact / cdWasteSpellNames", () => {
  it("one button is its name; the buttons of one cooldown are joined and marked", () => {
    expect(cdWasteSpellFact(["Divine Shield"])).toBe("Divine Shield");
    const shared = cdWasteSpellFact([BOP.spellName, SW.spellName]);
    expect(shared).toBe(
      `Blessing of Protection / Blessing of Spellwarding ${CD_WASTE_SHARED_COOLDOWN_NOTE}`,
    );
    expect(cdWasteSpellNames(shared)).toEqual({
      names: ["Blessing of Protection", "Blessing of Spellwarding"],
      shared: true,
    });
    expect(cdWasteSpellNames("Divine Shield")).toEqual({
      names: ["Divine Shield"],
      shared: false,
    });
    // two ids of one name are one button's name
    expect(cdWasteSpellFact(["Bladestorm", "Bladestorm"])).toBe("Bladestorm");
  });
});

describe("cd-waste — one row per shared cooldown (X1)", () => {
  it("fe1a9355 shape: neither blessing pressed → one row, the first one's id", () => {
    const rows = cdWasteEvents([BOP, SW], me, 40);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "cd-waste:Player-57-0DAA1122:1022",
      type: "cd-waste",
      spell: "Blessing of Protection",
      spellId: "1022",
      facts: {
        spell:
          "Blessing of Protection / Blessing of Spellwarding (one shared cooldown)",
        unit: me.name,
      },
    });
  });

  it("the group stands where its first member stood; nothing else moves", () => {
    expect(cdWasteEvents([DS, BOP, LOH, SW], me, 40).map((e) => e.id)).toEqual([
      "cd-waste:Player-57-0DAA1122:642",
      "cd-waste:Player-57-0DAA1122:1022",
      "cd-waste:Player-57-0DAA1122:471195",
    ]);
    // the ledger's order decides which id stays
    const [first] = cdWasteEvents([SW, BOP], me, 40);
    expect(first!.id).toBe("cd-waste:Player-57-0DAA1122:204018");
    expect(first!.facts.spell).toBe(
      "Blessing of Spellwarding / Blessing of Protection (one shared cooldown)",
    );
  });

  it("only one of the two in the ledger: a plain row", () => {
    const [e] = cdWasteEvents([DS, SW], me, 40).slice(1);
    expect(e!.facts.spell).toBe("Blessing of Spellwarding");
  });

  it("a button that does not reach the row brings no name into it", () => {
    // spec-baseline rows are cd-hoarded's (P-W6); a pressed pool mate spends
    // both (W2) — then neither is a row at all
    expect(
      cdWasteEvents([BOP, { ...SW, baselineOnly: true }], me, 40)[0]!.facts
        .spell,
    ).toBe("Blessing of Protection");
    expect(
      cdWasteEvents(
        [
          { ...BOP, sharedCasts: [{ timeSeconds: 75.6 }] as never[] },
          { ...SW, neverUsed: false },
        ],
        me,
        40,
      ),
    ).toEqual([]);
  });

  it("a rejected press of either button is a try at the cooldown", () => {
    const fail = (tSeconds: number, spellId: number) => ({
      tSeconds,
      unitGuid: me.id,
      spellId,
      spellName: "x",
      reason: "无法在放逐时那样做",
    });
    const rawStreams = {
      available: true,
      manaSamples: [],
      castFailed: [fail(50, 204018), fail(60, 1022), fail(61, 642)],
    };
    const [e] = cdWasteEvents([BOP, SW], me, 40, { rawStreams, untilS: 120 });
    expect(e!.facts.attempted).toBe(
      "pressed but rejected (under crowd control×2)",
    );
  });

  it("the legend says what the joined names are — only beside a row that has them", () => {
    const legendOf = (cds: (typeof BOP)[]) =>
      buildFindingsPrompt(cdWasteEvents(cds, me, 40), "", "Holy Paladin")
        .split("\n")
        .find((l) => l.startsWith('- "cd-waste":'))!;
    expect(legendOf([BOP, SW])).toContain(
      `ends "${CD_WASTE_SHARED_COOLDOWN_NOTE}", they are the buttons of ONE cooldown`,
    );
    expect(legendOf([BOP])).not.toContain("ONE cooldown");
  });
});
