/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A talent whose entry carries ANOTHER spell id than the button it grants
 * proves that button (`getSpecTalentButtonGrants`, the official
 * TraitDefinition.VisibleSpellID). The roster lists the cast id, the spec's
 * tree and the unit's talents hold the entry's, so the cooldown ledger read
 * the button as "outside the tree" and listed it only once pressed: a holder
 * who never pressed it had no kit row. 605 archive files, 2026-10-13
 * (fix-FT/scripts/tic_scan.ts): 158 player-rounds held one of these talents,
 * never pressed the button and had no ledger row — Fortifying Brew 149
 * (Mistweaver 89, Windwalker 60), Incarnation: Chosen of Elune 5, Avenging
 * Crusader 4.
 *
 * Node / entry ids below are COMBATANT_INFO rows `{node, entry, rank}` from
 * talentIdMap.json.
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { classMetadata } from "../src/data/classSpells";
import { ensureAnalysisData } from "../src/data/ensure";
import observedSpellIds from "../src/data/observedSpellIdsGenerated.json";
import { PVP_TALENT_POOL_GENERATED } from "../src/data/pvpTalentPoolGenerated";
import {
  effectiveCooldownSeconds,
  spellEffectData,
} from "../src/data/spellEffectData";
import { nodeMaps } from "../src/data/talentStrings";
import {
  BASELINE_DEFENSIVE_BY_SPEC,
  extractMajorCooldowns,
  kitRowUnused,
  MIN_CD_SECONDS,
  SPEC_EXCLUSIVE_SPELLS,
  SPELL_CANONICAL_IDS,
} from "../src/utils/cooldowns";
import {
  killOpportunityAt,
  unpressedWallsOwned,
} from "../src/utils/killWindowTargetSelection";
import { talentOwnershipOf } from "../src/utils/talentOwnership";
import {
  getPlayerTalentGrantedButtonIds,
  getSpecTalentButtonGrants,
  getSpecTalentTreeSpellInfo,
} from "../src/utils/talents";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

const T0 = 1_700_000_000_000;
const at = (s: number) => T0 + s * 1000;
const TRINKET = "336126";

type Row = { id1: number; id2: number; count: number };
const combatOf = (...units: any[]) =>
  ({
    startTime: T0,
    endTime: at(300),
    startInfo: { zoneId: "1505" },
    units: Object.fromEntries(units.map((u) => [u.id, u])),
  }) as any;
const unitOf = (
  cls: CombatUnitClass,
  spec: CombatUnitSpec,
  talents: Row[] | undefined,
  casts: string[] = [],
  over: Record<string, unknown> = {},
) =>
  makeUnit("P1", {
    name: "P1",
    class: cls,
    spec,
    info: talents ? { talents, pvpTalents: [] } : { pvpTalents: [] },
    spellCastEvents: casts.map((id, i) =>
      makeSpellCastEvent(id, at(20 + i * 10), "P1"),
    ),
    ...over,
  } as any);
const ledgerOf = (u: any) =>
  extractMajorCooldowns(u, combatOf(u), { withBaselineOnly: true });
const rowOf = (u: any, name: string) =>
  ledgerOf(u).find((cd) => cd.spellName === name);

interface Pair {
  label: string;
  cls: CombatUnitClass;
  spec: CombatUnitSpec;
  /** the roster's id: the button, and the id it is cast with */
  button: string;
  /** the talent entry's own spell id */
  talentId: string;
  name: string;
  talent: Row;
  /** the other entry of the talent's choice node, where it sits on one */
  otherChoice?: Row;
}
const FORTIFYING_BREW: Row = { id1: 101173, id2: 124968, count: 1 };
const CELESTIAL_ALIGNMENT: Row = { id1: 88215, id2: 109849, count: 1 };
const INCARNATION_ELUNE: Row = { id1: 88206, id2: 109839, count: 1 };
const BERSERK: Row = { id1: 82101, id2: 103162, count: 1 };
const INCARNATION_ASHAMANE: Row = { id1: 82114, id2: 103178, count: 1 };
const AVENGING_CRUSADER: Row = { id1: 81584, id2: 102568, count: 1 };
const AVENGING_WRATH_HOLY: Row = { id1: 81584, id2: 102569, count: 1 };
const PAIRS: Pair[] = [
  {
    label: "Holy Paladin — Avenging Crusader",
    cls: CombatUnitClass.Paladin,
    spec: CombatUnitSpec.Paladin_Holy,
    button: "216331",
    talentId: "394088",
    name: "Avenging Crusader",
    talent: AVENGING_CRUSADER,
    otherChoice: AVENGING_WRATH_HOLY,
  },
  {
    label: "Balance Druid — Incarnation: Chosen of Elune",
    cls: CombatUnitClass.Druid,
    spec: CombatUnitSpec.Druid_Balance,
    button: "102560",
    talentId: "394013",
    name: "Incarnation: Chosen of Elune",
    talent: INCARNATION_ELUNE,
    // Convoke the Spirits
    otherChoice: { id1: 88206, id2: 109838, count: 1 },
  },
  {
    label: "Balance Druid — Celestial Alignment",
    cls: CombatUnitClass.Druid,
    spec: CombatUnitSpec.Druid_Balance,
    button: "194223",
    talentId: "395022",
    name: "Celestial Alignment",
    talent: CELESTIAL_ALIGNMENT,
  },
  {
    label: "Feral Druid — Berserk",
    cls: CombatUnitClass.Druid,
    spec: CombatUnitSpec.Druid_Feral,
    button: "106951",
    talentId: "343223",
    name: "Berserk",
    talent: BERSERK,
  },
  ...(
    [
      ["Brewmaster", CombatUnitSpec.Monk_Brewmaster],
      ["Windwalker", CombatUnitSpec.Monk_Windwalker],
      ["Mistweaver", CombatUnitSpec.Monk_Mistweaver],
    ] as const
  ).map(([specName, spec]) => ({
    label: `${specName} Monk — Fortifying Brew`,
    cls: CombatUnitClass.Monk,
    spec,
    button: "115203",
    talentId: "388917",
    name: "Fortifying Brew",
    talent: FORTIFYING_BREW,
  })),
];

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("the official map: talent entry id → the button it grants", () => {
  it.each(PAIRS)(
    "$label: the tree holds the entry's id, never the button's — and the map joins them",
    (p) => {
      const specId = Number(p.spec);
      const tree = getSpecTalentTreeSpellInfo(specId);
      expect(tree.has(p.talentId)).toBe(true);
      expect(tree.has(p.button)).toBe(false);
      expect(getSpecTalentButtonGrants(specId).get(p.button)).toEqual([
        p.talentId,
      ]);
      // the button is the id players cast (a live id); the entry's own id is
      // a passive nobody casts
      const observed = new Set((observedSpellIds as number[]).map(String));
      expect(observed.has(p.button)).toBe(true);
      expect(observed.has(p.talentId)).toBe(false);
      expect(
        getPlayerTalentGrantedButtonIds(specId, [p.talent])?.has(p.button),
      ).toBe(true);
      expect(getPlayerTalentGrantedButtonIds(specId, [])?.size).toBe(0);
    },
  );

  it("a choice node grants only the entry the loadout names — the other side, or no readable entry, grants nothing", () => {
    const holy = Number(CombatUnitSpec.Paladin_Holy);
    expect([
      ...getPlayerTalentGrantedButtonIds(holy, [AVENGING_WRATH_HOLY])!,
    ]).toEqual([]);
    expect([
      ...getPlayerTalentGrantedButtonIds(holy, [
        { ...AVENGING_CRUSADER, id2: 0 },
      ])!,
    ]).toEqual([]);
    expect([
      ...getPlayerTalentGrantedButtonIds(holy, [
        { ...AVENGING_CRUSADER, count: 0 },
      ])!,
    ]).toEqual([]);
    expect(getPlayerTalentGrantedButtonIds(999_999, [])).toBeNull();
  });
});

describe("extractMajorCooldowns — the talent proves the button nobody pressed", () => {
  it.each(PAIRS)(
    "$label: talent taken and never pressed ⇒ a kit row tagged [UNUSED]; talent not taken ⇒ no row",
    (p) => {
      const holder = unitOf(p.cls, p.spec, [p.talent]);
      const row = rowOf(holder, p.name);
      expect(row?.spellId).toBe(p.button);
      expect(row?.neverUsed).toBe(true);
      expect(kitRowUnused(row!)).toBe(true);
      expect(row?.baselineOnly).toBeUndefined();
      // the default ledger (every reader but the kit render) holds it too
      expect(
        extractMajorCooldowns(holder, combatOf(holder)).some(
          (cd) => cd.spellId === p.button,
        ),
      ).toBe(true);

      const without = unitOf(p.cls, p.spec, []);
      expect(rowOf(without, p.name)).toBeUndefined();
      // talents not decoded: nothing is proven, as for any talent button
      const blind = unitOf(p.cls, p.spec, undefined);
      expect(rowOf(blind, p.name)).toBeUndefined();
    },
  );

  it.each(PAIRS.filter((p) => p.otherChoice))(
    "$label: the other side of its choice node, or a selection that names no entry ⇒ no row",
    (p) => {
      expect(
        rowOf(unitOf(p.cls, p.spec, [p.otherChoice!]), p.name),
      ).toBeUndefined();
      expect(
        rowOf(unitOf(p.cls, p.spec, [{ ...p.talent, id2: 0 }]), p.name),
      ).toBeUndefined();
    },
  );

  it.each(PAIRS)(
    "$label: the unpressed row carries the cooldown the pressed row does, and a press without the talent still lists it",
    (p) => {
      const unpressed = rowOf(unitOf(p.cls, p.spec, [p.talent]), p.name)!;
      const pressed = rowOf(
        unitOf(p.cls, p.spec, [p.talent], [p.button]),
        p.name,
      )!;
      expect(pressed.neverUsed).toBe(false);
      expect(pressed.casts).toHaveLength(1);
      expect(unpressed.cooldownSeconds).toBe(pressed.cooldownSeconds);
      expect(unpressed.maxChargesDetected).toBe(pressed.maxChargesDetected);
      expect(unpressed.tag).toBe(pressed.tag);
      // cast evidence without the talent row: listed, as before
      expect(
        rowOf(unitOf(p.cls, p.spec, [], [p.button]), p.name)?.casts,
      ).toHaveLength(1);
    },
  );

  it("Feral: Incarnation: Avatar of Ashamane replaces Berserk (official override) — no Berserk row beside it", () => {
    const u = unitOf(CombatUnitClass.Druid, CombatUnitSpec.Druid_Feral, [
      BERSERK,
      INCARNATION_ASHAMANE,
    ]);
    expect(rowOf(u, "Berserk")).toBeUndefined();
    expect(rowOf(u, "Incarnation: Avatar of Ashamane")?.neverUsed).toBe(true);
  });

  it("Balance: Incarnation stands where Celestial Alignment stood — one row, and Celestial Alignment only when it is cast", () => {
    const both = unitOf(CombatUnitClass.Druid, CombatUnitSpec.Druid_Balance, [
      CELESTIAL_ALIGNMENT,
      INCARNATION_ELUNE,
    ]);
    expect(rowOf(both, "Celestial Alignment")).toBeUndefined();
    expect(rowOf(both, "Incarnation: Chosen of Elune")?.neverUsed).toBe(true);
    // the build of the corpus's two Celestial Alignment druids: no Incarnation
    const alone = unitOf(CombatUnitClass.Druid, CombatUnitSpec.Druid_Balance, [
      CELESTIAL_ALIGNMENT,
    ]);
    expect(rowOf(alone, "Celestial Alignment")?.neverUsed).toBe(true);
    expect(rowOf(alone, "Incarnation: Chosen of Elune")).toBeUndefined();
    // a cast beats the replacement row for that player
    const castBoth = unitOf(
      CombatUnitClass.Druid,
      CombatUnitSpec.Druid_Balance,
      [CELESTIAL_ALIGNMENT, INCARNATION_ELUNE],
      ["194223"],
    );
    expect(rowOf(castBoth, "Celestial Alignment")?.casts).toHaveLength(1);
  });

  it("Balance: an Orbital Strike press (390414, the id that talent swaps in) is a press of the Incarnation row, not an unused cooldown", () => {
    const u = unitOf(
      CombatUnitClass.Druid,
      CombatUnitSpec.Druid_Balance,
      [CELESTIAL_ALIGNMENT, INCARNATION_ELUNE],
      ["390414"],
    );
    const rows = ledgerOf(u).filter(
      (cd) => cd.spellName === "Incarnation: Chosen of Elune",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.spellId).toBe("102560");
    expect(rows[0]!.neverUsed).toBe(false);
    expect(rows[0]!.casts).toHaveLength(1);
  });

  it("Holy: Avenging Crusader's holder has no Avenging Wrath row, Avenging Wrath's holder no Avenging Crusader row", () => {
    const crusader = unitOf(
      CombatUnitClass.Paladin,
      CombatUnitSpec.Paladin_Holy,
      [AVENGING_CRUSADER],
    );
    expect(rowOf(crusader, "Avenging Wrath")).toBeUndefined();
    expect(rowOf(crusader, "Avenging Crusader")?.tag).toBe("Defensive");
    const wrath = unitOf(CombatUnitClass.Paladin, CombatUnitSpec.Paladin_Holy, [
      AVENGING_WRATH_HOLY,
    ]);
    expect(rowOf(wrath, "Avenging Crusader")).toBeUndefined();
    expect(rowOf(wrath, "Avenging Wrath")).toBeDefined();
  });

  it("a spec the roster does not allow the button for stays out, talent or not (SPEC_EXCLUSIVE_SPELLS still reads the unit's own grants)", () => {
    // Restoration Druid: Balance's Celestial Alignment row is not in its tree
    const resto = unitOf(
      CombatUnitClass.Druid,
      CombatUnitSpec.Druid_Restoration,
      [CELESTIAL_ALIGNMENT],
    );
    expect(rowOf(resto, "Celestial Alignment")).toBeUndefined();
  });
});

/**
 * Lay on Hands: the talent's own spell is 633 (class node 81597), the roster
 * lists 471195 — the id Empyreal Ward 387791 puts in its place (DB2 aura 332,
 * base points 471195), `SPELL_CANONICAL_IDS["633"]`. 605 archive files: 864
 * paladin player-rounds, every one holding 633; 831 hold Empyreal Ward and
 * cast 471195, the 33 without it cast 633. Holy had the unpressed row through
 * the healer save roster's alias evidence (148 player-rounds); Retribution
 * (185 of 430) and Protection (1 of 2) had none.
 */
describe("extractMajorCooldowns — a talent whose own spell the roster lists under its canonical alias", () => {
  const LAY_ON_HANDS: Row = { id1: 81597, id2: 102583, count: 1 };
  const paladin = (
    spec: CombatUnitSpec,
    talents: Row[],
    casts: string[] = [],
  ) => unitOf(CombatUnitClass.Paladin, spec, talents, casts);

  it.each([
    ["Retribution", CombatUnitSpec.Paladin_Retribution],
    ["Protection", CombatUnitSpec.Paladin_Protection],
    ["Holy", CombatUnitSpec.Paladin_Holy],
  ] as const)(
    "%s: Lay on Hands taken and never pressed ⇒ one row, 471195, tagged [UNUSED]; not taken ⇒ no row",
    (_name, spec) => {
      const rows = ledgerOf(paladin(spec, [LAY_ON_HANDS])).filter(
        (cd) => cd.spellName === "Lay on Hands",
      );
      expect(rows.map((r) => r.spellId)).toEqual(["471195"]);
      expect(kitRowUnused(rows[0]!)).toBe(true);
      expect(rowOf(paladin(spec, []), "Lay on Hands")).toBeUndefined();
      expect(
        rowOf(unitOf(CombatUnitClass.Paladin, spec, undefined), "Lay on Hands"),
      ).toBeUndefined();
    },
  );

  it.each([
    ["Retribution", CombatUnitSpec.Paladin_Retribution],
    ["Protection", CombatUnitSpec.Paladin_Protection],
  ] as const)(
    "%s: the unpressed row carries the pressed row's cooldown, whichever id the press had",
    (_name, spec) => {
      const unpressed = rowOf(paladin(spec, [LAY_ON_HANDS]), "Lay on Hands")!;
      for (const castId of ["471195", "633"]) {
        const pressed = ledgerOf(
          paladin(spec, [LAY_ON_HANDS], [castId]),
        ).filter((cd) => cd.spellName === "Lay on Hands");
        expect(pressed).toHaveLength(1);
        expect(pressed[0]!.casts).toHaveLength(1);
        expect(pressed[0]!.cooldownSeconds).toBe(unpressed.cooldownSeconds);
        expect(pressed[0]!.tag).toBe(unpressed.tag);
      }
    },
  );

  it("only where the roster has no row for the talent's own id: Bladestorm stays under 227847 until 446035 is pressed", () => {
    // Arms, Bladestorm on the choice node 90441 (entry 112314 = spell 227847)
    const BLADESTORM: Row = { id1: 90441, id2: 112314, count: 1 };
    const arms = (casts: string[] = []) =>
      unitOf(
        CombatUnitClass.Warrior,
        CombatUnitSpec.Warrior_Arms,
        [BLADESTORM],
        casts,
      );
    const unpressed = ledgerOf(arms()).filter(
      (cd) => cd.spellName === "Bladestorm",
    );
    expect(unpressed.map((r) => r.spellId)).toEqual(["227847"]);
    expect(unpressed[0]!.neverUsed).toBe(true);
    const pressed = ledgerOf(arms(["446035"])).filter(
      (cd) => cd.spellName === "Bladestorm",
    );
    expect(pressed.map((r) => r.spellId)).toEqual(["446035"]);
    expect(pressed[0]!.casts).toHaveLength(1);
  });
});

describe("the kill-opportunity tier — an owned, unpressed Fortifying Brew is a wall in hand", () => {
  const monk = (talents: Row[], casts: any[] = []) =>
    makeUnit("Monk", {
      name: "Monk",
      reaction: CombatUnitReaction.Hostile,
      class: CombatUnitClass.Monk,
      spec: CombatUnitSpec.Monk_Windwalker,
      info: { talents, pvpTalents: [] },
      // trinket spent from 0.5 s on, so the tier is prime or gated
      spellCastEvents: [makeSpellCastEvent(TRINKET, at(0.5), "Monk"), ...casts],
    } as any);

  it("with the talent and no press: gated, not PRIME; without the talent: no wall is claimed", () => {
    const holder = monk([FORTIFYING_BREW]);
    expect(
      unpressedWallsOwned(holder, combatOf(holder)).map((r) => r.name),
    ).toContain("Fortifying Brew");
    const tier = killOpportunityAt(holder, 70, combatOf(holder));
    expect(tier.tier).toBe("gated");
    expect(tier.wallsInHand).toContain("Fortifying Brew");

    const without = monk([]);
    expect(
      unpressedWallsOwned(without, combatOf(without)).map((r) => r.name),
    ).not.toContain("Fortifying Brew");
  });

  it("a pressed Fortifying Brew keeps its cooldown arithmetic", () => {
    const u = monk(
      [FORTIFYING_BREW],
      [makeSpellCastEvent("115203", at(10), "Monk")],
    );
    const combat = combatOf(u);
    expect(unpressedWallsOwned(u, combat).map((r) => r.name)).not.toContain(
      "Fortifying Brew",
    );
    expect(killOpportunityAt(u, 70, combat).wallsInHand).not.toContain(
      "Fortifying Brew",
    );
  });
});

describe("talentOwnershipOf — a button the tree grants under another id is talent-gated, not baseline", () => {
  const brew = (talents: Row[] | undefined) =>
    unitOf(CombatUnitClass.Monk, CombatUnitSpec.Monk_Mistweaver, talents);
  it("yes with the entry, no without it (it read 'yes' by elimination), unknown without talents", () => {
    expect(talentOwnershipOf(brew([FORTIFYING_BREW]), "115203")).toBe("yes");
    // a loadout that resolves and does not hold the entry (Tiger's Lust,
    // class node 101147)
    const TIGERS_LUST: Row = { id1: 101147, id2: 124937, count: 1 };
    expect(talentOwnershipOf(brew([TIGERS_LUST]), "115203")).toBe("no");
    // a row the current tree cannot resolve proves nothing (another build)
    expect(
      talentOwnershipOf(brew([{ id1: 1, id2: 1, count: 1 }]), "115203"),
    ).toBe("unknown");
    expect(talentOwnershipOf(brew(undefined), "115203")).toBe("unknown");
    expect(talentOwnershipOf(brew([]), "115203")).toBe("unknown");
  });

  it("a choice node: the entry taken is yes, the other side no, an unreadable selection unknown; a cast is always yes", () => {
    const holy = (talents: Row[], casts: string[] = []) =>
      unitOf(
        CombatUnitClass.Paladin,
        CombatUnitSpec.Paladin_Holy,
        talents,
        casts,
      );
    expect(talentOwnershipOf(holy([AVENGING_CRUSADER]), "216331")).toBe("yes");
    expect(talentOwnershipOf(holy([AVENGING_WRATH_HOLY]), "216331")).toBe("no");
    expect(
      talentOwnershipOf(holy([{ ...AVENGING_CRUSADER, id2: 0 }]), "216331"),
    ).toBe("unknown");
    expect(
      talentOwnershipOf(holy([AVENGING_WRATH_HOLY], ["216331"]), "216331"),
    ).toBe("yes");
  });

  it("a replaced button is 'no' whatever its own entry says", () => {
    const feral = unitOf(CombatUnitClass.Druid, CombatUnitSpec.Druid_Feral, [
      BERSERK,
      INCARNATION_ASHAMANE,
    ]);
    expect(talentOwnershipOf(feral, "106951")).toBe("no");
    const balance = unitOf(
      CombatUnitClass.Druid,
      CombatUnitSpec.Druid_Balance,
      [CELESTIAL_ALIGNMENT, INCARNATION_ELUNE],
    );
    expect(talentOwnershipOf(balance, "194223")).toBe("no");
    expect(talentOwnershipOf(balance, "102560")).toBe("yes");
  });
});

/**
 * Completeness, in the Curated-List spirit: the ledger reaches a talent
 * button through the CLASS ROSTER's id, and the roster is written by hand. A
 * roster cooldown that an active talent entry of the spec names — the same
 * English name — must be in the ledger of a unit that holds that entry and
 * presses nothing; otherwise a holder silently has no kit row until the
 * press. Asked of the product itself, for every such pair: a hand-built unit
 * of the spec with that one talent row. Today a row is there because
 *   · the entry's own id is a roster row or is discovered by name (Bladestorm
 *     227847 beside 446035, each spec's Ascendance, Intimidation 19577): the
 *     button stands under the entry's id and the roster's other id is a
 *     variant press of it;
 *   · the official button grant proves the roster's id
 *     (`getSpecTalentButtonGrants`);
 *   · the roster's id is the canonical alias of the entry's own spell, which
 *     the roster does not list (Lay on Hands 633 → 471195,
 *     `SPELL_CANONICAL_IDS`).
 * A pair with no row is a renumbered id or a roster that fell behind the
 * game. `KNOWN_OPEN` holds the pairs known to be open, each with its reason;
 * the test fails on any pair outside it — and on a listed pair that is no
 * longer open.
 */
describe("completeness: every roster cooldown a talent of the spec names is in the ledger of a holder who never pressed it", () => {
  /** `spec|roster id|talent entry id` */
  const KNOWN_OPEN: Record<string, string> = {
    // The Hunt, Devourer: its own spell 1246167, which the roster does not
    // list (it lists Havoc's 370965) and no discovery rule names. Press-only
    // by the user ruling of 2026-10-09 (an offensive-catalog member outside
    // the roster is `responseOnly`).
    "1480|370965|1246167": "The Hunt, Devourer",
  };

  it("no pair without a row outside the known-open list, and no stale entry in it", () => {
    const open: string[] = [];
    let pairs = 0;
    for (const [specId, sd] of Object.entries(nodeMaps) as [string, any][]) {
      const cls = classMetadata.find(
        (c) => String(c.unitClass) === String(sd.classId),
      );
      if (!cls) continue;
      const tree = getSpecTalentTreeSpellInfo(Number(specId));
      const activeByName = new Map<string, Array<{ id: string; row: Row }>>();
      for (const node of [
        ...sd.classNodes,
        ...sd.specNodes,
        ...(sd.heroNodes ?? []),
      ])
        for (const e of node.entries ?? [])
          if (e.type === "active" && e.spellId)
            activeByName.set(e.name, [
              ...(activeByName.get(e.name) ?? []),
              {
                id: String(e.spellId),
                row: { id1: node.id, id2: e.id, count: 1 },
              },
            ]);
      for (const a of cls.abilities) {
        if (a.tags.length === 0 || !spellEffectData[a.spellId]) continue;
        if ((effectiveCooldownSeconds(a.spellId) ?? 0) < MIN_CD_SECONDS)
          continue;
        const allowed = SPEC_EXCLUSIVE_SPELLS[a.spellId];
        if (allowed && !allowed.includes(specId as CombatUnitSpec)) continue;
        // the roster id is the entry's own id, a PvP talent or the spec's
        // DB2 baseline: other rules of the ledger, tested where they live
        if (tree.has(a.spellId)) continue;
        if (PVP_TALENT_POOL_GENERATED[specId]?.[a.spellId]) continue;
        if ((BASELINE_DEFENSIVE_BY_SPEC[specId] ?? []).includes(a.spellId))
          continue;
        for (const talent of activeByName.get(a.name) ?? []) {
          pairs++;
          const holder = unitOf(cls.unitClass, specId as CombatUnitSpec, [
            talent.row,
          ]);
          if (!rowOf(holder, a.name))
            open.push(`${specId}|${a.spellId}|${talent.id}`);
        }
      }
    }
    // the 19 spec × spell pairs of fix-FT/scripts/sw_talentIdVsCastId.ts
    expect(pairs).toBe(19);
    expect(open.sort()).toEqual(Object.keys(KNOWN_OPEN).sort());
  });

  it("the grant map is not empty-by-accident: the five roster buttons it proves today", () => {
    // raidbots dropping `visibleSpellId` from talents.json would empty the
    // map and turn the test above red pair by pair; this names what is lost.
    const proven = new Set<string>();
    for (const [specId, sd] of Object.entries(nodeMaps) as [string, any][]) {
      const cls = classMetadata.find(
        (c) => String(c.unitClass) === String(sd.classId),
      );
      const rosterIds = new Set(cls?.abilities.map((a) => a.spellId) ?? []);
      for (const button of getSpecTalentButtonGrants(Number(specId)).keys())
        if (
          rosterIds.has(button) &&
          (effectiveCooldownSeconds(button) ?? 0) >= MIN_CD_SECONDS
        )
          proven.add(button);
    }
    expect([...proven].sort()).toEqual(
      ["102560", "106951", "115203", "194223", "216331"].sort(),
    );
    // none of them is an alias the ledger would fold into another row
    for (const id of proven) expect(SPELL_CANONICAL_IDS[id]).toBeUndefined();
  });
});
