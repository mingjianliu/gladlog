import { serializeFactsBlock } from "@gladlog/analysis/src/analysis/factFormat";
import { describe, expect, it } from "vitest";

import { checkFactsBlockIntegrity, parseFactsBlock } from "../src/quality/promptQualityCheck";

const menu = (facts: string) =>
  `  - id=kick-eaten:P1:92 type=kick-eaten t=92.2s units=A/B facts={${facts}}`;

describe("checkFactsBlockIntegrity (18th hardFailure class, 2026-09-16)", () => {
  it("a ', ' inside a facts value is a hard failure — the text-side parser truncates it", () => {
    const line = menu("t=92.2, interrupted=Holy Fire, postKick=acted on another school 2.4s later (Fade, instant or channel)");
    const fails = checkFactsBlockIntegrity([line]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("instant or channel)");
    // the fingerprint: the shared parser really does lose the tail
    expect(parseFactsBlock(line.replace(/^.*facts=\{(.*)\}\s*$/, "$1")).postKick).toBe(
      "acted on another school 2.4s later (Fade",
    );
  });
  it("the producers' separators ('; ' qualifier, '、' enumeration) pass", () => {
    expect(
      checkFactsBlockIntegrity([
        menu("t=92.2, postKick=acted on another school 2.4s later (Fade; instant or channel)"),
        "  - id=missed-cleanse:P1:169 type=missed-cleanse t=169.2s units=A facts={t=169.2, ownerCastingS=1.7, ownerCastingSpells=Mind Control、Mind Blast}",
        "  - key=hp kind=state facts={hp=44, note=fine}",
      ]),
    ).toEqual([]);
  });
  it("the serializer's no-break-space escape round-trips through the gate parser", () => {
    const block = serializeFactsBlock({ t: 96, readyCds: "Invoke Chi-Ji, the Red Crane" });
    expect(checkFactsBlockIntegrity([`  - id=cd-hoarded:P1:96 type=cd-hoarded t=96s units=A facts={${block}}`])).toEqual([]);
    expect(parseFactsBlock(block).readyCds).toBe("Invoke Chi-Ji,\u00a0the Red Crane");
  });
  it("lines without a facts block are ignored", () => {
    expect(checkFactsBlockIntegrity(["1:23  [KICK]   4(WMonk) interrupted 1(HPriest)'s Flash Heal, twice"])).toEqual([]);
  });
});
