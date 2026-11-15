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
