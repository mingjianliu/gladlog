/**
 * Auras that obscure their carrier from enemy targeting (official data): DB2
 * SpellEffect aura 322 (MOD_INTERFERE_TARGETTING) on the spell itself,
 * restricted to the observed universe. A unit standing in a Smoke Bomb
 * (212183) and a burrowed Earthen Shaman (Burrow 409293, effect #0) both
 * carry one; the client then refuses a cast at them with
 * SPELL_FAILED_VISION_OBSCURED ("Your vision of the target is obscured").
 *
 * The Smoke Bomb aura itself is never logged (212183: zero corpus
 * occurrences); what the log shows is the cast that drops the area (Smoke
 * Bomb 212182 / 359053: SpellEffect 179 CREATE_AREATRIGGER, area 6951). So a
 * second set: observed spells with a CREATE_AREATRIGGER effect whose
 * SpellName is the name of an aura-322 spell (the same-name link
 * `castEffectNominations` uses). The area lasts the cast's own duration.
 *
 * Pipeline T108 (fact13 D24, ec49887a r0 1:12): every vision-obscured refusal
 * was blamed on a Smoke Bomb from a fixed wording, while the match had no
 * Rogue and the refusals sat inside an enemy's Burrow. `[REJECTED]` and the
 * other refusal readers name the aura of this set that was up instead.
 *
 * A third artifact, `refusedSpellAimGenerated.ts`: whether a refused spell
 * can aim at an enemy at all — an aura on an enemy obscures only a press
 * aimed at one (codex 85-tk-N-T108-1b / 1c / 1d). Read off EVERY effect row
 * of the spell and one EffectTriggerSpell hop, dummy rows included (Strike of
 * the Windlord 392983 / Fists of Fury 113656 aim through an Effect 3 row at
 * ImplicitTarget 6, a row genAbilityEffects' `considered` drops):
 *   - aims at an enemy: a target in ENEMY_IMPLICIT_TARGETS;
 *   - friend only: none of those, at least one in ALLY_IMPLICIT_TARGETS, and
 *     nothing but those, the caster (1) and none (0);
 *   - neither (absent): any other target — 25 UNIT_TARGET_ANY (Holy Shock
 *     20473, Penance 47540), a destination (Chi Burst 123986, 18), a chain
 *     (Chain Heal 1064, 45) — or no row: the targeting is not known.
 * Universe: the observed ids ∪ the class catalogue.
 */
import fs from "fs-extra";

import { classMetadata } from "../../src/data/classSpells";
import { ALLY_IMPLICIT_TARGETS } from "./lib/allyTargets";
import { writeArtifact } from "./lib/emit";
import { ENEMY_IMPLICIT_TARGETS } from "./lib/enemyTargets";
import {
  assertColumns,
  fetchTable,
  parseCsv,
  resolveBuild,
} from "./lib/wagoCsv";

/** SpellAuraDefines: SPELL_AURA_MOD_INTERFERE_TARGETTING. */
export const INTERFERE_TARGETING_AURA = "322";
/** SpellEffect.Effect 179: SPELL_EFFECT_CREATE_AREATRIGGER. */
export const CREATE_AREATRIGGER_EFFECT = "179";

async function main() {
  const build = await resolveBuild(process.argv[2]);
  const cacheDir = process.env.DATAGEN_CACHE ?? undefined;
  const observed = new Set(
    (
      JSON.parse(
        fs.readFileSync(
          new URL(
            "../../src/data/observedSpellIdsGenerated.json",
            import.meta.url,
          ).pathname,
          "utf8",
        ),
      ) as number[]
    ).map(String),
  );
  const eff = parseCsv(await fetchTable("SpellEffect", build, cacheDir));
  assertColumns(
    eff.header,
    [
      "SpellID",
      "DifficultyID",
      "EffectAura",
      "Effect",
      "EffectTriggerSpell",
      "ImplicitTarget_0",
      "ImplicitTarget_1",
    ],
    "SpellEffect",
  );
  const names = parseCsv(await fetchTable("SpellName", build, cacheDir));
  assertColumns(names.header, ["ID", "Name_lang"], "SpellName");
  const nameOf = new Map(names.rows.map((r) => [r.ID, r.Name_lang]));
  const ids = new Set<string>();
  const auraNames = new Set<string>();
  const areaCasters = new Set<string>();
  for (const r of eff.rows) {
    if (r.DifficultyID !== "0" || !r.SpellID) continue;
    if (r.EffectAura === INTERFERE_TARGETING_AURA) {
      const n = nameOf.get(r.SpellID);
      if (n) auraNames.add(n);
      if (observed.has(r.SpellID)) ids.add(r.SpellID);
    }
    if (r.Effect === CREATE_AREATRIGGER_EFFECT && observed.has(r.SpellID))
      areaCasters.add(r.SpellID);
  }
  const byNumber = (a: string, b: string) => Number(a) - Number(b);
  const sorted = [...ids].sort(byNumber);
  const areaCasts = [...areaCasters]
    .filter((id) => auraNames.has(nameOf.get(id) ?? ""))
    .sort(byNumber);
  const outPath = new URL(
    "../../src/data/visionObscuringAuraGenerated.ts",
    import.meta.url,
  ).pathname;
  const header = `/**\n * Generated at: ${new Date().toISOString()}\n * Build: ${build}\n * Source: SpellEffect aura 322 (MOD_INTERFERE_TARGETTING) on the spell itself; restricted to the\n *   observed universe; area casts: SpellEffect 179 (CREATE_AREATRIGGER) on an observed spell named like\n *   an aura-322 spell\n * ids: ${sorted.length}; area casts: ${areaCasts.length}\n */\n\n`;
  // the English name rides along: the refusal wordings are module-level
  // word lists the gates read, built before the spell-name table loads
  const named = (ids: string[]) =>
    `{\n${ids.map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(nameOf.get(id) ?? "")},\n`).join("")}}`;
  writeArtifact(
    outPath,
    header +
      `/** aura id → English name */\nexport const VISION_OBSCURING_AURAS: Readonly<Record<string, string>> = ${named(sorted)};\n\n` +
      `/** area cast id → English name */\nexport const VISION_OBSCURING_AREA_CASTS: Readonly<Record<string, string>> = ${named(areaCasts)};\n`,
  );
  console.log(
    `visionObscuringAuraGenerated.ts: ${sorted.length} auras, ${areaCasts.length} area casts (build ${build})`,
  );

  // the refused-spell aim table (see the header)
  const targetsOf = new Map<string, { targets: string[]; trigger: string }[]>();
  for (const r of eff.rows) {
    if (r.DifficultyID !== "0" || !r.SpellID) continue;
    const list = targetsOf.get(r.SpellID) ?? [];
    list.push({
      targets: [r.ImplicitTarget_0 ?? "0", r.ImplicitTarget_1 ?? "0"],
      trigger: r.EffectTriggerSpell ?? "0",
    });
    targetsOf.set(r.SpellID, list);
  }
  const targetSet = (id: string, hop: boolean): Set<string> => {
    const out = new Set<string>();
    for (const row of targetsOf.get(id) ?? []) {
      for (const t of row.targets) out.add(t || "0");
      if (hop && row.trigger && row.trigger !== "0")
        for (const t of targetSet(row.trigger, false)) out.add(t);
    }
    return out;
  };
  const SELF_OR_NONE = new Set(["1", "0"]);
  const aimUniverse = new Set<string>([
    ...observed,
    ...classMetadata.flatMap((c) => c.abilities.map((a) => a.spellId)),
  ]);
  const atEnemy: string[] = [];
  const friendOnly: string[] = [];
  for (const id of aimUniverse) {
    if (!targetsOf.has(id)) continue;
    const t = [...targetSet(id, true)];
    if (t.some((x) => ENEMY_IMPLICIT_TARGETS.has(x))) atEnemy.push(id);
    else if (
      t.some((x) => ALLY_IMPLICIT_TARGETS.has(x)) &&
      t.every((x) => ALLY_IMPLICIT_TARGETS.has(x) || SELF_OR_NONE.has(x))
    )
      friendOnly.push(id);
  }
  // [id, expected, why] — asserted before writing (true = at an enemy,
  // false = friend only, null = not known)
  const AIM_CONTROLS: Array<[string, boolean | null, string]> = [
    ["44425", true, "Arcane Barrage — enemy (6)"],
    [
      "392983",
      true,
      "Strike of the Windlord — enemy through a dummy row (codex 1d)",
    ],
    ["113656", true, "Fists of Fury — enemy through a dummy row (codex 1d)"],
    ["118", true, "Polymorph — enemy (6)"],
    ["2061", false, "Flash Heal — ally (21)"],
    ["19750", false, "Flash of Light — ally (21)"],
    ["33206", false, "Pain Suppression — ally"],
    ["20473", null, "Holy Shock — any (25)"],
    ["47540", null, "Penance — any (25)"],
    ["123986", null, "Chi Burst — a destination (18)"],
  ];
  const aimOf = (id: string): boolean | null =>
    atEnemy.includes(id) ? true : friendOnly.includes(id) ? false : null;
  const bad = AIM_CONTROLS.filter(([id, want]) => aimOf(id) !== want);
  if (bad.length > 0)
    throw new Error(
      `refused-spell aim controls failed: ${bad.map(([id, want, why]) => `${id} want ${want} got ${aimOf(id)} (${why})`).join("; ")}`,
    );
  const aimPath = new URL(
    "../../src/data/refusedSpellAimGenerated.ts",
    import.meta.url,
  ).pathname;
  const csv = (ids: string[]) =>
    JSON.stringify([...ids].sort(byNumber).join(","));
  writeArtifact(
    aimPath,
    `/**\n * Generated at: ${new Date().toISOString()}\n * Build: ${build}\n * Source: SpellEffect ImplicitTarget_0/_1 on every row (dummy rows included) and one\n *   EffectTriggerSpell hop; universe = observed ∪ class catalogue. See\n *   scripts/datagen/genVisionObscuringAuras.ts for the rule and its controls.\n * at an enemy: ${atEnemy.length}; friend only: ${friendOnly.length}; any other id: not known\n */\n\n` +
      `const ids = (s: string): ReadonlySet<string> => new Set(s.split(","));\n\n` +
      `/** a refused spell of these can aim at an enemy */\nexport const REFUSED_SPELL_AIMS_AT_ENEMY: ReadonlySet<string> = ids(\n  ${csv(atEnemy)},\n);\n\n` +
      `/** …and these only ever at a friend (or the caster) */\nexport const REFUSED_SPELL_AIMS_AT_FRIEND_ONLY: ReadonlySet<string> = ids(\n  ${csv(friendOnly)},\n);\n`,
  );
  console.log(
    `refusedSpellAimGenerated.ts: ${atEnemy.length} at an enemy, ${friendOnly.length} friend only (build ${build})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
