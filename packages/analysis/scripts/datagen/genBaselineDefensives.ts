/**
 * Which catalog defensives a spec owns WITHOUT a talent, from OFFICIAL data
 * (triage 2026-09-29 cd-hoarded F-W6, user ruling 2026-09-30 C4: "restore
 * baseline defensives through a per-spec baseline-ability table").
 *
 * `extractMajorCooldowns` keeps an ability that is in no talent tree of the
 * spec only on a PvP-talent pick or a cast in THIS round, so a round where a
 * Paladin never pressed Divine Shield lost it from the ledger, `[UNUSED]`,
 * [RES] `rdy` and cd-hoarded's ready set (06bb9860 round 5, after casting it
 * in rounds 1–4).
 *
 * A row (spec, spell) is nominated when ALL of these hold:
 *   catalog   the spell is tagged Defensive in data/classSpells.ts for the
 *             spec's class, with an effective cooldown ≥ MIN_CD_SECONDS
 *   no tree   it is in no node of the spec's talent trees (talentIdMap.json)
 *             — a tree spell is owned by taking the node, never by spec
 *   DB2       SpecializationSpells lists it for the spec, OR SkillLineAbility
 *             has it on the class's skill line with AcquireMethod ≠ 3
 *             (3 marks talent-granted rows: Lay on Hands 633, Blessing of
 *             Protection 1022 — those are NOT baseline)
 * The class skill line is the most frequent SkillLine among the class's
 * catalog ids (no hand-typed line numbers). It is a thin vote — one catalog
 * id decides it for six classes, and Warrior / Priest / Shaman / Evoker have
 * no catalog id on any line, so this leg nominates nothing for them. The
 * row's own `ClassMask` cannot replace it: it is 0 on Barkskin's and the
 * Hunter buttons' class-line rows (Feign Death, Exhilaration, Aspect of the
 * Turtle), though Divine Shield (2), Anti-Magic Shell 48707 (32) and
 * Unending Resolve (256) carry their class bit (build 12.1.0.69587: a
 * ClassMask leg keeps 16 of the 29 rows and loses Barkskin and the nine
 * Hunter rows). The line → class link lives in
 * SkillRaceClassInfo, which this generator does not read; the guard against
 * a flipped vote is test/baselineDefensives.test.ts, which pins the row
 * count and the nomination legs it can re-derive.
 *
 * Not covered by this rule (ownership DB2 does not prove this way; none is
 * guessed in): Lay on Hands 471195, Fortifying Brew 115203, Blessing of
 * Spellwarding 204018, Anti-Magic Shell 410358.
 *
 * `enemyTargetDefensives` (codex review of F-W6, round 6): every catalog
 * defensive whose real DB2 SpellEffect rows (DifficultyID 0; dummy rows only
 * when the spell has nothing else — genSpellTargeting's rule) carry
 * ImplicitTarget 6, UNIT_TARGET_ENEMY: it cannot be pressed without an enemy
 * in range (Touch of Karma). Asserted both ways before writing: Karma must be
 * in, the self-cast defensives with a range (Exhilaration, Survival of the
 * Fittest, Metamorphosis, Obsidian Scales, Guardian of Ancient Kings) and the
 * personal walls must be out.
 *
 *   DATAGEN_BUILD=<build> DATAGEN_CACHE=~/.cache/gladlog-datagen \
 *     npx tsx packages/analysis/scripts/datagen/genBaselineDefensives.ts
 */
import { classMetadata } from "../../src/data/classSpells";
import { ensureAnalysisData } from "../../src/data/ensure";
import { effectiveCooldownSeconds } from "../../src/data/spellEffectData";
import { SpellTag } from "../../src/data/spellTypes";
import talentTrees from "../../src/data/talentIdMap.json";
import { MIN_CD_SECONDS } from "../../src/utils/cooldowns";
import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  fetchTable,
  parseCsv,
  resolveBuild,
} from "./lib/wagoCsv";

/** DB2 SpellImplicitTarget 6, UNIT_TARGET_ENEMY (allyTargets.ts names it as
 *  Touch of Karma's and deliberately not friendly). */
const UNIT_TARGET_ENEMY = "6";
/** Ground truth for `enemyTargetDefensives`, both directions. */
const MUST_TARGET_ENEMY = ["122470"]; // Touch of Karma
const MUST_NOT_TARGET_ENEMY = [
  "109304", // Exhilaration (45 yd range, self heal)
  "264735", // Survival of the Fittest
  "187827", // Metamorphosis
  "363916", // Obsidian Scales
  "86659", // Guardian of Ancient Kings
  "642", // Divine Shield
  "45438", // Ice Block
  "198589", // Blur
];

type Tree = {
  classId: number;
  specId: number;
  classNodes?: Array<{ entries?: Array<{ spellId?: number }> }>;
  specNodes?: Array<{ entries?: Array<{ spellId?: number }> }>;
  heroNodes?: Array<{ entries?: Array<{ spellId?: number }> }>;
  subTreeNodes?: Array<{ entries?: Array<{ spellId?: number }> }>;
};

async function main() {
  await ensureAnalysisData();
  const build = await resolveBuild(process.argv[2]);
  const cacheDir = process.env.DATAGEN_CACHE ?? undefined;
  const sla = parseCsv(await fetchTable("SkillLineAbility", build, cacheDir));
  const ss = parseCsv(
    await fetchTable("SpecializationSpells", build, cacheDir),
  );
  assertColumns(
    sla.header,
    ["Spell", "SkillLine", "AcquireMethod"],
    "SkillLineAbility",
  );
  assertColumns(ss.header, ["SpecID", "SpellID"], "SpecializationSpells");
  const se = parseCsv(await fetchTable("SpellEffect", build, cacheDir));
  assertColumns(
    se.header,
    [
      "SpellID",
      "DifficultyID",
      "Effect",
      "ImplicitTarget_0",
      "ImplicitTarget_1",
    ],
    "SpellEffect",
  );

  const slaBySpell = new Map<
    string,
    Array<{ line: string; acquire: string }>
  >();
  for (const r of sla.rows as unknown as Array<Record<string, string>>) {
    const id = String(r["Spell"]);
    if (!slaBySpell.has(id)) slaBySpell.set(id, []);
    slaBySpell.get(id)!.push({
      line: String(r["SkillLine"]),
      acquire: String(r["AcquireMethod"]),
    });
  }
  const specsBySpell = new Map<string, Set<string>>();
  for (const r of ss.rows as unknown as Array<Record<string, string>>) {
    const id = String(r["SpellID"]);
    if (!specsBySpell.has(id)) specsBySpell.set(id, new Set());
    specsBySpell.get(id)!.add(String(r["SpecID"]));
  }

  const bySpec: Record<
    string,
    Array<{
      id: string;
      name: string;
      source: "SpecializationSpells" | "SkillLineAbility";
    }>
  > = {};
  for (const cls of classMetadata) {
    // the class's own skill line: the most frequent line among its catalog ids
    const lineVotes = new Map<string, number>();
    for (const a of cls.abilities)
      for (const row of slaBySpell.get(a.spellId) ?? [])
        lineVotes.set(row.line, (lineVotes.get(row.line) ?? 0) + 1);
    const classLine = [...lineVotes.entries()].sort(
      (x, y) => y[1] - x[1],
    )[0]?.[0];
    const trees = (talentTrees as Tree[]).filter(
      (t) => t.classId === Number(cls.unitClass),
    );
    for (const tree of trees) {
      const inTree = new Set<string>();
      for (const key of [
        "classNodes",
        "specNodes",
        "heroNodes",
        "subTreeNodes",
      ] as const)
        for (const node of tree[key] ?? [])
          for (const e of node.entries ?? [])
            if (e.spellId) inTree.add(String(e.spellId));
      const spec = String(tree.specId);
      const seen = new Set<string>();
      for (const a of cls.abilities) {
        if (seen.has(a.spellId)) continue;
        if (!a.tags.includes(SpellTag.Defensive)) continue;
        if ((effectiveCooldownSeconds(a.spellId) ?? 0) < MIN_CD_SECONDS)
          continue;
        if (inTree.has(a.spellId)) continue;
        const bySpecTable = specsBySpell.get(a.spellId)?.has(spec) ?? false;
        const byClassLine = (slaBySpell.get(a.spellId) ?? []).some(
          (r) => r.line === classLine && r.acquire !== "3",
        );
        if (!bySpecTable && !byClassLine) continue;
        seen.add(a.spellId);
        (bySpec[spec] ??= []).push({
          id: a.spellId,
          name: a.name,
          source: bySpecTable ? "SpecializationSpells" : "SkillLineAbility",
        });
      }
    }
  }

  // enemy-targeted defensives: UNIT_TARGET_ENEMY on a considered effect row
  const catalogDefensives = new Map<string, string>();
  for (const cls of classMetadata)
    for (const a of cls.abilities)
      if (a.tags.includes(SpellTag.Defensive))
        catalogDefensives.set(a.spellId, a.name);
  const effectRows = new Map<
    string,
    Array<{ effect: string; targets: string[] }>
  >();
  for (const r of se.rows as unknown as Array<Record<string, string>>) {
    const id = String(r["SpellID"]);
    if (String(r["DifficultyID"]) !== "0" || !catalogDefensives.has(id))
      continue;
    if (!effectRows.has(id)) effectRows.set(id, []);
    effectRows.get(id)!.push({
      effect: String(r["Effect"]),
      targets: [r["ImplicitTarget_0"], r["ImplicitTarget_1"]].map(String),
    });
  }
  const enemyTargetDefensives: Array<{ id: string; name: string }> = [];
  for (const [id, name] of [...catalogDefensives].sort(
    (x, y) => Number(x[0]) - Number(y[0]),
  )) {
    const rows = effectRows.get(id) ?? [];
    const real = rows.filter((r) => r.effect !== "3");
    const considered = real.length > 0 ? real : rows;
    if (considered.some((r) => r.targets.includes(UNIT_TARGET_ENEMY)))
      enemyTargetDefensives.push({ id, name });
  }
  const enemyIds = new Set(enemyTargetDefensives.map((r) => r.id));
  const missing = MUST_TARGET_ENEMY.filter((id) => !enemyIds.has(id));
  const wrong = MUST_NOT_TARGET_ENEMY.filter((id) => enemyIds.has(id));
  if (missing.length > 0 || wrong.length > 0)
    throw new Error(
      `genBaselineDefensives: enemy-target check failed — missing [${missing.join(", ")}], ` +
        `wrongly marked [${wrong.join(", ")}]`,
    );

  const outPath = new URL(
    "../../src/data/baselineDefensivesGenerated.json",
    import.meta.url,
  ).pathname;
  writeArtifact(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        build,
        bySpec,
        enemyTargetDefensives,
      },
      null,
      2,
    ) + "\n",
  );
  const rows = Object.values(bySpec).reduce((n, v) => n + v.length, 0);
  console.log(`${Object.keys(bySpec).length} specs, ${rows} rows`);
  console.log(
    `enemy-targeted defensives: ${enemyTargetDefensives.map((r) => `${r.id} ${r.name}`).join(", ")}`,
  );
  for (const [spec, v] of Object.entries(bySpec).sort(
    (x, y) => Number(x[0]) - Number(y[0]),
  ))
    console.log(
      `${spec} ${v.map((r) => `${r.id} ${r.name} (${r.source})`).join(", ")}`,
    );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
