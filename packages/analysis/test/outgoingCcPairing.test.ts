/**
 * Triage 2026-09-29, CROSS-THEME G2 — the outgoing CC loop (`drAnalysis.ts`
 * `analyzeOutgoingCCChains`):
 *  - cc-dr F-RB1 (ruling A50 = A): a same-ms REMOVED→APPLIED re-broadcast is
 *    one application (`dropAuraRebroadcasts`);
 *  - crisis-external F-K5: a CC never removed is closed at its official
 *    length, not at the round end (`officialDurationS`);
 *  - sync-burst F-S3: what ended a CC, when the log says (`ccRemovalCause`),
 *    carried to the enemy-healer CC windows and the missed-sync-window facts.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  enemyHealerCcWindows,
  mergeHealerCcWindows,
} from "../src/analysis/candidates/cooldownTiming";
import { ensureAnalysisData } from "../src/data/ensure";
import { ccFullDurationSeconds } from "../src/data/spellEffectData";
import { oppressingRoarOnAtMs } from "../src/utils/ccBreakAnalysis";
import {
  ccRemovalCause,
  formatCcRemovalCause,
} from "../src/utils/ccTrinketAnalysis";
import { analyzeOutgoingCCChains } from "../src/utils/drAnalysis";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);
const KIDNEY = "408";
const POLYMORPH = "118";

beforeAll(async () => {
  await ensureAnalysisData();
});

const rogue = () =>
  makeUnit("f1", {
    name: "Rogue",
    spec: CombatUnitSpec.Rogue_Subtlety,
    reaction: CombatUnitReaction.Friendly,
  });
const healer = (over: Record<string, unknown>) =>
  makeUnit("e1", {
    name: "EnemyPriest",
    spec: CombatUnitSpec.Priest_Holy,
    reaction: CombatUnitReaction.Hostile,
    ...over,
  });
const combat = (f: any, e: any, endS = 300) =>
  ({
    startTime: T0,
    endTime: at(endS),
    units: { f1: f, e1: e },
  }) as never;
const aura = (event: LogEvent, spellId: string, s: number) =>
  makeAuraEvent(event, spellId, at(s), "f1", "e1", "DEBUFF");

describe("outgoing CC pairing (G2)", () => {
  it("F-RB1: a same-ms REMOVED→APPLIED re-broadcast is one application", () => {
    const e = healer({
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, KIDNEY, 10),
        aura(LogEvent.SPELL_AURA_REMOVED, KIDNEY, 11),
        aura(LogEvent.SPELL_AURA_APPLIED, KIDNEY, 11),
        aura(LogEvent.SPELL_AURA_REMOVED, KIDNEY, 14),
      ],
    });
    const f = rogue();
    const apps = analyzeOutgoingCCChains([f], [e], combat(f, e))[0]!
      .applications;
    expect(apps).toHaveLength(1);
    expect(apps[0]!.durationSeconds).toBeCloseTo(4, 6);
  });

  it("F-K5: a CC never removed closes at its official length, not at the round end", () => {
    const full = ccFullDurationSeconds(POLYMORPH)!;
    expect(full).toBeGreaterThan(1);
    const e = healer({
      auraEvents: [aura(LogEvent.SPELL_AURA_APPLIED, POLYMORPH, 72)],
    });
    const f = rogue();
    const apps = analyzeOutgoingCCChains([f], [e], combat(f, e, 171))[0]!
      .applications;
    expect(apps).toHaveLength(1);
    expect(apps[0]!.durationSeconds).toBeCloseTo(full, 3);
    // the round ending first still ends it
    const short = analyzeOutgoingCCChains([f], [e], combat(f, e, 73))[0]!
      .applications;
    expect(short[0]!.durationSeconds).toBeCloseTo(1, 3);
  });

  it("F-S3: a damage break names the breaking spell and its source; the owner reads 'you'", () => {
    const params: (string | number)[] = [];
    params[11] = 357209;
    params[12] = "Fire Breath";
    const base = aura(LogEvent.SPELL_AURA_BROKEN_SPELL, POLYMORPH, 15) as any;
    const broken = {
      ...base,
      srcUnitId: "f1",
      srcUnitName: "Rogue",
      logLine: { ...base.logLine, parameters: params },
    };
    const e = healer({
      auraEvents: [aura(LogEvent.SPELL_AURA_APPLIED, POLYMORPH, 12), broken],
    });
    const cause = ccRemovalCause(e as never, POLYMORPH, at(12), at(15));
    expect(cause).toMatchObject({ kind: "broken", byUnitId: "f1" });
    expect(formatCcRemovalCause(cause!, "f1")).toMatch(/ \(you\)$/);
    expect(formatCcRemovalCause(cause!, "someone-else")).toMatch(/ \(Rogue\)$/);
    // carried on the healer CC window
    const f = rogue();
    const w = enemyHealerCcWindows([f], [e], combat(f, e));
    expect(w[0]?.endedBy?.kind).toBe("broken");
  });

  it("FT-T08: the window ends at the aura's REMOVED a few ms after its BROKEN line — the break is still named", () => {
    const params: (string | number)[] = [];
    params[11] = 357209;
    params[12] = "Fire Breath";
    const base = aura(LogEvent.SPELL_AURA_BROKEN_SPELL, POLYMORPH, 15) as any;
    const broken = {
      ...base,
      srcUnitId: "f1",
      srcUnitName: "Rogue",
      logLine: { ...base.logLine, parameters: params },
    };
    const e = healer({
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, POLYMORPH, 12),
        broken,
        aura(LogEvent.SPELL_AURA_REMOVED, POLYMORPH, 15.003),
      ],
    });
    // the removal is the REMOVED line's time now, 3 ms after the BROKEN line
    expect(
      ccRemovalCause(e as never, POLYMORPH, at(12), at(15.003)),
    ).toMatchObject({ kind: "broken", byUnitId: "f1", spellName: "Fire Breath" });
    const f = rogue();
    const w = enemyHealerCcWindows([f], [e], combat(f, e));
    expect(w).toHaveLength(1);
    expect(w[0]?.endedBy?.kind).toBe("broken");
    // the outgoing chain closes the application at the REMOVED too — one end
    // for one CC in every reader (agy review of FT-T08 step 2)
    const [app] = analyzeOutgoingCCChains(
      [f],
      [e],
      combat(f, e),
    ).flatMap((c) => c.applications);
    expect(app!.durationSeconds).toBeCloseTo(3.003, 3);
    // a BROKEN line of an EARLIER application is not this one's cause
    expect(ccRemovalCause(e as never, POLYMORPH, at(15.002), at(15.003))).toBeUndefined();
  });

  it("FT-T08 step 2b: the break of the PREVIOUS application, in the very ms the next one landed, is not the next one's", () => {
    const brokenAt = (s: number) => {
      const params: (string | number)[] = [];
      params[11] = 133;
      params[12] = "Fireball";
      const base = aura(LogEvent.SPELL_AURA_BROKEN_SPELL, POLYMORPH, s) as any;
      return { ...base, srcUnitId: "f1", srcUnitName: "Mage", logLine: { ...base.logLine, parameters: params } };
    };
    // #1: 10 → 13, broken by Fireball; #2 lands in that same ms and runs out at 13.75
    const e = healer({
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, POLYMORPH, 10),
        brokenAt(13),
        aura(LogEvent.SPELL_AURA_REMOVED, POLYMORPH, 13),
        aura(LogEvent.SPELL_AURA_APPLIED, POLYMORPH, 13),
        aura(LogEvent.SPELL_AURA_REMOVED, POLYMORPH, 13.75),
      ],
    });
    expect(ccRemovalCause(e as never, POLYMORPH, at(10), at(13))).toMatchObject({ kind: "broken", spellName: "Fireball" });
    expect(ccRemovalCause(e as never, POLYMORPH, at(13), at(13.75))).toBeUndefined();
    // and a second application that IS broken names its own breaker
    const e2 = healer({
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, POLYMORPH, 10),
        brokenAt(13),
        aura(LogEvent.SPELL_AURA_REMOVED, POLYMORPH, 13),
        aura(LogEvent.SPELL_AURA_APPLIED, POLYMORPH, 13),
        brokenAt(13.4),
        aura(LogEvent.SPELL_AURA_REMOVED, POLYMORPH, 13.402),
      ],
    });
    expect(ccRemovalCause(e2 as never, POLYMORPH, at(13), at(13.402))).toMatchObject({ kind: "broken" });
  });

  it("F-S3: the healer's trinket at the removal, a dispel, or nothing logged", () => {
    const trinketed = healer({
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, KIDNEY, 10),
        aura(LogEvent.SPELL_AURA_REMOVED, KIDNEY, 11.5),
      ],
      spellCastEvents: [
        makeSpellCastEvent("336126", at(11.5), "0000000000000000"),
      ],
    });
    expect(
      ccRemovalCause(trinketed as never, KIDNEY, at(10), at(11.5))?.kind,
    ).toBe("trinket");
    const dispelled = healer({
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, POLYMORPH, 10),
        aura(LogEvent.SPELL_AURA_REMOVED, POLYMORPH, 12),
      ],
      actionIn: [
        {
          spellId: "527",
          spellName: "Purify",
          srcUnitId: "e2",
          srcUnitName: "EnemyPaladin",
          extraSpellId: POLYMORPH,
          timestamp: at(12),
          logLine: {
            event: LogEvent.SPELL_DISPEL,
            timestamp: at(12),
            parameters: [],
          },
        },
      ],
    });
    const d = ccRemovalCause(dispelled as never, POLYMORPH, at(10), at(12));
    expect(d).toMatchObject({ kind: "dispel", byName: "EnemyPaladin" });
    // a CC that simply ran out has no cause
    const ranOut = healer({
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, KIDNEY, 10),
        aura(LogEvent.SPELL_AURA_REMOVED, KIDNEY, 14),
      ],
    });
    expect(
      ccRemovalCause(ranOut as never, KIDNEY, at(10), at(14)),
    ).toBeUndefined();
  });

  it("F-S3: a break press names the cause only when the CC was cut short of its official end (the [CC ON ENEMY] break guard)", () => {
    const pressed = healer({
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, KIDNEY, 10),
        aura(LogEvent.SPELL_AURA_REMOVED, KIDNEY, 12),
      ],
      // Every Man for Himself at the removal
      spellCastEvents: [
        makeSpellCastEvent("59752", at(12), "0000000000000000"),
      ],
    });
    const cut = ccRemovalCause(
      pressed as never,
      KIDNEY,
      at(10),
      at(12),
      at(14),
    );
    expect(cut?.kind).toBe("break");
    // the same press at the CC's own official end ended nothing
    expect(
      ccRemovalCause(pressed as never, KIDNEY, at(10), at(12), at(12)),
    ).toBeUndefined();
  });
  it("FT-T07: the healer lock's official end counts an Oppressing Roar on the healer at the landing — a press 5.5 s into a 5 s stun ended it only under the Roar (6.5 s)", () => {
    expect(ccFullDurationSeconds(KIDNEY)).toBe(5);
    const ROAR = "372048";
    const stunned = (roar: boolean) =>
      healer({
        auraEvents: [
          ...(roar ? [aura(LogEvent.SPELL_AURA_APPLIED, ROAR, 9)] : []),
          aura(LogEvent.SPELL_AURA_APPLIED, KIDNEY, 10),
          aura(LogEvent.SPELL_AURA_REMOVED, KIDNEY, 15.5),
        ],
        // Will to Survive at the removal
        spellCastEvents: [
          makeSpellCastEvent("59752", at(15.5), "0000000000000000"),
        ],
      });
    const f = rogue();
    const under = stunned(true);
    expect(
      enemyHealerCcWindows([f], [under], combat(f, under))[0]?.endedBy,
    ).toMatchObject({ kind: "break" });
    // the helper the window reads the Roar with: the application's own line
    expect(oppressingRoarOnAtMs(under as never, KIDNEY, at(10))).toBe(true);
    expect(oppressingRoarOnAtMs(under as never, KIDNEY, at(11))).toBe(false);
    const plain = stunned(false);
    expect(oppressingRoarOnAtMs(plain as never, KIDNEY, at(10))).toBe(false);
    const w = enemyHealerCcWindows([f], [plain], combat(f, plain));
    expect(w).toHaveLength(1);
    expect(w[0]?.endedBy).toBeUndefined();
  });

  it("F-S3: a chained lock reports what ended its LAST component (141470d0: the second Polymorph, broken by Fire Breath)", () => {
    const w = (fromSeconds: number, toSeconds: number, by?: string) => ({
      fromSeconds,
      toSeconds,
      spellName: "Polymorph",
      spellId: POLYMORPH,
      healerName: "H",
      drLevel: "Full" as const,
      ...(by ? { endedBy: { kind: "broken" as const, spellName: by } } : {}),
    });
    const [chain] = mergeHealerCcWindows([
      w(106, 108, "Deep Breath"),
      w(108, 116.7, "Fire Breath"),
    ]);
    expect(chain!.endedBy?.spellName).toBe("Fire Breath");
    // a last component that ran out names nothing
    const [ranOut] = mergeHealerCcWindows([
      w(106, 108, "Deep Breath"),
      w(108, 116.7),
    ]);
    expect(ranOut!.endedBy).toBeUndefined();
  });
});
