/**
 * T05 (fact12 A6 / B7 / C19): a Havoc Metamorphosis pressed before a Solo
 * Shuffle round's deciding death whose 200166 landing row was logged after
 * it is this round's press. 52a97230 r0: the 162264 aura went up at
 * 0:32.885, the deciding death came at 0:33.744 and the landing at 0:33.809;
 * the kit read `Metamorphosis [120s] [UNUSED]` while `[ENEMY CD]` (the aura
 * start) printed the press. The ledger dates the press at its activation
 * (`metamorphosisPressActivationMs`) for every reader. The corpus check is
 * `packages/eval/scripts/scan5/t05.ts`.
 */
import {
  CombatUnitClass,
  CombatUnitSpec,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  cdAvailableAt,
  cdSecondsUntilReady,
  extractMajorCooldowns,
} from "../src/utils/cooldowns";
import {
  auraOffensiveOccurrences,
  metamorphosisPressActivationMs,
} from "../src/utils/offensiveAuraOccurrences";
import { SOLO_SHUFFLE_BRACKET } from "../src/utils/roundEnd";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_700_000_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);
const DEATH_S = 33.744;
const AURA_S = 32.885;
const LANDING_S = 33.809;

beforeAll(async () => {
  await ensureAnalysisData();
});

type AuraRow = [LogEvent, number];
/** Havoc loadouts: one with Demonic (node 90922), one resolved without it
 * (Deflecting Dance, node 93015) */
const WITH_DEMONIC = {
  talents: [{ id1: 90922, id2: 112831, count: 1 }],
  pvpTalents: [],
};
const NO_DEMONIC = {
  talents: [{ id1: 93015, id2: 115246, count: 1 }],
  pvpTalents: [],
};
const dh = (
  auras: AuraRow[],
  casts: Array<[string, number]>,
  info: object = {},
): ICombatUnit =>
  makeUnit("player-1", {
    name: "Dh",
    class: CombatUnitClass.DemonHunter,
    spec: CombatUnitSpec.DemonHunter_Havoc,
    info: info as never,
    spellCastEvents: casts.map(([id, s]) =>
      makeSpellCastEvent(id, at(s), "player-1"),
    ),
    auraEvents: auras.map(([event, s]) =>
      makeAuraEvent(event, "162264", at(s), "player-1", "player-1", "BUFF"),
    ),
  });
/** 52a97230 r0: the press's aura, then the death, then its landing */
const repro = () =>
  dh([[LogEvent.SPELL_AURA_APPLIED, AURA_S]], [["200166", LANDING_S]]);

const mate = () =>
  makeUnit("player-2", {
    name: "Mate",
    class: CombatUnitClass.Warrior,
    spec: CombatUnitSpec.Warrior_Arms,
    info: {},
    deathRecords: [{ timestamp: at(DEATH_S) }],
  });

const metaOf = (u: ICombatUnit) => {
  const combat = {
    startTime: T0,
    endTime: at(DEATH_S + 2),
    startInfo: { bracket: SOLO_SHUFFLE_BRACKET },
    units: { [u.id]: u, "player-2": mate() },
  } as never;
  return extractMajorCooldowns(u, combat).find((c) => c.spellId === "191427");
};

describe("T05 — a Metamorphosis up before the round's end is its press", () => {
  it("the activation is the press's own 162264 row", () => {
    expect(metamorphosisPressActivationMs(repro(), at(LANDING_S))).toBe(
      at(AURA_S),
    );
    // no aura in the landing lag: the row itself
    expect(
      metamorphosisPressActivationMs(
        dh([], [["200166", LANDING_S]]),
        at(LANDING_S),
      ),
    ).toBe(at(LANDING_S));
  });

  it("52a97230 r0 shape: the kit is not [UNUSED], the press is dated at its activation", () => {
    const meta = metaOf(repro());
    expect(meta?.neverUsed).toBe(false);
    expect(meta?.casts.map((c) => c.timeSeconds)).toEqual([AURA_S]);
  });

  // codex B11 #1: at the deciding death the press is spent, not ready
  it("at the deciding death the pressed Metamorphosis is not ready", () => {
    const meta = metaOf(repro())!;
    expect(cdAvailableAt(meta, DEATH_S)).toBe(false);
    expect(cdSecondsUntilReady(meta, DEATH_S)).toBeGreaterThan(100);
  });

  it("a landing with no aura up before the death stays out of the round", () => {
    const meta = metaOf(dh([], [["200166", LANDING_S]]));
    expect(meta === undefined || meta.neverUsed).toBe(true);
  });

  // codex B11 #2: an Eye Beam's Demonic form up before the death is not the
  // later press's activation
  it("a Demonic APPLIED (Eye Beam) before the death, a press REFRESHing it after: no press this round", () => {
    const u = dh(
      [
        [LogEvent.SPELL_AURA_APPLIED, AURA_S],
        [LogEvent.SPELL_AURA_REFRESH, 34.0],
      ],
      [
        ["198013", AURA_S + 0.001],
        ["200166", 34.2],
      ],
    );
    expect(metamorphosisPressActivationMs(u, at(34.2))).toBe(at(34.0));
    const meta = metaOf(u);
    expect(meta === undefined || meta.neverUsed).toBe(true);
    // with no REFRESH logged either: the landing row
    const bare = dh(
      [[LogEvent.SPELL_AURA_APPLIED, AURA_S]],
      [
        ["198013", AURA_S + 0.001],
        ["200166", 34.2],
      ],
    );
    expect(metamorphosisPressActivationMs(bare, at(34.2))).toBe(at(34.2));
  });

  // codex T05-2 #1: an Eye Beam 2.4 s before a press's APPLIED opened no
  // form of it (a Demonic row is logged with its cast) — the row is the press
  it("Eye Beam 2.4 s before a press's APPLIED: the press, whatever the loadout", () => {
    for (const info of [NO_DEMONIC, WITH_DEMONIC, {}]) {
      const u = dh(
        [[LogEvent.SPELL_AURA_APPLIED, AURA_S]],
        [
          ["198013", 30.5],
          ["200166", LANDING_S],
        ],
        info,
      );
      expect(metamorphosisPressActivationMs(u, at(LANDING_S))).toBe(at(AURA_S));
      expect(metaOf(u)?.neverUsed).toBe(false);
    }
  });

  it("an Eye Beam with the row: Demonic's form unless the unit lacks Demonic", () => {
    const shape = (info: object) =>
      dh(
        [[LogEvent.SPELL_AURA_APPLIED, AURA_S]],
        [
          ["198013", AURA_S + 0.05],
          ["200166", LANDING_S],
        ],
        info,
      );
    expect(metamorphosisPressActivationMs(shape(NO_DEMONIC), at(LANDING_S))).toBe(
      at(AURA_S),
    );
    // a Demonic holder (or an unread loadout): Eye Beam's form, the press
    // reads as its landing
    for (const info of [WITH_DEMONIC, {}])
      expect(metamorphosisPressActivationMs(shape(info), at(LANDING_S))).toBe(
        at(LANDING_S),
      );
  });

  it("a form instance REMOVED before the landing is not the press's row", () => {
    const u = dh(
      [
        [LogEvent.SPELL_AURA_APPLIED, 32.0],
        [LogEvent.SPELL_AURA_REMOVED, 32.5],
        [LogEvent.SPELL_AURA_APPLIED, 33.0],
        [LogEvent.SPELL_AURA_REFRESH, 33.2],
      ],
      [["200166", 33.3]],
    );
    // the earliest row of the instance up at the landing
    expect(metamorphosisPressActivationMs(u, at(33.3))).toBe(at(33.0));
  });

  // codex T05-2 #2: the enemy occurrence and the friendly ledger date the
  // press at the same instant, and recover it at the same instant
  it("a press REFRESHing an Eye Beam form: friendly press = enemy occurrence start, same recovery", () => {
    const u = dh(
      [
        [LogEvent.SPELL_AURA_APPLIED, 30.0],
        [LogEvent.SPELL_AURA_REFRESH, AURA_S],
      ],
      [
        ["198013", 30.05],
        ["200166", LANDING_S],
      ],
    );
    const friendly = metaOf(u)!;
    expect(friendly.casts.map((c) => c.timeSeconds)).toEqual([AURA_S]);
    const occ = auraOffensiveOccurrences(u, {
      startTime: T0,
      endTime: at(DEATH_S + 2),
    }).occurrences.find((o) => o.spellId === "191427")!;
    expect(occ.startMs).toBe(at(AURA_S));
    expect(occ.availableAgainAtMs).toBe(
      at(AURA_S) + friendly.cooldownSeconds * 1000,
    );
  });

  // codex T05-2b: a logged 191427 button row is its own instant — the enemy
  // side keeps a logged cast's own start, so the friendly side does too
  it("a logged 191427 button row is not backdated", () => {
    const u = dh(
      [
        [LogEvent.SPELL_AURA_APPLIED, AURA_S],
        [LogEvent.SPELL_AURA_REMOVED, 80],
      ],
      [["191427", LANDING_S]],
    );
    const combat = {
      startTime: T0,
      endTime: at(120),
      units: { [u.id]: u },
    } as never;
    const meta = extractMajorCooldowns(u, combat).find(
      (c) => c.spellId === "191427",
    );
    expect(meta?.casts.map((c) => c.timeSeconds)).toEqual([LANDING_S]);
  });
});
