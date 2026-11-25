/**
 * T259 (B194 assembly review) — the friendly timeline keeps a proc's own
 * activation beside a real press of the same button. The producer
 * (`selfSaveCasts` → `enemyDefensiveEvents`' `procOwned`) states Well-Honed
 * Instincts' Frenzied Regeneration and the player's press a second later as
 * two events; the friendly reader dropped the proc as "the ledger row's own
 * aura" (85a6cad9 r4: proc 56.791 s, press 57.778 s — the press's line
 * alone). Every other activation this near a ledger row is still that row.
 */
import {
  type AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { emitFriendlyAuraOnlyEntries } from "../src/context/timelineSections/friendlyCheatDeath";
import { ensureAnalysisData } from "../src/data/ensure";
import { auraOnlyActivations } from "../src/utils/auraOnlyActivations";
import {
  type IMajorCooldownInfo,
  unitCooldownEntry,
} from "../src/utils/cooldowns";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const START = 1_700_000_000_000;
const at = (s: number) => START + Math.round(s * 1000);
const FR = "22842";
const MARKER = "382912";

beforeAll(async () => {
  await ensureAnalysisData();
});

const aura = (id: string, s: number) =>
  makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, id, at(s), "p1", "p1", "BUFF");
const press = (s: number) =>
  makeSpellCastEvent(
    FR,
    at(s),
    "p1",
    "p1",
    "p1",
    "p1",
    0,
    "Frenzied Regeneration",
  );
const druid = (
  castSeconds: number[],
  auras: ReturnType<typeof makeAuraEvent>[],
) =>
  makeUnit("p1", {
    class: CombatUnitClass.Druid,
    spec: CombatUnitSpec.Druid_Feral,
    spellCastEvents: castSeconds.map(press),
    auraEvents: auras,
  });
const ledgerOf = (u: ReturnType<typeof makeUnit>): IMajorCooldownInfo[] => {
  const entry = unitCooldownEntry(
    u,
    {
      startTime: START,
      endTime: START + 300_000,
      units: { p1: u },
    } as unknown as AtomicArenaCombat,
    FR,
  );
  return entry ? [entry] : [];
};
const row = (timeSeconds: number): IMajorCooldownInfo[] =>
  [
    {
      spellId: FR,
      spellName: "Frenzied Regeneration",
      casts: [{ timeSeconds }],
    },
  ] as unknown as IMajorCooldownInfo[];

function lines(
  u: ReturnType<typeof makeUnit>,
  ledger: readonly IMajorCooldownInfo[],
  as: "owner" | "teammate" = "owner",
) {
  const other = makeUnit("p2", {
    class: CombatUnitClass.Priest,
    spec: CombatUnitSpec.Priest_Holy,
  });
  const out: string[] = [];
  const emitted = emitFriendlyAuraOnlyEntries({
    owner: as === "owner" ? u : other,
    friends: as === "owner" ? [] : [u],
    ownerCDs: as === "owner" ? ledger : [],
    teammateCDs: as === "owner" ? [] : [{ player: u, cds: ledger }],
    matchStartMs: START,
    matchEndSeconds: 300,
    pid: () => "2(FDruid)",
    addEntry: (_t, line) => out.push(line),
  });
  return { out, emitted };
}

describe("emitFriendlyAuraOnlyEntries: a proc's own activation beside a press (T259)", () => {
  // the proc's marker and aura at 56.791 s, the player's press 0.987 s on
  const procThenPress = () =>
    druid([57.778], [aura(MARKER, 56.791), aura(FR, 56.791)]);

  it("the producer states the proc and names the press beside it", () => {
    const u = procThenPress();
    expect(auraOnlyActivations(u, [u], START, START + 300_000)).toEqual([
      {
        atSeconds: 56.791,
        spellId: FR,
        spellName: "Frenzied Regeneration",
        family: "save",
        procOwned: true,
        pressesBesideSeconds: [57.778],
      },
    ]);
  });

  it("85a6cad9 r4 shape: the proc has its [PROC] line though the press's ledger row lies within a second", () => {
    const u = procThenPress();
    const ledger = ledgerOf(u);
    // the ledger holds the press alone — its [CD] line is the ledger's
    expect(ledger[0].casts.map((c) => c.timeSeconds)).toEqual([57.778]);
    expect(lines(u, ledger)).toEqual({
      out: ["0:56  [YOU] [PROC]   Frenzied Regeneration (no press)"],
      emitted: true,
    });
  });

  it("…and on a teammate's page (0418dc7a r1 shape)", () => {
    const u = procThenPress();
    expect(lines(u, ledgerOf(u), "teammate").out).toEqual([
      "0:56  [TEAM] [PROC]   2(FDruid) (Feral Druid): Frenzied Regeneration (no press)",
    ]);
  });

  it("a ledger row beside the proc that is no logged press still stands for it", () => {
    const u = procThenPress();
    // a row of the ledger's own at the activation (an aura-only row)
    expect(lines(u, row(56.791))).toEqual({ out: [], emitted: false });
    // …and one 0.5 s off the producer's press is not that press
    expect(lines(u, row(57.278)).out).toEqual([]);
  });

  it("an activation that is no proc's, within a second of a ledger row, is still that row (unchanged)", () => {
    // the aura with no marker and no cast row: stated with no press…
    const u = druid([], [aura(FR, 56.791)]);
    const acts = auraOnlyActivations(u, [u], START, START + 300_000);
    expect(acts.map((a) => [a.atSeconds, a.procOwned])).toEqual([
      [56.791, undefined],
    ]);
    // …and a ledger row 0.987 s on swallows it, as before
    expect(lines(u, row(57.778))).toEqual({ out: [], emitted: false });
    // with no row near, it has its line
    expect(lines(u, row(60)).out).toEqual([
      "0:56  [YOU] [PROC]   Frenzied Regeneration (no press)",
    ]);
  });

  it("a press with its own aura and no marker is one [CD] line, no [PROC] (unchanged)", () => {
    const u = druid([57.778], [aura(FR, 57.777)]);
    expect(lines(u, ledgerOf(u))).toEqual({ out: [], emitted: false });
  });
});
