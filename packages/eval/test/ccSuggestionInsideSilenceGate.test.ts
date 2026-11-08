import { describe, expect, it } from "vitest";

import { checkCcSuggestionInsideSilence } from "../src/quality/promptQualityCheck";

/**
 * fact12 D8 (pipeline T13, 3e1f5c3a r0 P:488): a `[CC BOOKMARK]` /
 * `[PEEL OPTION]` says its target was not CC'd on the seconds it counts; a
 * `[SILENCE]` line on that target covering one of them contradicts it. A
 * bookmark counts every second of its span; a peel option counts its two ends
 * and `usable N s` of the seconds between.
 */

const venom =
  "0:50  [SILENCE]   6(DPriest) ← Spider Venom (by 3(MHunter)) | 3s";
const bookmark =
  "0:48–0:56  [CC BOOKMARK]  Storm Bolt → 6(DPriest): during your Burst #2 (0:40–1:12) on 5(AWarlock), their healer was not CC'd | at 0:48: 18.4yd, DR Full, 6(DPriest) PvP trinket ready";
const peel =
  "0:50–0:56  [PEEL OPTION]  1(RPaladin) Hammer of Justice → 6(DPriest): usable 7 s, not used | 6(DPriest) did 71% of 3(FDKnight)'s damage taken in the 10 s before dying at 0:56 | at 0:50: 4.0yd, DR Full, 6(DPriest) PvP trinket on cooldown";
const spanned = (line: string, span: string) =>
  line
    .replace(/^\d+:\d{2}–\d+:\d{2}/, span)
    .replace(/at \d+:\d{2}:/, `at ${span.split("–")[0]}:`);

describe("checkCcSuggestionInsideSilence (fact12 D8)", () => {
  it("fails the 3e1f5c3a shape, and a peel line the same way", () => {
    expect(checkCcSuggestionInsideSilence([venom, bookmark])).toHaveLength(1);
    expect(checkCcSuggestionInsideSilence([venom, peel])).toHaveLength(1);
  });

  it("covers a … a+n−1 only: spans that end before it or begin after it pass", () => {
    // 0:50 | 3s → 0:50, 0:51, 0:52 surely silenced
    expect(
      checkCcSuggestionInsideSilence([venom, spanned(bookmark, "0:43–0:49")]),
    ).toEqual([]);
    expect(
      checkCcSuggestionInsideSilence([venom, spanned(bookmark, "0:53–0:59")]),
    ).toEqual([]);
    expect(
      checkCcSuggestionInsideSilence([venom, spanned(bookmark, "0:52–0:58")]),
    ).toHaveLength(1);
  });

  it("reads the trinket form, the round-end form and `<1s`", () => {
    const trinket = venom.replace(
      "| 3s",
      "| trinket broke this silence after 1s (cut short — it had not expired)",
    );
    expect(
      checkCcSuggestionInsideSilence([trinket, spanned(bookmark, "0:50–0:56")]),
    ).toHaveLength(1);
    expect(
      checkCcSuggestionInsideSilence([trinket, spanned(bookmark, "0:51–0:57")]),
    ).toEqual([]);
    const short = venom.replace("| 3s", "| <1s");
    expect(
      checkCcSuggestionInsideSilence([short, spanned(bookmark, "0:50–0:56")]),
    ).toHaveLength(1);
    const roundEnd = venom.replace(
      "| 3s",
      "| still on them when the round ended, 2s in",
    );
    expect(
      checkCcSuggestionInsideSilence([
        roundEnd,
        spanned(bookmark, "0:51–0:57"),
      ]),
    ).toHaveLength(1);
  });

  it("a peel span may hold a silence its usable count leaves out (605: 144-4-838)", () => {
    const sv =
      "1:11  [SILENCE]   4(FMage) ← Spider Venom (by 3(BMHunter)) | 3s";
    const p = (n: number, span = "1:10–1:19") =>
      `${span}  [PEEL OPTION]  2(HPaladin) Hammer of Justice → 4(FMage): usable ${n} s, not used | 4(FMage) did 51% of 1(UDKnight)'s damage taken in the 10 s before dying at 1:19 | at ${span.split("–")[0]}: 7.2yd, DR Full, 4(FMage) PvP trinket ready`;
    // 1:10–1:19 is 10 seconds, 1:11–1:13 silenced: at most 7 usable
    expect(checkCcSuggestionInsideSilence([sv, p(5)])).toEqual([]);
    expect(checkCcSuggestionInsideSilence([sv, p(7)])).toEqual([]);
    expect(checkCcSuggestionInsideSilence([sv, p(8)])).toHaveLength(1);
    expect(checkCcSuggestionInsideSilence([sv, p(9)])).toHaveLength(1);
    // an end inside the silence is a usable second the silence covers
    expect(
      checkCcSuggestionInsideSilence([sv, p(2, "1:13–1:19")]),
    ).toHaveLength(1);
    expect(
      checkCcSuggestionInsideSilence([sv, p(2, "1:05–1:12")]),
    ).toHaveLength(1);
  });

  it("a silence on another unit says nothing", () => {
    expect(
      checkCcSuggestionInsideSilence([
        venom.replace("6(DPriest)", "5(AWarlock)"),
        bookmark,
      ]),
    ).toEqual([]);
  });
});
