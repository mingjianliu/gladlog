/**
 * Pipeline T330 — scan5 burstRatioOwnSideDamage filed damage the enemy
 * caused as the side's own (126 in-total rows on the 605, all the scan's
 * error): deferral shields' ticks, sacrifice transfers, the enemy-caused own
 * rows (Cauterize's burn, Ultimate Sacrifice's moved damage) and a charmed
 * teammate's hits. A teammate's straight hit is the side's own; a unit's
 * other own rows are listed apart (user ruling 2026-11-28).
 */
import { buildRosterSides } from "@gladlog/analysis/src/utils/rosterSide";
import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  OUT_OF_TOTAL,
  reflectsByCaster,
  sideRowBucket,
} from "../scripts/scan5/t159";

const FRIEND = 0x512;
const HOSTILE = 0x548;
const victim = { id: "Player-1-A", reaction: CombatUnitReaction.Friendly };
const mate = { id: "Player-1-B", reaction: CombatUnitReaction.Friendly };
const enemy = { id: "Player-1-E", reaction: CombatUnitReaction.Hostile };
const matePet = {
  id: "Pet-0-1-1",
  reaction: CombatUnitReaction.Friendly,
  ownerId: mate.id,
};
const sides = buildRosterSides([victim, mate, enemy, matePet] as never);
const ownerOf = new Map([[matePet.id, mate.id]]);

const row = (
  src: string,
  spellId: string,
  {
    event = LogEvent.SPELL_DAMAGE as string,
    srcFlags = FRIEND,
    destFlags = FRIEND,
  } = {},
) => ({
  srcUnitId: src,
  srcUnitFlags: srcFlags,
  srcUnitName: src,
  destUnitId: victim.id,
  destUnitFlags: destFlags,
  spellId,
  logLine: { event, timestamp: 1 },
});
const bucket = (e: ReturnType<typeof row>): string =>
  sideRowBucket(victim, e, sides, ownerOf);

describe("burstRatioOwnSideDamage's own-side row (T330)", () => {
  it("is a teammate's straight hit, or its pet's", () => {
    expect(bucket(row(mate.id, "81297"))).toBe("own"); // Consecration
    expect(bucket(row(matePet.id, "17253"))).toBe("own");
  });

  it("is no enemy's hit", () => {
    expect(bucket(row(enemy.id, "585", { srcFlags: HOSTILE }))).toBe("pressure");
  });

  it("is no sacrifice transfer (a DAMAGE_SPLIT row)", () => {
    expect(
      bucket(row(mate.id, "6940", { event: LogEvent.DAMAGE_SPLIT as string })),
    ).toBe("pressure");
  });

  it("is no deferral shield's tick, whoever the log names", () => {
    expect(bucket(row(victim.id, "361029"))).toBe("pressure"); // Time Dilation
    expect(bucket(row(mate.id, "1309786"))).toBe("pressure"); // Refraction
  });

  it("reads Cauterize's burn and Ultimate Sacrifice's ticks as pressure", () => {
    expect(bucket(row(victim.id, "87023"))).toBe("pressure");
    expect(bucket(row(victim.id, "199450"))).toBe("pressure");
    expect(bucket(row(victim.id, "210380"))).toBe("pressure"); // Blessing of Dawn
  });

  it("reads a reflected spell coming back in its caster's name as pressure", () => {
    // the victim's Unstable Affliction 1259790 reflected at t = 1000 by the enemy
    const reflects = reflectsByCaster([
      {
        id: victim.id,
        missesOut: [
          {
            missType: "REFLECT",
            spellId: "1259790",
            srcUnitId: victim.id,
            destUnitId: enemy.id,
            logLine: { timestamp: 1000 },
          },
        ],
      },
    ]);
    const at = (e: ReturnType<typeof row>, t: number) => ({
      ...e,
      logLine: { ...e.logLine, timestamp: t },
    });
    const b = (e: ReturnType<typeof row>): string =>
      sideRowBucket(victim, e, sides, ownerOf, reflects);
    // its ticks on the caster: the enemy's doing
    expect(b(at(row(victim.id, "1259790"), 5000))).toBe("pressure");
    // a teammate's dispel backlash, 196364 named as the reflected spell
    const mateSees = (e: ReturnType<typeof row>): string =>
      sideRowBucket(mate, { ...e, destUnitId: mate.id }, sides, ownerOf, reflects);
    expect(mateSees(at(row(victim.id, "196364"), 9000))).toBe("pressure");
    expect(mateSees(at(row(victim.id, "196364"), 30_000))).toBe("own");
    // past the window, or another spell: the unit's own again
    expect(b(at(row(victim.id, "1259790"), 30_000))).toBe("self");
    expect(b(at(row(victim.id, "111400"), 5000))).toBe("self");
  });

  it("lists the unit's other own rows apart, out of the total", () => {
    expect(bucket(row(victim.id, "111400"))).toBe("self"); // Burning Rush
    // Shadow Word: Death's backlash: no source, the victim's side in its flags
    expect(bucket(row("0000000000000000", "32409"))).toBe("self");
    expect(
      bucket(row("0000000000000000", "32409", { srcFlags: HOSTILE })),
    ).toBe("pressure");
    expect(
      OUT_OF_TOTAL.has(
        "burstRatioOwnSideDamage|units' own damage: label reads high",
      ),
    ).toBe(true);
    expect(OUT_OF_TOTAL.has("burstRatioOwnSideDamage|label reads high")).toBe(
      false,
    );
  });

  it("is no teammate's hit across a charm the row's flags show", () => {
    // ab7fbe2e r1 4:43: a Mind-Controlled Balance Druid flagged 0x548
    expect(bucket(row(mate.id, "164812", { srcFlags: HOSTILE }))).toBe("pressure");
    // the victim charmed: our side hitting it
    expect(bucket(row(mate.id, "81297", { destFlags: HOSTILE }))).toBe("pressure");
  });
});
