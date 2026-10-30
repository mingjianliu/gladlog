import { describe, expect, it } from "vitest";

import {
  formatKitUnusedNote,
  KIT_NOT_READY_WHY,
  KIT_REFUSED_PRESS_LEGEND,
  KIT_REFUSED_WHY_WORDS,
  KIT_UNUSED_NOTE_RE_SRC,
  kitRefusedPressesOf,
} from "../src/context/kitUnusedNote";
import { buildPlayerLoadout } from "../src/context/resourceSnapshot";
import {
  REJECT_WHY,
  REJECT_WHY_BAR_STOPPED,
  REJECT_WHY_UNWORDED,
} from "../src/context/spellOutcomeLines";
import type { IMajorCooldownInfo } from "../src/utils/cooldowns";
import type { IEnemyCDTimeline } from "../src/utils/enemyCDs";
import type { CastFailedEvent } from "../src/utils/rawStreams";
import { makeUnit } from "./ported/testHelpers";

// FT board F09 (2026-10-11): a cooldown whose only presses the game refused is
// not "never pressed". 17/61fc7e40 (Holy Priest): Power Infusion pressed six
// times — five "Target not in line of sight", one stunned — and the kit read
// a bare [UNUSED].
const OWNER = "player-1";
const row = (
  tSeconds: number,
  spellId: number,
  reason: string,
  unitGuid = OWNER,
): CastFailedEvent => ({
  tSeconds,
  unitGuid,
  spellId,
  spellName: "x",
  reason,
});
const PI = { spellId: "10060", spellName: "Power Infusion" };
const owner = makeUnit(OWNER, { name: "Player1" });

describe("kitRefusedPressesOf — the refused presses of one cooldown", () => {
  it("counts the unit's rows of that cooldown, worded by reason, in order of first press", () => {
    const out = kitRefusedPressesOf(
      [
        row(13.2, 10060, "Target not in line of sight"),
        row(13.9, 10060, "Target not in line of sight"),
        row(17.5, 10060, "Can't do that while stunned"),
        row(14.4, 10060, "目标不在视野中"), // the zh client's text, same kind
        row(20, 10060, "Not yet recovered"),
        row(21, 10060, "Can't do that while silenced"),
        row(22, 10060, "You have no target."), // no word in the product
      ],
      owner,
      PI,
      100,
    );
    expect(out).toEqual({
      count: 7,
      reasons: [
        { why: REJECT_WHY["no line of sight"], count: 3 },
        { why: "under crowd control", count: 1 },
        { why: KIT_NOT_READY_WHY, count: 1 },
        { why: "silenced", count: 1 },
        { why: REJECT_WHY_UNWORDED, count: 1 },
      ],
    });
  });

  it("leaves out another unit's rows, another spell's, an interrupted bar's and the ones after `untilS`", () => {
    expect(
      kitRefusedPressesOf(
        [
          row(5, 10060, "Out of range", "player-2"),
          row(6, 33206, "Out of range"), // Pain Suppression
          row(7, 10060, "Interrupted"), // a bar that had begun: `started N×`
          row(100.001, 10060, "You are dead"),
          row(-1, 10060, "Out of range"),
        ],
        owner,
        PI,
        100,
      ),
    ).toBeNull();
    // the bound is inclusive, in whole milliseconds
    expect(
      kitRefusedPressesOf([row(100, 10060, "Out of range")], owner, PI, 100)
        ?.count,
    ).toBe(1);
  });

  it("never prints the bar-stopped wording, and every word it can print is in KIT_REFUSED_WHY_WORDS", () => {
    expect(KIT_REFUSED_WHY_WORDS).not.toContain(REJECT_WHY_BAR_STOPPED);
    expect(KIT_REFUSED_WHY_WORDS).toContain(KIT_NOT_READY_WHY);
    for (const w of [...Object.values(REJECT_WHY), REJECT_WHY_UNWORDED])
      expect(KIT_REFUSED_WHY_WORDS).toContain(w);
  });
});

describe("formatKitUnusedNote — the text between `[UNUSED` and `]`", () => {
  const re = new RegExp(`^${KIT_UNUSED_NOTE_RE_SRC}$`);
  const tag = (note: string) => `[UNUSED${note}]`;

  it("writes neither, one or both parts, and the gate's pattern reads each back", () => {
    expect(formatKitUnusedNote(0, null)).toBe("");
    expect(formatKitUnusedNote(2, null)).toBe(" — started 2×, never finished");
    const one = {
      count: 3,
      reasons: [{ why: "under crowd control", count: 3 }],
    };
    expect(formatKitUnusedNote(0, one)).toBe(
      " — pressed 3×, refused: under crowd control",
    );
    const two = {
      count: 6,
      reasons: [
        { why: "target not in line of sight", count: 5 },
        { why: "under crowd control", count: 1 },
      ],
    };
    expect(formatKitUnusedNote(1, two)).toBe(
      " — started 1×, never finished; pressed 6×, refused: target not in line of sight ×5, under crowd control ×1",
    );
    expect(tag(formatKitUnusedNote(0, null)).match(re)!.slice(1)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(tag(formatKitUnusedNote(2, null)).match(re)![1]).toBe("2");
    const m = tag(formatKitUnusedNote(1, two)).match(re)!;
    expect([m[1], m[2], m[3]]).toEqual([
      "1",
      "6",
      "target not in line of sight ×5, under crowd control ×1",
    ]);
    const alone = tag(formatKitUnusedNote(0, one)).match(re)!;
    expect([alone[1], alone[4], alone[5]]).toEqual([
      undefined,
      "3",
      "under crowd control",
    ]);
    // the Smoke Bomb wording carries brackets of its own
    const smoke = {
      count: 2,
      reasons: [{ why: REJECT_WHY["vision obscured"], count: 2 }],
    };
    expect(tag(formatKitUnusedNote(0, smoke)).match(re)![5]).toBe(
      "vision obscured (Smoke Bomb)",
    );
  });
});

describe("buildPlayerLoadout — `[UNUSED — pressed N×, refused: …]` on the log owner's kit", () => {
  const cd = (spellId: string, spellName: string) =>
    ({
      spellId,
      spellName,
      cooldownSeconds: 120,
      maxChargesDetected: 1,
      neverUsed: true,
      casts: [],
    }) as unknown as IMajorCooldownInfo;
  const NO_ENEMIES = {
    players: [],
    alignedBurstWindows: [],
  } as unknown as IEnemyCDTimeline;
  const mate = makeUnit("player-2", { name: "Player2" });
  const castFailed = [
    row(13.2, 10060, "Target not in line of sight"),
    row(17.5, 10060, "Can't do that while stunned"),
    // the teammate has no rows in a real log; one that names them is not the owner's
    row(18, 10060, "Out of range", "player-2"),
  ];
  const build = (
    refused?: { castFailed: readonly CastFailedEvent[]; untilS: number },
    neverUsed = true,
  ) =>
    buildPlayerLoadout(
      owner,
      "Holy Priest",
      [
        { ...cd("10060", "Power Infusion"), neverUsed },
        cd("47788", "Guardian Spirit"),
      ],
      [
        {
          player: mate,
          spec: "Holy Priest",
          cds: [cd("10060", "Power Infusion")],
        },
      ],
      NO_ENEMIES,
      undefined,
      undefined,
      { startTime: 0, endTime: 100_000 },
      refused,
    ).text;

  it("says so on the owner's entry, with the legend once; a teammate's entry stays bare", () => {
    const text = build({ castFailed, untilS: 100 });
    expect(text).toContain(
      "Power Infusion [120s] [UNUSED — pressed 2×, refused: target not in line of sight ×1, under crowd control ×1], Guardian Spirit",
    );
    expect(text.split(KIT_REFUSED_PRESS_LEGEND)).toHaveLength(2);
    const mateKit = text
      .split("\n")
      .filter((l) => l.includes("<cooldowns>"))[1];
    expect(mateKit).toBe(
      "    <cooldowns>Power Infusion [120s] [UNUSED]</cooldowns>",
    );
  });

  it("no raw stream, or no refused press of an unused cooldown → the kit and its notes as before", () => {
    const before = build();
    expect(before).toContain("Power Infusion [120s] [UNUSED], Guardian Spirit");
    expect(before).not.toContain("pressed");
    expect(before).not.toContain(KIT_REFUSED_PRESS_LEGEND);
    expect(build({ castFailed: [], untilS: 100 })).toBe(before);
    // a cooldown that went off is not UNUSED, whatever was refused
    const spent = build({ castFailed, untilS: 100 }, false);
    expect(spent).toContain("Power Infusion [120s], Guardian Spirit");
    expect(spent).not.toContain(KIT_REFUSED_PRESS_LEGEND);
  });
});
