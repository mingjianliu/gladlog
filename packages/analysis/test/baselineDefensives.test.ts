/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Triage 2026-09-29 cd-hoarded F-W6 (user ruling 2026-09-30, C4): a catalog
 * defensive the spec owns without a talent stays in the ledger in a round
 * where it was not pressed. 06bb9860 round 5 dropped Divine Shield, cast in
 * rounds 1–4, from the loadout, `[UNUSED]`, [RES] `rdy` and cd-hoarded.
 *
 * The table is generated (DB2 SpecializationSpells / SkillLineAbility
 * AcquireMethod ≠ 3, genBaselineDefensives.ts); this file pins the legs of
 * the nomination rule the repo itself can re-derive (catalog Defensive,
 * cooldown floor, in no talent tree of the spec) and the ledger behaviour.
 */
import { CombatUnitClass, CombatUnitSpec } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { cdWasteEvents } from "../src/analysis/candidateFindings";
import generated from "../src/data/baselineDefensivesGenerated.json";
import { classMetadata } from "../src/data/classSpells";
import { ensureAnalysisData } from "../src/data/ensure";
import { effectiveCooldownSeconds } from "../src/data/spellEffectData";
import { SpellTag } from "../src/data/spellTypes";
import talentTrees from "../src/data/talentIdMap.json";
import {
  BASELINE_DEFENSIVE_BY_SPEC,
  extractMajorCooldowns,
  findCheaperDefensiveAlternatives,
  MIN_CD_SECONDS,
  RESPONSE_ONLY_DEFENSIVE_IDS,
} from "../src/utils/cooldowns";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

const T0 = 1_700_000_000_000;
const combatOf = (u: any) =>
  ({
    startTime: T0,
    endTime: T0 + 300_000,
    units: { [u.id]: u },
  }) as unknown as import("@gladlog/parser-compat").AtomicArenaCombat;
// the ledger render / cd-hoarded view (the rows reach only callers that ask)
const ledger = (u: any) =>
  extractMajorCooldowns(u, combatOf(u), { withBaselineOnly: true });

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("BASELINE_DEFENSIVE_BY_SPEC — the nomination rule", () => {
  const trees = talentTrees as Array<{
    classId: number;
    specId: number;
    [k: string]: any;
  }>;
  const treeIds = (specId: string) => {
    const t = trees.find((x) => String(x.specId) === specId)!;
    const ids = new Set<string>();
    for (const key of ["classNodes", "specNodes", "heroNodes", "subTreeNodes"])
      for (const n of t[key] ?? [])
        for (const e of n.entries ?? [])
          if (e.spellId) ids.add(String(e.spellId));
    return { classId: t.classId, ids };
  };

  it("is the generated table minus response-only buttons", () => {
    const gen = (generated as any).bySpec as Record<
      string,
      Array<{ id: string }>
    >;
    expect(Object.keys(BASELINE_DEFENSIVE_BY_SPEC).sort()).toEqual(
      Object.keys(gen).sort(),
    );
    for (const [spec, rows] of Object.entries(gen))
      expect(BASELINE_DEFENSIVE_BY_SPEC[spec]).toEqual(
        rows
          .map((r) => r.id)
          .filter((id) => !RESPONSE_ONLY_DEFENSIVE_IDS.has(id)),
      );
    // Feign Death is nominated by DB2 and left out on purpose (its aura proof
    // owns it; it is never named as held — ruling 2026-09-30 A9-3)
    expect(gen["253"]!.map((r) => r.id)).toContain("5384");
    expect(BASELINE_DEFENSIVE_BY_SPEC["253"]).not.toContain("5384");
  });

  it("every row is a catalog Defensive of the spec's class, cooldown ≥ the ledger floor, in no talent tree of the spec", () => {
    let rows = 0;
    for (const [spec, ids] of Object.entries(BASELINE_DEFENSIVE_BY_SPEC)) {
      const { classId, ids: inTree } = treeIds(spec);
      const catalog = classMetadata.find(
        (c) => Number(c.unitClass) === classId,
      )!;
      for (const id of ids) {
        rows++;
        const row = catalog.abilities.find((a) => a.spellId === id);
        expect(row, `${spec} ${id} in the class catalog`).toBeDefined();
        expect(row!.tags, `${spec} ${id}`).toContain(SpellTag.Defensive);
        expect(
          effectiveCooldownSeconds(id) ?? 0,
          `${spec} ${id} cooldown`,
        ).toBeGreaterThanOrEqual(MIN_CD_SECONDS);
        expect(inTree.has(id), `${spec} ${id} is a talent-tree spell`).toBe(
          false,
        );
      }
    }
    // 2026-10-01, build 12.1.0.69587: 21 specs / 26 rows (29 nominated − Feign Death × 3)
    expect(Object.keys(BASELINE_DEFENSIVE_BY_SPEC)).toHaveLength(21);
    expect(rows).toBe(26);
  });

  it("known rows and known non-rows", () => {
    for (const spec of ["65", "66", "70"])
      expect(BASELINE_DEFENSIVE_BY_SPEC[spec]).toContain("642"); // Divine Shield
    expect(BASELINE_DEFENSIVE_BY_SPEC["258"]).toEqual(["47585"]); // Dispersion, Shadow only
    expect(BASELINE_DEFENSIVE_BY_SPEC["256"]).toBeUndefined(); // Discipline: none
    const all = new Set(Object.values(BASELINE_DEFENSIVE_BY_SPEC).flat());
    // talent-granted (AcquireMethod 3) — never baseline
    for (const id of ["633", "1022"]) expect(all.has(id)).toBe(false);
  });
});

describe("extractMajorCooldowns — a baseline defensive stays in the ledger unpressed (F-W6)", () => {
  const paladin = (over: Record<string, unknown> = {}) =>
    makeUnit("player-1", {
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Holy,
      info: { talents: [], pvpTalents: [] } as any,
      ...over,
    });

  it("Holy Paladin, no cast this round → Divine Shield listed, never used", () => {
    const ds = ledger(paladin()).find((c) => c.spellId === "642");
    expect(ds).toBeDefined();
    expect(ds!.tag).toBe(SpellTag.Defensive);
    expect(ds!.neverUsed).toBe(true);
  });

  it("a caller that does not ask gets the evidence-owned ledger only (Fable review of F-W6, round 8)", () => {
    const u = paladin();
    expect(
      extractMajorCooldowns(u, combatOf(u)).find((c) => c.spellId === "642"),
    ).toBeUndefined();
    const pressed = paladin({
      spellCastEvents: [makeSpellCastEvent("642", T0 + 20_000, "player-1")],
    });
    expect(
      extractMajorCooldowns(pressed, combatOf(pressed)).find(
        (c) => c.spellId === "642",
      ),
    ).toBeDefined();
  });

  it("the row is flagged baselineOnly — and only while nothing else proves the button (user ruling 2026-10-01, P-W6)", () => {
    expect(
      ledger(paladin()).find((c) => c.spellId === "642")!.baselineOnly,
    ).toBe(true);
    const pressed = paladin({
      spellCastEvents: [makeSpellCastEvent("642", T0 + 20_000, "player-1")],
    });
    const ds = ledger(pressed).find((c) => c.spellId === "642")!;
    expect(ds.baselineOnly).toBeUndefined();
    expect(ds.neverUsed).toBe(false);
  });

  it("cd-waste never names a baselineOnly row; the same row with evidence is named as before", () => {
    const row = {
      spellId: "642",
      spellName: "Divine Shield",
      tag: "Defensive",
      neverUsed: true,
      isThroughput: false,
    };
    const owner = { id: "player-1", name: "Pal-R" };
    expect(cdWasteEvents([row], owner, 30)).toHaveLength(1);
    expect(cdWasteEvents([{ ...row, baselineOnly: true }], owner, 30)).toEqual(
      [],
    );
  });

  it("a baseline ability the table does not prove stays cast-evidence only (Lay on Hands)", () => {
    expect(ledger(paladin()).find((c) => c.spellId === "633")).toBeUndefined();
  });

  it("without COMBATANT_INFO nothing changes (the branch is not reached)", () => {
    const a = ledger(paladin({ info: undefined }));
    expect(a.filter((c) => c.spellId === "642")).toHaveLength(1);
  });

  it("another class's spec does not get it", () => {
    const priest = makeUnit("player-1", {
      class: CombatUnitClass.Priest,
      spec: CombatUnitSpec.Priest_Discipline,
      info: { talents: [], pvpTalents: [] } as any,
    });
    // Dispersion is Shadow's baseline, not Discipline's
    expect(ledger(priest).find((c) => c.spellId === "47585")).toBeUndefined();
  });

  it("same-name guard: a Death Knight with the 410358 row on evidence lists Anti-Magic Shell once", () => {
    const dk = (casts: string[]) =>
      makeUnit("player-1", {
        class: CombatUnitClass.DeathKnight,
        spec: CombatUnitSpec.DeathKnight_Unholy,
        info: { talents: [], pvpTalents: [] } as any,
        spellCastEvents: casts.map((id, i) =>
          makeSpellCastEvent(id, T0 + 20_000 + i * 10_000, "player-1"),
        ),
      });
    const withOther = ledger(dk(["410358"])).filter(
      (c) => c.spellName === "Anti-Magic Shell",
    );
    expect(withOther.map((c) => c.spellId)).toEqual(["410358"]);
    const alone = ledger(dk([])).filter(
      (c) => c.spellName === "Anti-Magic Shell",
    );
    expect(alone.map((c) => c.spellId)).toEqual(["48707"]);
  });

  it("no talent node of the spec carries a baseline row's name under another id", () => {
    // the two-pass filter guards the catalog pass; rows added LATER (dynamic
    // discovery of talents, the healer save roster) are keyed by id, so a
    // same-name talent id would list the button twice. Today none exists —
    // this pins it.
    const trees = talentTrees as Array<{ specId: number; [k: string]: any }>;
    for (const [spec, ids] of Object.entries(BASELINE_DEFENSIVE_BY_SPEC)) {
      const tree = trees.find((t) => String(t.specId) === spec)!;
      const nameById = new Map<string, string>();
      for (const c of Object.values(classMetadata) as any[])
        for (const sp of c.abilities ?? [])
          nameById.set(String(sp.spellId), sp.name);
      const baselineNames = new Map(
        ids.map((id) => [nameById.get(id) ?? `?${id}`, id]),
      );
      for (const key of [
        "classNodes",
        "specNodes",
        "heroNodes",
        "subTreeNodes",
      ])
        for (const n of tree[key] ?? [])
          for (const e of n.entries ?? []) {
            const base = baselineNames.get(e.name);
            if (base === undefined) continue;
            expect(String(e.spellId), `${spec} ${e.name}`).toBe(base);
          }
    }
  });

  it("a baseline-only row is never the cheaper alternative (codex review: BM Hunter, Turtle pressed)", () => {
    const hunter = (casts: string[]) =>
      makeUnit("player-1", {
        class: CombatUnitClass.Hunter,
        spec: CombatUnitSpec.Hunter_BeastMastery,
        info: { talents: [], pvpTalents: [] } as any,
        spellCastEvents: casts.map((id, i) =>
          makeSpellCastEvent(id, T0 + 20_000 + i * 1_000, "player-1"),
        ),
      });
    const TURTLE = "186265";
    const EXHILARATION = "109304";
    const cheaperAt20 = (casts: string[]) => {
      const cds = ledger(hunter(casts));
      const turtle = cds.find((c) => c.spellId === TURTLE)!;
      return findCheaperDefensiveAlternatives(turtle, cds, 20);
    };
    // Exhilaration owned on the baseline only: not offered
    expect(cheaperAt20([TURTLE])).not.toContain("Exhilaration");
    // shown this round (pressed later): it is a real alternative again
    expect(
      ledger(hunter([TURTLE, EXHILARATION])).find(
        (c) => c.spellId === EXHILARATION,
      )?.baselineOnly,
    ).toBeUndefined();
  });

  it("flags a row owned on the baseline alone, never one with evidence", () => {
    const paladin = (casts: string[]) =>
      makeUnit("player-1", {
        class: CombatUnitClass.Paladin,
        spec: CombatUnitSpec.Paladin_Holy,
        info: { talents: [], pvpTalents: [] } as any,
        spellCastEvents: casts.map((id, i) =>
          makeSpellCastEvent(id, T0 + 20_000 + i * 10_000, "player-1"),
        ),
      });
    const DIVINE_SHIELD = "642";
    const unpressed = ledger(paladin([])).find(
      (c) => c.spellId === DIVINE_SHIELD,
    )!;
    expect(unpressed.baselineOnly).toBe(true);
    const pressed = ledger(paladin([DIVINE_SHIELD])).find(
      (c) => c.spellId === DIVINE_SHIELD,
    )!;
    expect(pressed.baselineOnly).toBeUndefined();
  });

  it("no unit lists two rows of the same name", () => {
    for (const [spec, ids] of Object.entries(BASELINE_DEFENSIVE_BY_SPEC)) {
      const tree = (talentTrees as any[]).find(
        (t) => String(t.specId) === spec,
      )!;
      const u = makeUnit("player-1", {
        class: tree.classId as CombatUnitClass,
        spec: spec as CombatUnitSpec,
        info: { talents: [], pvpTalents: [] } as any,
      });
      const names = ledger(u).map((c) => c.spellName);
      expect(new Set(names).size, `${spec}: ${names.join(", ")}`).toBe(
        names.length,
      );
      for (const id of ids)
        expect(
          ledger(u).some((c) => c.spellId === id),
          `${spec} ${id}`,
        ).toBe(true);
    }
  });
});
