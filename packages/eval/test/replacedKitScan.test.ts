/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * scan5/replacedKit.ts (F22): the check that counts "the prompt says a unit has
 * a spell its talents replaced" must fire on each surface it claims to read,
 * and stay quiet for the exemptions. A planted Lightsmith Holy Paladin.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import type { IRoundCtx } from "../scripts/scan5/ctx";
import { CHECKS, OUT_OF_TOTAL, run } from "../scripts/scan5/replacedKit";

const T0 = 1_700_000_000_000;
const TOLL_NODE = { id1: 81496, id2: 102465, count: 1 };
const ARMAMENTS_NODE = { id1: 110257, id2: 136795, count: 1 };

function paladin(opts: { lightsmith?: boolean; casts?: string[] } = {}): any {
  return {
    id: "Player-1",
    name: "Pal-Realm-US",
    spec: CombatUnitSpec.Paladin_Holy,
    info: {
      talents:
        opts.lightsmith === false ? [TOLL_NODE] : [TOLL_NODE, ARMAMENTS_NODE],
      pvpTalents: [],
    },
    spellCastEvents: (opts.casts ?? []).map((spellId) => ({
      spellId,
      logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + 1000 },
    })),
  };
}

/** The owner sits on the other team unless it is this unit. */
function scan(unit: any, lines: string[], menu = "", ownerId = "Player-9") {
  return scanOf(
    [unit],
    lines,
    { id: ownerId, info: { teamId: unit.id === ownerId ? undefined : "0" } },
    menu,
  );
}

function scanOf(players: any[], lines: string[], owner: any, menu = "") {
  const seen: { kind: string; atMs: number }[] = [];
  const ctx = {
    lines,
    menu,
    players,
    owner,
    start: T0,
    pidOf: () => "2",
    bump: () => undefined,
    violate: (_c: string, kind: string, atMs: number) =>
      seen.push({ kind, atMs }),
  } as unknown as IRoundCtx;
  run(ctx);
  return seen.map((s) => s.kind);
}

const KIT = [
  `  <unit id="2" name="Pal-Realm-US" spec="Holy Paladin" role="teammate">`,
  `    <cooldowns>Aura Mastery [120s], Divine Toll [60s] [UNUSED]</cooldowns>`,
];

describe("replacedSpellListed", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("registers one check, the timeline kind measured only", () => {
    expect([...CHECKS]).toEqual(["replacedSpellListed"]);
    expect(OUT_OF_TOTAL.has("replacedSpellListed|timeline")).toBe(true);
  });

  it("fires on the kit", () => {
    expect(scan(paladin(), KIT)).toEqual(["kit"]);
  });

  it("fires on a teammate's [RES] token, and on the owner's bare one", () => {
    const row =
      "      [RES] rdy:Aegis,2:Divine Toll,3:Fade  cd:Fade(3s)  focus:2";
    expect(scan(paladin(), [row])).toEqual(["res"]);
    const own = "      [RES] rdy:Aegis,Divine Toll  focus:2";
    expect(scan(paladin(), [own], "", "Player-1")).toEqual(["res"]);
  });

  it("fires on the enemy column under the unit's spec only", () => {
    const row =
      "      [RES] rdy:Aegis  enemy:Divine Toll (no press)/Holy Paladin(3s left)  focus:1";
    expect(scan(paladin(), [row])).toEqual(["resEnemy"]);
    const ret =
      "      [RES] rdy:Aegis  enemy:Divine Toll/Retribution Paladin(3s left)  focus:1";
    expect(scan(paladin(), [ret])).toEqual([]);
  });

  it("fires on a menu row's facts for that unit", () => {
    const menu =
      "  - id=cd-waste:Player-1:5 type=cd-waste t=whole-round units=Pal-Realm-US facts={spell=Divine Toll, unit=Pal-Realm-US}\n" +
      "  - id=cd-hoarded:x type=cd-hoarded t=4s units=Pal-Realm-US facts={readyCds=Aura Mastery; Divine Toll, own=no}";
    expect(scan(paladin(), [], menu)).toEqual(["menu", "menu"]);
  });

  it("does not read a bare fact as the crisis target's", () => {
    const row =
      "  - id=x type=cd-hoarded t=4s units=Other-Realm-US/Pal-Realm-US facts={crisisUnit=Pal-Realm-US, readyCds=Divine Toll, own=no}";
    expect(scan(paladin(), [], row)).toEqual([]);
  });

  it("reads the owner qualifiers of a menu fact", () => {
    const row = (facts: string) => `  - id=x type=y t=1s facts={t=1, ${facts}}`;
    const pal = "Pal-Realm-US";
    expect(
      scan(
        paladin(),
        [],
        row("readyCds=Aura Mastery (yours)、Divine Toll (yours)"),
        "Player-1",
      ),
    ).toEqual(["menu"]);
    expect(
      scan(paladin(), [], row("readyCds=Divine Toll (yours)"), "Player-9"),
    ).toEqual([]);
    expect(scan(paladin(), [], row(`readyCds=Divine Toll (${pal}'s)`))).toEqual(
      ["menu"],
    );
    expect(
      scan(paladin(), [], row("readyCds=Divine Toll (Other-Realm-US's)")),
    ).toEqual([]);
  });

  it("reads the enemy column for an enemy only, and only when no same-spec enemy keeps it", () => {
    // a ledger row as rendered: under its timed line, six spaces, no time
    const line = [
      "0:10  [PRESS]   x",
      "      [RES] rdy:—  cd:—  enemy:Divine Toll/Holy Paladin(8s left)",
    ];
    const enemy = () => ({
      ...paladin(),
      info: { ...paladin().info, teamId: "1" },
    });
    const friend = { ...paladin(), info: { ...paladin().info, teamId: "0" } };
    const herald = {
      ...paladin({ lightsmith: false }),
      id: "Player-2",
      name: "Other-Realm-US",
      info: { ...paladin({ lightsmith: false }).info, teamId: "1" },
    };
    const owner = { id: "Player-9", info: { teamId: "0" } };
    expect(scanOf([enemy()], line, owner)).toEqual(["resEnemy"]);
    expect(scanOf([friend], line, owner)).toEqual([]);
    expect(scanOf([enemy(), herald], line, owner)).toEqual([]);
  });

  it("proves a PvP pair when the class talents did not decode", () => {
    const u = paladin();
    u.info = { talents: [], pvpTalents: ["410126"] };
    expect(
      scan(u, [
        `  <unit id="2" name="Pal-Realm-US" spec="Holy Paladin" role="teammate">`,
        `    <cooldowns>Blinding Light [90s] [UNUSED]</cooldowns>`,
      ]),
    ).toEqual(["kit"]);
  });

  it("reads a timeline mention as the measured kind", () => {
    expect(
      scan(paladin(), ["0:30  [DEATH]  2(HPaladin) (Unused: Divine Toll)"]),
    ).toEqual(["timeline"]);
  });

  it("does not read a mate's entry or a longer name as the owner's", () => {
    const owner = "Player-1";
    const line = (s: string) => [
      "0:10  [PRESS]   x",
      `      [RES] rdy:Aura Mastery,${s}  cd:—`,
    ];
    expect(scan(paladin(), line("3:Divine Toll"), "", owner)).toEqual([]);
    expect(scan(paladin(), line("Mass Divine Toll"), "", owner)).toEqual([]);
    expect(scan(paladin(), line("Divine Toll"), "", owner)).toEqual(["res"]);
  });

  it("reads a menu row only on a fact about the unit's kit", () => {
    const row = (facts: string) =>
      `  - id=x type=y t=1s units=Pal-Realm-US facts={${facts}}`;
    expect(
      scan(paladin(), [], row("healer=Pal-Realm-US, cc=Divine Toll")),
    ).toEqual([]);
    expect(
      scan(paladin(), [], row("readyCds=Aura Mastery; Divine Toll, own=no")),
    ).toEqual(["menu"]);
  });

  it("is quiet for a Herald, and for a Lightsmith who did press it", () => {
    expect(scan(paladin({ lightsmith: false }), KIT)).toEqual([]);
    expect(scan(paladin({ casts: ["375576"] }), KIT)).toEqual([]);
  });

  it("skips a loadout that did not decode", () => {
    const u = paladin();
    u.info.talents = [];
    expect(scan(u, KIT)).toEqual([]);
  });
});
