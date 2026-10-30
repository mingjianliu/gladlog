/**
 * codex F16 group 1 B2–B4 (2026-10-21) — regression pins:
 *  - B2: a disarm / silence that lasted its official length ran out on its
 *    own; a PvP trinket logged 1 ms after its removal did not break it
 *    (`findBrokenDisarm`, `pressEndedSilence` — the CC binder's
 *    `ranFullLength` rule). A shorter one is still a break.
 *  - B3: a never-pressed Divine Shield under Forbearance is not `rdy:` on a
 *    first-5-s [RES] row (the opener promotion skipped the lockout).
 *  - B4: a first-5-s [RES] request that printed nothing does not reset the
 *    delta state — the next row's Δ is against the last PRINTED row.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { buildResourceSnapshot } from "../src/context/resourceSnapshot";
import type { DeferredSnapshot } from "../src/context/timelineSections/ctx";
import { resolveDeferredSnapshots } from "../src/context/timelineSections/resolveSnapshots";
import { ensureAnalysisData } from "../src/data/ensure";
import { ccFullDurationSeconds } from "../src/data/spellEffectData";
import {
  findBrokenDisarm,
  type IRootInstance,
  pressEndedSilence,
} from "../src/utils/ccTrinketAnalysis";
import type { IMajorCooldownInfo } from "../src/utils/cooldowns";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);

const DISMANTLE = "236077"; // official 5 s
const SILENCE = "15487"; // official 4 s

const ledger = (
  spellId: string,
  spellName: string,
  cooldownSeconds: number,
  casts: number[],
): IMajorCooldownInfo =>
  ({
    spellId,
    spellName,
    tag: "Defensive",
    cooldownSeconds,
    maxChargesDetected: 1,
    casts: casts.map((timeSeconds) => ({ timeSeconds })),
    availableWindows: [],
    neverUsed: casts.length === 0,
  }) as unknown as IMajorCooldownInfo;

describe("codex F16 group 1 B", () => {
  it("B2: a disarm / silence that lasted its official length was not broken by a press 1 ms later", () => {
    // the fixture's premise: the official lengths these windows are read against
    expect(ccFullDurationSeconds(DISMANTLE)).toBe(5);
    expect(ccFullDurationSeconds(SILENCE)).toBe(4);

    const dismantle = (durationSeconds: number): IRootInstance => ({
      atSeconds: 10,
      durationSeconds,
      spellId: DISMANTLE,
      spellName: "Dismantle",
      sourceName: "Rogue-Realm",
      sourceId: "e1",
      sourceSpec: "Rogue_Subtlety",
    });
    // ran its full 5 s (10 → 15), Medallion at 15.001: nothing broken
    expect(findBrokenDisarm([dismantle(5)], T0, at(15.001))).toBeUndefined();
    // removed at 12 s, Medallion at 12.001: the press broke it
    const cut = dismantle(2);
    expect(findBrokenDisarm([cut], T0, at(12.001))).toBe(cut);

    // a 4 s Silence that ran out (10 → 14), Medallion 1 ms later: not broken
    expect(pressEndedSilence(at(10), at(14), at(14.001), SILENCE)).toBe(false);
    // removed 2 s in, Medallion 1 ms later: broken
    expect(pressEndedSilence(at(10), at(12), at(12.001), SILENCE)).toBe(true);
  });

  it("codex 20-F16-08 #2: under Oppressing Roar the length as it landed decides (Silence 5.2 s, Dismantle 6.5 s)", () => {
    const ROAR = "372048";
    const holder = {
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, ROAR, at(9), "ev", "h"),
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, SILENCE, at(10), "e1", "h"),
      ],
    } as any;
    // removed 4.5 s in — past the base 4 s, inside the Roar's 5.2 s: broken
    expect(
      pressEndedSilence(at(10), at(14.5), at(14.501), SILENCE, holder),
    ).toBe(true);
    // no Roar on the holder: the base 4 s ran out
    expect(pressEndedSilence(at(10), at(14.5), at(14.501), SILENCE)).toBe(
      false,
    );
    // a disarm instance carrying its as-landed length
    const roared: IRootInstance = {
      atSeconds: 10,
      durationSeconds: 5.5,
      spellId: DISMANTLE,
      spellName: "Dismantle",
      sourceName: "Rogue-Realm",
      sourceId: "e1",
      sourceSpec: "Rogue_Subtlety",
      fullDurationSeconds: 6.5,
    };
    expect(findBrokenDisarm([roared], T0, at(15.501))).toBe(roared);
  });

  it("B3: Divine Shield is not rdy: at 0:02 after Lay on Hands put Forbearance on the paladin", () => {
    const FORBEARANCE = "25771";
    const owner = makeUnit("P", {
      name: "P-R",
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Holy,
      spellCastEvents: [makeSpellCastEvent("633", at(1), "P", "P-R", "P")],
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          FORBEARANCE,
          at(1),
          "P",
          "P",
          "DEBUFF",
        ),
      ],
    } as never);
    const cds = [
      ledger("642", "Divine Shield", 300, []),
      ledger("633", "Lay on Hands", 420, [1]),
    ];
    const line = buildResourceSnapshot({
      timeSeconds: 2,
      ownerCDs: cds,
      ownerName: "P-R",
      ownerSpec: "Holy Paladin",
      teammateCDs: [],
      ccTrinketSummaries: [],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] },
      matchStartMs: T0,
      ownerUnit: owner as any,
    });
    expect(line).not.toMatch(/rdy:[^ ]*Divine Shield/);
  });

  it("B4: a suppressed 0:04 row keeps the 0:02 row's ready set — 0:20 prints -Anti-Magic Shell, no +Anti-Magic Zone", () => {
    const entries = [2, 4, 20].map((t, id) => ({
      timeSeconds: t,
      lines: [
        {
          type: "resource_snapshot",
          timeSeconds: t,
          forceFull: false,
          bypassDebounce: true,
          id,
        } as DeferredSnapshot,
      ] as Array<string | DeferredSnapshot>,
    }));
    resolveDeferredSnapshots({
      entries,
      teammateCDs: [],
      playerIdMap: undefined,
      matchStartMs: T0,
      owner: {
        id: "o",
        name: "Me-Realm",
        deathRecords: [],
        auraEvents: [],
        spellCastEvents: [],
        damageIn: [],
        advancedActions: [],
      },
      resOwnerCDs: [
        ledger("48792", "Icebound Fortitude", 120, [2]),
        ledger("48707", "Anti-Magic Shell", 60, [20]),
        ledger("51052", "Anti-Magic Zone", 120, []),
      ],
      snapshotFn: buildResourceSnapshot,
      ownerSpec: "DeathKnight_Frost",
      ccTrinketSummaries: [],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] },
      rosterSides: undefined,
      manaFallback: undefined,
      roundBounds: { startTime: T0, endTime: T0 + 200_000 },
    } as never);
    const [r2, r4, r20] = entries.map(
      (e) => (e.lines[0] as string | undefined) ?? "",
    );
    expect(r2).toContain("rdy:Anti-Magic Shell,Anti-Magic Zone");
    expect(r4).toBe("");
    expect(r20).toContain("-Anti-Magic Shell");
    expect(r20).not.toContain("+Anti-Magic Zone");
  });
});
