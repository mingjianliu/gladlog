/**
 * `checkKickEatenRefusedForAnotherReason` — the three press lists of a
 * kick-eaten `postKick` (re-eval 2026-10-08, I01): a "refused for another
 * reason" clause names a reason the producer can word, once per line, and
 * every clause's count is the number of presses it lists.
 */
import { buildFindingsPrompt } from "@gladlog/analysis/src/analysis/buildFindingsPrompt";
import { POST_KICK_OTHER_REASON_HEAD } from "@gladlog/analysis/src/analysis/candidateFindings";
import { REFUSAL_WHY_WORDS } from "@gladlog/analysis/src/context/spellOutcomeLines";
import { describe, expect, it } from "vitest";

import { checkKickEatenRefusedForAnotherReason } from "../src/quality/promptQualityCheck";

const menuLine = (postKick: string) =>
  `  - id=kick-eaten:P1:169 type=kick-eaten t=169.3s units=Me/Sham facts={t=169.3, interrupted=Dream Breath, kick=Wind Shear, source=Sham, lockout=3.0, postKick=${postKick}, yourCancels=2}`;

describe("checkKickEatenRefusedForAnotherReason", () => {
  it("passes the producer's shapes", () => {
    expect(
      checkKickEatenRefusedForAnotherReason([
        menuLine(
          "acted on another school 1.4s later (Echo; not a hard cast); pressed 2x but rejected (Verdant Embrace×2 +0.9/+1.1s) inside the lockout; refused for another reason 2x — out of range (Reversion×2 +2.6/+2.7s); outside the locked school 1x not ready yet — its own cooldown or the GCD (Reversion +4.2s)",
        ),
        menuLine(
          "no successful cast for 5s after the kick; pressed 3x but rejected (Polymorph×3 +2.8/+3.0/+3.4s); refused for another reason 5x — silenced (Frostfire Bolt×3 +1.8/+1.9/+2.1s、Fire Blast×2 +2.3/+2.5s); refused for another reason 1x — vision obscured (Smoke Bomb) (Counterspell +4.0s)",
        ),
        menuLine("waited out the lockout (first cast 3.3s later)"),
      ]),
    ).toEqual([]);
  });

  it("flags a reason the product does not word (a client text, a made-up cause)", () => {
    const f = checkKickEatenRefusedForAnotherReason([
      menuLine(
        "no successful cast for 5s after the kick; refused for another reason 1x — the lockout (Polymorph +0.4s)",
      ),
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain("not");
  });

  it("flags a count that is not the number of presses listed — in any of the three lists", () => {
    expect(
      checkKickEatenRefusedForAnotherReason([
        menuLine(
          "no successful cast for 5s after the kick; refused for another reason 3x — out of range (Reversion×2 +2.6/+2.7s)",
        ),
      ]),
    ).toHaveLength(1);
    expect(
      checkKickEatenRefusedForAnotherReason([
        menuLine(
          "pressed 7x but rejected (Haunt×3 +0.0/+0.2/+0.3s、Soulburn×3 +2.5/+2.7/+2.8s) inside the lockout; first successful cast 3.0s later",
        ),
      ]),
    ).toHaveLength(1);
    expect(
      checkKickEatenRefusedForAnotherReason([
        menuLine(
          "first cast 0.4s later; outside the locked school 2x not ready yet — its own cooldown or the GCD (Fire Blast +1.3s)",
        ),
      ]),
    ).toHaveLength(1);
  });

  it("flags one reason split over two clauses", () => {
    expect(
      checkKickEatenRefusedForAnotherReason([
        menuLine(
          "no successful cast for 5s after the kick; refused for another reason 1x — silenced (Fire Blast +2.3s); refused for another reason 1x — silenced (Frostfire Bolt +2.9s)",
        ),
      ]),
    ).toHaveLength(1);
  });

  it("ignores other candidate types", () => {
    expect(
      checkKickEatenRefusedForAnotherReason([
        "  - id=cd-hoarded:P1:10 type=cd-hoarded t=10s units=Me facts={t=10, postKick=refused for another reason 9x — nonsense (X +0.1s)}",
      ]),
    ).toEqual([]);
  });

  it("the kick-eaten legend explains the clause and names every reason the producer can print", () => {
    const legend = buildFindingsPrompt(
      [
        {
          id: "kick-eaten:P1:10",
          type: "kick-eaten",
          t: 10,
          unitNames: ["Me", "Sham"],
          facts: { t: "10" },
        },
      ],
      "",
      "Restoration Druid",
    )
      .split("\n")
      .find((l) => l.startsWith('- "kick-eaten": '))!;
    expect(legend).toContain(
      `"${POST_KICK_OTHER_REASON_HEAD}Nx — <reason> (…)"`,
    );
    for (const why of REFUSAL_WHY_WORDS) expect(legend, why).toContain(why);
  });
});
