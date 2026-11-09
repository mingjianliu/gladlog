/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the producer and the check read them untyped */
/**
 * scan5/t16 `kitSoonestAboveRecast` reads its presses from the ledger entry
 * the kit entry is rendered from (`unitCooldownLedger`), never a second
 * press identification and never `unitCooldownEntry`'s fallback for an id
 * the ledger does not carry. The shapes: codex's (85-tk-E-T16-2) Time Spiral
 * free press with its echo row 0.253 s later (neither restarts the cooldown
 * nor proves it back), and Stasis's release 370564, which the fallback
 * built a cooldown entry of its own for (61 false Stasis rows on 605).
 */
import { ensureAnalysisData } from "@gladlog/analysis/src/data/ensure";
import { RESYNC_BATCH_MIN_APPLIED } from "@gladlog/analysis/src/utils/hiddenPress";
import {
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  makeSpellCastEvent,
  makeUnit,
} from "../../analysis/test/ported/testHelpers";
import { run } from "../scripts/scan5/t16";

const START = 1_000_000;
const PID = "player-1";
const SWG = "79206"; // Spiritwalker's Grace
const SHAMAN_SPIRAL = "375256";
const STASIS = "370537";
const STASIS_RELEASE = "370564";
const LIFE_COCOON = "116849";

/** an APPLIED row on the unit (the re-stating batch's rows) */
const applied = (auraId: string, atMs: number, src = PID): any => ({
  logLine: { event: LogEvent.SPELL_AURA_APPLIED, timestamp: START + atMs },
  timestamp: START + atMs,
  spellId: auraId,
  spellName: auraId,
  srcUnitId: src,
  destUnitId: PID,
});

const removed = (auraId: string, atMs: number): any => ({
  logLine: { event: LogEvent.SPELL_AURA_REMOVED, timestamp: START + atMs },
  timestamp: START + atMs,
  spellId: auraId,
  srcUnitId: "evoker-1",
  destUnitId: PID,
});

function scan(u: any, kit: string): { checked: number; seen: string[] } {
  (u as any).pid = "1";
  const seen: string[] = [];
  let checked = 0;
  run({
    lines: [
      `  <unit id="1" name="${u.name}">`,
      `    <cooldowns>${kit}</cooldowns>`,
    ],
    legacy: { startTime: START, endTime: START + 300_000, units: { [PID]: u } },
    unitOfPid: (pid: string | undefined) => (pid === "1" ? u : undefined),
    roundEndAt: START + 300_000,
    start: START,
    firstOwnerOfRound: false,
    violate: (check: string, _k: string, _t: number, _f: string, d: string) =>
      seen.push(`${check}: ${d}`),
    bump: () => {
      checked++;
    },
  } as any);
  return { checked, seen };
}

const shaman = (pressMs: number[], auraEvents: any[]) =>
  makeUnit(PID, {
    class: CombatUnitClass.Shaman,
    spec: CombatUnitSpec.Shaman_Restoration,
    // the Spiritwalker's Grace talent node (discoveryWallTags.test.ts)
    info: { talents: [{ id1: 103584, id2: 127857, count: 1 }], pvpTalents: [] },
    spellCastEvents: pressMs.map((t) => makeSpellCastEvent(SWG, START + t, "")),
    auraEvents,
  } as unknown as Parameters<typeof makeUnit>[1]);

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("scan5/t16 kitSoonestAboveRecast — the ledger's presses", () => {
  it("a Time Spiral free press and its echo row neither restart the cooldown nor prove it back", () => {
    const presses = [10_000, 40_000, 40_258, 200_000];
    const u = shaman(presses, [removed(SHAMAN_SPIRAL, 40_005)]);
    expect(scan(u, "Spiritwalker's Grace [100–120s]")).toEqual({
      checked: 1,
      seen: [],
    });
    // without the aura consumed, 40.0 s is a press of its own: caught
    const v = shaman(presses, []);
    expect(scan(v, "Spiritwalker's Grace [100–120s]").seen).toEqual([
      "kitSoonestAboveRecast: player-1 Spiritwalker's Grace [100–120s]: pressed 30.0 s apart",
    ]);
  });

  it("Stasis's release is no press of the kit's Stasis (its own fallback entry is not read)", () => {
    // store at 10 s, release at 25 s, store again at 100 s: one gap of 90 s
    const u = makeUnit(PID, {
      class: CombatUnitClass.Evoker,
      spec: CombatUnitSpec.Evoker_Preservation,
      info: { talents: [], pvpTalents: [] },
      spellCastEvents: [
        makeSpellCastEvent(STASIS, START + 10_000, ""),
        makeSpellCastEvent(STASIS_RELEASE, START + 25_000, ""),
        makeSpellCastEvent(STASIS, START + 100_000, ""),
      ],
    } as unknown as Parameters<typeof makeUnit>[1]);
    expect(scan(u, "Stasis [85–90s]")).toEqual({ checked: 1, seen: [] });
  });

  it("a press no cast row dates (unseen, timed at the batch that re-stated the unit) proves the button back but anchors no gap", () => {
    // codex 85-tk-E-T16-2b: Life Cocoon pressed unseen at ≤ 15 s, its aura new
    // in the 15 s re-stating batch, pressed again at 97 s: no 82.0 s recast
    const monk = (seenAt15: boolean) =>
      makeUnit(PID, {
        class: CombatUnitClass.Monk,
        spec: CombatUnitSpec.Monk_Mistweaver,
        info: { talents: [], pvpTalents: [] },
        spellCastEvents: [
          ...(seenAt15
            ? [makeSpellCastEvent(LIFE_COCOON, START + 15_000, "")]
            : []),
          makeSpellCastEvent(LIFE_COCOON, START + 97_000, ""),
        ],
        auraEvents: seenAt15
          ? []
          : [
              ...Array.from({ length: RESYNC_BATCH_MIN_APPLIED + 2 }, (_, i) =>
                applied(String(900_000 + i), 15_000, "x"),
              ),
              applied(LIFE_COCOON, 15_000),
            ],
      } as unknown as Parameters<typeof makeUnit>[1]);
    expect(scan(monk(false), "Life Cocoon [86–120s]")).toEqual({
      checked: 0,
      seen: [],
    });
    // the same press with its cast row is an anchor: caught
    expect(scan(monk(true), "Life Cocoon [86–120s]").seen).toEqual([
      "kitSoonestAboveRecast: player-1 Life Cocoon [86–120s]: pressed 82.0 s apart",
    ]);
  });
});
