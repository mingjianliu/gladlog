import {
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  castAndEffectIds,
  effectSpanIdsOfCast,
  TALENT_EFFECT_AURAS_OF_CAST,
} from "../src/data/castEffectAuras";
import { ensureAnalysisData } from "../src/data/ensure";
import { SpellTag } from "../src/data/spellTypes";
import {
  extractMajorCooldowns,
  friendlyOffensiveCdActiveAt,
} from "../src/utils/cooldowns";
import {
  observedEffectEndSeconds,
  reconstructEnemyCDTimeline,
} from "../src/utils/enemyCDs";
import { isOffensiveLedgerCd } from "../src/utils/spellDanger";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

// GH #184 part B (user ruling 2026-11-05, option A): a Retribution Divine
// Toll's window is its Divine Resonance 1266308 aura as the log shows it; a
// press with none logged has no span.
const T0 = 1_000_000;
const DIVINE_TOLL = "375576";
const RESONANCE = "1266308";

function scene(auras: Array<[LogEvent, number]>) {
  const caster = makeUnit("c1", {
    name: "Ret",
    auraEvents: auras.map(([ev, s]) => ({
      ...makeAuraEvent(ev, RESONANCE, T0 + s * 1000, "c1", "c1", "BUFF"),
      srcUnitName: "Ret",
    })),
  } as never);
  const combat = {
    startTime: T0,
    endTime: T0 + 200_000,
    units: { c1: caster },
  } as never;
  return { caster, combat };
}

describe("Divine Toll's span on Divine Resonance", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("the talent aura is a span id of the press only, not a miss / control id", () => {
    expect(TALENT_EFFECT_AURAS_OF_CAST[DIVINE_TOLL]).toEqual([RESONANCE]);
    expect(effectSpanIdsOfCast(DIVINE_TOLL).has(RESONANCE)).toBe(true);
    expect(castAndEffectIds(DIVINE_TOLL).has(RESONANCE)).toBe(false);
  });

  it("ends where the log removed Divine Resonance", () => {
    const { caster, combat } = scene([
      [LogEvent.SPELL_AURA_APPLIED, 10],
      [LogEvent.SPELL_AURA_REMOVED, 23.5],
    ]);
    expect(
      observedEffectEndSeconds(caster, DIVINE_TOLL, 10, Infinity, combat),
    ).toBe(23.5);
  });

  it("no Divine Resonance logged: no observed span", () => {
    const { caster, combat } = scene([]);
    expect(
      observedEffectEndSeconds(caster, DIVINE_TOLL, 10, Infinity, combat),
    ).toBeNull();
  });
});

// codex review 2026-11-06 (P1, P2 ×2)
const cast = (spellId: string, s: number) => ({
  spellId,
  spellName: spellId,
  srcUnitId: "u",
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + s * 1000 },
});
const aura = (spellId: string, s: number, event: LogEvent) => ({
  spellId,
  spellName: spellId,
  srcUnitId: "u",
  destUnitId: "u",
  timestamp: T0 + s * 1000,
  logLine: { event, timestamp: T0 + s * 1000 },
});
const unit = (
  unitClass: CombatUnitClass,
  spec: CombatUnitSpec,
  spellCastEvents: unknown[],
  auraEvents: unknown[] = [],
) =>
  ({
    id: "u",
    name: "Unit",
    class: unitClass,
    spec,
    spellCastEvents,
    auraEvents,
    damageIn: [],
    damageOut: [],
    healOut: [],
    healIn: [],
  }) as never;

describe("GH #184 part B — the readers codex probed", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });
  const round = (u: unknown, endS = 300) =>
    ({ startTime: T0, endTime: T0 + endS * 1000, units: { u } }) as never;

  it("P1: the ledger tags the row Offensive in the gated spec — no healer roster needed", () => {
    for (const [cls, spec, id] of [
      [
        CombatUnitClass.Paladin,
        CombatUnitSpec.Paladin_Retribution,
        DIVINE_TOLL,
      ],
      [CombatUnitClass.Druid, CombatUnitSpec.Druid_Feral, "391528"],
      [CombatUnitClass.Druid, CombatUnitSpec.Druid_Balance, "391528"],
    ] as const) {
      const u = unit(cls, spec, [cast(id, 20)]);
      const row = extractMajorCooldowns(u, round(u)).find(
        (c) => c.spellId === id,
      );
      expect(row?.tag, spec).toBe(SpellTag.Offensive);
      expect(isOffensiveLedgerCd(row!), spec).toBe(true);
    }
    const prot = unit(
      CombatUnitClass.Paladin,
      CombatUnitSpec.Paladin_Protection,
      [cast(DIVINE_TOLL, 20)],
    );
    const protRow = extractMajorCooldowns(prot, round(prot)).find(
      (c) => c.spellId === DIVINE_TOLL,
    );
    expect(protRow?.tag).not.toBe(SpellTag.Offensive);
  });

  it("P2: Resonance up past the round's end — the aura's official length, not 0", () => {
    const ret = unit(
      CombatUnitClass.Paladin,
      CombatUnitSpec.Paladin_Retribution,
      [cast(DIVINE_TOLL, 10)],
      [
        aura(RESONANCE, 10, LogEvent.SPELL_AURA_APPLIED),
        aura(RESONANCE, 23.5, LogEvent.SPELL_AURA_REMOVED),
      ],
    );
    const t = reconstructEnemyCDTimeline([ret], round(ret, 20));
    const dt = t.players[0]!.offensiveCDs.find(
      (c) => c.spellId === DIVINE_TOLL,
    );
    expect(dt?.buffEndSeconds).toBeGreaterThan(20);
  });

  it("P2: a press with no Resonance keeps no span", () => {
    const ret = unit(
      CombatUnitClass.Paladin,
      CombatUnitSpec.Paladin_Retribution,
      [cast(DIVINE_TOLL, 10)],
    );
    const t = reconstructEnemyCDTimeline([ret], round(ret));
    const dt = t.players[0]!.offensiveCDs.find(
      (c) => c.spellId === DIVINE_TOLL,
    );
    expect(dt?.buffEndSeconds).toBe(10);
  });

  it("P2: a Feral's running Convoke is a friendly offensive CD; a Restoration's is not", () => {
    const at = (spec: CombatUnitSpec) => {
      const u = makeUnit("f1", {
        spec,
        auraEvents: [
          makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            "391528",
            T0 + 10_000,
            "f1",
            "f1",
            "BUFF",
          ),
          makeAuraEvent(
            LogEvent.SPELL_AURA_REMOVED,
            "391528",
            T0 + 14_000,
            "f1",
            "f1",
            "BUFF",
          ),
        ],
      } as never) as never;
      return friendlyOffensiveCdActiveAt(
        [u],
        [],
        new Set(["f1"]),
        T0 + 11_000,
        {
          startTime: T0,
          endTime: T0 + 120_000,
        },
      );
    };
    expect(at(CombatUnitSpec.Druid_Feral)).toBe(true);
    expect(at(CombatUnitSpec.Druid_Restoration)).toBe(false);
  });
});
