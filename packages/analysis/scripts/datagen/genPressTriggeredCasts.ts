/**
 * Press id → the ids its own effect triggers as a second
 * `SPELL_CAST_SUCCESS` at the press's target (official data): every DB2
 * SpellEffect charge effect (Effect 96 CHARGE / 149 CHARGE_DEST) with an
 * EffectTriggerSpell — the impact — whose two ends are both observed ids
 * (observedSpellIdsGenerated), like channeledGenerated.
 *
 * GH #167.21: this was a hand copy of that query in `castMissRows.ts`
 * (`PRESS_TRIGGERED_CAST_IDS`); a hand pick had already missed The Hunt's
 * 370965 once (codex 20-F20-33). The rule alone reproduces the copied table
 * on 12.1.5.70391 / 70575 / 70783: 5 edges, 0 added, 0 removed.
 *
 * Why the rule is the effect type and not "any trigger edge": of the 437
 * SpellEffect trigger edges between observed ids (12.1.5.70575), read
 * against the 605 files' casts, the charge edges are the ones whose
 * triggered id is the press's impact; the other followed edges are effect
 * 64 / 6 procs and ticks (Mutilate's off-hand, Throw Glaive's bounce, Odyn's
 * Fury's hits, Divine Hymn) — see `castMissRows.ts`.
 */
import fs from "fs-extra";

import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  fetchTable,
  parseCsv,
  resolveBuild,
} from "./lib/wagoCsv";

/** SpellEffect.Effect: CHARGE, CHARGE_DEST. */
export const CHARGE_EFFECTS: ReadonlySet<string> = new Set(["96", "149"]);

/** The press → triggered-impact edges of a SpellEffect table, restricted to
 * the observed universe; keys and each key's ids ascend numerically. */
export function pressTriggeredEdges(
  rows: readonly Record<string, string>[],
  observed: ReadonlySet<string>,
): [string, string[]][] {
  const edges = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!CHARGE_EFFECTS.has(row.Effect)) continue;
    const trigger = row.EffectTriggerSpell;
    if (!row.SpellID || !trigger || trigger === "0") continue;
    if (!observed.has(row.SpellID) || !observed.has(trigger)) continue;
    let to = edges.get(row.SpellID);
    if (!to) edges.set(row.SpellID, (to = new Set()));
    to.add(trigger);
  }
  const num = (a: string, b: string) => Number(a) - Number(b);
  return [...edges.keys()]
    .sort(num)
    .map((k) => [k, [...edges.get(k)!].sort(num)]);
}

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
  const parsed = parseCsv(await fetchTable("SpellEffect", build, cacheDir));
  assertColumns(
    parsed.header,
    ["SpellID", "Effect", "EffectTriggerSpell"],
    "SpellEffect",
  );
  const edges = pressTriggeredEdges(parsed.rows, observed);
  const outPath = new URL(
    "../../src/data/pressTriggeredCastsGenerated.ts",
    import.meta.url,
  ).pathname;
  const header = `/**\n * Generated at: ${new Date().toISOString()}\n * Build: ${build}\n * Source: SpellEffect Effect 96 (CHARGE) / 149 (CHARGE_DEST) with an\n *   EffectTriggerSpell, both ends in the observed universe\n * edges: ${edges.length}\n */\n\n`;
  const body = edges
    .map(([k, v]) => `    [${JSON.stringify(k)}, ${JSON.stringify(v)}],\n`)
    .join("");
  writeArtifact(
    outPath,
    header +
      `export const PRESS_TRIGGERED_CAST_IDS: ReadonlyMap<string, readonly string[]> =\n  new Map([\n${body}  ]);\n`,
  );
  console.log(
    `pressTriggeredCastsGenerated.ts: ${edges.length} press → impact edges (build ${build})`,
  );
}

if (process.argv[1]?.endsWith("genPressTriggeredCasts.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
