/* eslint-disable @typescript-eslint/no-explicit-any */
import { LogEvent } from "@gladlog/parser-compat";

import { formatBurstLedgerForContext } from "../../src/utils/burstLedger";
import { analyzeKickAudit } from "../../src/utils/kickAudit";
import type { RawStreams } from "../../src/utils/rawStreams";
import {
  makeInterruptEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./testHelpers";

const MATCH_START = 1_000_000;
const WIND_SHEAR = "57994"; // interrupts category

function makeCombat() {
  return { startTime: MATCH_START, endTime: MATCH_START + 120_000 } as any;
}

/** SPELL_CAST_START stub (same shape as a cast event, different log event). */
function castStart(spellId: string, timestamp: number, unitId: string): any {
  const e = makeSpellCastEvent(
    spellId,
    timestamp,
    unitId,
    unitId,
    unitId,
    unitId,
    0,
    spellId,
  );
  e.logLine.event = LogEvent.SPELL_CAST_START;
  return e;
}

const info = { teamId: "0", specId: "x" } as any;

function makeKicker(kickTs: number, destUnitId = "e1") {
  return makeUnit("p1", {
    name: "Shaman",
    info,
    spellCastEvents: [
      makeSpellCastEvent(
        WIND_SHEAR,
        kickTs,
        destUnitId,
        "Enemy",
        "p1",
        "Shaman",
        0,
        "Wind Shear",
      ),
    ],
  } as any);
}

describe("kickAudit", () => {
  it("labels a kick landed when SPELL_INTERRUPT confirms it (D1-K1)", () => {
    const kickTs = MATCH_START + 20_000;
    const player = makeKicker(kickTs);
    const enemy = makeUnit("e1", {
      name: "Enemy",
      info,
      actionIn: [
        // id 116 = Frostbolt; getEnglishSpellName authoritatively overrides the
        // passed-in name by id
        makeInterruptEvent(
          WIND_SHEAR,
          "Wind Shear",
          "116",
          "Frostbolt",
          kickTs,
          "p1",
          "Shaman",
        ),
      ],
    } as any);

    const entries = analyzeKickAudit(player, [enemy], makeCombat());
    expect(entries).toHaveLength(1);
    expect(entries[0].result).toBe("landed");
    expect(entries[0].interruptedSpellName).toBe("Frostbolt");
    expect(entries[0].interruptedCategory).toBe("damage");
    expect(entries[0].atSeconds).toBe(20);
  });

  it("labels a missed kick juked when the target cancelled a cast just before (D1-K2)", () => {
    const kickTs = MATCH_START + 20_000;
    const player = makeKicker(kickTs);
    // Enemy started a cast 1.5s before the kick and never completed it.
    const enemy = makeUnit("e1", {
      name: "Enemy",
      info,
      castStartEvents: [castStart("116", kickTs - 1_500, "e1")],
    } as any);

    const entries = analyzeKickAudit(player, [enemy], makeCombat());
    expect(entries[0].result).toBe("juked");
    expect(entries[0].jukedBySpellName).toBeTruthy();
  });

  it("does not call it a juke when the cast completed (D1-K3)", () => {
    const kickTs = MATCH_START + 20_000;
    const player = makeKicker(kickTs);
    const enemy = makeUnit("e1", {
      name: "Enemy",
      info,
      castStartEvents: [castStart("116", kickTs - 1_500, "e1")],
      spellCastEvents: [
        makeSpellCastEvent(
          "116",
          kickTs + 500,
          "p1",
          "Player",
          "e1",
          "Enemy",
          0,
          "116",
        ),
      ],
    } as any);

    const entries = analyzeKickAudit(player, [enemy], makeCombat());
    expect(entries[0].result).toBe("missed");
  });

  it("labels unknown when the match has no cast-start data (old archive) (D1-K4)", () => {
    const player = makeKicker(MATCH_START + 20_000);
    const enemy = makeUnit("e1", { name: "Enemy", info } as any);
    // makeUnit defaults castStartEvents to [] — simulate an old archive (field absent)
    delete (enemy as any).castStartEvents;

    const entries = analyzeKickAudit(player, [enemy], makeCombat());
    expect(entries[0].result).toBe("unknown");
  });

  it("returns nothing for a player with no interrupt casts (D1-K5)", () => {
    const player = makeUnit("p1", { name: "Shaman", info } as any);
    const enemy = makeUnit("e1", { name: "Enemy", info } as any);
    expect(analyzeKickAudit(player, [enemy], makeCombat())).toHaveLength(0);
  });
});

describe("kickAudit — DPS baseline 修复(2026-07-16)", () => {
  it("宠物执行的打断(src=宠物 id)也算 landed", () => {
    const kickTs = MATCH_START + 20_000;
    // If Spell Lock 19647 isn't in the interrupts category, Wind Shear stands in
    // for the same semantics: cast by the owner, landed by the pet
    const player = makeKicker(kickTs);
    const pet = makeUnit("pet1", { name: "Felhunter", ownerId: "p1" } as any);
    const enemy = makeUnit("e1", {
      name: "Enemy",
      info,
      actionIn: [
        makeInterruptEvent(
          WIND_SHEAR,
          "Wind Shear",
          "116",
          "Frostbolt",
          kickTs,
          "pet1",
          "Felhunter",
        ),
      ],
    } as any);
    const combat = {
      startTime: MATCH_START,
      endTime: MATCH_START + 120_000,
      units: { p1: player, pet1: pet, e1: enemy },
    } as any;
    const entries = analyzeKickAudit(player, [enemy], combat);
    expect(entries[0].result).toBe("landed");
  });

  it("敌方读条被队友打断 ≠ 假读条:不判 juked", () => {
    const kickTs = MATCH_START + 20_000;
    const player = makeKicker(kickTs);
    const stTs = kickTs - 1_500;
    const enemy = makeUnit("e1", {
      name: "Enemy",
      info,
      castStartEvents: [castStart("116", stTs, "e1")],
      // Teammate f2 interrupted it 1s after the cast started
      // (SPELL_INTERRUPT src=f2, dest=e1)
      actionIn: [
        (() => {
          const ev = makeInterruptEvent(
            "57994",
            "Wind Shear",
            "116",
            "Frostbolt",
            stTs + 1_000,
            "f2",
            "Teammate",
          );
          ev.destUnitId = "e1";
          return ev;
        })(),
      ],
    } as any);
    const entries = analyzeKickAudit(player, [enemy], makeCombat());
    // Not juked (the cast was real, a teammate kicked it); the player's own Wind
    // Shear whiffed → missed
    expect(entries[0].result).toBe("missed");
  });
});

// Triage 2026-09-29, CROSS-THEME G11: other F-O4 → sync-burst F-L6 →
// kick-priority F-B1.
describe("kickAudit — one kick one entry, landed silence, bounded juke (G11)", () => {
  const kickTs = MATCH_START + 20_000;
  const cast = (spellId: string, ts: number, dest = "e1") =>
    makeSpellCastEvent(spellId, ts, dest, "Enemy", "p1", "Kicker", 0, spellId);
  const kicker = (casts: any[]) =>
    makeUnit("p1", { name: "Kicker", info, spellCastEvents: casts } as any);
  const success = (spellId: string, ts: number) =>
    makeSpellCastEvent(spellId, ts, "p1", "Kicker", "e1", "Enemy", 0, spellId);
  const applied = (spellId: string, ts: number, src = "p1") => ({
    logLine: {
      event: LogEvent.SPELL_AURA_APPLIED,
      timestamp: ts,
      parameters: [],
    },
    timestamp: ts,
    spellId,
    spellName: spellId,
    srcUnitId: src,
    destUnitId: "e1",
  });

  it("F-O4: Skull Bash's two cast rows a millisecond apart are one entry", () => {
    const player = kicker([cast("106839", kickTs), cast("93985", kickTs + 1)]);
    const enemy = makeUnit("e1", {
      name: "Enemy",
      info,
      actionIn: [
        makeInterruptEvent(
          "93985",
          "Skull Bash",
          "116",
          "Frostbolt",
          kickTs + 1,
          "p1",
          "Kicker",
        ),
      ],
    } as any);
    const entries = analyzeKickAudit(player, [enemy], makeCombat());
    expect(entries).toHaveLength(1);
    expect(entries[0].result).toBe("landed");
    // the rows themselves are untouched (the cooldown ledger keys on 106839)
    expect(player.spellCastEvents).toHaveLength(2);
  });

  it("F-O4: two real kicks of the same spell seconds apart stay two entries", () => {
    const player = kicker([
      cast("106839", kickTs),
      cast("106839", kickTs + 15_000),
    ]);
    const enemy = makeUnit("e1", {
      name: "Enemy",
      info,
      castStartEvents: [],
    } as any);
    expect(analyzeKickAudit(player, [enemy], makeCombat())).toHaveLength(2);
  });

  it("F-L6: a Silence that put its own aura on a target who was not casting is 'silenced', not missed", () => {
    const player = kicker([cast("15487", kickTs)]);
    const enemy = makeUnit("e1", {
      name: "Enemy",
      info,
      castStartEvents: [castStart("116", kickTs - 30_000, "e1")],
      auraEvents: [applied("15487", kickTs + 2)],
    } as any);
    const [e] = analyzeKickAudit(player, [enemy], makeCombat());
    expect(e!.result).toBe("silenced");
    expect(e!.silencedTargetName).toBe("Enemy");
    // the target was not casting: "no cast interrupted" may be said
    expect(e!.openCastSpellName).toBeUndefined();
  });

  it("F-L6: a Silence that landed on a target mid-cast names the cast that never finished — a silence stops a bar with no SPELL_INTERRUPT row, so 'no cast interrupted' would be a guess (pre-review)", () => {
    const player = kicker([cast("15487", kickTs)]);
    const enemy = makeUnit("e1", {
      name: "Enemy",
      info,
      // Frostbolt started 1 s before the Silence and never succeeded
      castStartEvents: [castStart("116", kickTs - 1_000, "e1")],
      auraEvents: [applied("15487", kickTs + 2)],
    } as any);
    const [e] = analyzeKickAudit(player, [enemy], makeCombat());
    expect(e!.result).toBe("silenced");
    expect(e!.openCastSpellName).toBe("Frostbolt");
  });

  it("F-L6: the cast a silenced entry names is the one still open at the kick, not an earlier bar the next cast start had ended (Fable review)", () => {
    const player = kicker([cast("15487", kickTs)]);
    const enemy = makeUnit("e1", {
      name: "Enemy",
      info,
      // Frostbolt −3.0 s, never finished, over when Polymorph started at
      // −0.5 s (+ the queue tolerance = −0.1 s); Polymorph is the open bar
      castStartEvents: [
        castStart("116", kickTs - 3_000, "e1"),
        castStart("118", kickTs - 500, "e1"),
      ],
      auraEvents: [applied("15487", kickTs + 2)],
    } as any);
    const [e] = analyzeKickAudit(player, [enemy], makeCombat());
    expect(e!.result).toBe("silenced");
    expect(e!.openCastSpellName).toBe("Polymorph");
  });

  it("F-L6: a bar that was over before the kick is not named — the target was not casting (Fable review)", () => {
    const player = kicker([cast("15487", kickTs)]);
    const enemy = makeUnit("e1", {
      name: "Enemy",
      info,
      // Frostbolt −3.0 s stopped; Polymorph −2.0 s completed at −0.7 s
      castStartEvents: [
        castStart("116", kickTs - 3_000, "e1"),
        castStart("118", kickTs - 2_000, "e1"),
      ],
      spellCastEvents: [
        makeSpellCastEvent(
          "118",
          kickTs - 700,
          "p1",
          "Kicker",
          "e1",
          "Enemy",
          0,
          "118",
        ),
      ],
      auraEvents: [applied("15487", kickTs + 2)],
    } as any);
    const [e] = analyzeKickAudit(player, [enemy], makeCombat());
    expect(e!.result).toBe("silenced");
    expect(e!.openCastSpellName).toBeUndefined();
    // the juke test reads the same bar (FT F12: it kept the EARLIEST stopped
    // cast and said "JUKED by fake Frostbolt" 0.7 s after the Polymorph had
    // gone off): same target, no aura
    const bare = makeUnit("e1", {
      name: "Enemy",
      info,
      castStartEvents: enemy.castStartEvents,
      spellCastEvents: enemy.spellCastEvents,
    } as any);
    const [j] = analyzeKickAudit(player, [bare], makeCombat());
    expect(j!.result).toBe("missed");
    expect(j!.jukedBySpellName).toBeUndefined();
  });

  it("F-L6: an aura that went onto two enemies names the one the kick was aimed at (Avenger's Shield; Fable review)", () => {
    const player = kicker([cast("31935", kickTs, "e2")]);
    const mk = (id: string, name: string) =>
      makeUnit(id, {
        name,
        info,
        castStartEvents: [castStart("116", kickTs - 30_000, id)],
        auraEvents: [{ ...applied("31935", kickTs + 10), destUnitId: id }],
      } as any);
    const [e] = analyzeKickAudit(
      player,
      [mk("e1", "First"), mk("e2", "Aimed")],
      makeCombat(),
    );
    expect(e!.result).toBe("silenced");
    expect(e!.silencedTargetName).toBe("Aimed");
    // no aura on the aimed unit: whoever carries it
    const lone = makeUnit("e2", {
      name: "Aimed",
      info,
      castStartEvents: [],
    } as any);
    const [f] = analyzeKickAudit(
      player,
      [mk("e1", "First"), lone],
      makeCombat(),
    );
    expect(f!.silencedTargetName).toBe("First");
  });

  it("F-L6: without cast-start data a silence that landed stays 'unknown', outside the landed rate like the match's other kicks (Fable review)", () => {
    const player = kicker([cast("15487", kickTs)]);
    const enemy = makeUnit("e1", {
      name: "Enemy",
      info,
      auraEvents: [applied("15487", kickTs + 2)],
    } as any);
    expect(analyzeKickAudit(player, [enemy], makeCombat())[0]!.result).toBe(
      "unknown",
    );
  });

  it("FT-T11 follow-up: a miss on a totem is named through the caller's label, never by the totem's unit name", () => {
    const missed = {
      atSeconds: 80,
      kickSpellId: "57994",
      kickSpellName: "Wind Shear",
      result: "missed",
      kickMiss: {
        missType: "IMMUNE",
        targetId: "Creature-0-3019-1825-9-5925-00001",
        targetName: "根基图腾",
      },
    } as any;
    const kicksLine = (label?: (name: string, id: string) => string) =>
      formatBurstLedgerForContext([], [], [missed], label).find((l) =>
        l.includes("Kicks:"),
      );
    expect(
      kicksLine((name, id) =>
        id.startsWith("Player-") ? name : "Shammy-Realm's totem",
      ),
    ).toBe(
      "  Kicks: 1:20 Wind Shear → hit nothing [IMMUNE: Shammy-Realm's totem]",
    );
    // a player target keeps the name this block uses everywhere
    const onPlayer = {
      ...missed,
      kickMiss: {
        missType: "IMMUNE",
        targetId: "Player-1-0001",
        targetName: "Pal-Realm",
      },
    };
    expect(
      formatBurstLedgerForContext([], [], [onPlayer], (name, id) =>
        id.startsWith("Player-") ? name : "x",
      ).find((l) => l.includes("Kicks:")),
    ).toContain("[IMMUNE: Pal-Realm]");
  });

  it("F-L6: the ledger's Kicks line says 'no cast interrupted' only for a target with no open cast", () => {
    const line = (openCastSpellName?: string) =>
      formatBurstLedgerForContext(
        [],
        [],
        [
          {
            atSeconds: 20,
            kickSpellId: "15487",
            kickSpellName: "Silence",
            result: "silenced",
            silencedTargetName: "Enemy",
            ...(openCastSpellName ? { openCastSpellName } : {}),
          },
        ],
      ).find((l) => l.includes("Kicks:"));
    expect(line()).toContain(
      "0:20 Silence → silenced Enemy (no cast interrupted)",
    );
    expect(line("Flash Heal")).toContain(
      "0:20 Silence → silenced Enemy (their Flash Heal cast did not finish)",
    );
  });

  it("F-L6: only the kick's own aura counts — another aura from the kicker, or the same aura from before the kick, does not (2c6e85ec Solar Beam)", () => {
    const player = kicker([cast("78675", kickTs)]); // Solar Beam
    const enemy = makeUnit("e1", {
      name: "Enemy",
      info,
      castStartEvents: [castStart("116", kickTs - 30_000, "e1")],
      auraEvents: [
        applied("102359", kickTs + 6), // Mass Entanglement, 6 ms later
        applied("78675", kickTs - 500), // the same id, before the kick
      ],
    } as any);
    expect(analyzeKickAudit(player, [enemy], makeCombat())[0]!.result).toBe(
      "missed",
    );
  });

  // Found on d692582c with Strangulate @51.3; Strangulate left the kick set on
  // 2026-10-16 (a silence aura with no school lockout is control — user
  // ruling, `isKickSpellId`), so the precedence is pinned on Priest Silence,
  // the silencing kick that stays.
  it("precedence: a kick that silenced its target is decided before the juke test (d692582c, Silence)", () => {
    const player = kicker([cast("15487", kickTs)]);
    const enemy = makeUnit("e1", {
      name: "Enemy",
      info,
      // a cast the target stopped 1.5 s earlier — a juke under F-B1 alone
      castStartEvents: [castStart("116", kickTs - 1_500, "e1")],
      auraEvents: [applied("15487", kickTs + 1)],
    } as any);
    expect(analyzeKickAudit(player, [enemy], makeCombat())[0]!.result).toBe(
      "silenced",
    );
  });

  it("F-B1: a stopped cast followed by a completed recast of the same spell is a juke (2c6e85ec Rebuke @75.6)", () => {
    const player = kicker([cast(WIND_SHEAR, kickTs)]);
    const enemy = makeUnit("e1", {
      name: "Enemy",
      info,
      castStartEvents: [
        castStart("116", kickTs - 1_000, "e1"), // stopped
        castStart("116", kickTs + 300, "e1"), // the recast
      ],
      spellCastEvents: [success("116", kickTs + 2_000)], // the recast completes
    } as any);
    const [e] = analyzeKickAudit(player, [enemy], makeCombat());
    expect(e!.result).toBe("juked");
  });

  it("F-B1: a success within the queue tolerance after the next start still completes the first cast", () => {
    const player = kicker([cast(WIND_SHEAR, kickTs)]);
    const enemy = makeUnit("e1", {
      name: "Enemy",
      info,
      castStartEvents: [
        castStart("116", kickTs - 1_000, "e1"),
        castStart("133", kickTs + 300, "e1"), // the queued next cast
      ],
      spellCastEvents: [success("116", kickTs + 600)], // 300 ms after the next start
    } as any);
    expect(analyzeKickAudit(player, [enemy], makeCombat())[0]!.result).toBe(
      "missed",
    );
  });

  it("F-B1: the last cast start has no next one — its completion is bounded by the 4 s cap only", () => {
    const player = kicker([cast(WIND_SHEAR, kickTs)]);
    const enemy = makeUnit("e1", {
      name: "Enemy",
      info,
      castStartEvents: [castStart("116", kickTs - 1_000, "e1")],
      spellCastEvents: [success("116", kickTs + 1_500)],
    } as any);
    expect(analyzeKickAudit(player, [enemy], makeCombat())[0]!.result).toBe(
      "missed",
    );
  });
});

// FT F12: "JUKED by fake X" on a cast that was not a fake. The bait is the
// LAST bar the target began before the kick, read by the one reading of how
// a cast bar ended (`castBarOutcomesOf`).
describe("kickAudit — the bait is the last bar before the kick (FT F12)", () => {
  const kickTs = MATCH_START + 29_029;
  const kickerOf = (spellId = WIND_SHEAR) =>
    makeUnit("p1", {
      name: "Kicker",
      info,
      spellCastEvents: [
        makeSpellCastEvent(
          spellId,
          kickTs,
          "e1",
          "Enemy",
          "p1",
          "Kicker",
          0,
          spellId,
        ),
      ],
    } as any);
  const done = (spellId: string, ts: number) =>
    makeSpellCastEvent(spellId, ts, "p1", "Kicker", "e1", "Enemy", 0, spellId);
  const FLASH_HEAL = "2061";
  const HOLY_FIRE = "14914";

  it("a0a48716 0:29: a cast stopped 3.8 s earlier is not the fake when the target has cast since — the bar the kick went out at is", () => {
    const enemy = makeUnit("e1", {
      name: "Enemy",
      info,
      castStartEvents: [
        castStart(FLASH_HEAL, kickTs - 3_809, "e1"), // stopped
        castStart(FLASH_HEAL, kickTs - 1_944, "e1"), // went off
        castStart(HOLY_FIRE, kickTs - 741, "e1"), // never finished
      ],
      spellCastEvents: [done(FLASH_HEAL, kickTs - 972)],
    } as any);
    const [e] = analyzeKickAudit(kickerOf(), [enemy], makeCombat());
    expect(e!.result).toBe("juked");
    expect(e!.jukedBySpellName).toBe("Holy Fire");
  });

  it("24b6a229 2:19: a kick 0.28 s after the recast went off hit nothing — the stopped first cast is not its bait", () => {
    const enemy = makeUnit("e1", {
      name: "Enemy",
      info,
      castStartEvents: [
        castStart(FLASH_HEAL, kickTs - 2_517, "e1"), // stopped
        castStart(FLASH_HEAL, kickTs - 1_429, "e1"), // went off 0.28 s before the kick
      ],
      spellCastEvents: [done(FLASH_HEAL, kickTs - 284)],
    } as any);
    const [e] = analyzeKickAudit(kickerOf(), [enemy], makeCombat());
    expect(e!.result).toBe("missed");
    expect(e!.beatenBy).toBeUndefined();
  });

  it("8930cb36 0:59: a kick 0.14 s after a teammate's interrupt ended the second cast is 'hit nothing — … had interrupted', not a juke by the first", () => {
    const rebuke = makeInterruptEvent(
      "96231",
      "Rebuke",
      FLASH_HEAL,
      "Flash Heal",
      kickTs - 143,
      "f2",
      "Teammate",
    );
    rebuke.destUnitId = "e1";
    const enemy = makeUnit("e1", {
      name: "Enemy",
      info,
      castStartEvents: [
        castStart(FLASH_HEAL, kickTs - 3_056, "e1"), // stopped
        castStart(FLASH_HEAL, kickTs - 735, "e1"), // interrupted by the teammate
      ],
      actionIn: [rebuke],
    } as any);
    const [e] = analyzeKickAudit(kickerOf(), [enemy], makeCombat());
    expect(e!.result).toBe("missed");
    expect(e!.beatenBy?.kickSpellName).toBe("Rebuke");
    expect(e!.beatenBy?.interruptedSpellName).toBe("Flash Heal");
  });

  it("two fakes in a row: the later one is named", () => {
    const enemy = makeUnit("e1", {
      name: "Enemy",
      info,
      castStartEvents: [
        castStart(FLASH_HEAL, kickTs - 2_500, "e1"),
        castStart(HOLY_FIRE, kickTs - 600, "e1"),
      ],
    } as any);
    const [e] = analyzeKickAudit(kickerOf(), [enemy], makeCombat());
    expect(e!.result).toBe("juked");
    expect(e!.jukedBySpellName).toBe("Holy Fire");
  });

  it("a bar begun after the kick, or more than the look-back before it, is not read", () => {
    const enemy = (starts: number[]) =>
      makeUnit("e1", {
        name: "Enemy",
        info,
        castStartEvents: starts.map((ms) =>
          castStart(FLASH_HEAL, kickTs + ms, "e1"),
        ),
      } as any);
    expect(
      analyzeKickAudit(kickerOf(), [enemy([-4_001, 200])], makeCombat())[0]!
        .result,
    ).toBe("missed");
    expect(
      analyzeKickAudit(kickerOf(), [enemy([-4_000, 200])], makeCombat())[0]!
        .result,
    ).toBe("juked");
  });

  it("9d899d10 r1 1:42: a bar with a stun on the target between its start and the kick is not called a fake — the stun broke it, or the log cannot tell", () => {
    const stun = (ms: number) => ({
      logLine: {
        event: LogEvent.SPELL_AURA_APPLIED,
        timestamp: kickTs + ms,
        parameters: [],
      },
      timestamp: kickTs + ms,
      spellId: "118905", // Static Charge (Capacitor Totem)
      spellName: "Static Charge",
      srcUnitId: "totem",
      destUnitId: "e1",
    });
    const enemy = (auraMs: number[]) =>
      makeUnit("e1", {
        name: "Enemy",
        info,
        castStartEvents: [castStart(FLASH_HEAL, kickTs - 870, "e1")],
        auraEvents: auraMs.map(stun),
      } as any);
    const result = (auraMs: number[]) =>
      analyzeKickAudit(kickerOf(), [enemy(auraMs)], makeCombat())[0]!.result;
    // Scorch begun 0.87 s before the Counter Shot, the stun 0.12 s before it
    expect(result([-122])).toBe("missed");
    // a stun before the bar began, or after the kick, stopped nothing of it
    expect(result([-900])).toBe("juked");
    expect(result([1])).toBe("juked");
    expect(result([])).toBe("juked");
  });

  // The recorder's bars, with their SPELL_CAST_FAILED rows handed in: read as
  // the cancel ledger reads them.
  describe("a target that recorded the log", () => {
    const streams = (reason: string): RawStreams => ({
      available: true,
      manaSamples: [],
      castFailed: [
        {
          tSeconds: (kickTs - 400 - MATCH_START) / 1000,
          unitGuid: "e1",
          spellId: Number(FLASH_HEAL),
          spellName: "Flash Heal",
          reason,
        } as never,
      ],
    });
    const recorder = (extra: Record<string, unknown> = {}) =>
      makeUnit("e1", {
        name: "Enemy",
        info,
        castStartEvents: [castStart(FLASH_HEAL, kickTs - 1_000, "e1")],
        ...extra,
      } as any);
    const audit = (enemy: any, s?: RawStreams) =>
      analyzeKickAudit(kickerOf(), [enemy], makeCombat(), s)[0]!;

    it("a bar it stopped is a fake even when the same spell went off as an instant right after", () => {
      const enemy = recorder({
        spellCastEvents: [done(FLASH_HEAL, kickTs + 300)],
      });
      // without the rows the SUCCESS reads as the bar's completion
      expect(audit(enemy).result).toBe("missed");
      expect(audit(enemy, streams("Interrupted")).result).toBe("juked");
    });

    it("a bar stopped next to a control on it, or refused by the client, is no fake (ruling A′17)", () => {
      const stunned = recorder({
        auraEvents: [
          {
            logLine: {
              event: LogEvent.SPELL_AURA_APPLIED,
              timestamp: kickTs - 450,
              parameters: [],
            },
            timestamp: kickTs - 450,
            spellId: "853", // Hammer of Justice
            spellName: "Hammer of Justice",
            srcUnitId: "f2",
            destUnitId: "e1",
          },
        ],
      });
      expect(audit(stunned, streams("Interrupted")).result).toBe("missed");
      expect(
        audit(recorder(), streams("Target not in line of sight")).result,
      ).toBe("missed");
      // the rows of another unit change nothing
      const other = streams("Target not in line of sight");
      other.castFailed[0]!.unitGuid = "someone-else";
      expect(audit(recorder(), other).result).toBe("juked");
    });
  });
});
