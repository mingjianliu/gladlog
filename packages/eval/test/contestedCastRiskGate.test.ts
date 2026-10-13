/**
 * FT I12 — `checkContestedCastRisk`: a `[CONTESTED]` line states cast risk
 * (and the enemy interrupts ready) only for a control that has a cast to
 * interrupt, by the official cast time the producer reads. The lines below
 * are built by the producer's own formatter and then mutated.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  formatContestedTradeLine,
  type IContestedTradeFact,
} from "@gladlog/analysis/src/utils/healerOffenseAnalysis";
import { interruptibleCastOf } from "@gladlog/analysis/src/utils/spellMechanics";
import { beforeAll, describe, expect, it } from "vitest";

import { checkContestedCastRisk } from "../src/quality/promptQualityCheck";

beforeAll(async () => {
  await ensureAnalysisData();
});

const line = (
  name: string,
  id: string,
  over: Partial<IContestedTradeFact> = {},
) =>
  formatContestedTradeLine({
    fromSeconds: 144,
    toSeconds: 148,
    durationSeconds: 4,
    teamMinHpPct: 80,
    ccSpellName: name,
    ccSpellId: id,
    ccInterruptible: interruptibleCastOf(id),
    enemyHealerName: "Chunguswings-Onyxia-US",
    enemyHealerSpec: "Holy Priest",
    enemyHealerTrinket: "available",
    ownerHealing: 138_000,
    ownerCCCasts: 1,
    enemyInterruptsReady: 1,
    ...over,
  });

describe("checkContestedCastRisk (FT I12)", () => {
  it("the generated lines pass: an instant, a cast bar, a channel", () => {
    expect(
      checkContestedCastRisk([
        "HEALER OFFENSE (each line states the condition it holds under):",
        line("Hammer of Justice", "853"),
        line("Capacitor Totem", "192058"),
        line("Cyclone", "33786"),
        line("Song of Chi-Ji", "198898"),
        line("Lightning Lasso", "305483"),
        "  Note: healing under pressure always outranks offense.",
      ]),
    ).toEqual([]);
  });

  it("mutation: the old line — cast risk and an interrupt count on an instant — fails", () => {
    const old =
      "  [CONTESTED] 2:24–2:28 (4s, team min HP 80%): Hammer of Justice ready on enemy healer Chunguswings-Onyxia-US (DR Full, trinket available); you healed 138k, cast 1 CC; enemy interrupts ready: 1 — contested trade: a CC here competed with continued healing AND carried cast risk (EV question, not a verdict).";
    const out = checkContestedCastRisk([old]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("Hammer of Justice");
    expect(out[0]).toContain("instant");
  });

  it("mutation: a cast-time control printed as an instant fails", () => {
    const out = checkContestedCastRisk([
      line("Cyclone", "33786", { ccInterruptible: "none" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("risk");
  });

  it("mutation: a known control that claims neither fails; a name no cast carries must claim neither", () => {
    expect(
      checkContestedCastRisk([
        line("Hammer of Justice", "853", { ccInterruptible: undefined }),
      ]),
    ).toHaveLength(1);
    expect(
      checkContestedCastRisk([
        line("No Such Control", "999999999", { ccInterruptible: undefined }),
      ]),
    ).toEqual([]);
    expect(
      checkContestedCastRisk([
        line("No Such Control", "999999999", { ccInterruptible: "none" }),
      ]),
    ).toHaveLength(1);
  });

  it("mutation: a line off the generated format fails — the count kept beside the instant note, a dropped disclaimer", () => {
    const ok = line("Hammer of Justice", "853");
    expect(
      checkContestedCastRisk([
        ok.replace(" — contested", "; enemy interrupts ready: 1 — contested"),
      ]),
    ).toHaveLength(1);
    expect(
      checkContestedCastRisk([
        ok.replace(" (EV question, not a verdict).", "."),
      ]),
    ).toHaveLength(1);
  });
});
