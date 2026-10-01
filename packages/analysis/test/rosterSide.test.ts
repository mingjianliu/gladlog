import { CombatUnitReaction } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { getTopDamageSourcesInWindow } from "../src/context/timelineHelpers";
import {
  incomingPressureEvents,
  REDISTRIBUTION_DAMAGE_IDS,
  sumIncomingPressure,
} from "../src/utils/incomingPressure";
import { buildRosterSides, isSameSideSource } from "../src/utils/rosterSide";

/**
 * Triage 2026-09-29, pair G7-P6: death-kill F-T1 (Top sources decide "same
 * team" by roster, not by the per-event reaction flags a charm flips) and
 * hp-state F-D1 (a teammate's redistribution is not incoming pressure; user
 * ruling 2026-09-30, A22 = B).
 */

const F = CombatUnitReaction.Friendly;
const H = CombatUnitReaction.Hostile;
/** reaction flags as the log writes them */
const FRIENDLY_PLAYER = 0x511;
const HOSTILE_PLAYER = 0x548;
/** a charmed player: the player's GUID, PET type, the other side's reaction
 * (a5a8d31b `Limìts` 0x1148 while Mind-Controlled) */
const CHARMED_BY_ENEMY = 0x1148;
const CHARMED_BY_US = 0x1111;
const MATE2 = "Player-1-MATE2";
const ENEMY2 = "Player-1-ENEMY2";
/** a charmed RECORDER on its own rows (90c57b63 r3: 0x511 → 0x1118) */
const CHARMED_RECORDER = 0x1118;
const PVICTIM = "Player-1-VICTIM";

const roster = buildRosterSides([
  { id: "victim", ownerId: "", reaction: F },
  { id: "mate", ownerId: "", reaction: F },
  { id: MATE2, ownerId: "", reaction: F },
  { id: PVICTIM, ownerId: "", reaction: F },
  { id: ENEMY2, ownerId: "", reaction: H },
  { id: "neutral", ownerId: "", reaction: CombatUnitReaction.Neutral },
  { id: "totem", ownerId: "mate", reaction: H }, // its own vote is wrong on purpose
  { id: "enemy", ownerId: "", reaction: H },
  { id: "enemy-pet", ownerId: "enemy", reaction: F },
]);
const victim = { id: "victim", reaction: F };

describe("rosterSide", () => {
  it("a summon takes its owner's side, whatever its own flags voted", () => {
    expect(roster.get("totem")).toBe(F);
    expect(roster.get("enemy-pet")).toBe(H);
  });

  it("the roster decides; the event's flags are only the fallback", () => {
    // an enemy logged with friendly flags (the recorder is charmed)
    expect(isSameSideSource(victim, "enemy", FRIENDLY_PLAYER, roster)).toBe(
      false,
    );
    // a teammate logged with hostile flags
    expect(isSameSideSource(victim, "mate", HOSTILE_PLAYER, roster)).toBe(true);
    // unknown GUID → flags
    expect(isSameSideSource(victim, "stranger", FRIENDLY_PLAYER, roster)).toBe(
      true,
    );
    expect(isSameSideSource(victim, "stranger", HOSTILE_PLAYER, roster)).toBe(
      false,
    );
    // no roster at all → flags
    expect(isSameSideSource(victim, "enemy", HOSTILE_PLAYER)).toBe(false);
  });

  it("a charmed player acts for the other side while its rows say so", () => {
    // a Mind-Controlled teammate: same GUID, flagged as a controlled player
    expect(isSameSideSource(victim, MATE2, CHARMED_BY_ENEMY, roster)).toBe(
      false,
    );
    // the same teammate before / after the charm
    expect(isSameSideSource(victim, MATE2, FRIENDLY_PLAYER, roster)).toBe(true);
    // hostile flags WITHOUT the controlled-player type = the recorder is
    // charmed and the log flipped everyone: still a teammate
    expect(isSameSideSource(victim, MATE2, HOSTILE_PLAYER, roster)).toBe(true);
    // an enemy our side charmed hits its own team
    expect(
      isSameSideSource(
        { id: "enemy", reaction: H },
        ENEMY2,
        CHARMED_BY_US,
        roster,
      ),
    ).toBe(false);
  });

  it("nothing is same-side for a charmed victim: its own team attacks it", () => {
    const charmedVictim = { id: PVICTIM, reaction: F };
    // the recorder is charmed: its Death Knight's hit is logged hostile
    expect(
      isSameSideSource(
        charmedVictim,
        MATE2,
        HOSTILE_PLAYER,
        roster,
        CHARMED_RECORDER,
      ),
    ).toBe(false);
    // a charmed non-recorder: the teammate's flags do not flip
    expect(
      isSameSideSource(
        charmedVictim,
        MATE2,
        FRIENDLY_PLAYER,
        roster,
        CHARMED_BY_ENEMY,
      ),
    ).toBe(false);
    // the other team's DoT keeps ticking on it, flagged friendly meanwhile
    expect(
      isSameSideSource(
        charmedVictim,
        ENEMY2,
        FRIENDLY_PLAYER,
        roster,
        CHARMED_RECORDER,
      ),
    ).toBe(false);
    // the same rows once the charm is over
    expect(
      isSameSideSource(charmedVictim, MATE2, FRIENDLY_PLAYER, roster, 0x511),
    ).toBe(true);
  });

  it("a Neutral roster vote decides nothing: this row's flags do", () => {
    expect(isSameSideSource(victim, "neutral", FRIENDLY_PLAYER, roster)).toBe(
      true,
    );
    expect(isSameSideSource(victim, "neutral", HOSTILE_PLAYER, roster)).toBe(
      false,
    );
    expect(isSameSideSource(victim, "neutral", undefined, roster)).toBe(false);
  });
});

const dmg = (
  spellId: string,
  srcUnitId: string,
  srcUnitFlags: number,
  amount: number,
  destUnitFlags?: number,
) => ({
  destUnitFlags,
  logLine: { event: "SPELL_DAMAGE", timestamp: 1_000, parameters: [] },
  timestamp: 1_000,
  effectiveAmount: -amount,
  spellId,
  spellName: "x",
  srcUnitId,
  srcUnitName: `${srcUnitId}-Realm`,
  srcUnitFlags,
});
const absorb = (
  attackSpellId: string,
  attackerId: string,
  srcUnitFlags: number,
  amount: number,
) => ({
  logLine: { event: "SPELL_ABSORBED", timestamp: 1_000, parameters: [] },
  timestamp: 1_000,
  absorbedAmount: amount,
  spellId: "17", // the shield
  attackSpellId,
  attackerId,
  srcUnitFlags,
});
const unit = (damageIn: unknown[], absorbsIn: unknown[] = []) =>
  ({ id: "victim", reaction: F, damageIn, absorbsIn }) as never;

describe("incomingPressureEvents — redistribution (hp-state F-D1)", () => {
  it("the table is the ruling's two ids", () => {
    expect([...REDISTRIBUTION_DAMAGE_IDS].sort()).toEqual(["451963", "98021"]);
  });

  it("drops a teammate's Spirit Link / Void Leech, damage and absorbed part alike", () => {
    const u = unit(
      [
        dmg("98021", "totem", FRIENDLY_PLAYER, 600),
        dmg("451963", "mate", FRIENDLY_PLAYER, 300),
        dmg("50622", "enemy", HOSTILE_PLAYER, 100),
      ],
      [absorb("451963", "mate", FRIENDLY_PLAYER, 50)],
    );
    expect(sumIncomingPressure(u, 0, 10_000, roster)).toBe(100);
    // without a roster the row's own flags say the same thing here
    expect(sumIncomingPressure(u, 0, 10_000)).toBe(100);
  });

  it("keeps a Void Leech from the OTHER roster, even flagged friendly (a charmed victim)", () => {
    const u = unit([dmg("451963", "enemy", FRIENDLY_PLAYER, 300)]);
    expect(sumIncomingPressure(u, 0, 10_000, roster)).toBe(300);
  });

  it("keeps every other same-team id: Blessing of Sacrifice's transfer, a charmed teammate's hits", () => {
    const u = unit([
      dmg("6940", "mate", FRIENDLY_PLAYER, 400),
      dmg("116", "mate", HOSTILE_PLAYER, 200),
    ]);
    expect(incomingPressureEvents(u, roster)).toHaveLength(2);
  });
});

describe("getTopDamageSourcesInWindow — side by roster (death-kill F-T1)", () => {
  const top = (damageIn: unknown[], sides?: typeof roster) =>
    getTopDamageSourcesInWindow(
      {
        id: "victim",
        reaction: F,
        damageIn,
        absorbsIn: [],
      } as never,
      10_000,
      10_000,
      3,
      new Map(),
      new Map([["enemy-Realm", 6]]),
      undefined,
      undefined,
      sides,
    );

  it("an enemy's hit flagged friendly (the recorder is charmed) stays in the list", () => {
    const rows = [
      dmg("116", "enemy", FRIENDLY_PLAYER, 86_000),
      dmg("116", "enemy", HOSTILE_PLAYER, 113_000),
    ];
    expect(top(rows, roster)).toEqual(["6 — Frostbolt (199k)"]);
    // the flag test alone dropped the flipped row
    expect(top(rows)).toEqual(["6 — Frostbolt (113k)"]);
  });

  it("a teammate's hit flagged hostile (the recorder is charmed) is still same-team and left out", () => {
    expect(top([dmg("116", "mate", HOSTILE_PLAYER, 50_000)], roster)).toEqual(
      [],
    );
  });

  it("a charmed victim: its own team's hits are listed, and its Spirit Link share is pressure", () => {
    const rows = [
      dmg("116", MATE2, HOSTILE_PLAYER, 150_000, CHARMED_RECORDER),
      dmg("98021", MATE2, HOSTILE_PLAYER, 40_000, CHARMED_RECORDER),
    ];
    const charmed = {
      id: PVICTIM,
      reaction: F,
      damageIn: rows,
      absorbsIn: [],
    } as never;
    expect(sumIncomingPressure(charmed, 0, 10_000, roster)).toBe(190_000);
    const listed = getTopDamageSourcesInWindow(
      charmed,
      10_000,
      10_000,
      3,
      new Map(),
      new Map(),
      undefined,
      undefined,
      roster,
    );
    expect(listed).toHaveLength(2);
    expect(listed.join(" ")).toContain("(150k)");
  });

  it("a Mind-Controlled teammate's hit is in the pressure total AND in Top sources", () => {
    const rows = [dmg("116", MATE2, CHARMED_BY_ENEMY, 200_000)];
    // the ruling keeps it in the total (A22: mind-controlled teammates stay)
    expect(sumIncomingPressure(unit(rows), 0, 10_000, roster)).toBe(200_000);
    // so the same line's sources must show it (the roster alone dropped it)
    const listed = top(rows, roster);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toContain("(200k)");
    // named as the player it is (its rows carry the PET type), not "[pet]"
    const named = getTopDamageSourcesInWindow(
      { id: "victim", reaction: F, damageIn: rows, absorbsIn: [] } as never,
      10_000,
      10_000,
      3,
      new Map([[`${MATE2}-Realm`, 2]]),
      new Map(),
      undefined,
      undefined,
      roster,
    );
    expect(named).toEqual(["2 (mind-controlled) — Frostbolt (200k)"]);
  });
});
