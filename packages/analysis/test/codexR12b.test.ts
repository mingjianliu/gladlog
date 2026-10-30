/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * codex 21-R12-b (2026-10-23), the fact-layer P1s of the F16 follow-ups.
 *  - #1 a control the holder's OWN team put on it while it was charmed locks
 *    its casting too (`charmedAt`, the `ccInstances` admission) — the Mind
 *    Controlled mage under its warlock's Mortal Coil read a ready kicker;
 *  - #4 a casting lock never closed runs its official length — an Ice Block
 *    that was the mage's last aura event, its REMOVED lost, was capped at
 *    that event (a zero-length lock).
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { castBlockingAuraAt } from "../src/utils/cannotCastIntervals";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

const T0 = 1_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);
const CHARMED_FLAGS = 0x1112;
const PLAYER_FLAGS = 0x512;

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("#1 own-team control on a charmed holder", () => {
  const flagged = (e: any, flags: number) => ({ ...e, destUnitFlags: flags });
  const mage = (charmed: boolean) =>
    makeUnit("Player-1-MAGE", {
      name: "Mage",
      spec: CombatUnitSpec.Mage_Fire,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        flagged(
          makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            "605",
            at(15),
            "Player-2-PRIEST",
            "Player-1-MAGE",
          ),
          charmed ? CHARMED_FLAGS : PLAYER_FLAGS,
        ),
        flagged(
          makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            "6789",
            at(17),
            "Player-1-LOCK",
            "Player-1-MAGE",
          ),
          charmed ? CHARMED_FLAGS : PLAYER_FLAGS,
        ),
        flagged(
          makeAuraEvent(
            LogEvent.SPELL_AURA_REMOVED,
            "605",
            at(17.2),
            "Player-2-PRIEST",
            "Player-1-MAGE",
          ),
          PLAYER_FLAGS,
        ),
        flagged(
          makeAuraEvent(
            LogEvent.SPELL_AURA_REMOVED,
            "6789",
            at(20),
            "Player-1-LOCK",
            "Player-1-MAGE",
          ),
          PLAYER_FLAGS,
        ),
      ],
    } as any);
  const ours = new Set(["Player-2-PRIEST"]);
  it("the warlock's Mortal Coil on its Mind Controlled mate holds it to the REMOVED", () => {
    const m = mage(true);
    expect(castBlockingAuraAt(m, ours, at(18))?.spellId).toBe("6789");
    expect(castBlockingAuraAt(m, ours, at(20.5))).toBeUndefined();
  });
  it("not charmed: a teammate's aura is not the other side's control", () => {
    expect(castBlockingAuraAt(mage(false), ours, at(18))).toBeUndefined();
  });
});

describe("#4 an unclosed casting lock", () => {
  it("an Ice Block with no REMOVED, the mage's last aura event, locks for its official length", () => {
    const mage = makeUnit("Player-1-MAGE", {
      name: "Mage",
      spec: CombatUnitSpec.Mage_Frost,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "45438",
          at(10),
          "Player-1-MAGE",
          "Player-1-MAGE",
          "BUFF",
        ),
      ],
    } as any);
    const lock = castBlockingAuraAt(mage, new Set(["x"]), at(12));
    expect(lock?.spellId).toBe("45438");
    expect(lock?.to).toBe(at(20));
    expect(castBlockingAuraAt(mage, new Set(["x"]), at(21))).toBeUndefined();
  });
});
