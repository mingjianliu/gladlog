import { describe, expect, it } from "vitest";
import { causalLint } from "./causalLint";

describe("causalLint (enforces the no-strong-causal-claim policy)", () => {
  it("flags strong causal attribution", () => {
    expect(
      causalLint("You died because you wasted your defensive.").length,
    ).toBeGreaterThan(0);
    expect(causalLint("Holding CDs cost you the game.").length).toBeGreaterThan(
      0,
    );
    expect(causalLint("That's why you lost the round.").length).toBeGreaterThan(
      0,
    );
    expect(causalLint("This led to the loss.").length).toBeGreaterThan(0);
  });
  it("flags the strengthened patterns (got-killed, which-is-why, present-tense, cost-the-round)", () => {
    expect(
      causalLint("Poor positioning got you killed.").length,
    ).toBeGreaterThan(0);
    expect(
      causalLint("Which is why you lost that round.").length,
    ).toBeGreaterThan(0);
    expect(
      causalLint("You die because you overextend.").length,
    ).toBeGreaterThan(0);
    expect(causalLint("That greed cost the round.").length).toBeGreaterThan(0);
  });
  it("allows observational + suggestive coaching (no strong causal connective)", () => {
    expect(
      causalLint(
        "At 1:00 you used Pain Suppression; the kill came at 2:00 during their cooldowns.",
      ),
    ).toEqual([]);
    expect(
      causalLint("Consider saving the trinket for the first swap."),
    ).toEqual([]);
  });
  it("does not false-drop resource-cost observations or positive reinforcement (narrowed patterns)", () => {
    expect(causalLint("It cost you nothing to try the early swap.")).toEqual(
      [],
    );
    expect(
      causalLint("Great peel — which is why you survived the go."),
    ).toEqual([]);
  });
});
