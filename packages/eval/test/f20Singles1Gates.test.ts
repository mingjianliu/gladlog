/**
 * F20 singles1 (fact6, 2026-10-28) gates: each fails on the rendered shape
 * the fact6 audit found and passes on the fixed one.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { beforeAll, describe, expect, it } from "vitest";

import {
  checkDeathTrinketCcConsistency,
  checkDisarmTrinketTail,
  checkSelfOnlyDefensiveClaims,
} from "../src/quality/promptQualityCheck";

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("checkSelfOnlyDefensiveClaims — the reverse direction (D1)", () => {
  const kill =
    "1:22  [KILL]                 2(RPaladin) (Retribution Paladin) dead";
  it("002d2573 1:21: the dying paladin's own Blessing of Sacrifice fails; a teammate's death keeps it", () => {
    const bos =
      "1:21  [DEFENSIVE AVAILABLE]  2(RPaladin): Blessing of Sacrifice available but unused (free to press it for the last 4.2s before the death)";
    expect(checkSelfOnlyDefensiveClaims([bos, kill])).toHaveLength(1);
    expect(
      checkSelfOnlyDefensiveClaims([
        bos,
        "1:22  [KILL]                 3(FMage) (Fire Mage) dead",
      ]),
    ).toEqual([]);
    expect(
      checkSelfOnlyDefensiveClaims([
        "1:21  [DEFENSIVE AVAILABLE]  2(RPaladin): Divine Protection available but unused",
        kill,
      ]),
    ).toEqual([]);
  });
  it("the [DEATH] Unused list never names it", () => {
    const death = (unused: string) =>
      `3:48  [DEATH]  1(RPaladin) (Retribution Paladin — friendly) (Unused: ${unused}) (PvP Trinket available) | dampening: 15%`;
    expect(
      checkSelfOnlyDefensiveClaims([
        death("Divine Protection, Blessing of Sacrifice"),
      ]),
    ).toHaveLength(1);
    expect(checkSelfOnlyDefensiveClaims([death("Divine Protection")])).toEqual(
      [],
    );
  });
});

describe("checkDisarmTrinketTail (D9)", () => {
  const trinket = "0:14  [TRINKET]   2(SHunter) used PvP trinket";
  it("c992ce75 0:14: a disarm cut at the press must carry the trinket tail", () => {
    const bare = "0:11  [DISARM]   2(SHunter) ← Disarm (by 5(AWarrior)) | 3s";
    const tail =
      "0:11  [DISARM]   2(SHunter) ← Disarm (by 5(AWarrior)) | trinket broke this disarm after 3s (cut short — it had not expired)";
    expect(checkDisarmTrinketTail([bare, trinket])).toHaveLength(1);
    expect(checkDisarmTrinketTail([tail, trinket])).toEqual([]);
  });
  it("a disarm that ran its length, a press on another player, or one long after, does not", () => {
    const full = "0:09  [DISARM]   2(SHunter) ← Disarm (by 5(AWarrior)) | 5s";
    expect(checkDisarmTrinketTail([full, trinket])).toEqual([]);
    const bare = "0:11  [DISARM]   2(SHunter) ← Disarm (by 5(AWarrior)) | 3s";
    expect(
      checkDisarmTrinketTail([
        bare,
        "0:14  [TRINKET]   3(RDruid) used PvP trinket",
      ]),
    ).toEqual([]);
    expect(
      checkDisarmTrinketTail([
        bare,
        "0:20  [TRINKET]   2(SHunter) used PvP trinket",
      ]),
    ).toEqual([]);
  });
});

describe("checkDeathTrinketCcConsistency — a control the death cut short (D13, ruling 4)", () => {
  const scream =
    "2:35  [CC ON TEAM]   2(HPriest) ← Psychic Scream (by 4(HPriest)) | 1s [DR: Disorient Full] | 9.2yd from caster | ended at their death";
  const death = (tag: string) =>
    `2:35  [DEATH]  2(HPriest) (Holy Priest — friendly) (PvP Trinket available${tag}) | dampening: 49%`;
  it("1263fff6 2:35: 'no breakable CC' beside a death-cut Scream fails; naming it passes", () => {
    expect(
      checkDeathTrinketCcConsistency([
        scream,
        death("; no breakable CC in the last 10 s"),
      ]),
    ).toHaveLength(1);
    expect(
      checkDeathTrinketCcConsistency([
        scream,
        death("; Psychic Scream landed 0.5 s before the death"),
      ]),
    ).toEqual([]);
  });
  it("the naming form must match a death-cut line, and never stand beside a breakable one", () => {
    expect(
      checkDeathTrinketCcConsistency([
        scream.replace(" | ended at their death", ""),
        death("; Psychic Scream landed 0.5 s before the death"),
      ]),
    ).toHaveLength(1);
    expect(
      checkDeathTrinketCcConsistency([
        scream,
        death("; Fear landed 0.5 s before the death"),
      ]),
    ).toHaveLength(1);
    expect(
      checkDeathTrinketCcConsistency([
        scream,
        "2:30  [CC ON TEAM]   2(HPriest) ← Kidney Shot (by 4(ARogue)) | 5s",
        death("; Psychic Scream landed 0.5 s before the death"),
      ]),
    ).toHaveLength(1);
  });
  it("a short control that ended on its own still reads 'no breakable CC'", () => {
    expect(
      checkDeathTrinketCcConsistency([
        scream.replace(" | ended at their death", ""),
        death("; no breakable CC in the last 10 s"),
      ]),
    ).toEqual([]);
  });
});
