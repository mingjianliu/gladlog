import { describe, expect, it } from "vitest";

import { auditFindings } from "./auditFindings";
import { buildFindingsPrompt } from "./buildFindingsPrompt";
import {
  citableEventCount,
  citableEvents,
  EVENT_MENU_HEADER,
  eventIdSetKey,
  FINDINGS_COUNT_MAX,
  FINDINGS_COUNT_MIN,
  findingsCountInstruction,
  findingsPromptHead,
  menuEventIdsOfPrompt,
} from "./findingsCount";
import type { CandidateEvent } from "./types";

const ev = (
  id: string,
  type = "kick-eaten",
  facts: Record<string, string> = { t: "10" },
): CandidateEvent => ({ id, type, t: 10, unitNames: ["Me-R"], facts });
const menuOf = (n: number): CandidateEvent[] =>
  Array.from({ length: n }, (_, i) => ev(`kick-eaten:p:${i}`));
const headOf = (candidates: CandidateEvent[]): string =>
  buildFindingsPrompt(candidates, "CTX", "Holy Paladin").split("\n")[0]!;

/** The sentence every prompt opened with before L07 (PROMPT_VERSION ≤ 377),
 * copied from that source — the text a menu of four or more must still get,
 * byte for byte. */
const BEFORE = `Produce 4-8 coaching findings as JSON — as many as the event menu genuinely supports; never fabricate, but prefer covering MORE distinct menu events over polishing few. Spread coverage across the whole match: when the menu has early/mid-game events (missed-cleanse, missed-purge, kick-eaten, bursts, kicks, targeting), do not spend every finding on the final seconds, and cover at least two non-death event types when present. At most 2 findings may be anchored solely on death events; when a death has "death-setup" events, pair them into one chain finding instead of adding another death-only item. Prioritize covering DIFFERENT event types over repeating the same one: of "missed-cleanse", "missed-purge", at most 3 findings TOTAL (combined across both, not 3 each) may draw from that group even when the menu offers more of them — spend your remaining picks on other types instead.`;

describe("findingsCountInstruction — the requested count follows the menu (L07 b, 2026-10-11)", () => {
  it("N = 0: untouched — an empty menu is never sent to a model", () => {
    expect(findingsCountInstruction(0)).toBe(BEFORE);
  });

  it("N = 1: up to one finding, and none of the multi-finding selection rules", () => {
    const s = findingsCountInstruction(1);
    expect(s).toBe(
      "Produce up to 1 coaching finding as JSON — at most one per menu event, and the menu holds a single event; never fabricate.",
    );
    expect(s).not.toMatch(
      /4-8|At most 2|at most 3|chain|Spread|remaining picks/,
    );
    // no clause about whether the one event deserves a finding (see the
    // doc comment: the smoke's empty reply)
    expect(s).not.toMatch(/only if|genuinely/);
  });

  it("N = 2: up to two, one per menu event, and the chain sentence (a chain needs two rows)", () => {
    expect(findingsCountInstruction(2)).toBe(
      `Produce up to 2 coaching findings as JSON — at most one per menu event, covering as many of the menu's 2 events as genuinely support one; never fabricate. When a death has "death-setup" events, pair them into one chain finding instead of adding another death-only item.`,
    );
  });

  it("N = 3: up to three, with the death cap of two that can bind at three", () => {
    expect(findingsCountInstruction(3)).toBe(
      `Produce up to 3 coaching findings as JSON — at most one per menu event, covering as many of the menu's 3 events as genuinely support one; never fabricate. At most 2 findings may be anchored solely on death events; when a death has "death-setup" events, pair them into one chain finding instead of adding another death-only item.`,
    );
  });

  it("N = 4 and N = 5: the sentence as it was, byte for byte", () => {
    expect(FINDINGS_COUNT_MIN).toBe(4);
    expect(FINDINGS_COUNT_MAX).toBe(8);
    expect(findingsCountInstruction(4)).toBe(BEFORE);
    expect(findingsCountInstruction(5)).toBe(BEFORE);
    expect(findingsCountInstruction(40)).toBe(BEFORE);
  });

  it("below the minimum no sentence asks for more findings than the menu has events, and none names the 4-8 range or a cap that cannot bind", () => {
    for (let n = 1; n < FINDINGS_COUNT_MIN; n++) {
      const s = findingsCountInstruction(n);
      expect(s, String(n)).not.toContain("4-8");
      expect(s, String(n)).not.toContain("prefer covering MORE");
      expect(s, String(n)).not.toContain("at most 3 findings TOTAL");
      expect(s, String(n)).not.toContain("remaining picks");
      // every "N findings" the sentence states is within the menu
      for (const m of s.matchAll(/\b(\d+) (?:coaching )?findings?\b/g))
        expect(Number(m[1]), `${n}: ${m[0]}`).toBeLessThanOrEqual(n);
    }
  });
});

describe("buildFindingsPrompt's first line is findingsPromptHead of its own menu", () => {
  it.each([0, 1, 2, 3, 4, 5])("a menu of %i", (n) => {
    const head = headOf(menuOf(n));
    expect(head).toBe(findingsPromptHead("Holy Paladin", n));
    expect(head).toBe(
      `You are a World of Warcraft arena coach reviewing a Holy Paladin's match. ${findingsCountInstruction(n)}`,
    );
  });

  it("the count is taken from the menu it is given — nothing else on the prompt moves with it", () => {
    const three = buildFindingsPrompt(menuOf(3), "CTX", "Holy Paladin");
    const four = buildFindingsPrompt(menuOf(4), "CTX", "Holy Paladin");
    const rest = (p: string, n: number) =>
      p
        .split("\n")
        .slice(1)
        .filter((l) => !l.startsWith(`  - id=kick-eaten:p:${n - 1} `));
    expect(rest(four, 4)).toEqual(rest(three, 4));
  });
});

describe("one definition of a menu event: the builder's count, the audit's map and the rendered menu agree", () => {
  it("N is the number of distinct ids — two rows sharing an id are one thing to cite", () => {
    const twice = [
      ev("kick-eaten:p:51", "kick-eaten", { t: "50.8" }),
      ev("kick-eaten:p:51", "kick-eaten", { t: "51.1" }),
      ev("death:a:60", "death", { t: "60" }),
      ev("cd-waste:p:1", "cd-waste", { spell: "Ice Block" }),
    ];
    expect(citableEventCount(twice)).toBe(3);
    expect(citableEvents(twice).size).toBe(3);
    // the audit resolves the shared id to the later row, as it always did
    expect(citableEvents(twice).get("kick-eaten:p:51")!.facts.t).toBe("51.1");
    const prompt = buildFindingsPrompt(twice, "CTX", "Fire Mage");
    const lines = prompt.split("\n");
    // four rows on the page, three events to cite, "up to 3"
    expect(menuEventIdsOfPrompt(lines)).toEqual(twice.map((c) => c.id));
    expect(citableEventCount(twice)).toBe(
      new Set(menuEventIdsOfPrompt(lines)).size,
    );
    expect(lines[0]).toContain("Produce up to 3 coaching findings");
    const r = auditFindings(
      [
        {
          eventIds: ["kick-eaten:p:51"],
          severity: "med",
          category: "interrupts",
          title: "Kick",
          explanation: "Kicked at {{t}}s.",
        },
      ],
      twice,
    );
    expect(r.findings[0]!.explanation).toBe("Kicked at 51.1s.");
  });

  it("menuEventIdsOfPrompt reads back every id the builder wrote, whole-round rows and ids with spaces included", () => {
    const menu = [
      ev("death-setup:Player-1-0A:119:healer-locked", "death-setup"),
      ev("cd-waste:Player-1-0A:48792", "cd-waste", { spell: "Icebound" }),
      ev("odd id with spaces:1", "kick-eaten"),
    ];
    const lines = buildFindingsPrompt(
      menu,
      "a context line\n  - id=not-a-menu-row type=death t=1s",
      "Frost Death Knight",
    ).split("\n");
    expect(lines).toContain(EVENT_MENU_HEADER);
    expect(menuEventIdsOfPrompt(lines)).toEqual(menu.map((c) => c.id));
  });

  it("an empty menu reads back as no ids; a text without a menu block as null", () => {
    expect(
      menuEventIdsOfPrompt(
        buildFindingsPrompt([], "", "Holy Priest").split("\n"),
      ),
    ).toEqual([]);
    expect(
      menuEventIdsOfPrompt(["MATCH TIMELINE", "0:10 [KICK] x"]),
    ).toBeNull();
  });

  it("eventIdSetKey: order and repeats do not matter, membership does", () => {
    expect(eventIdSetKey(["b", "a", "b"])).toBe(eventIdSetKey(["a", "b"]));
    expect(eventIdSetKey(["a"])).not.toBe(eventIdSetKey(["a", "b"]));
    expect(eventIdSetKey(["a:b"])).not.toBe(eventIdSetKey(["a", "b"]));
  });
});
