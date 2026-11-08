import { describe, expect, it } from "vitest";

import { checkBurstSoloHealerHeldNote } from "../src/quality/promptQualityCheck";

/**
 * User ruling R01 (2026-11-08, fact12 D22, 7edc099d r0): a teammate Holy
 * Paladin's Avenging Wrath is no ally offensive CD in the burst ledger
 * (fact11 D16) while KILL WINDOWS lists it pressed inside; a Solo burst it
 * overlapped says `(a healer's Avenging Wrath is not counted)`.
 */

const roster = (spec = "Holy Paladin", role = "teammate") => [
  `  <unit id="3" name="Holy-Realm-EU" spec="${spec}" role="${role}">`,
  "    <cooldowns>Divine Shield [210s, lasts 8s], Aura Mastery [120s, lasts 8s], Divine Toll [30s], Avenging Wrath [120s, lasts 30s], Hammer of Justice [30s]</cooldowns>",
  "  </unit>",
];
const press = (t: string, spec = "Holy Paladin") =>
  `${t}  [TEAM] [CD]   3(HPaladin) (${spec}): Avenging Wrath`;
const head = (from: string, to: string) =>
  `  Burst #6 — ${from}–${to} | Stormkeeper`;
const SOLO = "    Solo burst — no ally offensive CD overlapped.";
const NOTED =
  "    Solo burst — no ally offensive CD overlapped (a healer's Avenging Wrath is not counted).";

describe("checkBurstSoloHealerHeldNote", () => {
  it("fails a bare Solo line the healer's Avenging Wrath overlapped (the 7edc099d shape)", () => {
    const fails = checkBurstSoloHealerHeldNote([
      head("2:30", "2:35"),
      SOLO,
      ...roster(),
      press("2:32"),
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("Avenging Wrath 2:32");
    // pressed 23 s before a 0:55–0:56 burst, still running (lasts 30s)
    expect(
      checkBurstSoloHealerHeldNote([
        head("0:55", "0:56"),
        SOLO,
        ...roster(),
        press("0:32"),
      ]),
    ).toHaveLength(1);
  });

  it("passes the noted line", () => {
    expect(
      checkBurstSoloHealerHeldNote([
        head("2:30", "2:35"),
        NOTED,
        ...roster(),
        press("2:32"),
      ]),
    ).toEqual([]);
  });

  it("does not ask for the note where the floored grid leaves the overlap uncertain", () => {
    // 2:32 + 30 s = 3:02: the burst 3:02–3:12 may begin after it ended
    expect(
      checkBurstSoloHealerHeldNote([
        head("3:02", "3:12"),
        SOLO,
        ...roster(),
        press("2:32"),
      ]),
    ).toEqual([]);
    // a press in the burst's last second may come after it
    expect(
      checkBurstSoloHealerHeldNote([
        head("2:30", "2:35"),
        SOLO,
        ...roster(),
        press("2:35"),
      ]),
    ).toEqual([]);
    // the healer died before the burst: the aura may have gone with them
    expect(
      checkBurstSoloHealerHeldNote([
        head("0:55", "0:56"),
        SOLO,
        ...roster(),
        press("0:32"),
        "0:40  [DEATH]  3(HPaladin) (Holy Paladin — friendly)",
      ]),
    ).toEqual([]);
  });

  it("a Retribution Paladin's or an enemy's Avenging Wrath asks for nothing", () => {
    expect(
      checkBurstSoloHealerHeldNote([
        head("2:30", "2:35"),
        SOLO,
        ...roster("Retribution Paladin"),
        press("2:32", "Retribution Paladin"),
      ]),
    ).toEqual([]);
    expect(
      checkBurstSoloHealerHeldNote([
        head("2:30", "2:35"),
        SOLO,
        ...roster("Holy Paladin", "enemy"),
        press("2:32"),
      ]),
    ).toEqual([]);
  });

  it("fails a note with no healer press that could overlap", () => {
    expect(
      checkBurstSoloHealerHeldNote([head("2:30", "2:35"), NOTED, ...roster()]),
    ).toHaveLength(1);
    expect(
      checkBurstSoloHealerHeldNote([
        head("2:30", "2:35"),
        NOTED,
        ...roster(),
        press("1:00"),
      ]),
    ).toHaveLength(1);
  });
});
