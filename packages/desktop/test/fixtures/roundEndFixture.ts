import type { StoredMatch } from "../../src/renderer/src/report/derive/types";
import { loadRealMatchFixture } from "./loadFixture";

/** Second of the injected death — the round's end when the bracket is Solo
 * Shuffle. */
export const ROUND_END_DEATH_S = 70;
export const SOLO_SHUFFLE = "Rated Solo Shuffle";

type RawUnit = {
  id: string;
  name: string;
  auraEvents: Array<{ timestamp: number }>;
  deaths: Array<Record<string, unknown>>;
};

/**
 * The real fixture (3v3, 90 s, no player death) with a round end inside it.
 *
 * It carries enemy buffs nobody purged across 66–90 s: Void Shield on Player2
 * from 66.385 s for 20 s, on Player5 from 66.386 s for 14 s, on Player4 for
 * 7 s, Prayer of Mending on Player4 from 67.143 s for 7 s, and six more
 * applied after 70 s. Two things are injected: a death of Player5 at
 * `ROUND_END_DEATH_S`, and a Fear on Player1 from 64 s to 72 s (the fixture
 * has no uncleansed window of its own). Under `SOLO_SHUFFLE` the death is the
 * round's end; under any other bracket it is a death and the round runs to
 * the log's end.
 */
export function roundEndFixture(bracket: string): StoredMatch {
  const m = JSON.parse(JSON.stringify(loadRealMatchFixture())) as StoredMatch;
  (m as { bracket: string }).bracket = bracket;
  const units = Object.values(m.units as unknown as Record<string, RawUnit>);
  const named = (name: string) => units.find((u) => u.name === name)!;
  const dying = named("Player5-Test");
  dying.deaths.push({
    timestamp: m.startTime + ROUND_END_DEATH_S * 1000,
    eventName: "UNIT_DIED",
    spellId: 0,
    spellName: "",
    srcId: "",
    srcName: "",
    destId: dying.id,
    destName: dying.name,
    unconscious: false,
  });
  const feared = named("Player1-Test");
  const caster = named("Player4-Test");
  const fear = (eventName: string, atS: number) => ({
    timestamp: m.startTime + atS * 1000,
    eventName,
    srcId: caster.id,
    srcName: caster.name,
    destId: feared.id,
    destName: feared.name,
    spellId: 5782,
    spellName: "Fear",
    auraType: "DEBUFF",
  });
  feared.auraEvents.push(
    fear("SPELL_AURA_APPLIED", 64),
    fear("SPELL_AURA_REMOVED", 72),
  );
  feared.auraEvents.sort((a, b) => a.timestamp - b.timestamp);
  return m;
}
