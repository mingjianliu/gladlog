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
