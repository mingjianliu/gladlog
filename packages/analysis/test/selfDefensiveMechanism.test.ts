/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * User ruling 2026-10-11: an enemy's own non-wall defensive is labelled by
 * what it DOES — `(absorb Nk, Ts)`, `(heal)`, `(dodge)`, `(spell reflect)` … —
 * where its `[ENEMY DEF]` line used to print `(self-save)`, a purpose the log
 * does not show. One function gives the label (`selfDefensiveMechanism`),
 * official data first.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { emitEnemyDefEntries } from "../src/context/timelineSections/enemyDef";
import { abilityProfile } from "../src/data/abilityProfile";
import { effectAurasOfCast } from "../src/data/castEffectAuras";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  MITIGATION_TABLE,
  SELF_WALL_AURA_TO_CAST_ID,
} from "../src/data/mitigationData";
import observed from "../src/data/observedSpellIdsGenerated.json";
import { getEnglishSpellName } from "../src/data/spellEffectData";
import {
  ENEMY_IMMUNITY_SAVE_AURAS,
  ENEMY_SELF_DEFENSIVE_HAND_MECHANISMS,
} from "../src/data/spellIdLists";
import { immunityMechanics } from "../src/data/spellSchools";
import talentEffectInventory from "../src/data/talentEffectInventoryGenerated.json";
import {
  ENEMY_SAVE_EFFECT_BY_NAME,
  SELF_SAVE_IDS,
  selfSaveMechanismOfName,
} from "../src/utils/enemyDefensives";
import {
  SELF_SAVE_PURPOSE_LABEL,
  selfDefensiveLabelLegends,
  selfDefensiveLabelWords,
  selfDefensiveMechanism,
  statesSelfDefensiveLabel,
} from "../src/utils/selfDefensiveMechanism";

const OBSERVED = new Set((observed as number[]).map(String));
const family = (): string[] =>
  [...SELF_SAVE_IDS].sort((a, b) => Number(a) - Number(b));
const wordsOf = (id: string): string | undefined => {
  const m = selfDefensiveMechanism(id);
  return m && selfDefensiveLabelWords(m);
};
/** DB2 `SpellEffect` rows of a spell, as the generated inventory holds them. */
const db2 = (spellId: string) =>
  (
    talentEffectInventory as unknown as {
      rows: Array<{
        spellId: string;
        effect: number;
        aura: number;
        basePoints: number;
        pvpMultiplier: number;
      }>;
    }
  ).rows.filter((r) => r.spellId === spellId);

describe("selfDefensiveMechanism — what a self defensive does, official data first", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("every live member of the self-save family has a mechanism — a new id cannot print without a label", () => {
    const none = family().filter((id) => !selfDefensiveMechanism(id));
    // Renewing Blaze's cast id is never logged (a proc of Obsidian Scales —
    // `AURA_ONLY_ACTIVATION_IDS`), so no press of it can reach a line
    expect(none).toEqual(["374348"]);
    for (const id of none) expect(OBSERVED.has(id), id).toBe(false);
    for (const id of family().filter((i) => OBSERVED.has(i)))
      expect(selfDefensiveMechanism(id), id).toBeDefined();
  });

  it("the whole family, by id — the label words and where they come from", () => {
    expect(Object.fromEntries(family().map((id) => [id, wordsOf(id)]))).toEqual(
      {
        // abilityProfile.healsOthers (cast on oneself) — DB2 Effect 136
        "633": "heal", // Lay on Hands, the pre-12.x id
        "471195": "heal", // Lay on Hands
        "28880": "heal", // Gift of the Naaru (five class ids, DB2 aura 8)
        "59542": "heal",
        "59544": "heal",
        "59545": "heal",
        "59547": "heal",
        // abilityProfile.healsSelf — DB2 Effect 136 / aura 20
        "6262": "heal", // Healthstone
        "452930": "heal", // Demonic Healthstone
        "19236": "heal", // Desperate Prayer
        "22842": "heal", // Frenzied Regeneration
        "109304": "heal", // Exhilaration
        "185311": "heal", // Crimson Vial
        // … and HEAL_ABSORB_SELF_SAVE_IDS (DB2 aura 301)
        "48743": "heal + heal absorb", // Death Pact
        // abilityProfile.absorbs — DB2 aura 69
        "11426": "absorb", // Ice Barrier
        "48707": "absorb", // Anti-Magic Shell, the self-only id
        "410358": "absorb", // Anti-Magic Shell
        "108416": "absorb", // Dark Pact
        "116849": "absorb", // Life Cocoon
        "122470": "absorb", // Touch of Karma
        "421453": "absorb", // Ultimate Penitence
        "6940": "absorb", // Blessing of Sacrifice (never cast on oneself)
        "199448": "absorb", // Blessing of Sacrifice, Ultimate Sacrifice's id
        // abilityProfile.healingReceivedPct — DB2 aura 118
        "47788": "+60% healing received", // Guardian Spirit
        // immunityMechanics — DB2 aura 77, on the cast or its effect aura
        "49039": "charm / fear / sleep immunity", // Lichborne
        "58875": "root / snare immunity", // Spirit Walk
        "272682": "root / snare immunity", // Master's Call → 54216 / 62305
        "1241871": "root / snare immunity", // Master's Call → 1224810
        // abilityProfile.moveSpeedPct — DB2 aura 31 (never cast on oneself)
        "374227": "+30% movement speed", // Zephyr
        // talentMitigationGenerated, the reduction on the cast's own aura
        "53480": "25%", // Roar of Sacrifice
        // ENEMY_SELF_DEFENSIVE_HAND_MECHANISMS
        "5277": "dodge", // Evasion
        "212295": "spell reflect", // Nether Ward
        "342245": "rewind", // Alter Time
        // the signed sets (rulings A20 + U3, A15) — never cast on oneself
        "3411": "redirect", // Intervene
        "73325": "redirect", // Leap of Faith
        "97462": "area", // Rallying Cry
        // no press is ever logged for it
        "374348": undefined, // Renewing Blaze
      },
    );
  });

  it("the official rows behind the derived labels (DB2, re-read)", () => {
    // Roar of Sacrifice: aura 87 on the target, −15 × PvpMultiplier 1.66666
    const roar = db2("53480").find((r) => r.aura === 87)!;
    expect(Math.round(roar.basePoints * roar.pvpMultiplier)).toBe(-25);
    expect(selfDefensiveMechanism("53480")).toEqual({
      kind: "reduction",
      pct: 25,
    });
    // Guardian Spirit: aura 118, 60 points
    expect(db2("47788").find((r) => r.aura === 118)?.basePoints).toBe(60);
    // Dark Pact / Ice Barrier / Ultimate Penitence / Touch of Karma: aura 69
    for (const id of ["108416", "11426", "421453", "122470"])
      expect(
        db2(id).some((r) => r.aura === 69),
        id,
      ).toBe(true);
    // Death Pact: a 50 % heal (Effect 136) and a heal absorb (aura 301)
    expect(db2("48743").map((r) => [r.effect, r.aura])).toEqual(
      expect.arrayContaining([
        [136, 0],
        [6, 301],
      ]),
    );
    // a freedom: root (7) and snare (11) — Spirit Walk on the cast, Master's
    // Call on the aura the log shows it applying
    expect(immunityMechanics("58875")).toEqual(expect.arrayContaining([7, 11]));
    for (const cast of ["272682", "1241871"]) {
      const auras = effectAurasOfCast(cast);
      expect(auras.length, cast).toBeGreaterThan(0);
      for (const a of auras)
        expect(immunityMechanics(a), `${cast} → ${a}`).toEqual([7, 11]);
    }
    // Lichborne: charm (1), fear (5), sleep (10)
    expect(immunityMechanics("49039")).toEqual(
      expect.arrayContaining([1, 5, 10]),
    );
  });

  it("the hand table: live ids, the DB2 row each entry quotes, and nothing the official path already classifies", () => {
    expect(ENEMY_SELF_DEFENSIVE_HAND_MECHANISMS).toEqual({
      "5277": "dodge",
      "212295": "spell reflect",
      "342245": "rewind",
    });
    for (const id of Object.keys(ENEMY_SELF_DEFENSIVE_HAND_MECHANISMS)) {
      expect(OBSERVED.has(id), id).toBe(true);
      expect(SELF_SAVE_IDS.has(id), id).toBe(true);
      const p = abilityProfile(id);
      expect(
        [
          p.mitigationPct,
          p.absorbs,
          p.healsSelf,
          p.healsOthers,
          p.healingReceivedPct,
          p.moveSpeedPct,
          immunityMechanics(id),
          effectAurasOfCast(id).flatMap((a) => immunityMechanics(a) ?? []),
        ],
        id,
      ).toEqual([
        undefined,
        false,
        false,
        false,
        undefined,
        undefined,
        undefined,
        [],
      ]);
    }
    // Evasion: aura 49 (MOD_DODGE_PERCENT), 200 points; its aura-87 rows are 0
    expect(db2("5277").find((r) => r.aura === 49)?.basePoints).toBe(200);
    expect(
      db2("5277")
        .filter((r) => r.aura === 87)
        .map((r) => r.basePoints),
    ).toEqual([0, 0]);
    // Nether Ward: aura 28 (REFLECT_SPELLS), 100 points, its only row
    expect(db2("212295").map((r) => [r.aura, r.basePoints])).toEqual([
      [28, 100],
    ]);
    // Alter Time: the image (Effect 28), the trigger of 342246 (Effect 64),
    // a dummy; 342246 is aura 332 (the button becomes the return, 342247)
    expect(db2("342245").map((r) => r.effect)).toEqual([28, 64, 3]);
    expect(db2("342246").map((r) => [r.aura, r.basePoints])).toEqual([
      [332, 342247],
    ]);
    // … the return's heal and the press's two auras are live too
    for (const id of ["342246", "342247", "1219545"])
      expect(OBSERVED.has(id), id).toBe(true);
  });

  it("one name, one label — and no family name is a wall's, an immunity's or an effect save's (the gate reads by name)", () => {
    const byName = new Map<string, string>();
    for (const id of family()) {
      const words = wordsOf(id);
      if (words === undefined) continue;
      const name = getEnglishSpellName(id, "");
      expect(name, id).not.toBe("");
      expect(byName.get(name) ?? words, `${id} ${name}`).toBe(words);
      byName.set(name, words);
      expect(
        selfDefensiveLabelWords(selfSaveMechanismOfName(name)!),
        name,
      ).toBe(words);
    }
    expect(selfSaveMechanismOfName("Barkskin")).toBeUndefined();
    const others = new Set([
      ...Object.keys(MITIGATION_TABLE).map((id) => getEnglishSpellName(id, "")),
      ...Object.keys(SELF_WALL_AURA_TO_CAST_ID).map((id) =>
        getEnglishSpellName(id, ""),
      ),
      ...Object.values(ENEMY_IMMUNITY_SAVE_AURAS),
      ...ENEMY_SAVE_EFFECT_BY_NAME.keys(),
    ]);
    expect([...byName.keys()].filter((n) => others.has(n))).toEqual([]);
    // no member is a table row: a wall renders from its aura, with talents
    expect(family().filter((id) => MITIGATION_TABLE[id])).toEqual([]);
  });

  it("statesSelfDefensiveLabel reads exactly what selfDefensiveLabelWords wrote — figures only where the kind carries them", () => {
    const mechanisms = family().flatMap(
      (id) => selfDefensiveMechanism(id) ?? [],
    );
    const labels = [...new Set(mechanisms.map(selfDefensiveLabelWords))];
    expect(labels.length).toBeGreaterThan(8);
    for (const m of mechanisms) {
      const own = selfDefensiveLabelWords(m);
      expect(statesSelfDefensiveLabel(`(${own}) (at 40% HP)`, m), own).toBe(
        true,
      );
      // another member's label is not this one's
      for (const other of labels)
        expect(
          statesSelfDefensiveLabel(`(${other})`, m),
          `${own} vs ${other}`,
        ).toBe(other === own);
      for (const wrong of [
        SELF_SAVE_PURPOSE_LABEL,
        "(immune, 8.0s)",
        "(at 40% HP)",
        "",
        `(${own} proc)`,
        `(${own}0)`,
      ])
        expect(statesSelfDefensiveLabel(wrong, m), `${own} / ${wrong}`).toBe(
          false,
        );
    }
    const absorb = { kind: "absorb" } as const;
    for (const ok of [
      "(absorb)",
      "(absorb 64k, 2.0s)",
      "(absorb <1k, 0.4s — removed early)",
      "(absorb, 2.0s — used up)",
      "(absorb 12k, end not logged)",
    ])
      expect(statesSelfDefensiveLabel(ok, absorb), ok).toBe(true);
    for (const bad of ["(absorb 64)", "(absorbs)", "(absorb 64k; 2.0s)"])
      expect(statesSelfDefensiveLabel(bad, absorb), bad).toBe(false);
    const roar = { kind: "reduction", pct: 25 } as const;
    for (const ok of ["(25%)", "(25%, 10.0s)", "(25%, 3.1s — removed early)"])
      expect(statesSelfDefensiveLabel(ok, roar), ok).toBe(true);
    for (const bad of ["(30%, 10.0s)", "(250%)", "(25% 10.0s)", "(heal)"])
      expect(statesSelfDefensiveLabel(bad, roar), bad).toBe(false);
    // a figure on a kind that carries none is not that label
    expect(
      statesSelfDefensiveLabel("(heal, 4.0s)", {
        kind: "heal",
        healAbsorb: false,
      }),
    ).toBe(false);
  });

  it("the legend explains each label form a line carries, and only those", () => {
    const line = (label: string) =>
      `0:42  [ENEMY DEF]   4(ARogue) (Assassination Rogue): X (${label}) (at 60% HP)`;
    for (const id of family()) {
      const m = selfDefensiveMechanism(id);
      if (!m) continue;
      const words = selfDefensiveLabelWords(m);
      const legends = selfDefensiveLabelLegends([line(words)]);
      // an absorb, a percentage and an area save are the legend's own lines
      expect(legends.length, words).toBe(
        m.kind === "absorb" || m.kind === "reduction" || m.kind === "area"
          ? 0
          : 1,
      );
    }
    expect(selfDefensiveLabelLegends([])).toEqual([]);
    expect(
      selfDefensiveLabelLegends([
        line("immune, 8.0s"),
        line("30%, 12.0s"),
        line("heal proc"),
      ]),
    ).toEqual([]);
    const two = selfDefensiveLabelLegends([line("dodge"), line("heal")]);
    expect(two).toHaveLength(2);
    expect(two[0]).toContain("`(heal)` = ");
    expect(two[1]).toContain("`(dodge)` = ");
    for (const l of two) expect(l).not.toMatch(/sav(?:e|ed|ing)\b/);
  });
});

// —— the rendered line ————————————————————————————————————————————————————

const MATCH_START = Date.UTC(2026, 9, 11);
const ms = (s: number): number => MATCH_START + Math.round(s * 1000);
const cast = (spellId: string, atS: number, destUnitId = "0"): any => ({
  spellId,
  spellName: `S${spellId}`,
  srcUnitId: "e1",
  srcUnitName: "e1",
  destUnitId,
  destUnitName: destUnitId,
  timestamp: ms(atS),
  logLine: {
    event: LogEvent.SPELL_CAST_SUCCESS,
    timestamp: ms(atS),
    parameters: [],
  },
});
const aura = (event: LogEvent, spellId: string, atS: number): any => ({
  spellId,
  spellName: `S${spellId}`,
  srcUnitId: "e1",
  srcUnitName: "e1",
  destUnitId: "e1",
  destUnitName: "e1",
  timestamp: ms(atS),
  logLine: { event, timestamp: ms(atS), parameters: [] },
  auraType: "BUFF",
});
const up = (id: string, fromS: number, toS: number) => [
  aura(LogEvent.SPELL_AURA_APPLIED, id, fromS),
  aura(LogEvent.SPELL_AURA_REMOVED, id, toS),
];
const absorbed = (spellId: string, atS: number, amount: number): any => ({
  spellId,
  spellName: `S${spellId}`,
  srcUnitId: "e1",
  srcUnitName: "e1",
  destUnitId: "e1",
  destUnitName: "e1",
  attackerId: "f1",
  absorbedAmount: amount,
  timestamp: ms(atS),
  logLine: {
    event: LogEvent.SPELL_ABSORBED,
    timestamp: ms(atS),
    parameters: [],
  },
});
function unit(id: string, over: Record<string, unknown> = {}): any {
  return {
    id,
    name: id,
    type: 1,
    spec: "253",
    reaction: 1,
    info: {},
    spellCastEvents: [],
    auraEvents: [],
    actionIn: [],
    absorbsIn: [],
    damageOut: [],
    damageIn: [],
    healIn: [],
    healOut: [],
    deathRecords: [],
    advancedActions: [],
    ...over,
  };
}
function render(enemy: any): string[] {
  const lines: string[] = [];
  emitEnemyDefEntries({
    matchStartMs: ms(0),
    matchEndSeconds: 300,
    enemies: [enemy],
    enemyPid: (n: string) => `E:${n}`,
    friends: [unit("f1")],
    roundBounds: undefined,
    pid: (n: string) => `F:${n}`,
    actorLabel: (n: string, side: "friendly" | "enemy") =>
      side === "friendly" ? `F:${n}` : `E:${n}`,
    addEntry: (_t: number, line: string) => lines.push(line),
    _allUnits: [enemy],
  } as never);
  return lines;
}
/** the line from the ability's name on */
const body = (line: string): string => line.slice(line.indexOf("): ") + 3);

describe("[ENEMY DEF] — a pressed self defensive prints what it does (2026-10-11)", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("a shield: what it absorbed and how long the caster's own aura was up, with the end the log gives", () => {
    const lock = unit("e1", {
      spellCastEvents: [cast("108416", 30), cast("11426", 80)],
      auraEvents: [...up("108416", 30, 50), ...up("11426", 80, 91.5)],
      absorbsIn: [absorbed("108416", 33, 120_400)],
    });
    expect(render(lock).map(body)).toEqual([
      "Dark Pact (absorb 120k, 20.0s)",
      // 60 s official: the log gives no cause for the early end
      "Ice Barrier (absorb, 11.5s — removed early)",
    ]);
  });

  it("a shield whose aura the log does not start at the press states the mechanism alone", () => {
    // a re-press while the first is still up logs no new APPLIED
    const mage = unit("e1", { spellCastEvents: [cast("11426", 80)] });
    expect(render(mage).map(body)).toEqual(["Ice Barrier (absorb)"]);
  });

  it("Touch of Karma: `(absorb)` alone — its 10 s buff is not the shield's length, and the amount is the clause's", () => {
    const monk = unit("e1", {
      spellCastEvents: [cast("122470", 60, "f1")],
      auraEvents: up("122470", 60, 70),
      absorbsIn: [absorbed("122470", 61, 80_000)],
    });
    const [line] = render(monk).map(body);
    expect(line.startsWith("Touch of Karma (absorb)")).toBe(true);
    expect(line).not.toMatch(/\(absorb[ ,]/);
  });

  it("a heal, a dodge, a reflect, a rewind, a control immunity — the mechanism, no figure, no duration", () => {
    const e = unit("e1", {
      spellCastEvents: [
        cast("185311", 10), // Crimson Vial
        cast("48743", 20), // Death Pact
        cast("5277", 30), // Evasion
        cast("212295", 40), // Nether Ward
        cast("342245", 50), // Alter Time
        cast("49039", 60), // Lichborne
        cast("58875", 70), // Spirit Walk
        cast("272682", 80, "e1"), // Master's Call on oneself
        cast("47788", 90, "e1"), // Guardian Spirit on oneself
        cast("471195", 100, "e1"), // Lay on Hands on oneself
      ],
      auraEvents: [...up("5277", 30, 40), ...up("212295", 40, 43)],
    });
    expect(render(e).map(body)).toEqual([
      "Crimson Vial (heal)",
      "Death Pact (heal + heal absorb)",
      "Evasion (dodge)",
      "Nether Ward (spell reflect)",
      "Alter Time (rewind)",
      "Lichborne (charm / fear / sleep immunity)",
      "Spirit Walk (root / snare immunity)",
      "Master's Call (root / snare immunity)",
      "Guardian Spirit (+60% healing received)",
      "Lay on Hands (heal)",
    ]);
  });

  it("Roar of Sacrifice on oneself: the official reduction and the aura's observed length", () => {
    // 141470d0: APPLIED and SUCCESS 00:55:27.786, REMOVED 00:55:37.791
    const hunter = unit("e1", {
      spellCastEvents: [cast("53480", 20, "e1")],
      auraEvents: up("53480", 20, 30.005),
    });
    expect(render(hunter).map(body)).toEqual([
      "Roar of Sacrifice (25%, 10.0s)",
    ]);
    const cut = unit("e1", {
      spellCastEvents: [cast("53480", 20, "e1")],
      auraEvents: up("53480", 20, 23.1),
    });
    expect(render(cut).map(body)).toEqual([
      "Roar of Sacrifice (25%, 3.1s — removed early)",
    ]);
    const bare = unit("e1", { spellCastEvents: [cast("53480", 20, "e1")] });
    expect(render(bare).map(body)).toEqual(["Roar of Sacrifice (25%)"]);
  });

  it("no line says `(self-save)` — not even a press no source classifies, which prints no label", () => {
    const e = unit("e1", {
      spellCastEvents: [
        ...family()
          .filter((id) => id !== "122470")
          .map((id, i) => cast(id, 10 + i * 5, "e1")),
      ],
    });
    const lines = render(e);
    expect(lines.length).toBeGreaterThan(20);
    for (const l of lines) expect(l).not.toContain("self-save");
    // Renewing Blaze's cast id (never logged; forced here): the bare name
    expect(lines.map(body).filter((b) => !b.includes("("))).toEqual([
      "Renewing Blaze",
    ]);
  });
});
