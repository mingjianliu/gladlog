import { syncReadyCdEntry } from "@gladlog/analysis/src/analysis/candidates/cooldownTiming";
import { describe, expect, it } from "vitest";

import { checkSyncWindowReadyCdHolders } from "../src/quality/promptQualityCheck";

// L04: every `readyCds` entry of a missed-sync-window row says whose
// cooldown it is, and the loadout's kits agree. Shapes from the 605-file
// capture (s2/177-5-1133: a Restoration Shaman's menu, The Hunt the Demon
// Hunter's, Touch of the Magi the Mage's).
const OWNER = "Raketenrieke-Blackrock-EU";
const DH = "Glaivemeomg-Stormscale-EU";
const MAGE = "Klamphugger-Auchindoun-EU";
const LOADOUT = [
  `  <unit id="1" name="${OWNER}" spec="Restoration Shaman" role="log owner">`,
  "    <cooldowns>Astral Shift [90s, lasts 12s], Spirit Link Totem [180s, lasts 6s], Ascendance [PASSIVE], Invoke Xuen, the White Tiger [120s], Hex [30s]</cooldowns>",
  "  </unit>",
  `  <unit id="2" name="${DH}" spec="Havoc Demon Hunter" role="teammate">`,
  "    <cooldowns>Blur [60s, 2 Charges, lasts 10s], The Hunt [60s], Chaos Nova [45s]</cooldowns>",
  "  </unit>",
  `  <unit id="3" name="${MAGE}" spec="Arcane Mage" role="teammate">`,
  "    <cooldowns>Touch of the Magi [45s], Ice Block [180s, lasts 10s], Arcane Surge [90s]</cooldowns>",
  "  </unit>",
  '  <unit id="5" name="Elbenïl-Archimonde-EU" spec="Holy Priest" role="enemy">',
  "    <cooldowns>Power Infusion [120s], Psychic Scream [30s]</cooldowns>",
  "  </unit>",
];
const row = (readyCds: string) =>
  `  - id=missed-sync-window:Elbenïl-Archimonde-EU:31661:99 type=missed-sync-window t=99s units=Elbenïl-Archimonde-EU facts={t=99, windowEndT=102, healer=Elbenïl-Archimonde-EU, cc=Dragon's Breath, dr=Full, durationS=3, readyCds=${readyCds}, enemyMinHpPct=99, refN=48745, refKillEntered=9, refKillUnentered=5, cellKey=Rated Solo Shuffle}`;
const check = (readyCds: string, loadout = LOADOUT) =>
  checkSyncWindowReadyCdHolders([row(readyCds), ...loadout]);
const entries = (...e: Array<[string, string | undefined, boolean]>) =>
  e.map((x) => syncReadyCdEntry(...x)).join("、");

describe("checkSyncWindowReadyCdHolders", () => {
  it("passes the producer's entries: a teammate's by name, the owner's as yours", () => {
    expect(
      check(
        entries(
          ["The Hunt", DH, false],
          ["Touch of the Magi", MAGE, false],
          ["Astral Shift", OWNER, true],
        ),
      ),
    ).toEqual([]);
    // a name the facts serializer wrote with a no-break space
    expect(check("Invoke Xuen,\u00a0the White Tiger (yours)")).toEqual([]);
  });

  it("mutation: a bare name — the row as it was before L04 — fails", () => {
    const fails = check("The Hunt、Touch of the Magi");
    expect(fails).toHaveLength(2);
    expect(fails[0]).toContain("「The Hunt」没写是谁的冷却");
    expect(fails[1]).toContain("「Touch of the Magi」没写是谁的冷却");
    // … also with no loadout in the text
    expect(check("The Hunt", [])).toHaveLength(1);
  });

  it("mutation: a teammate's cooldown marked yours fails on the owner's kit", () => {
    const fails = check("The Hunt (yours)");
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain(
      "写 The Hunt 是录制者的,录制者的 <cooldowns> 里没有它",
    );
  });

  it("mutation: yours on an entry with no button fails", () => {
    const fails = check("Ascendance (yours)");
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("[PASSIVE]");
  });

  it("mutation: the wrong teammate, the owner by name, an enemy, a stranger", () => {
    expect(check(`The Hunt (${MAGE}'s)`)[0]).toContain(
      `写 The Hunt 是 ${MAGE} 的,其 <cooldowns> 里没有它`,
    );
    expect(check(`Astral Shift (${OWNER}'s)`)[0]).toContain("按名字写了录制者");
    expect(check("Power Infusion (Elbenïl-Archimonde-EU's)")[0]).toContain(
      "持有者是 enemy,不是队友",
    );
    expect(check("The Hunt (Nobody-Realm's)")[0]).toContain(
      "持有者不在技能栏的单位里",
    );
  });

  it("without a loadout only the holder's presence is judged", () => {
    expect(check("The Hunt (yours)", [])).toEqual([]);
    expect(check(`The Hunt (${MAGE}'s)`, [])).toEqual([]);
  });
});
