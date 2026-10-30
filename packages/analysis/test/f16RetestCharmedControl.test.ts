/**
 * F16 same-round retest (2026-10-21) idx 21 (0d08dd90 r3 0:17): a control the
 * holder's own teammate put on it while it was Mind Controlled is a control
 * on it — the mage trinketed out of its warlock's Mortal Coil and the
 * [ENEMY TRINKET] line said no `out of`.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { analyzePlayerCCAndTrinket } from "../src/utils/ccTrinketAnalysis";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

const T0 = 1_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);
const combat = {
  startTime: T0,
  endTime: at(120),
  startInfo: { zoneId: "1672" },
};
const MIND_CONTROL = "605";
const MORTAL_COIL = "6789";
/** a Player- unit flagged as a controlled pet (Mind Control) */
const CHARMED_FLAGS = 0x1112;
const PLAYER_FLAGS = 0x512;

beforeAll(async () => {
  await ensureAnalysisData();
});

const charmedRun = (charmed: boolean) => {
  const flagged = (e: any, flags: number) => ({ ...e, destUnitFlags: flags });
  const mage = makeUnit("Player-1-MAGE", {
    name: "Mage",
    spec: CombatUnitSpec.Mage_Fire,
    reaction: CombatUnitReaction.Hostile,
    auraEvents: [
      flagged(
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          MIND_CONTROL,
          at(15.657),
          "Player-2-PRIEST",
          "Player-1-MAGE",
        ),
        charmed ? CHARMED_FLAGS : PLAYER_FLAGS,
      ),
      flagged(
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          MORTAL_COIL,
          at(17.229),
          "Player-1-LOCK",
          "Player-1-MAGE",
        ),
        charmed ? CHARMED_FLAGS : PLAYER_FLAGS,
      ),
      flagged(
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          MIND_CONTROL,
          at(17.462),
          "Player-2-PRIEST",
          "Player-1-MAGE",
        ),
        PLAYER_FLAGS,
      ),
      flagged(
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          MORTAL_COIL,
          at(18.842),
          "Player-1-LOCK",
          "Player-1-MAGE",
        ),
        PLAYER_FLAGS,
      ),
    ],
  });
  const priest = makeUnit("Player-2-PRIEST", {
    name: "Priest",
    spec: CombatUnitSpec.Priest_Shadow,
    reaction: CombatUnitReaction.Friendly,
  });
  return analyzePlayerCCAndTrinket(mage, [priest], combat as never).ccInstances;
};
const run = (charmed: boolean) => charmedRun(charmed).map((c) => c.spellName);

describe("F16 retest — a teammate's control on a charmed holder", () => {
  it("Mortal Coil from the holder's warlock while Mind Controlled is a CC instance; not charmed, it is not", () => {
    expect(run(true)).toContain("Mortal Coil");
    expect(run(false)).not.toContain("Mortal Coil");
  });
  it("the instance is marked as the holder's own team's", () => {
    const all = (charmed: boolean) => charmedRun(charmed);
    const coil = all(true).find((c) => c.spellName === "Mortal Coil");
    expect(coil?.fromOwnTeamWhileCharmed).toBe(true);
    const mc = all(true).find((c) => c.spellName === "Mind Control");
    expect(mc?.fromOwnTeamWhileCharmed).toBeUndefined();
  });
});
