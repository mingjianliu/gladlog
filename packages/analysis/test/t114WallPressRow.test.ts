/**
 * T114 (fact13 D22, e2047b8b r0 2:43): the burst ledger's "pressed Zs after
 * the burst opened" is the press — its cast row — not the instant the wall's
 * aura settled. Spirit Link Totem pressed 4.95 s into the burst; the totem's
 * aura flickered on the target (0.11 s, 0.38 s after the press) and settled
 * 1.0 s after it; the line read "pressed 6.0s".
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { analyzeBurstLedger, wallTimingPhrase } from "../src/utils/burstLedger";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T = 1_000_000;
const at = (s: number) => T + s * 1000;
const SLT_CAST = "98008";
const SLT_AURA = "325174";
const info = { teamId: "0", specId: "x" } as unknown as NonNullable<
  Parameters<typeof makeUnit>[1]
>["info"];
type Combat = Parameters<typeof analyzeBurstLedger>[3];

const dmg = (s: number) => ({
  logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: at(s), parameters: [] },
  timestamp: at(s),
  effectiveAmount: -50_000,
  amount: -50_000,
  srcUnitId: "p1",
  srcUnitName: "Ret",
  destUnitId: "e1",
  destUnitName: "Pala",
  spellId: "1",
  spellName: "TestSpell",
});
const ret = makeUnit("p1", {
  name: "Ret",
  spec: CombatUnitSpec.Paladin_Retribution,
  info,
  spellCastEvents: [
    makeSpellCastEvent(
      "31884",
      at(10),
      "p1",
      "S",
      "p1",
      "Ret",
      0,
      "Avenging Wrath",
    ),
  ],
  damageOut: [dmg(12), dmg(17)],
});
const totemAura = (event: LogEvent, s: number) => ({
  ...makeAuraEvent(event, SLT_AURA, at(s), "t1", "e1", "BUFF"),
  srcUnitName: "Spirit Link Totem",
  spellName: "Spirit Link Totem",
});
const target = makeUnit("e1", {
  name: "Pala",
  spec: CombatUnitSpec.Paladin_Retribution,
  reaction: CombatUnitReaction.Hostile,
  info,
  auraEvents: [
    totemAura(LogEvent.SPELL_AURA_APPLIED, 15.06),
    totemAura(LogEvent.SPELL_AURA_REMOVED, 15.1),
    totemAura(LogEvent.SPELL_AURA_APPLIED, 15.33),
    totemAura(LogEvent.SPELL_AURA_REMOVED, 15.42),
    totemAura(LogEvent.SPELL_AURA_APPLIED, 15.96),
    totemAura(LogEvent.SPELL_AURA_REMOVED, 21),
  ],
});
const shamanWith = (pressS: number | undefined) =>
  makeUnit("e2", {
    name: "Sham",
    spec: CombatUnitSpec.Shaman_Restoration,
    reaction: CombatUnitReaction.Hostile,
    info,
    spellCastEvents:
      pressS === undefined
        ? []
        : [
            makeSpellCastEvent(
              SLT_CAST,
              at(pressS),
              "",
              "",
              "e2",
              "Sham",
              0,
              "Spirit Link Totem",
            ),
          ],
  });
const totem = makeUnit("t1", { name: "Spirit Link Totem", ownerId: "e2" });
const hitOf = (pressS: number | undefined) => {
  const sham = shamanWith(pressS);
  const combat = {
    startTime: T,
    endTime: at(120),
    units: Object.fromEntries([ret, target, sham, totem].map((u) => [u.id, u])),
  } as unknown as Combat;
  return analyzeBurstLedger(
    ret,
    [],
    [target, sham],
    combat,
  )[0]!.dominantTarget?.defensivesHit.find((d) => d.spellId === SLT_AURA);
};

describe("T114 — a wall's 'pressed Zs' is its press row", () => {
  it("a totem's aura that settled a second after the press reads the press", () => {
    const hit = hitOf(14.95);
    expect(hit?.startOffsetMs).toBe(5960);
    expect(wallTimingPhrase(hit)).toBe("pressed 5.0s after the burst opened");
  });
  it("an external whose aura landed 1.2 s after its cast reads the cast", () => {
    // 605 de880322 r2 2:07: Blessing of Protection cast 5.51 s into the
    // burst, its aura on the target at 6.74 s; `[ENEMY DEF]` pairs them
    const BOP = "1022";
    const pal = makeUnit("e3", {
      name: "Holy",
      spec: CombatUnitSpec.Paladin_Holy,
      reaction: CombatUnitReaction.Hostile,
      info,
      spellCastEvents: [
        {
          ...makeSpellCastEvent(
            BOP,
            at(15.51),
            "e1",
            "Pala",
            "e3",
            "Holy",
            0,
            BOP,
          ),
          spellName: "Blessing of Protection",
        },
      ],
    });
    const bop = (event: LogEvent, s: number) => ({
      ...makeAuraEvent(event, BOP, at(s), "e3", "e1", "BUFF"),
      srcUnitName: "Holy",
      spellName: "Blessing of Protection",
    });
    const tgt = makeUnit("e1", {
      name: "Pala",
      spec: CombatUnitSpec.Paladin_Retribution,
      reaction: CombatUnitReaction.Hostile,
      info,
      auraEvents: [
        bop(LogEvent.SPELL_AURA_APPLIED, 16.74),
        bop(LogEvent.SPELL_AURA_REMOVED, 21.14),
      ],
    });
    const combat = {
      startTime: T,
      endTime: at(120),
      units: Object.fromEntries([ret, tgt, pal].map((u) => [u.id, u])),
    } as unknown as Combat;
    const hit = analyzeBurstLedger(
      ret,
      [],
      [tgt, pal],
      combat,
    )[0]!.dominantTarget?.defensivesHit.find((d) => d.spellId === BOP);
    expect(wallTimingPhrase(hit)).toBe("pressed 5.5s after the burst opened");
  });
  it("a holder who walked into the totem later reads the totem's press", () => {
    // 605: Spirit Link Totem pressed 1.1–1.5 s before its holder was
    // linked; the totem pulsed on its caster at once
    const sham = shamanWith(15);
    const pulsing = makeUnit("t1", {
      name: "Spirit Link Totem",
      ownerId: "e2",
      spellCastEvents: [
        makeSpellCastEvent(
          SLT_AURA,
          at(15.1),
          "e2",
          "Sham",
          "t1",
          "Spirit Link Totem",
          0,
          "Spirit Link Totem",
        ),
      ],
    });
    const late = makeUnit("e1", {
      name: "Pala",
      spec: CombatUnitSpec.Paladin_Retribution,
      reaction: CombatUnitReaction.Hostile,
      info,
      auraEvents: [
        totemAura(LogEvent.SPELL_AURA_APPLIED, 16.45),
        totemAura(LogEvent.SPELL_AURA_REMOVED, 21),
      ],
    });
    const combat = {
      startTime: T,
      endTime: at(120),
      units: Object.fromEntries(
        [ret, late, sham, pulsing].map((u) => [u.id, u]),
      ),
    } as unknown as Combat;
    const hit = analyzeBurstLedger(
      ret,
      [],
      [late, sham],
      combat,
    )[0]!.dominantTarget?.defensivesHit.find((d) => d.spellId === SLT_AURA);
    expect(wallTimingPhrase(hit)).toBe("pressed 5.0s after the burst opened");
  });
  it("with no press row the aura's start stays the reading", () => {
    expect(wallTimingPhrase(hitOf(undefined))).toBe(
      "pressed 6.0s after the burst opened",
    );
  });
});

// Batch review 80-PIPE-75-B70b #1 (T114 meeting T124): Anti-Magic Zone's
// aura 145629 is logged with no source. Burst opens 10 s, a teammate of the
// target casts the zone at 15 s, the aura reaches the target at 19 s.
describe("T114 — a source-less wall's press is its one caster's cast", () => {
  const AMZ_CAST = "51052";
  const AMZ_AURA = "145629";
  const zoneAura = (event: LogEvent, s: number) => ({
    ...makeAuraEvent(event, AMZ_AURA, at(s), "0000000000000000", "e1", "BUFF"),
    srcUnitName: "nil",
    spellName: "Anti-Magic Zone",
  });
  const hitWith = (casters: string[], castS = 15, auraS = 19) => {
    const tgt = makeUnit("e1", {
      name: "Pala",
      spec: CombatUnitSpec.Paladin_Retribution,
      reaction: CombatUnitReaction.Hostile,
      info,
      auraEvents: [
        zoneAura(LogEvent.SPELL_AURA_APPLIED, auraS),
        zoneAura(LogEvent.SPELL_AURA_REMOVED, auraS + 2),
      ],
    });
    const dks = casters.map((id) =>
      makeUnit(id, {
        name: `DK-${id}`,
        spec: CombatUnitSpec.DeathKnight_Unholy,
        reaction: CombatUnitReaction.Hostile,
        info,
        spellCastEvents: [
          makeSpellCastEvent(
            AMZ_CAST,
            at(castS),
            "",
            "",
            id,
            `DK-${id}`,
            0,
            "Anti-Magic Zone",
          ),
        ],
      }),
    );
    const combat = {
      startTime: T,
      endTime: at(120),
      units: Object.fromEntries([ret, tgt, ...dks].map((u) => [u.id, u])),
    } as unknown as Combat;
    return analyzeBurstLedger(
      ret,
      [],
      [tgt, ...dks],
      combat,
    )[0]!.dominantTarget?.defensivesHit.find((d) => d.spellId === AMZ_AURA);
  };
  it("one teammate cast it: the press is that cast", () => {
    expect(wallTimingPhrase(hitWith(["e3"]))).toBe(
      "pressed 5.0s after the burst opened",
    );
  });
  it("no cast resolves: no press is claimed", () => {
    expect(wallTimingPhrase(hitWith([]))).toBe(
      "9.0s after the burst opened [no press logged]",
    );
  });
  // batch review 80-PIPE-83-B70c: cast 9 s, burst opens 10 s, the aura
  // reaches the target 11 s — the press is before the burst, not inside it
  it("cast before the opening, aura after it: pressed before the burst", () => {
    expect(wallTimingPhrase(hitWith(["e3"], 9, 11))).toBe(
      "pressed 1.0s before the burst opened",
    );
  });
  it("two casters: no one cast resolves, no press is claimed", () => {
    expect(wallTimingPhrase(hitWith(["e3", "e4"]))).toBe(
      "9.0s after the burst opened [no press logged]",
    );
  });
});
