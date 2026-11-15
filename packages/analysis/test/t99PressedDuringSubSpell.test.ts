/**
 * T99 (fact13 D18): a `| pressed during it:` clause counts presses of the
 * owner's cooldown as the ledger reads one (`isPressOfCooldown`), not every
 * refused row that shares its name. The Hunt's button 370965 went out; its
 * triggered impact 370966 ("The Hunt", no cooldown of its own) was refused
 * while stunned — no press of The Hunt.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  formatPressedDuringNote,
  ownerPressesRejectedDuring,
  PRESSED_DURING_ITEM_RE_SRC,
  PRESSED_DURING_NOTE_RE_SRC,
  SECOND_STAGE_MACRO_NOTE,
} from "../src/context/controlRejectedPresses";
import { ensureAnalysisData } from "../src/data/ensure";
import type { CastFailedEvent } from "../src/utils/rawStreams";
import { makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const OWNER = "Player-1-T99";
const owner = makeUnit(OWNER, { name: "Owner" });
const STUNNED = "Can't do that while stunned";
const press = (
  t: number,
  spellId: number,
  spellName: string,
): CastFailedEvent => ({
  tSeconds: t,
  unitGuid: OWNER,
  spellId,
  spellName,
  reason: STUNNED,
});
const stun = { fromSeconds: 8.74, toSeconds: 12.74 };
const kit = new Map([
  ["370965", "The Hunt"],
  ["198589", "Blur"],
]);

describe("T99 — a sub-spell's refused row is no press of the kit cooldown", () => {
  it("The Hunt's impact refused while stunned is not a press of The Hunt", () => {
    const got = ownerPressesRejectedDuring(
      [press(8.97, 370966, "The Hunt"), press(12.4, 198589, "Blur")],
      owner,
      kit,
      "control",
      [stun],
      (w) => w,
    );
    expect(formatPressedDuringNote(got.get(stun))).toBe(
      " | pressed during it: Blur ×1",
    );
  });
  it("the button's own refused row still counts", () => {
    const got = ownerPressesRejectedDuring(
      [press(9.5, 370965, "The Hunt")],
      owner,
      kit,
      "control",
      [stun],
      (w) => w,
    );
    expect(formatPressedDuringNote(got.get(stun))).toBe(
      " | pressed during it: The Hunt ×1",
    );
  });
});

describe("T99 (R45) — a same-button second stage is a press, with the /cancelaura note", () => {
  const atKit = new Map([
    ["342245", "Alter Time"],
    ["198589", "Blur"],
  ]);
  const run = (rows: CastFailedEvent[]) =>
    formatPressedDuringNote(
      ownerPressesRejectedDuring(
        rows,
        owner,
        atKit,
        "control",
        [stun],
        (w) => w,
      ).get(stun),
    );
  it("Alter Time's return refused while stunned counts, with the note", () => {
    expect(run([press(9.1, 342247, "Alter Time")])).toBe(
      ` | pressed during it: Alter Time ×1${SECOND_STAGE_MACRO_NOTE}`,
    );
  });
  it("a first press and a return of one button are one item, with the note", () => {
    expect(
      run([
        press(9.1, 342245, "Alter Time"),
        press(9.4, 342247, "Alter Time"),
        press(10, 198589, "Blur"),
      ]),
    ).toBe(
      ` | pressed during it: Alter Time ×2${SECOND_STAGE_MACRO_NOTE}, Blur ×1`,
    );
  });
  it("a first press alone carries no note", () => {
    expect(run([press(9.1, 342245, "Alter Time")])).toBe(
      " | pressed during it: Alter Time ×1",
    );
  });
  it("the gate's patterns read the noted item back", () => {
    const line = `0:09  [CC ON TEAM]   1(Owner) ← Kidney Shot | 4s${run([
      press(9.1, 342247, "Alter Time"),
      press(10, 198589, "Blur"),
    ])}`;
    const m = new RegExp(PRESSED_DURING_NOTE_RE_SRC).exec(line);
    expect(m).not.toBeNull();
    expect(
      [...m![1]!.matchAll(new RegExp(PRESSED_DURING_ITEM_RE_SRC, "g"))].map(
        (x) => [x[1], x[2], !!x[3]],
      ),
    ).toEqual([
      ["Alter Time", "1", true],
      ["Blur", "1", false],
    ]);
  });
});
