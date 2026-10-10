/**
 * FT board item 1 (user ruling 2026-10-09): a save the timeline prints when
 * an ENEMY presses it (`ENEMY_ONLY_SAVE_IDS` → `[ENEMY DEF]`) is on the
 * presser's own ledger too — as a Utility row, on cast evidence only.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { CombatUnitClass, CombatUnitSpec } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { evaluateSyncWindow } from "../src/analysis/candidates/cooldownTiming";
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
import { FREE_RECAST_WINDOWS } from "../src/data/talentScriptedCooldowns";
import {
  cdAvailableAt,
  extractMajorCooldowns,
  MIN_CD_SECONDS,
} from "../src/utils/cooldowns";
import { SELF_SAVE_IDS } from "../src/utils/enemyDefensives";
import { createKillWindowFactsComputer } from "../src/utils/killWindowFacts";
import { OFFENSIVE_CD_SPELL_IDS } from "../src/utils/spellDanger";
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

/**
 * The offensive half (user ruling 2026-10-09, option ②): a cooldown of the
 * canonical offensive catalog that no class roster lists enters on a cast as
 * a Utility row that is response-only — its press answers, nothing names it
 * ready and unpressed.
 */
describe("the ledger admits a pressed off-roster offensive cooldown as a press-only row", () => {
  const INFERNAL = "1122";
  const warlock = (casts: Array<[string, number]>) =>
    makeUnit("player-1", {
      class: CombatUnitClass.Warlock,
      spec: CombatUnitSpec.Warlock_Destruction,
      info: { talents: [], pvpTalents: [] } as any,
      spellCastEvents: casts.map(([id, s]) =>
        makeSpellCastEvent(id, T0 + s * 1000, "player-1"),
      ),
    });

  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("Summon Infernal: in the offensive catalog, on no class roster, at or above the ledger floor", () => {
    expect(OFFENSIVE_CD_SPELL_IDS.has(INFERNAL)).toBe(true);
    expect(
      classMetadata.some((c) =>
        c.abilities.some((a) => a.spellId === INFERNAL),
      ),
    ).toBe(false);
    expect(effectiveCooldownSeconds(INFERNAL)).toBeGreaterThanOrEqual(
      MIN_CD_SECONDS,
    );
  });

  it("pressed → a Utility row, response-only, the press counted; unpressed → no row", () => {
    const row = ledger(warlock([[INFERNAL, 20]])).find(
      (c) => c.spellId === INFERNAL,
    );
    expect(row).toBeDefined();
    expect(row!.tag).toBe(SpellTag.Utility);
    expect(row!.responseOnly).toBe(true);
    expect(row!.isThroughput).toBe(false);
    expect(row!.casts.map((c) => Math.round(c.timeSeconds))).toEqual([20]);
    expect(ledger(warlock([])).some((c) => c.spellId === INFERNAL)).toBe(false);
  });

  it("a save row from the same path is not response-only (the flag is the offensive half's)", () => {
    const vial = ledger(rogue([["185311", 20]])).find(
      (c) => c.spellId === "185311",
    );
    expect(vial!.responseOnly).toBeUndefined();
  });

  it("missed-sync-window: the press enters a lock; ready and unpressed, the row is not named", () => {
    const row = ledger(warlock([[INFERNAL, 20]])).find(
      (c) => c.spellId === INFERNAL,
    )!;
    // pressed at 20 s, a lock at 21–26 s: entered
    expect(
      evaluateSyncWindow({ fromSeconds: 21, toSeconds: 26 }, [row]).entered,
    ).toBe(true);
    // long after the cooldown is back, a lock nobody pressed into: the row
    // is ready by the cooldown model and still not in `ready`
    const late = evaluateSyncWindow({ fromSeconds: 250, toSeconds: 256 }, [
      row,
    ]);
    expect(late.entered).toBe(false);
    expect(late.ready).toEqual([]);
    // the same lock with the flag off names it — the flag is what holds it out
    expect(
      evaluateSyncWindow({ fromSeconds: 250, toSeconds: 256 }, [
        { ...row, responseOnly: undefined },
      ]).ready.map((c) => c.spellName),
    ).toEqual(["Summon Infernal"]);
  });

  it("kill window: `pressed inside` lists the press; the ready list and `accountable` do not read the row", () => {
    const lock = warlock([[INFERNAL, 20]]);
    const target = makeUnit("enemy-1", {
      class: CombatUnitClass.Warrior,
      spec: CombatUnitSpec.Warrior_Arms,
    });
    const computer = createKillWindowFactsComputer(
      combatOf(lock),
      [lock],
      [target],
    );
    const early = computer.facts(target, 15, 30);
    expect(early.pressedInside?.map((p) => p.name)).toEqual([
      "Summon Infernal",
    ]);
    expect(early.readyOffCds).toEqual([]);
    const late = computer.facts(target, 250, 260);
    expect(late.readyOffCds).toEqual([]);
    expect(late.backInside ?? []).toEqual([]);
    expect(late.maybeOffCds ?? []).toEqual([]);
    expect(late.accountable).toBe(false);
  });
});

/**
 * Save the Day (FREE_RECAST_WINDOWS, 2026-10-10): the Leap of Faith row this
 * path gave every priest spec showed a second press 2–6 s after the first as
 * a press the cooldown model called impossible (605 files: 41 of 622, every
 * one a Save the Day holder).
 */
describe("Leap of Faith under Save the Day: the second press inside 6 s is the talent's, not a broken cooldown", () => {
  const LEAP = "73325";
  /** Save the Day is entry 119331 of a choice node of the Oracle hero tree */
  const SAVE_THE_DAY = { id1: 94675, id2: 119331, count: 1 };
  const priest = (talents: any[], castsS: number[]) =>
    makeUnit("player-1", {
      class: CombatUnitClass.Priest,
      spec: CombatUnitSpec.Priest_Holy,
      info: { talents, pvpTalents: [] } as any,
      spellCastEvents: castsS.map((s) =>
        makeSpellCastEvent(LEAP, T0 + s * 1000, "player-2"),
      ),
    });
  const row = (u: any) => ledger(u).find((c) => c.spellId === LEAP)!;

  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("the table names the talent and the window", () => {
    expect(FREE_RECAST_WINDOWS["440669"]).toMatchObject({
      spellId: LEAP,
      windowS: 6,
    });
  });

  it("holder: a press 3 s after the opener is free; the cooldown stays on the opener", () => {
    const r = row(priest([SAVE_THE_DAY], [50, 53]));
    expect(r.casts.map((c) => c.freeRecast ?? false)).toEqual([false, true]);
    // not ready a few seconds after the pair, ready one cooldown after the OPENER
    expect(cdAvailableAt(r, 56)).toBe(false);
    expect(cdAvailableAt(r, 50 + r.cooldownSeconds - 1)).toBe(false);
    expect(cdAvailableAt(r, 50 + r.cooldownSeconds)).toBe(true);
  });

  it("holder: while the window is open and unused the spell is available", () => {
    const r = row(priest([SAVE_THE_DAY], [50]));
    expect(cdAvailableAt(r, 54)).toBe(true);
    expect(cdAvailableAt(r, 57)).toBe(false);
  });

  it("non-holder: no window — the same second press is not marked free", () => {
    const r = row(priest([], [50, 53]));
    expect(r.casts.some((c) => c.freeRecast)).toBe(false);
    expect(cdAvailableAt({ ...r, casts: r.casts.slice(0, 1) }, 54)).toBe(false);
  });

  it("holder: a second press 1.7 s later is kept — not folded as a double-logged line (codex 40-FT-46)", () => {
    const u = priest([SAVE_THE_DAY], []);
    (u as any).spellCastEvents = [
      makeSpellCastEvent(LEAP, T0 + 50_000, "player-2"),
      makeSpellCastEvent(LEAP, T0 + 51_700, "player-3"),
    ];
    const r = row(u);
    expect(r.casts.map((c) => Math.round(c.timeSeconds * 10) / 10)).toEqual([
      50, 51.7,
    ]);
    expect(r.casts[1]!.freeRecast).toBe(true);
    // the free press is spent: nothing left of the window
    expect(cdAvailableAt(r, 54)).toBe(false);
  });

  it("non-holder: two lines 1.7 s apart stay one press (the double-log rule is unchanged)", () => {
    const u = priest([], []);
    (u as any).spellCastEvents = [
      makeSpellCastEvent(LEAP, T0 + 50_000, "player-2"),
      makeSpellCastEvent(LEAP, T0 + 51_700, "player-2"),
    ];
    expect(row(u).casts).toHaveLength(1);
  });

  it("the choice node unresolved, or Divine Feathers taken: no window (codex 40-FT-46)", () => {
    for (const talent of [
      { id1: 94675, id2: 0, count: 1 }, // which entry is not in the loadout
      { id1: 94675, id2: 117278, count: 1 }, // Divine Feathers
    ]) {
      const r = row(priest([talent], [50]));
      expect(r.casts[0]!.freeRecastUntil, JSON.stringify(talent)).toBe(
        undefined,
      );
      expect(cdAvailableAt(r, 54)).toBe(false);
    }
  });
});
