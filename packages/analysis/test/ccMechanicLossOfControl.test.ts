/**
 * corpusFactScan trinketOutOf (82-4 0:25): a control's mechanic is its
 * control effect's — Axe Toss 89766 (effect 0 interrupt 26, effect 1 the
 * stun aura, 12) is a stun, so Will to Survive (aura 77 mechanic 12) ends it.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { breakRemovesCc } from "../src/data/ccBreakAbilities";
import { ensureAnalysisData } from "../src/data/ensure";
import { ccMechanicOf } from "../src/utils/spellMechanics";

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("ccMechanicOf — the loss-of-control effect's mechanic", () => {
  it("Axe Toss is a stun; Shambling Rush a root", () => {
    expect(ccMechanicOf("89766")).toBe(12);
    expect(ccMechanicOf("91807")).toBe(7);
  });
  it("Will to Survive breaks Axe Toss", () => {
    expect(breakRemovesCc("59752", "89766")).toBe(true);
  });
});
