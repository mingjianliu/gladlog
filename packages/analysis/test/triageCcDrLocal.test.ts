/**
 * Triage 2026-09-29, cc-dr theme-local entries:
 *  - F-RT1: `[ROOT]` says what a rooted unit cast on others meanwhile
 *    instead of "this stretch worked like hard CC".
 */
import { describe, expect, it } from "vitest";

import { formatRootReachabilityEntries } from "../src/utils/rootReachability";

const root = (over: object) =>
  ({
    atSeconds: 23,
    durationSeconds: 6,
    rootedId: "o",
    rootedName: "Eaxlol-Sargeras-US",
    rootedIsFriendly: true,
    rootedRole: "melee",
    sourceName: "Shatters-Garrosh-US",
    sourceLabel: "Shatters-Garrosh-US",
    spellId: "122",
    spellName: "Frost Nova",
    unreachableSeconds: 5,
    sampledSeconds: 6,
    significant: true,
    ...over,
  }) as never;

describe("cc-dr F-RT1 — a rooted unit that acted is not locked out", () => {
  it("names the casts on others in place of 'worked like hard CC'", () => {
    const [e] = formatRootReachabilityEntries(
      [root({ castsOnOthers: [{ spellName: "Blind", destId: "e4" }] })],
      "o",
      (id) => (id === "e4" ? "4(RShaman)" : id),
    );
    expect(e!.line).toContain(
      "could not attack; cast 1 spell on others meanwhile (Blind → 4(RShaman))",
    );
    expect(e!.line).not.toContain("worked like hard CC");
  });
  it("control: no casts on others keeps the hard-CC wording", () => {
    const [e] = formatRootReachabilityEntries([root({})], "o");
    expect(e!.line).toContain(
      "could not attack; this stretch worked like hard CC",
    );
  });
});
