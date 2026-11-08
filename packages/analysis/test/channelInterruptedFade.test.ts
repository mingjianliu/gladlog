/**
 * GH #173.3 (pipeline T19): a channel kicked near its natural end read
 * `(interrupted at 1.6s, ended 0:23)` on its `[YOU] [CD]` press and
 * `Dark Harvest (expired)` on its `[BUFF FADED]` — the fade read the length
 * share only (`CHANNEL_STOPPED_MAX_SHARE`). It now asks the press line's own
 * question, `channelWasInterrupted`, on the same channel end.
 */
import {
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  channelWasInterrupted,
  extractOwnerCDBuffExpiry,
} from "../src/context/timelineHelpers";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_700_000_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);
const DH = "1257052"; // Dark Harvest, a ~2 s channel

beforeAll(async () => {
  await ensureAnalysisData();
});

const warlock = (castS: number, removedS: number) =>
  makeUnit("player-1", {
    name: "You",
    class: CombatUnitClass.Warlock,
    spec: CombatUnitSpec.Warlock_Affliction,
    info: {},
    spellCastEvents: [makeSpellCastEvent(DH, at(castS), "player-1")],
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        DH,
        at(castS),
        "player-1",
        "player-1",
        "BUFF",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        DH,
        at(removedS),
        "player-1",
        "player-1",
        "BUFF",
      ),
    ],
  });
const cds = (castS: number) => [
  {
    spellId: DH,
    spellName: "Dark Harvest",
    tag: "Offensive",
    casts: [{ timeSeconds: castS }],
    cooldownSeconds: 60,
    neverUsed: false,
    availableWindows: [],
  },
];
const kickAt = (s: number) => ({
  ccInstances: [],
  interruptInstances: [{ atSeconds: s }],
});
const fadeOf = (castS: number, removedS: number, cc?: unknown) => {
  const u = warlock(castS, removedS);
  return extractOwnerCDBuffExpiry(
    cds(castS) as never,
    u.id,
    [u],
    T0,
    u,
    [],
    at(300),
    cc as never,
  )[0];
};

describe("[BUFF FADED] of an interrupted channel (GH #173.3)", () => {
  it("kicked at 1.6 s of ~2 s: the press reads interrupted, so the fade is no expiry", () => {
    expect(channelWasInterrupted(kickAt(21.6) as never, 20, 21.6)).toBe(true);
    const e = fadeOf(20, 21.6, kickAt(21.6));
    expect(e?.cause).toBe("ended_early");
    expect(e?.channelStoppedAfterS).toBeCloseTo(1.6, 3);
  });

  it("controls: no kick, a kick that left it running, no summary — expired", () => {
    expect(fadeOf(20, 21.6)?.cause).toBe("expired");
    expect(fadeOf(20, 21.6, kickAt(20.8))?.cause).toBe("expired");
    expect(
      fadeOf(20, 21.6, { ccInstances: [], interruptInstances: [] })?.cause,
    ).toBe("expired");
  });
});
