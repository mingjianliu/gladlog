/**
 * T61 (user ruling R25, 2026-11-11): Ice Cold 414658 — Ice Block under the
 * talent 414659: 6 s, 70 % of all damage, no immunity — is a wall with its
 * own table row and a signed `unconditional` verdict, and its holder's kit
 * prints its own name and length on the Ice Block row.
 */
import {
  CombatUnitClass,
  CombatUnitSpec,
  type ICombatUnit,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { cdHoardedEvents } from "../src/analysis/candidates/cooldownTiming";
import {
  buildPlayerLoadout,
  computeOnCDDisplayNames,
  computeReadyNames,
} from "../src/context/resourceSnapshot";
import { ensureAnalysisData } from "../src/data/ensure";
import { MITIGATION_TABLE } from "../src/data/mitigationData";
import {
  MITIGATION_VERDICTS,
  mitigationVerdictOf,
} from "../src/data/mitigationVerdicts";
import { spellEffectData } from "../src/data/spellEffectData";
import {
  type IMajorCooldownInfo,
  kitSpellIdOf,
  kitSpellNameOf,
} from "../src/utils/cooldowns";
import type { IEnemyCDTimeline } from "../src/utils/enemyCDs";
import { unpressedWallsOwned } from "../src/utils/killWindowTargetSelection";
import { unusedKitRows } from "../src/utils/unusedKitRows";
import { makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

// Ice Block (class node 62122 / entry 80181) and, for a holder, Ice Cold
// (class node 62085 / entry 80141) — the fixture of talentReplaces.test.ts
const mage = (iceCold: boolean): ICombatUnit =>
  makeUnit("p1", {
    name: "Mage",
    class: CombatUnitClass.Mage,
    spec: CombatUnitSpec.Mage_Frost,
    info: {
      talents: [
        { id1: 62122, id2: 80181, count: 1 },
        ...(iceCold ? [{ id1: 62085, id2: 80141, count: 1 }] : []),
      ],
      pvpTalents: [],
    } as never,
  });

const iceBlock = {
  spellId: "45438",
  spellName: "Ice Block",
  tag: "Defensive",
  cooldownSeconds: 240,
  maxChargesDetected: 1,
  neverUsed: false,
  casts: [{ timeSeconds: 10 }],
} as unknown as IMajorCooldownInfo;

const kit = (u: ICombatUnit) =>
  buildPlayerLoadout(u, "Frost Mage", [iceBlock], [], {
    players: [],
    alignedBurstWindows: [],
  } as unknown as IEnemyCDTimeline).text;

describe("T61 — Ice Cold", () => {
  it("the table row is 70 % of every school, no immunity, and its verdict is the signed one", () => {
    expect(MITIGATION_TABLE["414658"]).toEqual({ pct: 70, schoolMask: 0x7f });
    expect(mitigationVerdictOf("414658")).toBe("unconditional");
    expect(MITIGATION_VERDICTS["414658"]!.officialPct).toBe(70);
    expect(MITIGATION_VERDICTS["414658"]!.approved).toBe("2026-11-11 user");
  });

  it("its holder's kit names Ice Cold and its own 6 s on the Ice Block row", () => {
    expect(spellEffectData["414658"]?.durationSeconds).toBe(6);
    const text = kit(mage(true));
    expect(text).toContain("Ice Cold [240s, lasts 6s]");
    expect(text).not.toContain("Ice Block [");
  });

  it("a mage without the talent keeps Ice Block and its 10 s", () => {
    const text = kit(mage(false));
    expect(text).toContain("Ice Block [240s, lasts 10s]");
    expect(text).not.toContain("Ice Cold");
  });

  // codex 85-tk-G-T61-2: one identity for the row wherever its holder is
  // named or classified
  it("the row is Ice Cold 414658 for its holder and Ice Block for anyone else", () => {
    expect(kitSpellIdOf(iceBlock, mage(true))).toBe("414658");
    expect(kitSpellNameOf(iceBlock, mage(true))).toBe("Ice Cold");
    expect(kitSpellIdOf(iceBlock, mage(false))).toBe("45438");
    expect(kitSpellNameOf(iceBlock, mage(false))).toBe("Ice Block");
    expect(kitSpellNameOf(iceBlock)).toBe("Ice Block");
  });

  it("#1 never pressed, it is a wall in hand for the kill tier — the kit's [UNUSED] and the tier agree", () => {
    const T0 = 1_000_000;
    const combatOf = (u: ICombatUnit) =>
      ({ startTime: T0, endTime: T0 + 120_000, units: { [u.id]: u } }) as never;
    const holder = mage(true);
    expect(unusedKitRows(holder, combatOf(holder))).toContainEqual({
      spellId: "414658",
      name: "Ice Cold",
    });
    expect(unpressedWallsOwned(holder, combatOf(holder))).toEqual([
      { spellId: "414658", name: "Ice Cold" },
    ]);
    // Ice Block itself is an immunity, no 20–99 % wall
    const plain = mage(false);
    expect(unusedKitRows(plain, combatOf(plain))).toContainEqual({
      spellId: "45438",
      name: "Ice Block",
    });
    expect(unpressedWallsOwned(plain, combatOf(plain))).toEqual([]);
  });

  it("#2 [RES] names the button as the kit does, ready and on cooldown", () => {
    const deaths = (u: ICombatUnit) => ({
      matchStartMs: 1_000_000,
      ownerUnit: u,
      allUnits: [u],
    });
    const unused = { ...iceBlock, casts: [], neverUsed: true };
    expect(
      computeReadyNames(20, [unused], [], deaths(mage(true)) as never),
    ).toEqual(["Ice Cold"]);
    expect(
      computeReadyNames(20, [unused], [], deaths(mage(false)) as never),
    ).toEqual(["Ice Block"]);
    const pressed = { ...iceBlock, casts: [{ timeSeconds: 30 }] };
    const onCd = computeOnCDDisplayNames(
      31,
      [pressed as never],
      [],
      deaths(mage(true)) as never,
    );
    expect(onCd).toHaveLength(1);
    expect(onCd[0]).toMatch(/^Ice Cold/);
    // a teammate's row carries its label and the same name
    expect(
      computeReadyNames(
        20,
        [],
        [{ player: mage(true), cds: [unused], playerLabel: "2" } as never],
        deaths(makeUnit("o", { name: "Owner" })) as never,
      ),
    ).toEqual(["2:Ice Cold"]);
  });

  it("cd-hoarded names the button as the owner's kit does (codex 85-tk-G-T61-2b #2)", () => {
    const point = {
      tSec: 20,
      hpPct: 20,
      dmg2s: 0.3,
      attackers2s: 1,
      enemyBurst: false,
      inCC: false,
      dangerous: true,
    };
    const unused = { ...iceBlock, casts: [], neverUsed: true };
    const rows = (owner: ICombatUnit) =>
      cdHoardedEvents(
        [{ crisisUnit: owner, own: true, points: [point] }],
        [unused as never],
        owner,
      );
    const [cold] = rows(mage(true));
    expect(cold?.spell).toBe("Ice Cold");
    expect(cold?.facts?.readyCds).toBe("Ice Cold");
    // the ledger key stays the replaced button's
    expect(cold?.spellId).toBe("45438");
    const [block] = rows(mage(false));
    expect(block?.spell).toBe("Ice Block");
    expect(block?.facts?.readyCds).toBe("Ice Block");
  });
});
