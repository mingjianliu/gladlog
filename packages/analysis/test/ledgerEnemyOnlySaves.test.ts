/**
 * FT board item 1 (user ruling 2026-10-09): a save the timeline prints when
 * an ENEMY presses it (`ENEMY_ONLY_SAVE_IDS` → `[ENEMY DEF]`) is on the
 * presser's own ledger too — as a Utility row, on cast evidence only.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { CombatUnitClass, CombatUnitSpec } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { classMetadata } from "../src/data/classSpells";
import { ensureAnalysisData } from "../src/data/ensure";
import observed from "../src/data/observedSpellIdsGenerated.json";
import { effectiveCooldownSeconds } from "../src/data/spellEffectData";
import {
  ENEMY_ALLY_SAVE_IDS,
  ENEMY_ONLY_SAVE_IDS,
  ENEMY_REDIRECT_SAVE_IDS,
  ENEMY_SELF_SAVE_ONLY_IDS,
} from "../src/data/spellIdLists";
import { SpellTag } from "../src/data/spellTypes";
import { extractMajorCooldowns, MIN_CD_SECONDS } from "../src/utils/cooldowns";
import { SELF_SAVE_IDS } from "../src/utils/enemyDefensives";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

const T0 = 1_700_000_000_000;
const combatOf = (u: any) =>
  ({
    startTime: T0,
    endTime: T0 + 300_000,
    units: { [u.id]: u },
  }) as unknown as import("@gladlog/parser-compat").AtomicArenaCombat;
const ledger = (u: any) => extractMajorCooldowns(u, combatOf(u));

const rogue = (casts: Array<[string, number]>) =>
  makeUnit("player-1", {
    class: CombatUnitClass.Rogue,
    spec: CombatUnitSpec.Rogue_Outlaw,
    info: { talents: [], pvpTalents: [] } as any,
    spellCastEvents: casts.map(([id, s]) =>
      makeSpellCastEvent(id, T0 + s * 1000, "player-1"),
    ),
  });

describe("the ledger admits a pressed enemy-only save as a Utility row", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("the union is the three enemy-only sets, and the [ENEMY DEF] roster holds all of it", () => {
    expect([...ENEMY_ONLY_SAVE_IDS].sort()).toEqual(
      [
        ...new Set([
          ...ENEMY_SELF_SAVE_ONLY_IDS,
          ...ENEMY_ALLY_SAVE_IDS,
          ...ENEMY_REDIRECT_SAVE_IDS,
        ]),
      ].sort(),
    );
    for (const id of ENEMY_ONLY_SAVE_IDS)
      expect(SELF_SAVE_IDS.has(id), id).toBe(true);
  });

  it("Crimson Vial pressed twice → one row, tagged Utility, both presses counted", () => {
    const row = ledger(
      rogue([
        ["185311", 20],
        ["185311", 67],
      ]),
    ).find((c) => c.spellId === "185311");
    expect(row).toBeDefined();
    expect(row!.spellName).toBe("Crimson Vial");
    expect(row!.tag).toBe(SpellTag.Utility);
    expect(row!.isThroughput).toBe(false);
    expect(row!.casts.map((c) => Math.round(c.timeSeconds))).toEqual([20, 67]);
    expect(row!.neverUsed).toBe(false);
  });

  it("not pressed → no row: cast evidence only, so never a `never used` line", () => {
    expect(ledger(rogue([])).some((c) => c.spellId === "185311")).toBe(false);
  });

  it("a member the class roster lists is the roster's to decide: its tag when admitted, no Utility row when its talent filter drops it", () => {
    expect(ENEMY_ONLY_SAVE_IDS.has("5277")).toBe(true);
    // talents not decoded → the roster admits Evasion on the cast, Defensive
    const undecoded = makeUnit("player-1", {
      class: CombatUnitClass.Rogue,
      spec: CombatUnitSpec.Rogue_Outlaw,
      info: { pvpTalents: [] } as any,
      spellCastEvents: [makeSpellCastEvent("5277", T0 + 30_000, "player-1")],
    });
    const rows = ledger(undecoded).filter((c) => c.spellName === "Evasion");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tag).toBe(SpellTag.Defensive);
    // talents decoded and the node not taken → the roster drops it; this
    // path does not bring it back under another tag
    expect(
      ledger(rogue([["5277", 30]])).filter((c) => c.spellName === "Evasion"),
    ).toEqual([]);
  });

  it("an id outside the sets is not admitted by this path (Sprint 2983 stays off the ledger)", () => {
    expect(
      ledger(rogue([["2983", 30]])).some((c) => c.spellId === "2983"),
    ).toBe(false);
  });

  // Curated-List Completeness: which members this path can ever admit — on
  // no class roster, an official cooldown at or above the ledger floor, and
  // cast in the corpus. A member that drops out of this list was renumbered
  // or went under the floor.
  it("the members no class roster lists, by the corpus and the cooldown floor", () => {
    const OBSERVED = new Set(
      (observed as unknown as Array<string | number>).map(String),
    );
    const onRoster = new Set(
      classMetadata.flatMap((c) => c.abilities.map((a) => a.spellId)),
    );
    const admitted = [...ENEMY_ONLY_SAVE_IDS]
      .filter(
        (id) =>
          !onRoster.has(id) &&
          (effectiveCooldownSeconds(id) ?? 0) >= MIN_CD_SECONDS,
      )
      .sort();
    for (const id of admitted) expect(OBSERVED.has(id), id).toBe(true);
    for (const id of [
      "185311", // Crimson Vial
      "212295", // Nether Ward
      "452930", // Demonic Healthstone
      "6262", // Healthstone
      "3411", // Intervene
      "272682", // Master's Call
      "73325", // Leap of Faith
    ])
      expect(admitted, id).toContain(id);
  });
});
