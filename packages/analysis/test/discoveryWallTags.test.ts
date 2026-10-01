/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Triage 2026-09-29 menu-coverage F-MC1: the dynamic-discovery name rule had
 * Darkness 196718 under Offensive, so the ledger carried a 40 % group wall as
 * throughput — cd-waste could never say "never used" and the cd-hoarded
 * spendable-defensive set never saw it. The repo's own tables call it a wall
 * (`MITIGATION_TABLE`, `TEAM_SAVE_CD_IDS`).
 *
 * The pin: nothing those two tables call a wall may come out of the ledger
 * tagged Offensive — neither from the name rule (ids the hand catalog does
 * not list) nor from the catalog itself.
 *
 * Darkness node / entry ids from talentIdMap.json (Demon Hunter class tree):
 * classNodes 91002 / entry 112921.
 */
import { CombatUnitClass, CombatUnitSpec } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { classMetadata } from "../src/data/classSpells";
import { DISCOVERY_TAG_RULES } from "../src/data/discoveryRules";
import { ensureAnalysisData } from "../src/data/ensure";
import { MITIGATION_TABLE } from "../src/data/mitigationData";
import { spellEffectData } from "../src/data/spellEffectData";
import { SpellTag } from "../src/data/spellTypes";
import {
  extractMajorCooldowns,
  TEAM_SAVE_CD_IDS,
} from "../src/utils/cooldowns";
import { makeUnit } from "./ported/testHelpers";

const T0 = 1_700_000_000_000;
const DARKNESS = "196718";
const DARKNESS_NODE = { id1: 91002, id2: 112921, count: 1 };

/** Catalog-tagged Offensive buttons that also carry a mitigation row. Each is
 * a damage cooldown whose row is a side effect, not a wall: the tag is right.
 *  - 107574 Avatar: generated row, 3 % (a rider on the damage cooldown). */
const OFFENSIVE_WITH_A_MITIGATION_ROW = new Set(["107574"]);

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("walls never ledger as Offensive (F-MC1)", () => {
  const wallIds = () =>
    [
      ...new Set([...TEAM_SAVE_CD_IDS, ...Object.keys(MITIGATION_TABLE)]),
    ].sort();
  const catalogTags = () => {
    const m = new Map<string, SpellTag[]>();
    for (const c of classMetadata)
      for (const a of c.abilities) m.set(a.spellId, a.tags);
    return m;
  };

  it("the tables are loaded (guards against a vacuous pass)", () => {
    expect(wallIds().length).toBeGreaterThan(40);
    expect(wallIds()).toContain(DARKNESS);
  });

  it("name rule: no wall id outside the hand catalog discovers as Offensive", () => {
    const catalog = catalogTags();
    const offenders: string[] = [];
    for (const id of wallIds()) {
      if (catalog.has(id)) continue;
      const name = spellEffectData[id]?.name?.toLowerCase();
      if (!name) continue;
      const tags = DISCOVERY_TAG_RULES.filter((r) =>
        r.pattern.test(name),
      ).flatMap((r) => r.tags);
      if (tags.includes(SpellTag.Offensive)) offenders.push(`${id} ${name}`);
    }
    expect(offenders).toEqual([]);
  });

  it("catalog: a wall id tagged Offensive is a listed exception, nothing else", () => {
    const offenders = wallIds().filter((id) =>
      catalogTags().get(id)?.includes(SpellTag.Offensive),
    );
    expect(offenders).toEqual([...OFFENSIVE_WITH_A_MITIGATION_ROW]);
  });

  it("Darkness by name → Defensive, not Offensive", () => {
    const tags = DISCOVERY_TAG_RULES.filter((r) =>
      r.pattern.test("darkness"),
    ).flatMap((r) => r.tags);
    expect(tags).toEqual([SpellTag.Defensive]);
  });

  it("extractMajorCooldowns: a Havoc DH with Darkness talented ledgers it as a Defensive", () => {
    const owner = makeUnit("player-1", {
      class: CombatUnitClass.DemonHunter,
      spec: CombatUnitSpec.DemonHunter_Havoc,
      info: { talents: [DARKNESS_NODE], pvpTalents: [] } as any,
    });
    const combat = {
      startTime: T0,
      endTime: T0 + 300_000,
      units: { "player-1": owner },
    } as unknown as import("@gladlog/parser-compat").AtomicArenaCombat;
    const cd = extractMajorCooldowns(owner, combat).find(
      (c) => c.spellId === DARKNESS,
    );
    expect(cd).toBeDefined();
    expect(cd!.tag).toBe(SpellTag.Defensive);
    expect(cd!.neverUsed).toBe(true);
  });
});
