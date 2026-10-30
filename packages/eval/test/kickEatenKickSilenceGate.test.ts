/**
 * `checkKickEatenKickSilence` — an interrupt whose own spell also silenced
 * the player (Shield of Virtue; re-eval 2026-10-08, F21) says so on its
 * kick-eaten row, and what it says is the `[SILENCE]` line's duration.
 */
import { buildFindingsPrompt } from "@gladlog/analysis/src/analysis/buildFindingsPrompt";
import { renderedCcSpan } from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import { describe, expect, it } from "vitest";

import { checkKickEatenKickSilence } from "../src/quality/promptQualityCheck";

const UNITS = [
  '<unit id="1" name="Mage-Realm" spec="Fire Mage" role="log owner"/>',
  '<unit id="2" name="Sham-Realm" spec="Restoration Shaman" role="teammate"/>',
  '<unit id="6" name="Pal-Realm" spec="Protection Paladin" role="enemy"/>',
];
const row = (kick: string, extra: string, t = "166.5") =>
  `  - id=kick-eaten:P1:167 type=kick-eaten t=${t}s units=Mage-Realm/Pal-Realm facts={t=${t}, interrupted=Polymorph, kick=${kick}, source=Pal-Realm, lockout=4.0, lockedSchool=Arcane${extra}, postKick=no cast for 5s after the kick}`;
const silence = (at: string, who: string, spell: string, tail: string) =>
  `${at}  [SILENCE]   ${who} ← ${spell} (by 6(PPaladin)) | ${tail}`;

describe("checkKickEatenKickSilence", () => {
  it("flags the dfcccbf2 line: the kick's own silence is on the timeline and not on the row", () => {
    const f = checkKickEatenKickSilence([
      ...UNITS,
      "2:46  [KICK]   6(PPaladin) interrupted 1(FMage)'s Polymorph (Shield of Virtue)",
      silence("2:46", "1(FMage)", "Shield of Virtue", "4s"),
      row("Shield of Virtue", ""),
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain("no kickSilence");
  });

  it("passes the row that states it — the same duration, the aura a second later, a dispelled one, a trinketed one", () => {
    expect(
      checkKickEatenKickSilence([
        ...UNITS,
        silence("2:46", "1(FMage)", "Shield of Virtue", "4s"),
        row("Shield of Virtue", ", kickSilence=4s"),
      ]),
    ).toEqual([]);
    expect(
      checkKickEatenKickSilence([
        ...UNITS,
        silence("2:47", "1(FMage)", "Shield of Virtue", "4s"),
        row("Shield of Virtue", ", kickSilence=4s", "166.998"),
      ]),
    ).toEqual([]);
    expect(
      checkKickEatenKickSilence([
        ...UNITS,
        silence(
          "2:46",
          "1(FMage)",
          "Shield of Virtue",
          "1s | dispelled by 2(RShaman)'s Purify Spirit",
        ),
        row("Shield of Virtue", ", kickSilence=1s"),
      ]),
    ).toEqual([]);
    expect(
      checkKickEatenKickSilence([
        ...UNITS,
        silence(
          "2:46",
          "1(FMage)",
          "Shield of Virtue",
          "trinket broke this silence after 1s (cut short — it had not expired)",
        ),
        row("Shield of Virtue", ", kickSilence=1s"),
      ]),
    ).toEqual([]);
  });

  it("passes the round-end form `renderedCcSpan` prints for a silence the round's end cut (codex post-hoc U1)", () => {
    expect(
      checkKickEatenKickSilence([
        ...UNITS,
        silence(
          "2:46",
          "1(FMage)",
          "Shield of Virtue",
          renderedCcSpan({ durationSeconds: 1.5, stillOnAtRoundEnd: true }),
        ),
        row("Shield of Virtue", ", kickSilence=2s"),
      ]),
    ).toEqual([]);
    expect(
      checkKickEatenKickSilence([
        ...UNITS,
        silence(
          "2:46",
          "1(FMage)",
          "Shield of Virtue",
          renderedCcSpan({ durationSeconds: 1.5, stillOnAtRoundEnd: true }),
        ),
        row("Shield of Virtue", ", kickSilence=4s"),
      ]),
    ).toHaveLength(1);
  });

  it("flags a stated silence the timeline does not show, or shows with another duration", () => {
    expect(
      checkKickEatenKickSilence([
        ...UNITS,
        row("Shield of Virtue", ", kickSilence=4s"),
      ]),
    ).toHaveLength(1);
    expect(
      checkKickEatenKickSilence([
        ...UNITS,
        silence("2:46", "1(FMage)", "Shield of Virtue", "2s"),
        row("Shield of Virtue", ", kickSilence=4s"),
      ]),
    ).toHaveLength(1);
  });

  it("another unit's silence, another spell's, or one at another second is not the kick's", () => {
    expect(
      checkKickEatenKickSilence([
        ...UNITS,
        silence("2:46", "2(RShaman)", "Shield of Virtue", "4s"),
        silence("2:46", "1(FMage)", "Strangulate", "4s"),
        silence("1:11", "1(FMage)", "Shield of Virtue", "3s"),
        row("Shield of Virtue", ""),
        row("Rebuke", ""),
      ]),
    ).toEqual([]);
  });

  it("the legend explains the fact", () => {
    const legend = buildFindingsPrompt(
      [
        {
          id: "kick-eaten:P1:10",
          type: "kick-eaten",
          t: 10,
          unitNames: ["Me", "Pal"],
          facts: { t: "10" },
        },
      ],
      "",
      "Fire Mage",
    )
      .split("\n")
      .find((l) => l.startsWith('- "kick-eaten": '))!;
    expect(legend).toContain("facts.kickSilence");
    expect(legend).toContain("a spell of another school is NOT free either");
  });
});
