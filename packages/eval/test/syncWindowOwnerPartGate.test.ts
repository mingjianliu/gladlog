import { SOLO_SHUFFLE_BRACKET } from "@gladlog/analysis/src/utils/roundEnd";
import { describe, expect, it } from "vitest";

import { checkSyncWindowOwnerPart } from "../src/quality/promptQualityCheck";

// L04 (c): a Solo Shuffle menu has no missed-sync-window row nothing of
// which is the log owner's. Shapes from the 605-file capture
// (s2/177-5-1133: a Restoration Shaman's menu, the lock the Demon Hunter's
// Chaos Nova, the ready cooldown his The Hunt).
const header = (bracket: string) =>
  `  Spec: Restoration Shaman (Healer)  |  Bracket: ${bracket}  |  Result: Loss  |  Duration: 4:11  |  Map: Maldraxxus Coliseum`;
const row = (cellKey: string, readyCds: string, setupBy?: string) =>
  `  - id=missed-sync-window:Elbenïl-Archimonde-EU:179057:85 type=missed-sync-window t=85s units=Elbenïl-Archimonde-EU facts={t=85, windowEndT=88, healer=Elbenïl-Archimonde-EU, cc=Chaos Nova, dr=Full, durationS=3, readyCds=${readyCds}, enemyMinHpPct=85${setupBy ? `, setupBy=${setupBy}` : ""}, refN=48745, refKillEntered=9, refKillUnentered=5, cellKey=${cellKey}}`;
const MATES = "The Hunt (Glaivemeomg-Stormscale-EU's)";

describe("checkSyncWindowOwnerPart", () => {
  it("mutation: the row as it was before L04 (c) — a teammate's cooldown in a teammate's lock — fails in Solo Shuffle", () => {
    const fails = checkSyncWindowOwnerPart([
      header(SOLO_SHUFFLE_BRACKET),
      row(SOLO_SHUFFLE_BRACKET, MATES),
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("没有录制者的份");
    // … with no header in the text the row's own cellKey says the bracket
    expect(
      checkSyncWindowOwnerPart([row(SOLO_SHUFFLE_BRACKET, MATES)]),
    ).toHaveLength(1);
    // … and a bare name (no holder stated) is not the owner's either
    expect(
      checkSyncWindowOwnerPart([row(SOLO_SHUFFLE_BRACKET, "The Hunt")]),
    ).toHaveLength(1);
  });

  it("passes a Solo Shuffle row with a (yours) cooldown, or with setupBy", () => {
    expect(
      checkSyncWindowOwnerPart([
        header(SOLO_SHUFFLE_BRACKET),
        row(SOLO_SHUFFLE_BRACKET, `${MATES}、Touch of the Magi (yours)`),
        row(SOLO_SHUFFLE_BRACKET, MATES, "you"),
        row(SOLO_SHUFFLE_BRACKET, MATES, "you (Hex)"),
        row(SOLO_SHUFFLE_BRACKET, MATES).replace(
          ", refN=",
          ", alsoHeldAt=100, alsoHeldSetupBy=100: you, refN=",
        ),
      ]),
    ).toEqual([]);
  });

  it("3v3 and 2v2 rows are not judged", () => {
    for (const bracket of ["3v3", "2v2"])
      expect(
        checkSyncWindowOwnerPart([header(bracket), row(bracket, MATES)]),
      ).toEqual([]);
  });
});
