/* eslint-disable @typescript-eslint/no-explicit-any -- the scan context is a fake */
/**
 * scan5 `ledgerCopyHoldsPress` (T98): the copy's interval and its presses are
 * the producer's own selection — `buildAuraIntervals` and
 * `enemyDefensiveEvents` — not a hand replay of the builder (eight codex
 * rounds, 85-tk-K-T98-1c … 1h, each found a new divergence in the replay).
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "../../analysis/test/ported/testHelpers";
import { run } from "../scripts/scan5/t98";

const T = 1_000_000;
const at = (s: number) => T + s * 1000;
const SOTF = "264735";
const EXHILARATION = "109304";
const info = { teamId: "0", specId: "x" } as unknown as NonNullable<
  Parameters<typeof makeUnit>[1]
>["info"];

const buff = (event: LogEvent, s: number) => ({
  ...makeAuraEvent(event, SOTF, at(s), "e1", "e1", "BUFF"),
  srcUnitName: "Hunter",
  spellName: "Survival of the Fittest",
});
const cast = (id: string, s: number) =>
  makeSpellCastEvent(id, at(s), "e1", "Hunter", "e1", "Hunter", 0, id);

function scan(hunter: ReturnType<typeof makeUnit>): {
  checked: number;
  details: string[];
} {
  let checked = 0;
  const details: string[] = [];
  const units = [hunter];
  run({
    lines: [
      "  Burst #1 — 0:10–0:20 | Avenging Wrath",
      "  Target: Hunter 90% → 40%",
      "  Target had a major defensive up: Survival of the Fittest active ON THE TARGET 8.0s of this burst (3.5s after the burst opened [no press logged])",
    ],
    start: T,
    end: at(120),
    legacy: { startTime: T, endTime: at(120), units: { e1: hunter } },
    units,
    players: units,
    owner: undefined,
    unitOfPid: () => undefined,
    bump: () => checked++,
    violate: (_c: string, _k: string, _t: number, _f: string, d: string) =>
      details.push(d),
  } as any);
  return { checked, details };
}

const hunter = (auraEvents: unknown[], casts: unknown[]) =>
  makeUnit("e1", {
    name: "Hunter",
    spec: CombatUnitSpec.Hunter_Marksmanship,
    reaction: CombatUnitReaction.Hostile,
    info,
    auraEvents: auraEvents as never,
    spellCastEvents: [cast(EXHILARATION, 13.5), ...casts] as never,
  });

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("scan5 ledgerCopyHoldsPress — the producer's interval and presses", () => {
  it("a press that refreshed the copy is a violation of `[no press logged]`", () => {
    const got = scan(
      hunter(
        [
          buff(LogEvent.SPELL_AURA_APPLIED, 13.5),
          buff(LogEvent.SPELL_AURA_REFRESH, 16),
          buff(LogEvent.SPELL_AURA_REMOVED, 24),
        ],
        [cast(SOTF, 16)],
      ),
    );
    expect(got.checked).toBe(1);
    expect(got.details).toHaveLength(1);
  });
  it("a copy with no press passes", () => {
    const got = scan(
      hunter(
        [
          buff(LogEvent.SPELL_AURA_APPLIED, 13.5),
          buff(LogEvent.SPELL_AURA_REMOVED, 16.5),
        ],
        [],
      ),
    );
    expect(got).toEqual({ checked: 1, details: [] });
  });
  it("a fresh press after a lost REMOVED opens the next interval, not the copy's", () => {
    const got = scan(
      hunter(
        [
          buff(LogEvent.SPELL_AURA_APPLIED, 13.5),
          buff(LogEvent.SPELL_AURA_APPLIED, 16.001),
          buff(LogEvent.SPELL_AURA_REMOVED, 24),
        ],
        [cast(SOTF, 16)],
      ),
    );
    expect(got).toEqual({ checked: 1, details: [] });
  });
});
