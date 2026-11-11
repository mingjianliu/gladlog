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

import { buildPlayerLoadout } from "../src/context/resourceSnapshot";
import { ensureAnalysisData } from "../src/data/ensure";
import { MITIGATION_TABLE } from "../src/data/mitigationData";
import {
  MITIGATION_VERDICTS,
  mitigationVerdictOf,
} from "../src/data/mitigationVerdicts";
import { spellEffectData } from "../src/data/spellEffectData";
import type { IMajorCooldownInfo } from "../src/utils/cooldowns";
import type { IEnemyCDTimeline } from "../src/utils/enemyCDs";
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
});
