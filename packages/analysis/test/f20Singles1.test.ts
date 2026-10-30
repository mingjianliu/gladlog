/**
 * F20 singles1 (fact6, 2026-10-28): D1 an ally-only external is no save of
 * its holder's; D6 a reflected DoT's return is summed over its copy's aura
 * run; D9 one break press can end a CC and a disarm; D13 the `[DEATH]` tag
 * names a control the death cut short (user ruling 4: A28 stands, wording
 * only).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { reflectedSpells } from "../src/context/spellOutcomeLines";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  breakableCcBeforeDeath,
  deathCutCcBeforeDeath,
  disarmsRemovedByPress,
  type ICCInstance,
  type IRootInstance,
} from "../src/utils/ccTrinketAnalysis";
import { cdHelpsRecipient } from "../src/utils/cooldowns";
import { computeOffensiveWindows } from "../src/utils/offensiveWindows";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("D1 — cdHelpsRecipient", () => {
  it("Blessing of Sacrifice saves another unit, never its holder (002d2573 1:22)", () => {
    expect(cdHelpsRecipient({ spellId: "6940" }, true)).toBe(false);
    expect(cdHelpsRecipient({ spellId: "6940" }, false)).toBe(true);
    // the Ultimate Sacrifice id a Holy Paladin's roster row carries once
    // pressed (F20 residual, cap-int s1/81-1-445 2:20)
    expect(cdHelpsRecipient({ spellId: "199448" }, true)).toBe(false);
    expect(cdHelpsRecipient({ spellId: "199448" }, false)).toBe(true);
  });
  it("a self-castable external saves both; a personal wall only its holder", () => {
    expect(cdHelpsRecipient({ spellId: "33206" }, true)).toBe(true);
    expect(cdHelpsRecipient({ spellId: "33206" }, false)).toBe(true);
    expect(cdHelpsRecipient({ spellId: "19236" }, true)).toBe(true);
    expect(cdHelpsRecipient({ spellId: "19236" }, false)).toBe(false);
  });
});

describe("D1 — a pressed ally-only external is no save in hand for its holder (kill-window legend)", () => {
  const combat = { startTime: T0, endTime: at(200), units: {} } as never;
  const paladin = (withSacrifice: boolean) =>
    makeUnit("e1", {
      name: "EnemyPaladin",
      spec: CombatUnitSpec.Paladin_Holy,
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: [
        ...(withSacrifice
          ? [makeSpellCastEvent("6940", at(2), "e2", "X", "e1", "EnemyPaladin")]
          : []),
        // Divine Shield at 3 s — 8 s, back long after the round
        makeSpellCastEvent(
          "642",
          at(3),
          "e1",
          "EnemyPaladin",
          "e1",
          "EnemyPaladin",
        ),
      ],
    });
  it("Blessing of Sacrifice coming back off cooldown does not close the span", () => {
    const without = computeOffensiveWindows(
      [paladin(false)] as never,
      [],
      combat,
    );
    const withIt = computeOffensiveWindows(
      [paladin(true)] as never,
      [],
      combat,
    );
    expect(withIt.map((w) => [w.fromSeconds, w.toSeconds])).toEqual(
      without.map((w) => [w.fromSeconds, w.toSeconds]),
    );
    expect(withIt[0]!.toSeconds).toBeGreaterThan(190);
  });
});

describe("D6 — a reflected DoT's copy is summed over its aura run (c5ae2200 0:19)", () => {
  const FS = "188389";
  const unit = (id: string, over: Record<string, unknown> = {}): any => ({
    id,
    name: `${id}-R-US`,
    spellCastEvents: [],
    auraEvents: [],
    missesOut: [],
    damageIn: [],
    absorbsIn: [],
    advancedActions: [0, 30_000, 60_000].map((ms) => ({
      advancedActorId: "Player-P",
      advancedActorMaxHp: 500_000,
      advancedActorCurrentHp: 500_000,
      logLine: { timestamp: T0 + ms },
    })),
    ...over,
  });
  const miss = {
    spellId: FS,
    spellName: "Flame Shock",
    missType: "REFLECT",
    destUnitId: "Player-W",
    logLine: { timestamp: T0 + 5_000 },
  };
  const tick = (s: number) => ({
    spellId: FS,
    srcUnitId: "Player-P",
    effectiveAmount: -10_000,
    logLine: { event: LogEvent.SPELL_PERIODIC_DAMAGE, timestamp: at(s) },
  });
  const aura = (event: LogEvent, s: number) => ({
    spellId: FS,
    srcUnitId: "Player-P",
    destUnitId: "Player-P",
    logLine: { event, timestamp: at(s) },
  });
  // ticks every 2 s from 7 s to 45 s: 20 ticks, 10 of them past t0 + 20 s
  const ticks = Array.from({ length: 20 }, (_, k) => tick(7 + 2 * k));
  it("the copy's ticks past 20 s count while its aura runs", () => {
    const caster = unit("Player-P", {
      missesOut: [miss],
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, 5),
        aura(LogEvent.SPELL_AURA_REMOVED, 46),
      ],
      damageIn: ticks,
    });
    const [r] = reflectedSpells([caster, unit("Player-W")], T0);
    expect(r!.damageBack).toBe(200_000);
  });
  it("without an aura the fixed 20 s window stays", () => {
    const caster = unit("Player-P", { missesOut: [miss], damageIn: ticks });
    const [r] = reflectedSpells([caster, unit("Player-W")], T0);
    // ticks at 7 … 25 s (≤ t0 + 20 s)
    expect(r!.damageBack).toBe(100_000);
  });
  it("a REMOVED + APPLIED in one ms continues the copy, in either order", () => {
    for (const pair of [
      [LogEvent.SPELL_AURA_REMOVED, LogEvent.SPELL_AURA_APPLIED],
      [LogEvent.SPELL_AURA_APPLIED, LogEvent.SPELL_AURA_REMOVED],
    ] as const) {
      const caster = unit("Player-P", {
        missesOut: [miss],
        auraEvents: [
          aura(LogEvent.SPELL_AURA_APPLIED, 5),
          aura(pair[0], 30),
          aura(pair[1], 30),
          aura(LogEvent.SPELL_AURA_REMOVED, 46),
        ],
        damageIn: ticks,
      });
      const [r] = reflectedSpells([caster, unit("Player-W")], T0);
      expect(r!.damageBack).toBe(200_000);
    }
  });
  it("the last tick logged in the removal's ms is the run's (codex F20-04)", () => {
    const caster = unit("Player-P", {
      missesOut: [miss],
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, 5),
        // the 45 s tick, then the REMOVED, both at 45 s
        aura(LogEvent.SPELL_AURA_REMOVED, 45),
      ],
      damageIn: ticks,
    });
    const [r] = reflectedSpells([caster, unit("Player-W")], T0);
    expect(r!.damageBack).toBe(200_000);
  });
  it("a second reflect that refreshes the copy owns the rest of its run (d6d8a412 r1 2:07 / 2:17)", () => {
    // W reflects at 5 s (copy APPLIED), V reflects at 15 s (copy REFRESH);
    // ticks 7 … 45 s: 7–13 are W's (4), 15–45 V's (16) — before, V kept only
    // its first 20 s (15–35) and the copy's 37–45 went back to W
    const caster = unit("Player-P", {
      missesOut: [
        miss,
        { ...miss, destUnitId: "Player-V", logLine: { timestamp: at(15) } },
      ],
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, 5),
        aura(LogEvent.SPELL_AURA_REFRESH, 15),
        aura(LogEvent.SPELL_AURA_REMOVED, 46),
      ],
      damageIn: ticks,
    });
    const out = reflectedSpells(
      [caster, unit("Player-W"), unit("Player-V")],
      T0,
    );
    expect(out.map((r) => [r.reflectorId, r.damageBack])).toEqual([
      ["Player-W", 40_000],
      ["Player-V", 160_000],
    ]);
  });
  it("a REFLECT row aimed at its own caster is no reflect (4eea3cc5 r1 1:11)", () => {
    // the caster's own Nether Ward logged a self → self REFLECT in the ms of
    // the enemy's real one; it took the return and printed "reflected by"
    // the caster itself
    const caster = unit("Player-P", {
      missesOut: [
        { ...miss, srcUnitId: "Player-P", destUnitId: "Player-P" },
        { ...miss, srcUnitId: "Player-P" },
      ],
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, 5),
        aura(LogEvent.SPELL_AURA_REMOVED, 46),
      ],
      damageIn: ticks,
    });
    const out = reflectedSpells([caster, unit("Player-W")], T0);
    expect(out.map((r) => [r.reflectorId, r.damageBack])).toEqual([
      ["Player-W", 200_000],
    ]);
  });
});

describe("F20 wide residual — the reflector's own copy hands nothing over (cb7fe23f r1 0:20)", () => {
  it("its own dose inside the reflect's window does not make its run the return", () => {
    const FS = "188389";
    const own = (event: LogEvent, s: number) => ({
      spellId: FS,
      srcUnitId: "Player-W",
      destUnitId: "Player-P",
      logLine: { event, timestamp: at(s) },
    });
    const caster: any = {
      id: "Player-P",
      name: "Player-P-R-US",
      spellCastEvents: [],
      // W's own Flame Shock on P from 0 s, a dose 2 s after the reflect, a
      // same-ms re-application at 20 s (one run), gone at 46 s
      auraEvents: [
        own(LogEvent.SPELL_AURA_APPLIED, 0),
        own(LogEvent.SPELL_AURA_APPLIED_DOSE, 7),
        own(LogEvent.SPELL_AURA_REMOVED, 20),
        own(LogEvent.SPELL_AURA_APPLIED, 20),
        own(LogEvent.SPELL_AURA_REMOVED, 46),
      ],
      missesOut: [
        {
          spellId: FS,
          spellName: "Flame Shock",
          missType: "REFLECT",
          destUnitId: "Player-W",
          logLine: { timestamp: at(5) },
        },
      ],
      damageIn: Array.from({ length: 20 }, (_, k) => ({
        spellId: FS,
        srcUnitId: "Player-W",
        effectiveAmount: -10_000,
        logLine: {
          event: LogEvent.SPELL_PERIODIC_DAMAGE,
          timestamp: at(7 + 2 * k),
        },
      })),
      absorbsIn: [],
      advancedActions: [
        {
          advancedActorId: "Player-P",
          advancedActorMaxHp: 500_000,
          advancedActorCurrentHp: 500_000,
          logLine: { timestamp: at(5) },
        },
      ],
    };
    const w: any = {
      ...caster,
      id: "Player-W",
      name: "Player-W-R-US",
      auraEvents: [],
      missesOut: [],
      damageIn: [],
      advancedActions: [],
    };
    expect(reflectedSpells([caster, w], T0)).toEqual([]);
  });
});

describe("F20 wide residual — a reflect chain deals damage by any of its ids (d59fd620 r1 1:01)", () => {
  // Death Coil reflected as its cast id 47541 (no damage effect) and its
  // damage id 47632; a Pestilence reflected around it; Nether Ward's 60k
  // lands 0.32 s after the Death Coil's last row, 0.49 s after Pestilence's
  const row = (spellId: string, spellName: string, s: number) => ({
    spellId,
    spellName,
    missType: "REFLECT",
    destUnitId: "Player-W",
    logLine: { timestamp: at(s) },
  });
  it("the Nether Ward row goes to the Death Coil, not the Pestilence", () => {
    const caster: any = {
      id: "Player-P",
      name: "Player-P-R-US",
      spellCastEvents: [],
      auraEvents: [],
      missesOut: [
        row("327093", "Pestilence", 5),
        row("47541", "Death Coil", 5.156),
        row("327093", "Pestilence", 5.176),
        row("47632", "Death Coil", 5.344),
      ],
      damageIn: [
        {
          spellId: "212295",
          srcUnitId: "Player-W",
          effectiveAmount: -60_000,
          logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: at(5.668) },
        },
      ],
      absorbsIn: [],
      advancedActions: [
        {
          advancedActorId: "Player-P",
          advancedActorMaxHp: 500_000,
          advancedActorCurrentHp: 500_000,
          logLine: { timestamp: at(5) },
        },
      ],
    };
    const w: any = {
      ...caster,
      id: "Player-W",
      name: "Player-W-R-US",
      missesOut: [],
      damageIn: [],
      advancedActions: [],
    };
    const out = reflectedSpells([caster, w], T0);
    expect(out.map((r) => [r.spellName, r.damageBack])).toEqual([
      ["Death Coil", 60_000],
    ]);
  });
});

describe("D9 — disarmsRemovedByPress (c992ce75 0:14)", () => {
  const disarm = (
    atS: number,
    durS: number,
    over: Partial<IRootInstance> = {},
  ): IRootInstance => ({
    atSeconds: atS,
    durationSeconds: durS,
    spellId: "236077",
    spellName: "Disarm",
    sourceName: "w",
    sourceId: "w",
    sourceSpec: "",
    fullDurationSeconds: 5,
    ...over,
  });
  it("a disarm cut short at the press is removed by it", () => {
    const d = disarm(11.944, 2.867);
    expect(disarmsRemovedByPress([d], T0, at(14.811), [])).toEqual([d]);
  });
  it("one that ran its full length, or ended elsewhere, is not", () => {
    const full = disarm(9.811, 5);
    const early = disarm(5, 2);
    expect(disarmsRemovedByPress([full, early], T0, at(14.811), [])).toEqual(
      [],
    );
  });
  it("every disarm the press ended, not only the binder's", () => {
    const a = disarm(11.944, 2.867);
    const b = disarm(12.5, 2.311, {
      spellId: "207777",
      spellName: "Dismantle",
    });
    expect(disarmsRemovedByPress([a, b], T0, at(14.811), [])).toHaveLength(2);
  });
  it("with a CC taken, a disarm the Medallion's removals took just before its buff row is still the press's (605 s1/53-1 0:19, s0/4-6 2:23)", () => {
    // Dismantle 19.385 → 20.147 (of 4 s); Howl of Terror REMOVED 20.155 in
    // the Medallion's buff row — the press instant pvpTrinketUses gives; the
    // Crippling Poison it also cleansed came off at 20.148
    const dismantle = disarm(19.385, 0.762, {
      spellId: "207777",
      spellName: "Dismantle",
      fullDurationSeconds: 4,
    });
    const howl = {
      spellId: "5484",
      spellName: "Howl of Terror",
      atSeconds: 19.508,
      durationSeconds: 0.647,
      expectedDurationSeconds: 6,
    } as unknown as ICCInstance;
    expect(disarmsRemovedByPress([dismantle], T0, at(20.155), [howl])).toEqual([
      dismantle,
    ]);
    // Sticky Tar Bomb 1.281 s of 4, REMOVED 1 ms before the buff row
    const tar = disarm(57.694, 1.281, {
      spellId: "407032",
      spellName: "Sticky Tar Bomb",
      fullDurationSeconds: 4,
    });
    const binding = {
      spellId: "117526",
      spellName: "Binding Shot",
      atSeconds: 58.291,
      durationSeconds: 0.685,
      expectedDurationSeconds: 3,
    } as unknown as ICCInstance;
    expect(disarmsRemovedByPress([tar], T0, at(58.976), [binding])).toEqual([
      tar,
    ]);
    // gone 29 ms before the press: out of the press's lag, CC or not
    const gone = disarm(19.385, 0.741, {
      spellId: "207777",
      spellName: "Dismantle",
      fullDurationSeconds: 4,
    });
    expect(disarmsRemovedByPress([gone], T0, at(20.155), [howl])).toEqual([]);
  });
  it("a disarm gone in the bound CC's own ms is the press's when no buff row anchors it (codex 20-F20-40)", () => {
    // no Medallion buff row: the press instant is the cast row, 20 ms after
    // Howl of Terror and Dismantle both came off at 20.147
    const dismantle = disarm(19.385, 0.762, {
      spellId: "207777",
      spellName: "Dismantle",
      fullDurationSeconds: 4,
    });
    const howl = {
      spellId: "5484",
      spellName: "Howl of Terror",
      atSeconds: 19.508,
      durationSeconds: 0.639,
      expectedDurationSeconds: 6,
    } as unknown as ICCInstance;
    expect(disarmsRemovedByPress([dismantle], T0, at(20.167), [howl])).toEqual([
      dismantle,
    ]);
  });
  it("a round-end endpoint is not a shared removal (codex 20-F20-37)", () => {
    // Howl 19 → round end 22, nothing removed it; Medallion at 20.155
    const howl = {
      spellId: "5484",
      spellName: "Howl of Terror",
      atSeconds: 19,
      durationSeconds: 3,
      expectedDurationSeconds: 6,
      stillOnAtRoundEnd: true,
    } as unknown as ICCInstance;
    const opts = {
      spellId: "207777",
      spellName: "Dismantle",
      fullDurationSeconds: 4,
      stillOnAtRoundEnd: true as const,
    };
    // applied after the press, ends on the same synthetic 22 s
    const later = disarm(21, 1, opts);
    // on before the press, still on at round end
    const before = disarm(19.5, 2.5, opts);
    expect(
      disarmsRemovedByPress([later, before], T0, at(20.155), [howl]),
    ).toEqual([]);
  });
  it("an end the log did not write is no removal (codex 20-F20-38)", () => {
    const opts = {
      spellId: "207777",
      spellName: "Dismantle",
      fullDurationSeconds: 4,
    };
    // Howl 16 s with no REMOVED: its end, 22 s, is the official length;
    // Dismantle 19.5 s really removed at 22 s, the Medallion at 20.155
    const estimated = {
      spellId: "5484",
      spellName: "Howl of Terror",
      atSeconds: 16,
      durationSeconds: 6,
      expectedDurationSeconds: 6,
      noRemoved: true,
    } as unknown as ICCInstance;
    const removed = disarm(19.5, 2.5, opts);
    expect(
      disarmsRemovedByPress([removed], T0, at(20.155), [estimated]),
    ).toEqual([]);
    // both clipped at the round's end, 22 s, the Medallion 5 ms before it
    const clipped = {
      spellId: "5484",
      spellName: "Howl of Terror",
      atSeconds: 19,
      durationSeconds: 3,
      expectedDurationSeconds: 6,
      stillOnAtRoundEnd: true,
      noRemoved: true,
    } as unknown as ICCInstance;
    const cut = disarm(19.5, 2.5, {
      ...opts,
      stillOnAtRoundEnd: true,
      noRemoved: true,
    });
    expect(disarmsRemovedByPress([cut], T0, at(21.995), [clipped])).toEqual([]);
  });
});

describe("D13 — deathCutCcBeforeDeath (1263fff6 2:35, ruling 4)", () => {
  const SCREAM = "8122";
  const cc = (atS: number, durS: number): ICCInstance =>
    ({
      atSeconds: atS,
      durationSeconds: durS,
      spellId: SCREAM,
      spellName: "Psychic Scream",
      sourceName: "b",
      sourceId: "b",
      sourceSpec: "",
      damageTakenDuring: 0,
      trinketState: "available_unused",
      drInfo: null,
      distanceYards: null,
      losBlocked: null,
    }) as ICCInstance;
  const holder = (died: boolean) =>
    makeUnit("p", {
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          SCREAM,
          at(155.201),
          "b",
          "p",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          SCREAM,
          at(155.712),
          "b",
          "p",
        ),
      ],
      deathRecords: died ? [{ timestamp: at(155.713) }] : [],
    });
  const scream = cc(155.201, 0.511);
  it("a Psychic Scream the death cut at 0.5 s is named; A28 still calls it unbreakable", () => {
    expect(breakableCcBeforeDeath({ ccInstances: [scream] }, 155.713)).toBe(
      false,
    );
    expect(
      deathCutCcBeforeDeath(
        { ccInstances: [scream] },
        holder(true),
        T0,
        155.713,
      ),
    ).toEqual({ spellName: "Psychic Scream", leadSeconds: "0.5" });
  });
  it("a short control that ended before the death is not death-cut", () => {
    expect(
      deathCutCcBeforeDeath({ ccInstances: [scream] }, holder(false), T0, 160),
    ).toBeUndefined();
  });
});
