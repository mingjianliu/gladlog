/**
 * Spell mechanic facts (GH #77 first version, user rulings 2026-09-24): the
 * official answers the "could this CC have peeled the attacker" check needs.
 * Everything comes from DB2; nothing here is hand-typed.
 *
 *   · mech         — the CC's mechanic (SpellMechanic id: 5 fleeing, 12 stunned,
 *                    14 incapacitated, 24 horrified, …). SpellCategories.Mechanic,
 *                    else the first non-zero SpellEffect.EffectMechanic
 *                    (Mortal Coil 6789 and Fear 5782 carry it on the effect),
 *                    else ONE EffectTriggerSpell hop, else the mechanic of the
 *                    corpus-observed spells sharing its English name when they
 *                    agree on exactly one. A cast id often carries no mechanic of its own and its
 *                    aura is applied by script, with no DB2 link at all (Storm
 *                    Bolt 107570 → 132169, Shockwave 46968 → 132168); the name
 *                    match is the same "same English name" rule GH #105 uses to
 *                    pair a cast with the aura it landed.
 *   · castMs       — base cast time, SpellMisc.CastingTimeIndex →
 *                    SpellCastTimes.Base. 0 = instant. User 2026-09-24
 *                    ("77只做顺发"): a cast-time CC completes only 59 % of the
 *                    time it is started (peelTruthProbe), so only instant CCs
 *                    are offered.
 *   · immuneMech   — mechanics this aura makes its carrier immune to, from
 *                    `EffectAura = 77` (MECHANIC_IMMUNITY), misc0 = mechanic.
 *                    Applying it also removes an existing effect of that
 *                    mechanic, which is how Berserker Rage breaks a fear. User
 *                    2026-09-24: "战士自己可以解恐 … dps自己的技能要算进去".
 *   · immuneMechMask — raw `EffectAura = 147` (MECHANIC_IMMUNITY_MASK) misc0.
 *                    Its bit order is NOT resolved: on the S2 archive (1 in 20
 *                    files) CCs landed inside Death's Advance 48265 (mask 1887)
 *                    whose mechanics both readings (1 << mech, 1 << (mech − 1))
 *                    call immune — fleeing ×7, disoriented ×3. The runtime
 *                    therefore treats a carrier of a masked aura as UNKNOWN and
 *                    stays silent, never as immune or not immune.
 *   · immuneAll    — `EffectAura = 39` (SCHOOL_IMMUNITY) with misc0 = 127: the
 *                    carrier is immune to every school (Ice Block, Divine
 *                    Shield).
 *   · locksCasting — the carrier cannot cast its other abilities while the aura
 *                    is up: `EffectAura = 60` (MOD_PACIFY_SILENCE) or 263
 *                    (DISABLE_CASTING_EXCEPT_ABILITIES). Ice Block, Dispersion,
 *                    Bladestorm — the probe once offered a Shockwave to a
 *                    Warrior who was inside Bladestorm.
 *
 * Universe = observedSpellIdsGenerated.json (every id the corpus has seen), so
 * the table cannot be incomplete relative to what a log can contain. An id
 * gets an entry only when at least one field is known; `castMs` is written for
 * every id that has a SpellMisc row, because "instant" and "unknown" must stay
 * distinguishable (unknown never counts as instant).
 */
import fs from "fs-extra";

import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  fetchTable,
  parseCsv,
  resolveBuild,
} from "./lib/wagoCsv";

const AURA_MECHANIC_IMMUNITY = "77";
const AURA_MECHANIC_IMMUNITY_MASK = "147";
const AURA_SCHOOL_IMMUNITY = "39";
const AURA_MOD_PACIFY_SILENCE = "60";
const AURA_DISABLE_CASTING_EXCEPT_ABILITIES = "263";
const ALL_SCHOOLS = 127;
/** SpellMechanic ids that take control away: charmed 1, disoriented 2,
 * fleeing 5, rooted 7, asleep 10, stunned 12, frozen 13, incapacitated 14,
 * polymorphed 17, banished 18, shackled 20, turned 23, horrified 24,
 * sapped 30. Knockback / slow / snare / silence / disarm are not. */
const LOSS_OF_CONTROL_MECHANICS = new Set([
  1, 2, 5, 7, 10, 12, 13, 14, 17, 18, 20, 23, 24, 30,
]);

interface Entry {
  mech?: number;
  castMs?: number;
  immuneMech?: number[];
  immuneMechMask?: number;
  immuneAll?: true;
  locksCasting?: true;
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
  const misc = parseCsv(await fetchTable("SpellMisc", build, cacheDir));
  const castTimes = parseCsv(
    await fetchTable("SpellCastTimes", build, cacheDir),
  );
  const cats = parseCsv(await fetchTable("SpellCategories", build, cacheDir));
  const eff = parseCsv(await fetchTable("SpellEffect", build, cacheDir));
  assertColumns(
    misc.header,
    ["SpellID", "CastingTimeIndex", "DifficultyID"],
    "SpellMisc",
  );
  assertColumns(castTimes.header, ["ID", "Base"], "SpellCastTimes");
  assertColumns(
    cats.header,
    ["SpellID", "Mechanic", "DifficultyID"],
    "SpellCategories",
  );
  assertColumns(
    eff.header,
    [
      "SpellID",
      "EffectAura",
      "EffectMechanic",
      "EffectMiscValue_0",
      "EffectTriggerSpell",
      "DifficultyID",
    ],
    "SpellEffect",
  );

  const baseMs = new Map(castTimes.rows.map((r) => [r.ID, Number(r.Base)]));
  const out: Record<string, Entry> = {};
  const entry = (id: string): Entry => (out[id] ??= {});

  for (const r of misc.rows) {
    if (r.DifficultyID !== "0" || !observed.has(r.SpellID)) continue;
    const ms = baseMs.get(r.CastingTimeIndex);
    if (ms !== undefined && entry(r.SpellID).castMs === undefined)
      entry(r.SpellID).castMs = ms;
  }
  for (const r of cats.rows) {
    if (r.DifficultyID !== "0" || !observed.has(r.SpellID)) continue;
    const m = Number(r.Mechanic);
    if (m > 0) entry(r.SpellID).mech = m;
  }
  for (const r of eff.rows) {
    if (r.DifficultyID !== "0" || !observed.has(r.SpellID)) continue;
    const e = entry(r.SpellID);
    const mech = Number(r.EffectMechanic);
    if (mech > 0 && e.mech === undefined) e.mech = mech;
    const misc0 = Number(r.EffectMiscValue_0);
    switch (r.EffectAura) {
      case AURA_MECHANIC_IMMUNITY:
        if (misc0 > 0) {
          e.immuneMech = [...new Set([...(e.immuneMech ?? []), misc0])].sort(
            (a, b) => a - b,
          );
        }
        break;
      case AURA_MECHANIC_IMMUNITY_MASK:
        if (misc0 > 0) e.immuneMechMask = (e.immuneMechMask ?? 0) | misc0;
        break;
      case AURA_SCHOOL_IMMUNITY:
        if (misc0 === ALL_SCHOOLS) e.immuneAll = true;
        break;
      case AURA_MOD_PACIFY_SILENCE:
      case AURA_DISABLE_CASTING_EXCEPT_ABILITIES:
        e.locksCasting = true;
        break;
    }
  }
  // One EffectTriggerSpell hop for mechanic-less cast ids (Storm Bolt
  // 107570 → 132169). Mechanics of ANY spell, observed or not, are eligible
  // as the hop target.
  const mechAny = new Map<string, number>();
  for (const r of cats.rows)
    if (r.DifficultyID === "0" && Number(r.Mechanic) > 0)
      mechAny.set(r.SpellID, Number(r.Mechanic));
  for (const r of eff.rows)
    if (
      r.DifficultyID === "0" &&
      Number(r.EffectMechanic) > 0 &&
      !mechAny.has(r.SpellID)
    )
      mechAny.set(r.SpellID, Number(r.EffectMechanic));
  for (const r of eff.rows) {
    if (r.DifficultyID !== "0" || !observed.has(r.SpellID)) continue;
    const e = out[r.SpellID];
    const trig = r.EffectTriggerSpell;
    if (!trig || trig === "0" || (e && e.mech !== undefined)) continue;
    const m = mechAny.get(trig);
    if (m !== undefined) entry(r.SpellID).mech = m;
  }
  // Name fallback: the unique mechanic among same-named spells.
  const names = parseCsv(await fetchTable("SpellName", build, cacheDir));
  assertColumns(names.header, ["ID", "Name_lang"], "SpellName");
  const nameOf = new Map(names.rows.map((r) => [r.ID, r.Name_lang]));
  const mechsByName = new Map<string, Set<number>>();
  // Only same-named spells the corpus has seen — DB2 is full of NPC
  // abilities that share a player spell's name — and only loss-of-control
  // mechanics: Shockwave 46968 shares its name with the knockback 441668
  // (mechanic 6) as well as its stun 132168.
  for (const [id, m] of mechAny) {
    if (!observed.has(id) || !LOSS_OF_CONTROL_MECHANICS.has(m)) continue;
    const n = nameOf.get(id);
    if (!n) continue;
    const set = mechsByName.get(n) ?? new Set<number>();
    set.add(m);
    mechsByName.set(n, set);
  }
  for (const id of observed) {
    if (out[id]?.mech !== undefined) continue;
    const n = nameOf.get(id);
    const set = n ? mechsByName.get(n) : undefined;
    if (set && set.size === 1) entry(id).mech = [...set][0]!;
  }
  for (const id of Object.keys(out))
    if (Object.keys(out[id]!).length === 0) delete out[id];

  // Positive and negative controls, asserted before anything is written.
  const expect = (cond: boolean, what: string) => {
    if (!cond) throw new Error(`genSpellMechanics control failed: ${what}`);
  };
  expect(out["853"]?.mech === 12, "Hammer of Justice 853 is a stun (12)");
  expect(out["853"]?.castMs === 0, "Hammer of Justice is instant");
  expect(out["8122"]?.mech === 5, "Psychic Scream 8122 is fleeing (5)");
  expect(
    out["6789"]?.mech === 24,
    "Mortal Coil 6789 is horrified (24, effect-level)",
  );
  expect(out["118"]?.castMs === 1700, "Polymorph 118 has a 1.7 s cast");
  expect(
    out["107570"]?.mech === 12,
    "Storm Bolt cast 107570 resolves its stun through its same-named aura",
  );
  expect(out["46968"]?.mech === 12, "Shockwave cast 46968 resolves to stun");
  expect(
    !!out["18499"]?.immuneMech?.includes(5),
    "Berserker Rage 18499 grants fear (5) immunity",
  );
  expect(
    !out["18499"]?.immuneMech?.includes(12),
    "Berserker Rage does NOT grant stun immunity",
  );
  expect(
    !!out["59752"]?.immuneMech?.includes(12),
    "Will to Survive 59752 grants stun immunity",
  );
  expect(!!out["45438"]?.immuneAll, "Ice Block 45438 is immune to all schools");
  expect(!!out["45438"]?.locksCasting, "Ice Block locks casting");
  expect(!!out["227847"]?.locksCasting, "Bladestorm 227847 locks casting");
  expect(!out["853"]?.immuneMech, "Hammer of Justice grants no immunity");
  expect(!out["18499"]?.locksCasting, "Berserker Rage does not lock casting");

  const outPath = new URL(
    "../../src/data/spellMechanicsGenerated.json",
    import.meta.url,
  ).pathname;
  const sorted = Object.fromEntries(
    Object.entries(out).sort((a, b) => Number(a[0]) - Number(b[0])),
  );
  writeArtifact(
    outPath,
    JSON.stringify({ build, spells: sorted }, null, 1) + "\n",
  );
  const count = (f: (e: Entry) => boolean) =>
    Object.values(out).filter(f).length;
  console.log(
    `spellMechanicsGenerated.json (build ${build}): ${Object.keys(out).length} ids — ` +
      `mech ${count((e) => e.mech !== undefined)}, instant ${count((e) => e.castMs === 0)}, ` +
      `immuneMech ${count((e) => !!e.immuneMech)}, mask ${count((e) => e.immuneMechMask !== undefined)}, ` +
      `immuneAll ${count((e) => !!e.immuneAll)}, locksCasting ${count((e) => !!e.locksCasting)}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
