/**
 * T103 (fact13 D3 / D7 / D17): a `[BUFF FADED]` cause the log contradicts.
 *  - D7 (26c4ac25 r0 0:13): a one-stack Power Siphon removed 7 ms after the
 *    Demonbolt that spends it read `ended after 4.2 of 20s` — its charge
 *    was spent (the 2:00 press's two stacks show Demonbolt spending a dose).
 *  - D3 (0a13e993 r0 0:34): Touch of Karma's absorb aura came off 0.78 s
 *    before its 10 s, in the ms of a hit it absorbed — used up, not
 *    `expired; 666k absorbed`.
 *  - D17 (77a6b63e r0 0:37): Dispersion removed 0.8 s before its 6 s read
 *    `(expired)`. The 1.5 s early-end slack was no log jitter (605: 15,630
 *    of 19,048 logged fades sit −0.2…+0.05 s from the full length); it is
 *    `BUFF_FADE_EARLY_TOLERANCE_S` = 0.2 s now.
 */
import {
  CombatUnitClass,
  CombatUnitSpec,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { extractOwnerCDBuffExpiry } from "../src/context/timelineHelpers";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_700_000_000_000;
const ME = "player-1";

beforeAll(async () => {
  await ensureAnalysisData();
});

const aura = (event: LogEvent, id: string, s: number) =>
  makeAuraEvent(event, id, T0 + s * 1000, ME, ME, "BUFF");
const cast = (id: string, s: number) =>
  makeSpellCastEvent(id, T0 + s * 1000, ME);
const cdRow = (spellId: string, spellName: string, casts: number[]) =>
  [
    {
      spellId,
      spellName,
      tag: "Offensive",
      casts: casts.map((timeSeconds) => ({ timeSeconds })),
      cooldownSeconds: 30,
      neverUsed: false,
      availableWindows: [],
    },
  ] as never;

describe("[BUFF FADED] — a one-charge buff spent by its spender (T103 D7)", () => {
  const SIPHON = "264130";
  const SIPHON_BUFF = "334581";
  const DEMONBOLT = "264178";
  const SHADOW_BOLT = "686";
  const BLOOD_FURY = "33702";
  function lock(opts: {
    secondPressDoses: boolean;
    spender: string;
    /** a cast that coincided with the 2:00 press's dose spend */
    coincident?: string;
  }) {
    return makeUnit(ME, {
      class: CombatUnitClass.Warlock,
      spec: CombatUnitSpec.Warlock_Demonology,
      spellCastEvents: [
        cast(SIPHON, 8.9),
        cast(opts.spender, 13.071),
        cast(SIPHON, 120),
        ...(opts.coincident ? [cast(opts.coincident, 121.95)] : []),
        cast(DEMONBOLT, 122),
        cast(DEMONBOLT, 124),
      ],
      auraEvents: [
        // one stack, spent at 13.078
        aura(LogEvent.SPELL_AURA_APPLIED, SIPHON_BUFF, 8.9),
        aura(LogEvent.SPELL_AURA_REMOVED, SIPHON_BUFF, 13.078),
        // two stacks: a Demonbolt spends a dose, the next one the last
        aura(LogEvent.SPELL_AURA_APPLIED, SIPHON_BUFF, 120),
        ...(opts.secondPressDoses
          ? [
              aura(LogEvent.SPELL_AURA_APPLIED_DOSE, SIPHON_BUFF, 120),
              aura(LogEvent.SPELL_AURA_REMOVED_DOSE, SIPHON_BUFF, 122.005),
            ]
          : []),
        aura(LogEvent.SPELL_AURA_REMOVED, SIPHON_BUFF, 124.005),
      ],
    }) as ICombatUnit;
  }
  const causeAt13 = (u: ICombatUnit) =>
    extractOwnerCDBuffExpiry(
      cdRow(SIPHON, "Power Siphon", [8.9, 120]),
      ME,
      [u],
      T0,
      u,
    ).find((e) => Math.floor(e.expiresAtSeconds) === 13)?.cause;

  it("removed ≤ 100 ms after a spell that spent a dose of it this round → charges_spent", () => {
    expect(
      causeAt13(lock({ secondPressDoses: true, spender: DEMONBOLT })),
    ).toBe("charges_spent");
  });
  it("no dose of it spent anywhere in the round: the spender is unknown, ended_early stays", () => {
    expect(
      causeAt13(lock({ secondPressDoses: false, spender: DEMONBOLT })),
    ).toBe("ended_early");
  });
  it("a cast that only coincided with a dose spend is no spender (codex 85-tk-L-T103-1 #2)", () => {
    expect(
      causeAt13(
        lock({
          secondPressDoses: true,
          spender: BLOOD_FURY,
          coincident: BLOOD_FURY,
        }),
      ),
    ).toBe("ended_early");
  });
  it("the cast before the removal is no spell that spent a dose: ended_early stays", () => {
    expect(
      causeAt13(lock({ secondPressDoses: true, spender: SHADOW_BOLT })),
    ).toBe("ended_early");
  });
});

describe("[BUFF FADED] — the early-end slack is log jitter only (T103 D3 / D17)", () => {
  const DISPERSION = "47585";
  const priest = (removedS: number) =>
    makeUnit(ME, {
      class: CombatUnitClass.Priest,
      spec: CombatUnitSpec.Priest_Shadow,
      spellCastEvents: [cast(DISPERSION, 32.684)],
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, DISPERSION, 32.684),
        aura(LogEvent.SPELL_AURA_REMOVED, DISPERSION, removedS),
      ],
    }) as ICombatUnit;
  const causeOf = (u: ICombatUnit, id: string, name: string, at: number) =>
    extractOwnerCDBuffExpiry(cdRow(id, name, [at]), ME, [u], T0, u)[0];

  it("Dispersion removed 0.8 s before its 6 s ended early (D17)", () => {
    expect(
      causeOf(priest(37.869), DISPERSION, "Dispersion", 32.684),
    ).toMatchObject({ cause: "ended_early", fullS: 6 });
  });
  it("a removal 50 ms before the full length is jitter: expired", () => {
    expect(
      causeOf(priest(38.634), DISPERSION, "Dispersion", 32.684)?.cause,
    ).toBe("expired");
  });
  it("a channel is not judged on its official length: Convoke 1 s short stays expired", () => {
    const CONVOKE = "391528";
    const u = makeUnit(ME, {
      class: CombatUnitClass.Druid,
      spec: CombatUnitSpec.Druid_Restoration,
      spellCastEvents: [cast(CONVOKE, 10)],
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, CONVOKE, 10),
        aura(LogEvent.SPELL_AURA_REMOVED, CONVOKE, 13),
      ],
    }) as ICombatUnit;
    expect(causeOf(u, CONVOKE, "Convoke the Spirits", 10)?.cause).toBe(
      "expired",
    );
  });

  it("a channel the press line reads interrupted ended early, whatever share it ran (codex 85-tk-L-T103-1 #1: Convoke kicked at 2.4 s)", () => {
    const CONVOKE = "391528";
    const u = makeUnit(ME, {
      class: CombatUnitClass.Druid,
      spec: CombatUnitSpec.Druid_Restoration,
      spellCastEvents: [cast(CONVOKE, 10)],
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, CONVOKE, 10),
        aura(LogEvent.SPELL_AURA_REMOVED, CONVOKE, 12.4),
      ],
    }) as ICombatUnit;
    const fade = (kickS?: number) =>
      extractOwnerCDBuffExpiry(
        cdRow(CONVOKE, "Convoke the Spirits", [10]),
        ME,
        [u],
        T0,
        u,
        [],
        T0 + 300_000,
        {
          ccInstances: [],
          interruptInstances: kickS === undefined ? [] : [{ atSeconds: kickS }],
        } as never,
      )[0]?.cause;
    expect(fade(12.4)).toBe("ended_early");
    expect(fade()).toBe("expired");
  });

  it("Touch of Karma's shield removed 0.78 s early in the ms of a hit it took is used up (D3)", () => {
    const KARMA = "122470";
    const ABSORB = "125174";
    const at = (s: number) => T0 + s * 1000;
    const hit = (s: number, amount: number) => ({
      logLine: {
        event: LogEvent.SPELL_ABSORBED,
        timestamp: at(s),
        parameters: [],
      },
      timestamp: at(s),
      spellId: KARMA,
      srcUnitId: ME,
      destUnitId: ME,
      absorbedAmount: amount,
    });
    const monk = makeUnit(ME, {
      class: CombatUnitClass.Monk,
      spec: CombatUnitSpec.Monk_Windwalker,
      spellCastEvents: [cast(KARMA, 25.649)],
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, ABSORB, 25.649),
        aura(LogEvent.SPELL_AURA_APPLIED, KARMA, 25.649),
        aura(LogEvent.SPELL_AURA_REMOVED, ABSORB, 34.874),
        aura(LogEvent.SPELL_AURA_REMOVED, KARMA, 35.65),
      ],
      absorbsIn: [hit(30, 454_824), hit(34.874, 211_548)] as never,
    }) as ICombatUnit;
    const enemy = makeUnit("enemy-1", {
      name: "Mage",
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          KARMA,
          at(25.65),
          ME,
          "enemy-1",
          "DEBUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          KARMA,
          at(35.65),
          ME,
          "enemy-1",
          "DEBUFF",
        ),
      ],
    }) as ICombatUnit;
    const [e] = extractOwnerCDBuffExpiry(
      cdRow(KARMA, "Touch of Karma", [25.649]),
      ME,
      [monk],
      T0,
      monk,
      [enemy],
    );
    expect(e).toMatchObject({
      cause: "absorbed",
      absorb: { absorbed: 666_372 },
    });
  });
});
