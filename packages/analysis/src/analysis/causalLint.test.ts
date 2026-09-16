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
    expect(
      causalLint("Overextending cost us the game.").length,
    ).toBeGreaterThan(0);
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
  it("does not bridge a gap across ! / ? (NOT_SENT tightening applies to English too, not just zh)", () => {
    // Pre-2026-07-31 the gap class was ASCII-"."-only, so this DID match
    // (no "." between "died" and "because"). NOT_SENT now also excludes
    // "!"/"?"/newlines, so a question mark correctly breaks the "outcome ...
    // because" span — this is a real tightening, not "zero behavior change
    // for English" (see the NOT_SENT comment in causalLint.ts).
    expect(causalLint("You died? Yes, because you overextended.")).toEqual([]);
  });
});

// 2026-07-31: 300-match agy production simulation (production default
// aiLanguage=zh) found 8 real Chinese causal-certainty overclaims across 6
// response files that the English-only gate above cannot see. Quotes below
// are verbatim from
// $HOME/code/gladlog-eval-private/agy-sim-2026-07-31/deep-read.md Part 4.
//
// Red→green: a minimal replica of the pre-2026-07-31 (English-only)
// PATTERNS list must fail to flag all 8 — proving this is genuinely new
// coverage, not a pre-existing capability nobody exercised.
const OLD_ENGLISH_ONLY_OUTCOME =
  "(died|death|dies|die|lost|loss|lose|loses|wiped|wipe|killed|defeat)";
const OLD_ENGLISH_ONLY_PATTERNS: RegExp[] = [
  new RegExp(`\\b${OLD_ENGLISH_ONLY_OUTCOME}\\b[^.]*\\bbecause\\b`, "i"),
  new RegExp(`\\bbecause\\b[^.]*\\b${OLD_ENGLISH_ONLY_OUTCOME}\\b`, "i"),
  /\bcost (you |us |him |her |them |the team )?(the )?(game|round|match|series)\b/i,
  /\bgot (you|him|her|them|the team) killed\b/i,
  new RegExp(
    `\\b(that'?s|this is|which is) why\\b[^.]*\\b${OLD_ENGLISH_ONLY_OUTCOME}\\b`,
    "i",
  ),
  new RegExp(
    `\\b(led to|resulted in|caused)\\b[^.]*\\b${OLD_ENGLISH_ONLY_OUTCOME}\\b`,
    "i",
  ),
];
function oldGateWouldFlag(text: string): boolean {
  return OLD_ENGLISH_ONLY_PATTERNS.some((rx) => rx.test(text));
}

const ZH_LABELED_VIOLATIONS = [
  // 002bcc0b.0 — on the audited decisive Blessing of Protection counterfactual.
  "如果在你血量跌破 30% 时他能给你一个 Blessing of Protection（可完全免疫猎人宠物的物理伤害），这波你绝对死不了。",
  // 7c0b2197.0 — unaudited Pain Suppression counterfactual, adjacent paragraph.
  "如果你没被控，或者预判到了控制并提前给出了你的减伤，他也不会死。",
  // d49b55cc.0 (1st) — on the audited decisive Aspect of the Turtle counterfactual.
  "如果他早交两秒，绝对可以存活。",
  // d49b55cc.0 (2nd) — unaudited Blessing of Spellwarding counterfactual, same file.
  "如果他在 Warrior 斩杀你时给出技能，你完全可以活下来。",
  // 889c99db.0 — a "died because X wasn't used" pattern tied to CD-stacking.
  "你在这场比赛中的减伤循环是直接导致你最终死亡的原因。",
  // 43065b44.0 — no-retreat/no-mitigation decision tied to death with certainty.
  "你不撤退的结果就是10秒内硬吃了740k的爆发伤害，直接猝死。",
  // d9bc7413.0 — header over an "ignoring Ironbark" section.
  "这是导致输掉比赛的直接原因。",
  // efc88dcb.0 — unused defensive cooldowns tied to the match outcome.
  "没有交出任何保命技能，这是直接导致输掉比赛的原因。",
];

describe("causalLint zh causal-certainty patterns (agy-sim-2026-07-31, 8 labeled violations)", () => {
  it.each(ZH_LABELED_VIOLATIONS)("flags labeled violation: %s", (quote) => {
    expect(oldGateWouldFlag(quote)).toBe(false); // red: old English-only gate is blind
    expect(causalLint(quote).length).toBeGreaterThan(0); // green: new gate catches it
  });

  it("does not flag legal-possibility framing (可能/或许/大概率/有机会 + 活)", () => {
    expect(causalLint("如果队友早两秒摆脱控制，可能就活下来了。")).toEqual([]);
    expect(causalLint("他或许能撑到治疗跟上，大概率能活下来。")).toEqual([]);
    expect(causalLint("这波至少有机会活下来，具体要看对面收人速度。")).toEqual(
      [],
    );
    expect(causalLint("就算他及时使用了防御技能，也未必能活下来。")).toEqual(
      [],
    );
  });

  it("does not flag the product's own decisive-line hedge phrasing (假设式, 无确定性断言)", () => {
    expect(causalLint("若同窗叠加圣盾术，该段伤害约降至致死线下。")).toEqual(
      [],
    );
    expect(
      causalLint(
        "反事实(算术,单因素):若换上 Ice Block,该段窗口伤害将降至致死线以下(裕量 >15% 最大生命值)。",
      ),
    ).toEqual([]);
  });

  it("does not flag mere factual descriptions of damage/death (no causal-certainty language)", () => {
    expect(
      causalLint("你死于三人集火，治疗当时正在处理另一侧的爆发。"),
    ).toEqual([]);
    expect(causalLint("本局你被击杀两次，分别在 1:23 和 2:45。")).toEqual([]);
  });

  it("does not flag positive-valence 是...的直接原因 (attributing a WIN, not a loss/death)", () => {
    // Real corpus phrasing (463f8b04.0). zh-shi-direct-reason requires a
    // ZH_OUTCOME (negative) word in the gap precisely so this stays
    // unflagged — mirrors English's explicit allowance for "which is why
    // you survived". Pinned here so a future ZH_OUTCOME/gap-width edit
    // can't silently regress it back to matching.
    expect(causalLint("这也是你们获胜的直接原因。")).toEqual([]);
  });

  it("dedicated fixture: zh-outcome-because only (outcome word BEFORE 因为, no 导致/造成/致使, no 是...的直接原因)", () => {
    // Removing zh-outcome-because from PATTERNS must break this test —
    // zh-led-to/zh-because-outcome/zh-shi-direct-reason cannot cover the
    // OUTCOME-before-因为 word order on their own.
    expect(causalLint("阵亡完全是因为你走位失误。")).toEqual([
      "strong causal claim (zh-outcome-because)",
    ]);
  });

  it("dedicated fixture: zh-shi-direct-reason only (是...的直接原因 with no 导致/造成/致使/因为)", () => {
    // Removing zh-shi-direct-reason from PATTERNS must break this test —
    // no other pattern contains a bare 是...OUTCOME...的直接原因 without
    // one of the other connectives.
    expect(causalLint("没交减伤是你阵亡的直接原因。")).toEqual([
      "strong causal claim (zh-shi-direct-reason)",
    ]);
  });

  it("negation guard: 没有/不会/并未/未曾/从未 immediately before the connective denies causation, must NOT flag", () => {
    // Real corpus sentence: agy-sim-2026-07-31/responses/48357f81.0.txt:14 —
    // confirmed false positive on zh-led-to before the guard was added
    // ("fortunately did NOT lead to the subsequent collapse").
    expect(causalLint("所幸没有导致后续崩盘。")).toEqual([]);
  });

  it("negation guard: single-character 未/不 immediately before the connective, must NOT flag (re-review round 2)", () => {
    // Reproduced by re-review: the original guard only listed multi-char
    // negators (没有/不会/并未/未曾/从未), so single-char 未/不 immediately
    // before 导致 bypassed it entirely.
    expect(causalLint("这个决策未导致后续崩盘。")).toEqual([]);
    expect(causalLint("这个决策不导致后续崩盘。")).toEqual([]);
    // 从不 (never) also ends in 不 — distinct word from 从未, must also be caught.
    expect(causalLint("这种操作从不导致团灭。")).toEqual([]);
  });

  it("negation guard does not over-block: 不 NOT immediately before the marker, or genuinely negating something else, must still flag/stay unaffected", () => {
    // "不仅" (not only) ends in 仅, not 不 — the char immediately before
    // 导致 is 仅, so the (?<!不) lookbehind does not apply here. The
    // sentence still makes an unhedged causal-outcome claim.
    expect(
      causalLint("这不仅导致了团灭，还让治疗提前挂了。").length,
    ).toBeGreaterThan(0);
    // "不是因为...而是因为" — the char immediately before each 因为 is 是,
    // not 不, so neither occurrence is blocked; the second clause asserts
    // B as the real cause with certainty (this is 2da07717.0's real
    // corpus structure).
    expect(
      causalLint(
        "你输掉比赛根本不是因为治疗量不够，而是因为该交技能的时候捏着不放。",
      ).length,
    ).toBeGreaterThan(0);
    // "不得不" (had no choice but to) is earlier in the sentence, nowhere
    // near the 导致 connective — the lookbehind only inspects the exact
    // position immediately before the marker (才导致, not 不导致), so this
    // must still flag.
    expect(
      causalLint("你不得不交出减伤，这才导致了后续的崩盘。").length,
    ).toBeGreaterThan(0);
  });

  it("8 labeled violations still all flag after the negation-guard fix (recall protection)", () => {
    for (const quote of ZH_LABELED_VIOLATIONS) {
      expect(causalLint(quote).length).toBeGreaterThan(0);
    }
  });

  it("flags the report.md example (因为...而死亡, generic zh outcome-because)", () => {
    expect(causalLint("你的治疗因为你没有拆火而死亡。").length).toBeGreaterThan(
      0,
    );
  });

  it("keeps a bounded gap so a match does not silently span an unrelated sentence (zh sentence terminators)", () => {
    // "因为" in one sentence, an unrelated "死亡" two sentences later — must
    // NOT be treated as one connective span (this is the segmentation bug
    // constraint 6 asks to guard against: 。！？ must bound the gap like "."
    // does for English).
    expect(
      causalLint(
        "因为对面开了控制链，你的走位其实没有问题。团队整体发挥不错。这局最后阵亡是三号目标猝死带走的另一个人，和你无关。",
      ),
    ).toEqual([]);
  });
});

// 2026-07-31: BACKLOG gap #1 — zh-shi-direct-reason's natural negation
// (不是/也不是/并不是/并非是) was unguarded; "这不是你阵亡的直接原因" would
// have flagged as if asserting the opposite of what it says.
describe("causalLint zh-shi-direct-reason negation guard (BACKLOG gap #1: 不是/并非)", () => {
  it("does not flag 不是/也不是/并不是 forms (explicit denial of the direct-reason attribution)", () => {
    expect(causalLint("这不是你阵亡的直接原因。")).toEqual([]);
    expect(causalLint("这也不是你阵亡的直接原因。")).toEqual([]);
    expect(causalLint("这并不是你阵亡的直接原因。")).toEqual([]);
  });
  it("does not flag 并非(是) forms", () => {
    // Plain 并非 has no literal 是 at all, so it never matched this
    // 是...的直接原因 pattern regardless of any guard — pinned here as a
    // regression fixture, not evidence the guard did the work.
    expect(causalLint("这并非你阵亡的直接原因。")).toEqual([]);
    // 并非是 does contain a literal 是 and needs the (?<!非) guard.
    expect(causalLint("这并非是你阵亡的直接原因。")).toEqual([]);
  });
  it("still flags the unnegated form (regression pin so the guard is not over-broad)", () => {
    expect(causalLint("没交减伤是你阵亡的直接原因。").length).toBeGreaterThan(
      0,
    );
  });
});

// 2026-07-31: BACKLOG gap #2 — hedge blindness. Possibility framing
// (可能/或许/大概/也许/似乎/恐怕 zh; possibly/perhaps/likely/may have/might
// have/could have en) is exactly what the product's honesty policy permits;
// since every consumer of causalLint DROPS content on a hit, flagging a
// hedge identically to a certainty claim is a pure false positive with a
// real cost. Fixtures below are symmetric across both languages by design —
// same connective family, same hedge-before-marker shape, different word
// lists.
describe("causalLint hedge exemption (BACKLOG gap #2, symmetric zh/en)", () => {
  it("zh: hedge immediately before a 导致/因为/结果就是/是 connective is exempted", () => {
    expect(causalLint("可能导致你阵亡。")).toEqual([]);
    expect(causalLint("可能因为你走位失误而阵亡。")).toEqual([]);
    expect(causalLint("也许结果就是团灭。")).toEqual([]);
    expect(causalLint("这或许是你阵亡的直接原因。")).toEqual([]);
    expect(causalLint("如果他及时处理，或许也不会死。")).toEqual([]);
  });
  it("zh: a hedge earlier in the same sentence still exempts a confidently-worded clause (可能 governs the whole clause)", () => {
    // Product's own example: "很可能就是因为X你才死" reads confidently but
    // 可能 (inside 很可能) governs the whole clause — this IS possibility
    // framing, exempting it is by design, not an over-block.
    expect(causalLint("这波很可能绝对死不了。")).toEqual([]);
  });
  it("zh: hedge exemption does not bridge across a sentence boundary", () => {
    // 可能 is in an earlier, unrelated sentence; the causal claim itself is
    // unhedged — must still flag (hedge scope is bounded like NEG_LOOKBEHIND).
    expect(
      causalLint("这波可能打得有点仓促。团灭是因为治疗没跟上节奏。").length,
    ).toBeGreaterThan(0);
  });
  it("en: hedge immediately/earlier before because/led-to/cost/got/that's-why is exempted", () => {
    expect(causalLint("You may have died because you overextended.")).toEqual(
      [],
    );
    expect(causalLint("This possibly led to the loss.")).toEqual([]);
    expect(causalLint("That could have cost you the game.")).toEqual([]);
    expect(causalLint("That could have got you killed.")).toEqual([]);
    expect(causalLint("Perhaps that's why you lost the round.")).toEqual([]);
  });
  it("en: hedge exemption does not bridge across a sentence boundary", () => {
    expect(
      causalLint(
        "This is possibly overthinking it. You died because you overextended.",
      ).length,
    ).toBeGreaterThan(0);
  });

  // 2026-07-31, round 2 (cross-AI review): Critical false-negative — the
  // round-1 guard was bounded only by NOT_SENT (sentence boundary), so a
  // hedge in an unrelated EARLIER CLAUSE of the same sentence exempted an
  // unhedged causal claim after a comma/但/but. Reproduced exactly as
  // reported; all three MUST flag (the hedge belongs to the prior clause,
  // not the clause making the causal claim).
  it("zh: hedge exemption does not bridge across a clause boundary (，/但/、/；/然而/不过/而)", () => {
    expect(
      causalLint("可能你没看到，但没交盾直接导致了死亡。").length,
    ).toBeGreaterThan(0);
    expect(
      causalLint("大概是这个原因，然而真正导致团灭的是治疗被秒吃满爆发。")
        .length,
    ).toBeGreaterThan(0);
    expect(
      causalLint("也许你没意识到，而没有交减伤才是你阵亡的直接原因。").length,
    ).toBeGreaterThan(0);
  });
  it("en: hedge exemption does not bridge across a clause boundary (,/;/but/however/though/yet)", () => {
    expect(
      causalLint(
        "You may have missed the block, but not swapping defensives directly caused the wipe.",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      causalLint(
        "This is possibly a stretch; the missed interrupt led to the wipe.",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      causalLint(
        "Perhaps that's overthinking it, however holding the cooldown directly caused the loss.",
      ).length,
    ).toBeGreaterThan(0);
  });
  it("zh: a quoted mention of a hedge word does not exempt an unrelated causal claim once separated by a clause boundary", () => {
    expect(
      causalLint("「可能」只是你的猜测，但没交减伤直接导致了团灭。").length,
    ).toBeGreaterThan(0);
  });
  it("recall protection: the 8 labeled zh violations are not hedged and must still all flag", () => {
    for (const quote of ZH_LABELED_VIOLATIONS) {
      expect(causalLint(quote).length).toBeGreaterThan(0);
    }
  });
  it("recall protection: existing English fixtures (unhedged) must still all flag", () => {
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
    expect(
      causalLint("Poor positioning got you killed.").length,
    ).toBeGreaterThan(0);
  });
});

describe("causalLint verdict forms (GH #98, first Opus 5 baseline 2026-09-15)", () => {
  // The 7 causal-hardening sentences the baseline's fact audit marked
  // `unsupported`. Before this block only the two `because` sentences hit;
  // the rest pass judgement without a connective the older patterns knew.
  it("flags the baseline's verdict sentences (5 shapes)", () => {
    for (const s of [
      "Even so, the round was decided by one thing: you pressed no major defensive during the whole go.",
      "The match was decided by how your resources lined up with the last two: Blessing of Sacrifice sat unused through the 1:34–1:48 go.",
      "The deciding mistake: at 1:00, two seconds before the death, you spent a GCD on an offensive stun on the Shaman.",
      "It worked because the kill landed at 0:50.",
      "The kill came from a CC chain on you at 52-60% dampening.",
      "Your healing output didn't lose this. The order you spent cooldowns in did, across three windows between 1:08 and 2:20.",
      "A 6s Full-DR fear at over 50% dampening, with no big cooldowns, is what lost this round.",
      "Your cooldown timing on the Rogue is what won it.",
      "Your death is what decided this match.",
    ])
      expect(causalLint(s), s).not.toEqual([]);
  });
  it("does not flag the baseline's non-causal `unsupported` sentences (precision)", () => {
    for (const s of [
      "Cyclones at 1:08 and 2:41 did not land while your Grounding Totem was up.",
      "Two of those stuns led straight into spending a Pain Suppression charge.",
      "Ultimate Penitence at 1:47 did heal the Shaman from 64% to 99%, but it came between the enemy's pushes, so it was gone for both later ones.",
      "It did put Forbearance on him until about 1:19, though.",
      "For the whole 0:53–1:05 Bladestorm dive, BoP could not go on him, and Sacrifice was still on cooldown from the opener.",
      "Apotheosis at 2:05 during the hunter's 1:55–2:05 spike brought him back from 44% (2:03) to 70% (2:14).",
      "Your Frost Mage died at 2:11 with dampening at 41%.",
      "The kill came at 2:00 during their cooldowns.",
      "You decided to trinket the fear at 1:31.",
    ])
      expect(causalLint(s), s).toEqual([]);
  });
  it("denial and hedge exempt the verdict forms (polarity guard, same as zh)", () => {
    for (const s of [
      "Offense wasn't the deciding factor here — you converted CC in most kill windows.",
      "The round was not decided by dampening.",
      "This was likely decided by the opener, but the log cannot show it.",
      "It may have worked because Ironbark was up.",
    ])
      expect(causalLint(s), s).toEqual([]);
  });
  it("standing policy pin: positive-reinforcement `which is why …` stays exempt", () => {
    // Deliberately NOT flagged — the narrowed thats-why pattern requires a
    // negative outcome. Recorded here so the exemption is a decision, not a gap.
    expect(
      causalLint("That spent the immunity before the 2:34 go, which is why the kill went through."),
    ).toEqual([]);
    expect(
      causalLint("Your team got through all three enemy Incarnation goes with nobody dying, and that is why you won."),
    ).toEqual([]);
  });
});
