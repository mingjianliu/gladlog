/**
 * WO3 #17 (r1008-140): a friendly Cauterize / Cheat Death proc gets a [PROC]
 * line — the owner's as [YOU], a teammate's as [TEAM]; another player's aura
 * of the id, or one after the round's end, does not.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { emitFriendlyCheatDeathEntries } from "../src/context/timelineSections/friendlyCheatDeath";
import { ensureAnalysisData } from "../src/data/ensure";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const aura = (spellId: string, src: string, dest: string, s: number) => ({
  spellId,
  spellName: "灼烧",
  srcUnitId: src,
  destUnitId: dest,
  logLine: { event: LogEvent.SPELL_AURA_APPLIED, timestamp: T0 + s * 1000 },
});
const unit = (id: string, auraEvents: unknown[]): any => ({
  id,
  name: `${id}-R-US`,
  spec: "63",
  auraEvents,
});

describe("emitFriendlyCheatDeathEntries", () => {
  it("[YOU] / [TEAM] lines, round-clipped, own aura only", () => {
    const owner = unit("o", [aura("87023", "o", "o", 166.88)]);
    const mate = unit("m", [
      aura("45182", "m", "m", 20.2),
      aura("87023", "x", "m", 30), // not its own
      aura("87023", "m", "m", 185), // after the round's end
    ]);
    const lines: string[] = [];
    const emitted = emitFriendlyCheatDeathEntries({
      owner,
      friends: [owner, mate],
      matchStartMs: T0,
      matchEndSeconds: 200,
      roundEndAtMs: T0 + 180_000,
      pid: (n) => `[${n}]`,
      addEntry: (_t, l) => lines.push(l),
    });
    expect(emitted).toBe(true);
    expect(lines).toEqual([
      "2:46  [YOU] [PROC]   Cauterize (cheat-death proc)",
      "0:20  [TEAM] [PROC]   [m-R-US] (Fire Mage): Cheat Death (cheat-death proc)",
    ]);
  });
});
