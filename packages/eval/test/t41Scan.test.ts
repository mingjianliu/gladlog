/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the check reads them untyped */
/**
 * scan5/t41 `resEnemyLeftPastLogEnd`: a `[RES]` `enemy:` entry's time left
 * against the holder's aura rows, read past the slice's end. The shapes:
 * 52a97230 r0 (REMOVED logged after the slice's end, `3s left` printed), the
 * same with no REMOVED at all, and the rows that are no violation — the
 * effect's own time left printed, and an aura removed inside the slice.
 */
import { ensureAnalysisData } from "@gladlog/analysis/src/data/ensure";
import { buffFullDurationForCaster } from "@gladlog/analysis/src/utils/buffDuration";
import {
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "../../analysis/test/ported/testHelpers";
import {
  applicationAnchorMs,
  aurasUpAtLogEnd,
  run,
} from "../scripts/scan5/t41";

const START = 1_700_000_000_000;
const at = (s: number) => START + Math.round(s * 1000);
const END_S = 35.744;

beforeAll(async () => {
  await ensureAnalysisData();
});

const dh = (removedS?: number): any =>
  makeUnit("Player-4", {
    name: "Dh",
    class: CombatUnitClass.DemonHunter,
    spec: CombatUnitSpec.DemonHunter_Havoc,
    info: {} as never,
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        "162264",
        at(32.885),
        "Player-4",
        "Player-4",
        "BUFF",
      ),
      ...(removedS === undefined
        ? []
        : [
            makeAuraEvent(
              LogEvent.SPELL_AURA_REMOVED,
              "162264",
              at(removedS),
              "Player-4",
              "Player-4",
              "BUFF",
            ),
          ]),
    ],
  });

function scan(
  u: any,
  left: number,
  entry = "Metamorphosis",
  endS = END_S,
): { checked: number; seen: string[] } {
  const seen: string[] = [];
  let checked = 0;
  const text = [
    `  <unit id="4" name="Dh" spec="Havoc Demon Hunter" role="enemy">`,
    `0:33  [STATE]   friends 3(MHunter):86 / enemies 4(HDHunter):98`,
    `      [RES] rdy:Δ -3:Intimidation  cd:3:Intimidation(40s)  enemy:${entry}/Havoc Demon Hunter(${left}s left)  focus:3`,
  ].join("\n");
  run({
    text,
    units: [u],
    unitOfPid: (pid: string | undefined) => (pid === "4" ? u : undefined),
    start: START,
    end: at(endS),
    violate: (_c: string, kind: string, _t: number, _f: string, d: string) =>
      seen.push(`${kind}: ${d}`),
    bump: () => {
      checked++;
    },
  } as any);
  return { checked, seen };
}

describe("scan5/t41 resEnemyLeftPastLogEnd", () => {
  it("52a97230 r0: REMOVED after the slice's end, `3s left` printed", () => {
    const r = scan(dh(39.48), 3);
    expect(r.checked).toBe(1);
    expect(r.seen).toHaveLength(1);
    expect(r.seen[0]).toMatch(/^removed after the log end: Metamorphosis/);
  });

  it("no REMOVED at all: the aura's own length is the bound", () => {
    const r = scan(dh(), 3);
    expect(r.checked).toBe(1);
    expect(r.seen).toHaveLength(1);
    expect(r.seen[0]).toMatch(/^never removed: Metamorphosis/);
  });

  it("the effect's own time left is no violation", () => {
    expect(scan(dh(39.48), 24).seen).toEqual([]);
    expect(scan(dh(), 24).seen).toEqual([]);
  });

  it("an aura removed inside the slice is not counted", () => {
    const r = scan(dh(35), 2);
    expect(r.checked).toBe(0);
    expect(r.seen).toEqual([]);
  });

  it("a REMOVED written with no source inside the slice closes the aura (codex 85-tk-G-T41-1 #3)", () => {
    const u = dh();
    u.auraEvents.push(
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        "162264",
        at(35),
        "0000000000000000",
        "Player-4",
        "BUFF",
      ),
    );
    const r = scan(u, 2);
    expect(r.checked).toBe(0);
    expect(r.seen).toEqual([]);
    // another unit's REMOVED of the same aura id closes nothing
    const other = dh();
    other.auraEvents.push(
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        "162264",
        at(35),
        "Player-9",
        "Player-4",
        "BUFF",
      ),
    );
    expect(scan(other, 3).seen).toHaveLength(1);
  });

  it("a source-less REMOVED closes the oldest open copy, not the holder's by default (codex 85-tk-G-T41-1b #3)", () => {
    // another caster's copy from 10 s, the holder's from 11 s; the first
    // leaves at 12 s with no source, the holder's at 17 s; slice over at 13 s
    const row = (event: LogEvent, s: number, src: string) =>
      makeAuraEvent(event, "162264", at(s), src, "Player-4", "BUFF");
    const u = makeUnit("Player-4", {
      name: "Dh",
      auraEvents: [
        row(LogEvent.SPELL_AURA_APPLIED, 10, "Player-9"),
        row(LogEvent.SPELL_AURA_APPLIED, 11, "Player-4"),
        row(LogEvent.SPELL_AURA_REMOVED, 12, "0000000000000000"),
        row(LogEvent.SPELL_AURA_REMOVED, 17, "Player-4"),
      ],
    });
    expect(aurasUpAtLogEnd([u], u, "Metamorphosis", at(13))).toEqual([
      {
        appliedMs: at(11),
        lastSeenMs: at(11),
        seenMs: [at(11)],
        removedMs: at(17),
        spellId: "162264",
      },
    ]);
  });

  it("an aura re-stated while open keeps its place: the source-less REMOVED is still the older copy's (codex 85-tk-G-T41-1c)", () => {
    // the holder's copy from 10 s, another caster's from 10.2 s; the log
    // re-states the holder's at 11.1 s; a source-less REMOVED at 12 s, the
    // other's at 17 s; slice over at 13 s — the holder's left at 12 s
    const row = (event: LogEvent, s: number, src: string) =>
      makeAuraEvent(event, "162264", at(s), src, "Player-4", "BUFF");
    const u = makeUnit("Player-4", {
      name: "Dh",
      auraEvents: [
        row(LogEvent.SPELL_AURA_APPLIED, 10, "Player-4"),
        row(LogEvent.SPELL_AURA_APPLIED, 10.2, "Player-9"),
        row(LogEvent.SPELL_AURA_APPLIED, 11.1, "Player-4"),
        row(LogEvent.SPELL_AURA_REMOVED, 12, "0000000000000000"),
        row(LogEvent.SPELL_AURA_REMOVED, 17, "Player-9"),
      ],
    });
    expect(aurasUpAtLogEnd([u], u, "Metamorphosis", at(13))).toEqual([]);
  });

  it("out of the total: a (no press) entry, and an aura past its own length", () => {
    const proc = scan(dh(39.48), 3, "Metamorphosis (no press)");
    expect(proc.seen).toHaveLength(1);
    expect(proc.seen[0]).toMatch(/^no press: /);
    // still up 60 s after it went up, removed after a slice that ends there
    const outran = scan(dh(99), 3, "Metamorphosis", 92.9);
    expect(outran.seen).toHaveLength(1);
    expect(outran.seen[0]).toMatch(/^outran its length: /);
  });

  it("a REFRESH no press made does not restart the application: Avatar refreshed by the Thunder Blast that extends it (codex 85-tk-G-T76-1c)", () => {
    // a Capacitance holder: Avatar pressed and applied at 10 s, Thunder
    // Blast at 14 s and 22 s, a REFRESH at 14 s, no REMOVED, the slice over
    // at 35 s — the effect ends at 34 s and `6s left` at 28 s is right
    const aura = (event: LogEvent, s: number) =>
      makeAuraEvent(event, "107574", at(s), "Player-4", "Player-4", "BUFF");
    const warrior = (refreshS?: number): any =>
      makeUnit("Player-4", {
        name: "War",
        class: CombatUnitClass.Warrior,
        spec: CombatUnitSpec.Warrior_Fury,
        info: { talents: [], pvpTalents: [] } as never,
        spellCastEvents: [
          makeSpellCastEvent("1270724", at(1), "Player-4"),
          makeSpellCastEvent("107574", at(10), "Player-4"),
          makeSpellCastEvent("435222", at(14), "Player-4"),
          makeSpellCastEvent("435222", at(22), "Player-4"),
        ],
        auraEvents: [
          aura(LogEvent.SPELL_AURA_APPLIED, 10),
          ...(refreshS === undefined
            ? []
            : [aura(LogEvent.SPELL_AURA_REFRESH, refreshS)]),
        ],
      });
    const scanAvatar = (u: any, left: number) => {
      const seen: string[] = [];
      run({
        text: [
          `  <unit id="4" name="War" spec="Fury Warrior" role="enemy">`,
          `0:28  [STATE]   friends 3(MHunter):86 / enemies 4(FWarrior):98`,
          `      [RES] rdy:Δ  enemy:Avatar/Fury Warrior(${left}s left)  focus:3`,
        ].join("\n"),
        units: [u],
        unitOfPid: (pid: string | undefined) => (pid === "4" ? u : undefined),
        start: START,
        end: at(35),
        violate: (
          _c: string,
          kind: string,
          _t: number,
          _f: string,
          d: string,
        ) => seen.push(`${kind}: ${d}`),
        bump: () => undefined,
      } as any);
      return seen;
    };
    expect(scanAvatar(warrior(14), 6)).toEqual([]);
    expect(scanAvatar(warrior(), 6)).toEqual([]);
    // the anchor: the press's own sighting, not the later REFRESH; a
    // REFRESH a press made restarts it; no press of the name, the last one
    const o = {
      appliedMs: at(10),
      lastSeenMs: at(14),
      seenMs: [at(10), at(14)],
    };
    expect(applicationAnchorMs(o, [at(10)], at(28))).toBe(at(10));
    expect(applicationAnchorMs(o, [at(10), at(13.8)], at(28))).toBe(at(14));
    expect(applicationAnchorMs(o, [], at(28))).toBe(at(14));
    // a later press's refresh is not an earlier row's application (1d #1)
    expect(applicationAnchorMs(o, [at(10), at(13.8)], at(12))).toBe(at(10));
  });

  const entryScan = (
    u: any,
    spec: string,
    entry: string,
    rowS: number,
    left: number,
    endS: number,
  ) => {
    const seen: string[] = [];
    let checked = 0;
    const mm = `${Math.floor(rowS / 60)}:${String(rowS % 60).padStart(2, "0")}`;
    run({
      text: [
        `  <unit id="4" name="U" spec="${spec}" role="enemy">`,
        `${mm}  [STATE]   friends 3(MHunter):86 / enemies 4(X):98`,
        `      [RES] rdy:Δ  enemy:${entry}/${spec}(${left}s left)  focus:3`,
      ].join("\n"),
      units: [u],
      unitOfPid: (pid: string | undefined) => (pid === "4" ? u : undefined),
      start: START,
      end: at(endS),
      violate: (_c: string, kind: string, _t: number, _f: string, d: string) =>
        seen.push(`${kind}: ${d}`),
      bump: () => {
        checked++;
      },
    } as any);
    return { checked, seen };
  };

  it("a later press and its REFRESH do not move an earlier row's application (codex 85-tk-G-T76-1d #1)", () => {
    // Metamorphosis' aura up at 10 s beside its press, pressed again with a
    // REFRESH at 14 s, no REMOVED; the 12 s row counts from 10 s
    const aura = (event: LogEvent, s: number) =>
      makeAuraEvent(event, "162264", at(s), "Player-4", "Player-4", "BUFF");
    const u: any = makeUnit("Player-4", {
      name: "U",
      class: CombatUnitClass.DemonHunter,
      spec: CombatUnitSpec.DemonHunter_Havoc,
      info: {} as never,
      spellCastEvents: [
        makeSpellCastEvent("191427", at(10), "Player-4"),
        makeSpellCastEvent("191427", at(14), "Player-4"),
      ],
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, 10),
        aura(LogEvent.SPELL_AURA_REFRESH, 14),
      ],
    });
    const full = buffFullDurationForCaster("162264", u)!;
    const endS = 10 + full + 1;
    // the first application's own time left at 12 s: right, whatever the
    // later press did
    const r = entryScan(
      u,
      "Havoc Demon Hunter",
      "Metamorphosis",
      12,
      Math.round(full - 2),
      endS,
    );
    expect(r.seen).toEqual([]);
  });

  it("a re-broadcast pair restarts nothing and keeps the run in the check (codex 85-tk-G-T76-1d #2)", () => {
    const aura = (event: LogEvent, s: number) =>
      makeAuraEvent(event, "107574", at(s), "Player-4", "Player-4", "BUFF");
    const warrior = (pairS: number): any =>
      makeUnit("Player-4", {
        name: "U",
        class: CombatUnitClass.Warrior,
        spec: CombatUnitSpec.Warrior_Fury,
        info: { talents: [], pvpTalents: [] } as never,
        spellCastEvents: [makeSpellCastEvent("107574", at(10.2), "Player-4")],
        auraEvents: [
          aura(LogEvent.SPELL_AURA_APPLIED, 10.2),
          aura(LogEvent.SPELL_AURA_REMOVED, pairS),
          aura(LogEvent.SPELL_AURA_APPLIED, pairS + 0.001),
        ],
      });
    // untalented Avatar from 10.2 s ends at 30.2 s: `2s left` at 28 s is
    // right with the pair at 11.699 s (the gate read 31.7 s)…
    const near = entryScan(
      warrior(11.699),
      "Fury Warrior",
      "Avatar",
      28,
      2,
      30,
    );
    expect(near.checked).toBe(1);
    expect(near.seen).toEqual([]);
    // …and a pair far from the press leaves the run checked (was 1 → 0)
    const far = entryScan(warrior(20), "Fury Warrior", "Avatar", 28, 0, 30);
    expect(far.checked).toBe(1);
    expect(far.seen).toHaveLength(1);
  });
});
