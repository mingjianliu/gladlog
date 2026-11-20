/**
 * Pressed aura → the dispel / steal spell ids its periodic trigger casts
 * (official data): every DB2 SpellEffect aura 23 (PERIODIC_TRIGGER_SPELL)
 * whose EffectTriggerSpell carries a dispel effect (Effect 38 DISPEL / 126
 * STEAL_BENEFICIAL_BUFF), both ends observed ids
 * (observedSpellIdsGenerated).
 *
 * Pipeline T215 (round-14 D31, ae1d0895 r0): Kleptomania 198100 channels for
 * 4 s and its aura fires Spellsteal 1231112 every 0.5 s; the log writes a
 * SPELL_STOLEN per tick and no cast row of 1231112, so `classifyDispel`'s
 * same-id / same-name cast match read every tick as a proc.
 *
 * Why the rule is aura 23 and not "any trigger edge": of the five
 * SpellEffect trigger edges into a dispelling spell with an observed end
 * (12.1.5.70391), Mass Dispel 32375 → 32592 is an instant effect 64 the
 * name match already closes, and the other three are passives' auras whose
 * parent is never cast. The periodic trigger is the one whose removals
 * arrive over the press's duration instead of at its instant.
 */
import fs from "fs-extra";

import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  fetchTable,
  parseCsv,
  resolveBuild,
} from "./lib/wagoCsv";

/** SpellEffect.EffectAura: PERIODIC_TRIGGER_SPELL. */
export const PERIODIC_TRIGGER_AURA = "23";
/** SpellEffect.Effect: DISPEL, STEAL_BENEFICIAL_BUFF. */
export const DISPEL_EFFECTS: ReadonlySet<string> = new Set(["38", "126"]);

/** The pressed aura → periodic dispel-spell edges of a SpellEffect table,
 * restricted to the observed universe; keys and each key's ids ascend
 * numerically. */
export function channelTickDispelEdges(
  rows: readonly Record<string, string>[],
  observed: ReadonlySet<string>,
): [string, string[]][] {
  const dispels = new Set<string>();
  for (const row of rows)
    if (row.SpellID && DISPEL_EFFECTS.has(row.Effect)) dispels.add(row.SpellID);
  const edges = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.EffectAura !== PERIODIC_TRIGGER_AURA) continue;
    const trigger = row.EffectTriggerSpell;
    if (!row.SpellID || !trigger || trigger === "0") continue;
    if (!dispels.has(trigger)) continue;
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
    ["SpellID", "Effect", "EffectAura", "EffectTriggerSpell"],
    "SpellEffect",
  );
  const edges = channelTickDispelEdges(parsed.rows, observed);
  const outPath = new URL(
    "../../src/data/channelTickDispelsGenerated.ts",
    import.meta.url,
  ).pathname;
  const header = `/**\n * Generated at: ${new Date().toISOString()}\n * Build: ${build}\n * Source: SpellEffect aura 23 (PERIODIC_TRIGGER_SPELL) whose\n *   EffectTriggerSpell has a dispel effect (Effect 38 / 126), both ends in\n *   the observed universe\n * edges: ${edges.length}\n */\n\n`;
  const body = edges
    .map(([k, v]) => `    [${JSON.stringify(k)}, ${JSON.stringify(v)}],\n`)
    .join("");
  writeArtifact(
    outPath,
    header +
      `export const CHANNEL_TICK_DISPEL_IDS: ReadonlyMap<string, readonly string[]> =\n  new Map([\n${body}  ]);\n`,
  );
  console.log(
    `channelTickDispelsGenerated.ts: ${edges.length} pressed aura → periodic dispel edges (build ${build})`,
  );
}

if (process.argv[1]?.endsWith("genChannelTickDispels.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
