/**
 * fact9 (F24) batch 2 — class 1 of the round-9 audit, interrupts and school
 * locks:
 *  - D8: a bar another enemy kick ended is "kicked again", not a refused press;
 *  - D9: a press inside a later kick's school lock is not "outside the locked
 *    school … its own cooldown or the GCD";
 *  - D12: an unsilenceable spell of the locked school is "a spell the lock does
 *    not stop", not "outside the locked school";
 *  - D10: Shambling Rush's root aura 91807 is no cast-blocking interval;
 *  - D11: a landed Death Grip is cast-stop evidence;
 *  - D5: the kick-eaten legend's full-immunity names are FULL_IMMUNITY_IDS.
 * User rulings 2026-11-02 (D8 / D9 / D12 wording).
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { CHAIN_LEGENDS } from "../src/analysis/buildFindingsPrompt";
import { postKickFact } from "../src/analysis/candidateFindings";
import { ensureAnalysisData } from "../src/data/ensure";
import { getEnglishSpellName } from "../src/data/spellEffectData";
import { castBlockingAuraIntervals } from "../src/utils/cannotCastIntervals";
import { forcedStopInstantsMs } from "../src/utils/castStopEvidence";
import {
  FULL_IMMUNITY_IDS,
  SCHOOL_LIMITED_IMMUNITY_IDS,
} from "../src/utils/enemyDefensives";
import { makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const failed = (t: number, spellId: number, reason = "Not yet recovered") => ({
  tSeconds: t,
  unitGuid: "P1",
  spellId,
  spellName: `spell-${spellId}`,
  reason,
});

describe("fact9 D8 / D9 — a second kick inside the first one's window (1d6eee5f 0:56.9)", () => {
  // Spear Hand Strike on Polymorph (Arcane) at 56.987; Mind Freeze on the
  // Pyroblast (Fire) begun 0.13 s later lands at 58.883 and locks Fire 3 s
  const spear = {
    atSeconds: 56.987,
    lockoutDurationSeconds: 3,
    postKick: "acted" as const,
    firstActionDelayS: 3.2,
    switchSpellName: "Ice Nova",
    switchDelayS: 3.2,
    switchWasHardCast: false,
    interruptedSpellId: "118",
    kickSpellId: "116705",
    kickSpellName: "Spear Hand Strike",
  };
  const mindFreeze = {
    atSeconds: 58.883,
    lockoutDurationSeconds: 3,
    interruptedSpellId: "11366",
    kickSpellId: "47528",
    kickSpellName: "Mind Freeze",
  };
  const presses = [
    failed(58.882, 11366, "Interrupted"), // the bar Mind Freeze ended
    failed(59.344, 11366), // Pyroblast, inside Mind Freeze's Fire lock
    failed(59.442, 235313), // Blazing Barrier, same
    failed(59.7, 122), // Frost Nova, Frost: its own cooldown or the GCD
  ];

  it("the kicked bar is 'kicked again', the Fire presses sit inside the later lock", () => {
    const f = postKickFact(spear, presses, [], [spear, mindFreeze]);
    expect(f).toContain("kicked again 1x (Pyroblast +1.8s by Mind Freeze)");
    expect(f).not.toContain("refused for another reason");
    expect(f).toContain(
      "inside a later kick's lockout 2x not ready yet (Pyroblast +2.3s、Blazing Barrier +2.4s)",
    );
    expect(f).toContain(
      "outside the locked school 1x not ready yet — its own cooldown or the GCD (Frost Nova +2.7s)",
    );
  });

  it("without the other kicks the old reading stands (the control)", () => {
    const f = postKickFact(spear, presses);
    expect(f).toContain(
      "refused for another reason 1x — its cast bar began and was stopped (Pyroblast +1.8s)",
    );
    expect(f).toContain("outside the locked school 3x");
  });
});

describe("fact9 D12 — an unsilenceable spell of the locked school (1eb4dd55 r1 0:35.6)", () => {
  it("Heart of the Wild under a Nature Skull Bash is a spell the lock does not stop; Rake stays outside", () => {
    const k = {
      atSeconds: 35.623,
      lockoutDurationSeconds: 3,
      postKick: "acted" as const,
      firstActionDelayS: 1,
      switchSpellName: "Rake",
      switchDelayS: 4,
      switchWasHardCast: false,
      interruptedSpellId: "8936", // Regrowth, Nature
    };
    const f = postKickFact(k, [
      failed(37.9, 1261868),
      failed(38.069, 1261868),
      failed(39.8, 1822),
    ]);
    expect(f).toContain(
      "a spell the lock does not stop 2x not ready yet — its own cooldown or the GCD (Heart of the Wild×2 +2.2/+2.4s)",
    );
    expect(f).toContain("outside the locked school 1x");
    expect(f).toContain("(Rake +4.1s)");
  });
});

describe("T46 — a pacify-only spell of the locked school is rejected inside the lockout (1d26a991 0:30.1)", () => {
  // Spell Lock on Searing Glare (Holy) at 30.15, 5 s. Judgment 20271, Blade
  // of Justice 184575 and Final Verdict 383328 are Holy with PreventionType
  // 2: none went out until the lock ended; Hammer of Wrath 24275 is Holy and
  // silenceable
  const k = {
    atSeconds: 30.15,
    lockoutDurationSeconds: 5,
    postKick: "acted" as const,
    firstActionDelayS: 3.1,
    switchSpellName: "Rebuke",
    switchDelayS: 3.1,
    switchWasHardCast: false,
    interruptedSpellId: "410126",
  };
  it("Judgment, Blade of Justice and Final Verdict sit with Hammer of Wrath, not under 'a spell the lock does not stop'", () => {
    const f = postKickFact(k, [
      failed(30.73, 20271),
      failed(30.9, 184575),
      failed(32.2, 24275),
      failed(32.7, 383328),
    ]);
    expect(f).toContain(
      "pressed 4x but rejected (Judgment +0.5s、Blade of Justice +0.7s、Hammer of Wrath +2.0s、Final Verdict +2.5s) inside the lockout",
    );
    expect(f).not.toContain("a spell the lock does not stop");
  });
  it("Divine Steed (Holy, PreventionType 4) stays 'a spell the lock does not stop'", () => {
    const f = postKickFact(k, [failed(31, 190784)]);
    expect(f).toContain(
      "a spell the lock does not stop 1x not ready yet — its own cooldown or the GCD (Divine Steed +0.8s)",
    );
  });
});

describe("fact9 D10 — Shambling Rush's aura is a root, not a cast block", () => {
  const aura = (spellId: string, event: LogEvent, timestamp: number) => ({
    spellId,
    spellName: getEnglishSpellName(spellId),
    srcUnitId: "ghoul",
    srcUnitName: "Ghoul",
    destUnitId: "P1",
    timestamp,
    logLine: { event, timestamp, parameters: [] },
  });
  it("91807 APPLIED → REMOVED gives no interval; a Strangulate silence does", () => {
    const rooted = makeUnit("P1", {
      auraEvents: [
        aura("91807", LogEvent.SPELL_AURA_APPLIED, 1_000),
        aura("91807", LogEvent.SPELL_AURA_REMOVED, 2_093),
      ] as never,
    });
    expect(castBlockingAuraIntervals(rooted, new Set(["ghoul"]))).toEqual([]);
    const silenced = makeUnit("P1", {
      auraEvents: [
        aura("47476", LogEvent.SPELL_AURA_APPLIED, 1_000),
        aura("47476", LogEvent.SPELL_AURA_REMOVED, 3_000),
      ] as never,
    });
    expect(
      castBlockingAuraIntervals(silenced, new Set(["ghoul"])),
    ).toHaveLength(1);
  });
});

describe("fact9 D11 — a landed Death Grip stopped the bar (1d6eee5f 1:26.609)", () => {
  const grip = {
    spellId: "49576",
    spellName: "Death Grip",
    srcUnitId: "dk",
    srcUnitName: "DK",
    destUnitId: "P1",
    destUnitName: "Me",
    timestamp: 86_610,
    logLine: {
      event: LogEvent.SPELL_CAST_SUCCESS,
      timestamp: 86_610,
      parameters: [],
    },
  };
  it("the grip's cast row on the player is `gripped`", () => {
    const u = makeUnit("P1", { actionIn: [grip] as never });
    expect(forcedStopInstantsMs(u).gripped).toEqual([86_610]);
  });
  it("a grip the player was immune to moved nobody", () => {
    // makeUnit does not carry missesIn through
    const u = {
      ...makeUnit("P1", { actionIn: [grip] as never }),
      missesIn: [
        {
          spellId: "49576",
          srcUnitId: "dk",
          timestamp: 86_611,
          missType: "IMMUNE",
        },
      ],
    } as never;
    expect(forcedStopInstantsMs(u).gripped).toEqual([]);
  });
});

describe("fact9 D5 — the kick-eaten legend's full immunities are FULL_IMMUNITY_IDS", () => {
  const legend = CHAIN_LEGENDS["kick-eaten"]!;
  const m =
    /a unit inside a full immunity — (.+?) — is not read as low.*?one under (.+?) still is/.exec(
      legend,
    );
  const names = (ids: ReadonlySet<string>) =>
    new Set([...ids].map((id) => getEnglishSpellName(id)));
  it("every name in the full list is a full immunity, every one in the other list is not", () => {
    expect(m).not.toBeNull();
    const full = names(FULL_IMMUNITY_IDS);
    for (const n of m![1]!.split(/, | or /)) expect(full.has(n), n).toBe(true);
    const other = m![2]!;
    for (const n of [
      "Blessing of Protection",
      "Blessing of Spellwarding",
      "Cloak of Shadows",
      "Aspect of the Turtle",
    ]) {
      expect(other, n).toContain(n);
      expect(full.has(n), n).toBe(false);
    }
    expect(names(SCHOOL_LIMITED_IMMUNITY_IDS).has("Cloak of Shadows")).toBe(
      true,
    );
  });
});

describe("fact9 D8 / D9 — codex 20-F24-04", () => {
  const arcaneKick = {
    atSeconds: 10,
    lockoutDurationSeconds: 3,
    postKick: "acted" as const,
    firstActionDelayS: 3.2,
    switchSpellName: "Fireball",
    switchDelayS: 3.2,
    switchWasHardCast: true,
    interruptedSpellId: "118", // Polymorph, Arcane
    kickSpellName: "Counterspell",
  };
  const fireKickAt = (atSeconds: number, extra: object = {}) => ({
    atSeconds,
    lockoutDurationSeconds: 3,
    interruptedSpellId: "11366", // Pyroblast, Fire
    kickSpellId: "96231",
    kickSpellName: "Rebuke",
    ...extra,
  });

  it("#1 a press inside an EARLIER kick's still-running lock (1d6eee5f r5)", () => {
    // Rebuke locks Fire at 87.525; Mind Freeze locks Arcane at 90.118;
    // Pyroblast refused at 90.223, before Fire unlocks at 90.525
    const mindFreeze = {
      ...arcaneKick,
      atSeconds: 90.118,
      kickSpellName: "Mind Freeze",
    };
    const f = postKickFact(
      mindFreeze,
      [failed(90.223, 11366)],
      [],
      [fireKickAt(87.525), mindFreeze],
    );
    expect(f).toContain(
      "still inside an earlier kick's lockout 1x not ready yet (Pyroblast +0.1s)",
    );
    expect(f).not.toContain("outside the locked school");
  });

  it("#2 one kick ends one bar; a 'not ready' re-press beside it stays a press", () => {
    const f = postKickFact(
      arcaneKick,
      [failed(10.999, 11366, "Interrupted"), failed(11.025, 11366)],
      [],
      [arcaneKick, fireKickAt(11)],
    );
    expect(f).toContain("kicked again 1x (Pyroblast +0.9s by Rebuke)");
    expect(f).toContain("inside a later kick's lockout 1x");
  });

  it("#2 a 'not ready' row alone is never a kicked bar", () => {
    const f = postKickFact(
      arcaneKick,
      [failed(11.0, 11366)],
      [],
      [arcaneKick, fireKickAt(11)],
    );
    expect(f).not.toContain("kicked again");
  });

  it("#3 a later lock a success already ended does not hold the press", () => {
    const f = postKickFact(
      arcaneKick,
      [failed(12, 11366)],
      [],
      [arcaneKick, fireKickAt(11, { lockEndedBySuccessS: 0.5 })],
    );
    expect(f).not.toContain("later kick's lockout");
    expect(f).toContain("outside the locked school 1x");
  });

  it("#4 a bar another kick ended is an attempt to act", () => {
    const rows = [failed(11, 11366, "Interrupted")];
    const acted = postKickFact(
      arcaneKick,
      rows,
      [],
      [arcaneKick, fireKickAt(11)],
    );
    expect(acted).not.toContain("waited out");
    expect(acted).toContain("kicked again 1x");
    const idle = postKickFact(
      { ...arcaneKick, postKick: "idle" as const, firstActionDelayS: null },
      rows,
      [],
      [arcaneKick, fireKickAt(11)],
    );
    expect(idle).toContain("no successful cast");
    expect(idle).not.toMatch(/(^|; )no cast/);
  });
});
