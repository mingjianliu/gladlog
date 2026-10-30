/**
 * Cast → effect-aura NOMINATIONS (official data) — the DB2 half of the
 * cast→effect table (triage 2026-09-29 ruling A10 = both: "DB2 datagen
 * nominates, the corpus verifies"; `packages/eval/scripts/castEffectAuraScan.ts`
 * is the corpus half and writes `castEffectAuraGenerated.json`, the table the
 * product reads).
 *
 * A logged cast id is often not the id of the aura it leaves: Storm Bolt
 * 107570 stuns with 132169, Freezing Trap 187650 traps with 3355 (and 203337
 * with Diamond Ice), Solar Beam 78675 silences with 81261. For a cast C in the
 * observed universe, an aura-bearing spell E (a SpellEffect row with a non-zero
 * EffectAura) is nominated when
 *   - trigger: E is reachable from C through EffectTriggerSpell (≤ 3 hops), or
 *   - name:    SpellName(E) = SpellName(C).
 * Measured 2026-10-02 on build 12.1.0.69587: the trigger chain reaches the
 * effect for 0 of the 17 known control pairs (Freezing Trap → 187651 →
 * area trigger, Solar Beam → 97547, Ring of Frost → 136511; the rest carry no
 * trigger at all — the stun is server-scripted); the name nominates all 17,
 * Capacitor Totem's "Static Charge" 118905 included (its DB2 name is
 * "Capacitor Totem"). A nomination is not a claim: the corpus scan keeps only
 * the pairs the log shows.
 *
 * Only the CAST end is restricted to the observed universe: the effect end is
 * not, because `observedSpellIdsGenerated.json` misses effect auras the log
 * does carry — Solar Beam's silence 81261 is absent from it (an observed-list
 * completeness gap, Curated-List rule), and an effect-side filter dropped the
 * one pair sync-burst F-B1 needs.
 *
 * Each nomination carries its effect's `SpellClassOptions.SpellClassSet`
 * (`cls`, absent when DB2 gives it no class row): a same-name aura no class
 * owns is a legacy or creature spell — Arcane Torrent 28730's name nominates
 * the TBC silence 33390, while the racial today only dispels and restores
 * (codex 20-F15-36). Readers that take a nomination as the effect itself, with
 * no logged aura to confirm it, keep only class-owned ones.
 *
 * - talent:  E is a CONTROL (`SpellCategories.DiminishType` ≠ 0) that a
 *   talent spell (`TraitDefinition.SpellID`) of C's class
 *   (`SpellClassOptions.SpellClassSet`) triggers (`EffectTriggerSpell`).
 *   F20 dr residual (codex 20-F20-10): Terror of the Skies 371032 triggers
 *   the stun 372245 when Deep Breath 433874 / 357210 lands — a scripted
 *   link no name and no trigger chain from the cast carries, so a Deep
 *   Breath recast whose stun logged only a REFRESH (114a4df7 r4 15.323 →
 *   16.343, the second stun 1.5 s = half of 3 s) read as no recast. The
 *   class match nominates the talent's control for every cast of that
 *   class; the corpus scan keeps only a cast the control follows within
 *   3 s nearly every time (its aura-side test, `castEffectAuraScan.ts`),
 *   and `nominatedEffectAurasOfCast` never reads a talent-only nomination.
 */
import fs from "fs-extra";

import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  fetchTable,
  parseCsv,
  resolveBuild,
} from "./lib/wagoCsv";

const TRIGGER_HOPS = 3;

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
    ["SpellID", "DifficultyID", "EffectAura", "EffectTriggerSpell"],
    "SpellEffect",
  );
  const names = parseCsv(await fetchTable("SpellName", build, cacheDir));
  assertColumns(names.header, ["ID", "Name_lang"], "SpellName");
  const classOpts = parseCsv(
    await fetchTable("SpellClassOptions", build, cacheDir),
  );
  assertColumns(
    classOpts.header,
    ["SpellID", "SpellClassSet"],
    "SpellClassOptions",
  );
  const cats = parseCsv(await fetchTable("SpellCategories", build, cacheDir));
  assertColumns(
    cats.header,
    ["SpellID", "DifficultyID", "DiminishType"],
    "SpellCategories",
  );
  const isControl = new Set<string>();
  for (const r of cats.rows)
    if (
      r.SpellID &&
      r.DifficultyID === "0" &&
      r.DiminishType &&
      r.DiminishType !== "0"
    )
      isControl.add(r.SpellID);
  const traits = parseCsv(await fetchTable("TraitDefinition", build, cacheDir));
  assertColumns(traits.header, ["SpellID"], "TraitDefinition");
  const talentSpells = new Set<string>();
  for (const r of traits.rows)
    if (r.SpellID && r.SpellID !== "0") talentSpells.add(r.SpellID);
  const classSetOf = new Map<string, number>();
  for (const r of classOpts.rows)
    if (r.SpellID && r.SpellClassSet && r.SpellClassSet !== "0")
      classSetOf.set(r.SpellID, Number(r.SpellClassSet));

  const auraBearing = new Set<string>();
  const triggers = new Map<string, Set<string>>();
  for (const r of eff.rows) {
    if (r.DifficultyID !== "0" || !r.SpellID) continue;
    if (r.EffectAura && r.EffectAura !== "0") auraBearing.add(r.SpellID);
    const t = r.EffectTriggerSpell;
    if (t && t !== "0" && t !== r.SpellID) {
      if (!triggers.has(r.SpellID)) triggers.set(r.SpellID, new Set());
      triggers.get(r.SpellID)!.add(t);
    }
  }
  // class set → the controls its talents trigger (the `talent` path)
  const talentControlsOfClass = new Map<number, Set<string>>();
  for (const t of talentSpells) {
    const cls = classSetOf.get(t);
    if (cls === undefined) continue;
    for (const e of triggers.get(t) ?? []) {
      if (!auraBearing.has(e) || !isControl.has(e)) continue;
      if (!talentControlsOfClass.has(cls))
        talentControlsOfClass.set(cls, new Set());
      talentControlsOfClass.get(cls)!.add(e);
    }
  }
  const nameOf = new Map<string, string>();
  for (const r of names.rows)
    if (r.ID && r.Name_lang) nameOf.set(r.ID, r.Name_lang);
  // aura-bearing ids by name (any id: the effect end is not filtered)
  const auraByName = new Map<string, string[]>();
  for (const id of auraBearing) {
    const n = nameOf.get(id);
    if (!n) continue;
    if (!auraByName.has(n)) auraByName.set(n, []);
    auraByName.get(n)!.push(id);
  }

  const nominations: Record<
    string,
    Array<{ aura: string; via: string; cls?: number }>
  > = {};
  let pairs = 0;
  for (const c of [...observed].sort((a, b) => Number(a) - Number(b))) {
    const via = new Map<string, Set<string>>();
    const add = (e: string, how: string) => {
      if (e === c || !auraBearing.has(e)) return;
      if (!via.has(e)) via.set(e, new Set());
      via.get(e)!.add(how);
    };
    let frontier = [c];
    const seen = new Set<string>([c]);
    for (let hop = 0; hop < TRIGGER_HOPS; hop++) {
      const next: string[] = [];
      for (const s of frontier)
        for (const t of triggers.get(s) ?? []) {
          if (seen.has(t)) continue;
          seen.add(t);
          next.push(t);
          add(t, "trigger");
        }
      frontier = next;
    }
    const n = nameOf.get(c);
    if (n) for (const e of auraByName.get(n) ?? []) add(e, "name");
    const cls = classSetOf.get(c);
    if (cls !== undefined)
      for (const e of talentControlsOfClass.get(cls) ?? []) add(e, "talent");
    if (via.size === 0) continue;
    nominations[c] = [...via.entries()]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([aura, how]) => ({
        aura,
        via: [...how].sort().join("+"),
        ...(classSetOf.has(aura) ? { cls: classSetOf.get(aura) } : {}),
      }));
    pairs += via.size;
  }

  const outPath = new URL(
    "../../src/data/castEffectNominationsGenerated.json",
    import.meta.url,
  ).pathname;
  writeArtifact(
    outPath,
    JSON.stringify(
      {
        build,
        generatedAt: new Date().toISOString(),
        source:
          "SpellEffect.EffectTriggerSpell (<= 3 hops) or same SpellName.Name_lang, to an aura-bearing spell (EffectAura != 0); or (talent) a control (SpellCategories.DiminishType != 0) a TraitDefinition spell of the cast's SpellClassSet triggers; the cast end in observedSpellIdsGenerated.json; cls = the effect's SpellClassOptions.SpellClassSet",
        casts: Object.keys(nominations).length,
        pairs,
        nominations,
      },
      null,
      0,
    ) + "\n",
  );
  console.log(
    `castEffectNominationsGenerated.json: ${Object.keys(nominations).length} casts, ${pairs} pairs (build ${build})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
