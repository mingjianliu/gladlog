/**
 * genUsableWhileCc.ts — "which abilities can be pressed while stunned /
 * feared / confused", read straight off the NAMED SpellMisc attribute bits.
 *
 * 2026-09-04 rewrite (BACKLOG #41 (8), user ruling). The 2026-08-14 version
 * of this file did not know which bit meant what and ran an exhaustive
 * ≤2-bit OR-union search anchored on 13 user-signed spells. It converged on
 * `Attributes_5#3 ∪ Attributes_10#13` for "stunned" and declared "feared" /
 * "confused" structurally unsolvable. SimulationCraft's attribute name table
 * (`engine/dbc/sc_spell_info.cpp`, global index = column × 32 + bit) and
 * TrinityCore's `SharedDefines.h` name the bits:
 *
 *   163 = Attributes_5  bit 3   "Allow While Stunned"                    (SPELL_ATTR5_ALLOW_WHILE_STUNNED)
 *   378 = Attributes_11 bit 26  "Allow While Stunned by Stun Mechanic"   (the wowhead flag the hand gap layer cited)
 *   177 = Attributes_5  bit 17  "Allow While Fleeing"                    (SPELL_ATTR5_ALLOW_WHILE_FLEEING)
 *   178 = Attributes_5  bit 18  "Allow While Confused"                   (SPELL_ATTR5_ALLOW_WHILE_CONFUSED)
 *   333 = Attributes_10 bit 13  "Reset Cooldown on Encounter End"        (SPELL_ATTR10_RESET_COOLDOWN_ON_ENCOUNTER_END)
 *
 * So the search had the first bit right and the second bit WRONG: 10#13 is a
 * long-cooldown marker that merely correlates with big defensives, and it
 * admitted 213 corpus-observed spells with no stun attribute at all
 * (Bloodlust, Tranquility, Rebirth, Innervate, Lay on Hands, Vanish, Blind,
 * Evasion, Adrenaline Rush, …) — the 1028-match stun observation line
 * (uwc-diff.md) had seen 0 casts-in-stun for all of them but Power Infusion.
 * The bit that WAS missing, 378, recovers every entry of the hand gap layer
 * (498 / 403876 Divine Protection, 51490 Thunderstorm) by itself.
 *
 * Why the search went wrong: three anchors signed as usable-while-stunned —
 * 642 Divine Shield, 45438 Ice Block, 48792 Icebound Fortitude — carry none
 * of the named bits (only "No Client Fail While Stunned, Fleeing, Confused",
 * attribute 244, which suppresses the client error text and grants nothing),
 * and 1028 matches show 1 / 0 / 0 casts-in-stun for them. User ruling
 * 2026-09-04: all three are NOT usable while stunned (Divine Shield / Ice
 * Block also not while feared or confused); the anchors file records the
 * reversal. With that, every non-null anchor agrees with the named bits.
 *
 * Contract:
 *   - the emitted sets are the named bits over the OBSERVED corpus
 *     (observedSpellIdsGenerated.json — same convention as offGcdGenerated:
 *     the full-table union is ~40 % of 410k NPC/quest rows nobody queries).
 *     `.has() === false` for an UNOBSERVED id is therefore "unknown", not
 *     "confirmed not usable" (self-heals on the next observed-id refresh);
 *   - UWC_ANCHORS is the verification gate: any non-null anchor that
 *     disagrees with its dimension's bits aborts the run (exit 1) — except
 *     ids listed in `ANCHOR_HAND_EXEMPTIONS`, which are break-out abilities
 *     the attribute system does not express (Will of the Forsaken removes
 *     fear and is castable while feared, but carries no 177) and live in a
 *     hand gap layer with a signed record instead;
 *   - positive controls: the former gap-layer ids must come out stunned via
 *     378, Vampiric Blood 55233 must not, Barkskin 22812 must come out feared;
 *   - ids in `USABLE_WHILE_CC_CONDITIONAL` (cooldowns.ts) are withheld from
 *     the unconditional stunned set even when the base spell carries a bit:
 *     119996 Transcendence: Transfer carries 378 on the base spell at 12.1,
 *     yet the user ruled 2026-09-04 ("真气转移本身的确不能晕里用 需要pvp天赋")
 *     that the base spell is NOT usable while stunned and Eminence is
 *     required — so for this id the bit is not the whole truth (the client
 *     gates it through the PvP talent) and the signed conditional layer is
 *     authoritative. A named bit is evidence, not a verdict, when a signed
 *     ruling and the game disagree with it.
 *
 * 2026-10-06 (user ruling U-T1) — the SECOND official route, for "stunned"
 * only. The 09-04 rewrite above was right about the named bits and wrong to
 * conclude that a spell without one cannot be pressed under a stun. A spell
 * whose own effect makes its CASTER immune to the stun may be cast through
 * it, and the cast purges the stun (TrinityCore `Spell::CheckCasterAuras` →
 * `SpellInfo::SpellCancelsAuraEffect`):
 *
 *    47 = Attributes_1 bit 15  "Immunity Purges Effect"   (SPELL_ATTR1_IMMUNITY_PURGES_EFFECT)
 *    + an own effect that is SCHOOL_IMMUNITY (aura 39, MiscValue_0 = the
 *      school mask it covers) or MECHANIC_IMMUNITY (aura 77) of mechanic 12
 *      (stunned).
 *
 * Over the observed corpus at 12.1.0.69587 that is exactly: Divine Shield
 * 642 (0x7f), Ice Block 45438 (0x7f), Icebound Fortitude 48792 (mechanic
 * 12), Blessing of Protection 1022 (0x1 — physical stuns only, and only on
 * the caster), Blink 1953 / 119415 and the imp's Flee 89792 (mechanic 12),
 * plus Will to Survive 59752, which also carries bit 378. Blessing of
 * Spellwarding (aura 39 0x7e, no bit 47), Cloak of Shadows and Aspect of the
 * Turtle (no bit 47) are not on it.
 *
 * User ruling U-T1b (2026-10-06): only the four named spells are taken.
 * Blink and Flee are nominated by the route and WITHHELD by the ruling
 * (`STUN_PURGE_WITHHELD_IDS`, cooldowns.ts) — the emitted map leaves them
 * out and the generated header names them.
 *
 * Corpus leg (605 S2 files, `fix-FU/stunCastProbe.py`: the caster's stun
 * REMOVED ≤ 3 ms before the SPELL_CAST_SUCCESS line — the purge is logged
 * just before the cast, which is why the 09-04 "casts strictly inside a
 * stun" count read 1 / 0 / 0): Divine Shield 99 of 417 casts, Ice Block 42
 * of 343, Icebound Fortitude 108 of 247, Blessing of Protection on self 13
 * of 56 — all 13 physical-school stuns — and on another unit 0 of 179;
 * Spellwarding on self 0 of 46, Cloak of Shadows 0 of 499, Aspect of the
 * Turtle 0 of 224, Astral Shift 0 of 304, Die by the Sword 0 of 343. The
 * named-bit spells show the other shape, pressed inside a stun that runs
 * on: Barkskin 222 of 630, Divine Protection 107 of 486, Pain Suppression
 * 123 of 592.
 *
 * Emitted as `STUN_PURGE_GENERATED` (id → the school mask its immunity
 * covers, and whether it is immune to the stun mechanic itself). The three
 * anchors the 09-04 ruling turned false (642 / 45438 / 48792) are true again
 * and agree through this route; 1022 is anchored true for the first time.
 * The feared / confused dimensions are NOT extended: the ruling is about
 * stuns, though the same purge ends a fear (a Psychic Scream REMOVED at 0 ms
 * of Divine Shield in the same scan).
 *
 * Usage: `DATAGEN_BUILD=<build> DATAGEN_CACHE=<dir> npx tsx
 *   packages/analysis/scripts/datagen/genUsableWhileCc.ts`
 */
import fs from "fs-extra";

import {
  STUN_PURGE_WITHHELD_IDS,
  USABLE_WHILE_CC_CONDITIONAL,
} from "../../src/utils/cooldowns";
import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  fetchTable,
  parseCsv,
  resolveBuild,
} from "./lib/wagoCsv";
import { UWC_ANCHORS, type UwcAnchor } from "./usableWhileCcAnchors";

export const DIMENSIONS = ["stunned", "feared", "confused"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/** SimC global attribute index (column × 32 + bit) → name, per dimension. */
export const NAMED_BITS: Readonly<
  Record<Dimension, ReadonlyArray<{ index: number; name: string }>>
> = {
  stunned: [
    { index: 163, name: "Allow While Stunned" },
    { index: 378, name: "Allow While Stunned by Stun Mechanic" },
  ],
  feared: [{ index: 177, name: "Allow While Fleeing" }],
  confused: [{ index: 178, name: "Allow While Confused" }],
};

/** Attributes_1 bit 15, "Immunity Purges Effect". */
export const IMMUNITY_PURGES_EFFECT_BIT = 47;
/** SpellEffect.EffectAura: SCHOOL_IMMUNITY / MECHANIC_IMMUNITY. */
const AURA_SCHOOL_IMMUNITY = "39";
const AURA_MECHANIC_IMMUNITY = "77";
/** SpellMechanic 12 — stunned. */
const MECHANIC_STUNNED = "12";
const EVERY_SCHOOL = 0x7f;

/** What a spell's own immunity covers, for the purge route. */
export interface StunPurge {
  /** union of its SCHOOL_IMMUNITY masks (0 = none) */
  schoolMask: number;
  /** immune to the stun mechanic itself */
  stunMechanic: boolean;
}

/**
 * The immunity route to "usable while stunned": bit 47 on the spell, and an
 * own effect (default difficulty) that is a school immunity or a
 * stun-mechanic immunity. Null when the spell is not on it.
 */
export function stunPurgeRoute(
  miscRow: Record<string, string>,
  effectRows: ReadonlyArray<Record<string, string>>,
): StunPurge | null {
  if (!attrBit(miscRow, IMMUNITY_PURGES_EFFECT_BIT)) return null;
  let schoolMask = 0;
  let stunMechanic = false;
  for (const e of effectRows) {
    if (e.EffectAura === AURA_SCHOOL_IMMUNITY)
      schoolMask |= Number(e.EffectMiscValue_0 ?? 0) & EVERY_SCHOOL;
    else if (
      e.EffectAura === AURA_MECHANIC_IMMUNITY &&
      e.EffectMiscValue_0 === MECHANIC_STUNNED
    )
      stunMechanic = true;
  }
  return schoolMask !== 0 || stunMechanic ? { schoolMask, stunMechanic } : null;
}

/**
 * Anchors the attribute system cannot express; each one MUST have a hand
 * gap-layer entry in cooldowns.ts plus a signed record in
 * curatedAbilityFacts.ts (the curatedFacts test pins both directions).
 */
export const ANCHOR_HAND_EXEMPTIONS: Readonly<
  Record<Dimension, ReadonlySet<string>>
> = {
  stunned: new Set<string>(),
  feared: new Set<string>(["7744"]), // Will of the Forsaken — removes fear, castable while feared, no 177
  confused: new Set<string>(),
};

/** Positive controls asserted before anything is written. */
const CONTROLS: Array<[Dimension, string, boolean, string]> = [
  [
    "stunned",
    "498",
    true,
    "Divine Protection — the former hand gap layer, now via 378",
  ],
  ["stunned", "403876", true, "Divine Protection (talent clone) — same"],
  [
    "stunned",
    "51490",
    true,
    "Thunderstorm — the former hand gap layer, now via 378",
  ],
  [
    "stunned",
    "55233",
    false,
    "Vampiric Blood — user-ruled not usable (2026-08-14)",
  ],
  ["stunned", "2825", false, "Bloodlust — the 10#13 false positive"],
  ["stunned", "740", false, "Tranquility — the 10#13 false positive"],
  [
    "feared",
    "22812",
    true,
    "Barkskin — signed usable_while_feared_gap fact + tooltip",
  ],
];

/** Purge-route controls: [id, expected mask (null = not on the route),
 * expected stun-mechanic immunity, why]. */
const PURGE_CONTROLS: Array<[string, number | null, boolean, string]> = [
  ["642", 0x7f, false, "Divine Shield — every school (ruling U-T1)"],
  ["45438", 0x7f, false, "Ice Block — every school (ruling U-T1)"],
  ["48792", 0, true, "Icebound Fortitude — the stun mechanic (ruling U-T1)"],
  ["1022", 0x1, false, "Blessing of Protection — physical only (ruling U-T1)"],
  ["204018", null, false, "Blessing of Spellwarding — aura 39 without bit 47"],
  ["31224", null, false, "Cloak of Shadows — no bit 47; 0 of 499 casts"],
  ["186265", null, false, "Aspect of the Turtle — no bit 47; 0 of 224 casts"],
  ["108271", null, false, "Astral Shift — a wall, no immunity"],
];

const ATTR_COLUMNS = Array.from({ length: 17 }, (_, i) => `Attributes_${i}`);

export function attrBit(
  row: Record<string, string>,
  globalIndex: number,
): boolean {
  const column = ATTR_COLUMNS[Math.floor(globalIndex / 32)];
  if (!column) return false;
  // Attributes_N is a 32-bit flag column; Number() keeps full precision for
  // values ≤ 2^32 and `>>> bit & 1` reads the bit unsigned.
  const value = Number(row[column] ?? "0");
  if (!Number.isFinite(value)) return false;
  return ((value >>> (globalIndex % 32)) & 1) === 1;
}

export function usableWhile(
  row: Record<string, string>,
  dim: Dimension,
): boolean {
  return NAMED_BITS[dim].some((b) => attrBit(row, b.index));
}

export interface AnchorVerdict {
  checked: number;
  disagreements: string[];
  exempted: string[];
}

/** Every non-null anchor cell must agree with the named bits (full table). */
export function verifyAnchors(
  byId: ReadonlyMap<string, Record<string, string>>,
  anchors: readonly UwcAnchor[],
  exemptions: Readonly<
    Record<Dimension, ReadonlySet<string>>
  > = ANCHOR_HAND_EXEMPTIONS,
  /** the purge route's ids — "stunned" agrees through it as well */
  stunPurgeIds: ReadonlySet<string> = new Set(),
): AnchorVerdict {
  const out: AnchorVerdict = { checked: 0, disagreements: [], exempted: [] };
  for (const a of anchors) {
    const row = byId.get(a.spellId);
    for (const dim of DIMENSIONS) {
      const expected = a[dim];
      if (expected === null) continue;
      if (exemptions[dim].has(a.spellId)) {
        out.exempted.push(
          `${a.spellId} ${a.name} ${dim}=${expected} (hand gap layer)`,
        );
        continue;
      }
      out.checked++;
      const actual =
        (row ? usableWhile(row, dim) : false) ||
        (dim === "stunned" && stunPurgeIds.has(a.spellId));
      if (actual !== expected)
        out.disagreements.push(
          `${a.spellId} ${a.name}: ${dim} anchor=${expected} bits=${actual}${row ? "" : " (no SpellMisc row)"}`,
        );
    }
  }
  return out;
}

function sortedIds(ids: Iterable<string>): string[] {
  return [...ids].sort((a, b) => Number(a) - Number(b));
}

export async function main(): Promise<void> {
  const build = await resolveBuild(process.argv[2]);
  const cacheDir = process.env.DATAGEN_CACHE ?? undefined;
  const parsed = parseCsv(await fetchTable("SpellMisc", build, cacheDir));
  assertColumns(
    parsed.header,
    [...ATTR_COLUMNS, "SpellID", "DifficultyID"],
    "SpellMisc",
  );

  const byId = new Map<string, Record<string, string>>();
  for (const row of parsed.rows) {
    if (row.DifficultyID !== "0" || !row.SpellID || byId.has(row.SpellID))
      continue;
    byId.set(row.SpellID, row);
  }

  // The immunity route needs each spell's own effects.
  const effects = parseCsv(await fetchTable("SpellEffect", build, cacheDir));
  assertColumns(
    effects.header,
    ["SpellID", "DifficultyID", "EffectAura", "EffectMiscValue_0"],
    "SpellEffect",
  );
  const effectsById = new Map<string, Record<string, string>[]>();
  for (const row of effects.rows) {
    if (row.DifficultyID !== "0" || !row.SpellID) continue;
    const list = effectsById.get(row.SpellID);
    if (list) list.push(row);
    else effectsById.set(row.SpellID, [row]);
  }
  const purgeOf = (id: string): StunPurge | null => {
    const row = byId.get(id);
    return row ? stunPurgeRoute(row, effectsById.get(id) ?? []) : null;
  };

  // 1. Verification gate over the FULL table.
  const anchorPurgeIds = new Set(
    UWC_ANCHORS.map((a) => a.spellId).filter((id) => purgeOf(id) !== null),
  );
  const verdict = verifyAnchors(
    byId,
    UWC_ANCHORS,
    ANCHOR_HAND_EXEMPTIONS,
    anchorPurgeIds,
  );
  for (const line of verdict.exempted)
    console.log(`[genUsableWhileCc] exempted: ${line}`);
  if (verdict.disagreements.length > 0) {
    for (const line of verdict.disagreements)
      console.error(`[genUsableWhileCc] ANCHOR DISAGREES: ${line}`);
    console.error(
      "[genUsableWhileCc] the named bits and the signed anchors disagree — re-rule the anchor or the bit table, do not emit.",
    );
    process.exit(1);
    return;
  }
  for (const [dim, id, expected, why] of CONTROLS) {
    const row = byId.get(id);
    const actual = row ? usableWhile(row, dim) : false;
    if (actual !== expected) {
      console.error(
        `[genUsableWhileCc] CONTROL FAILED: ${id} ${dim} expected ${expected} got ${actual} — ${why}`,
      );
      process.exit(1);
      return;
    }
  }
  for (const [id, mask, stun, why] of PURGE_CONTROLS) {
    const actual = purgeOf(id);
    const ok =
      mask === null
        ? actual === null
        : actual !== null &&
          actual.schoolMask === mask &&
          actual.stunMechanic === stun;
    if (!ok) {
      console.error(
        `[genUsableWhileCc] PURGE CONTROL FAILED: ${id} expected ${mask === null ? "off the route" : `mask 0x${mask.toString(16)} stunMechanic ${stun}`} got ${JSON.stringify(actual)} — ${why}`,
      );
      process.exit(1);
      return;
    }
  }
  console.log(
    `[genUsableWhileCc] anchors: ${verdict.checked} cells agree with the named bits or the purge route, ${verdict.exempted.length} hand-exempted; ${CONTROLS.length} + ${PURGE_CONTROLS.length} controls pass`,
  );

  // 2. Emit over the observed corpus, minus the signed conditional layer.
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
  const conditional = new Set(Object.keys(USABLE_WHILE_CC_CONDITIONAL));
  const spellNames = JSON.parse(
    fs.readFileSync(
      new URL("../../src/data/spellNames.json", import.meta.url).pathname,
      "utf8",
    ),
  ) as Record<string, string>;

  const sets: Record<Dimension, string[]> = {
    stunned: [],
    feared: [],
    confused: [],
  };
  const withheld: string[] = [];
  for (const id of observed) {
    const row = byId.get(id);
    if (!row) continue;
    for (const dim of DIMENSIONS) {
      if (!usableWhile(row, dim)) continue;
      if (dim === "stunned" && conditional.has(id)) {
        withheld.push(id);
        continue;
      }
      sets[dim].push(id);
    }
  }
  for (const dim of DIMENSIONS) sets[dim] = sortedIds(sets[dim]);
  // The purge route, same corpus restriction. An id the named bits already
  // admit is left out (Will to Survive: nothing to add), and so is the signed
  // conditional layer.
  const stunnedByBits = new Set(sets.stunned);
  const purge: Record<string, StunPurge> = {};
  const purgeWithheld: string[] = [];
  for (const id of sortedIds(observed)) {
    if (stunnedByBits.has(id) || conditional.has(id)) continue;
    const route = purgeOf(id);
    if (!route) continue;
    // nominated by the data, left out by a signed ruling (U-T1b)
    if (STUN_PURGE_WITHHELD_IDS.has(id)) purgeWithheld.push(id);
    else purge[id] = route;
  }
  // a withheld id the route no longer nominates is a stale ruling row
  for (const id of STUN_PURGE_WITHHELD_IDS) {
    if (observed.has(id) && !purgeWithheld.includes(id)) {
      console.error(
        `[genUsableWhileCc] STUN_PURGE_WITHHELD_IDS names ${id}, which the immunity route does not nominate — drop the row`,
      );
      process.exit(1);
      return;
    }
  }

  const countsLine = DIMENSIONS.map((d) => `${d}:${sets[d].length}`).join(" ");
  const sample = (d: Dimension) =>
    sets[d]
      .filter((id) => spellNames[id])
      .slice(0, 12)
      .map((id) => `${id} ${spellNames[id]}`)
      .join(", ");
  const bitsBlock = DIMENSIONS.map(
    (d) =>
      ` *   ${d}: ${NAMED_BITS[d].map((b) => `${b.index} (Attributes_${Math.floor(b.index / 32)} bit ${b.index % 32}, "${b.name}")`).join(" ∪ ")}`,
  ).join("\n");

  const header =
    `/**\n` +
    ` * Generated at: ${new Date().toISOString()}\n` +
    ` * Build: ${build}\n` +
    ` * Source: DB2 SpellMisc.Attributes_0..16, the NAMED bits (SimulationCraft\n` +
    ` *   sc_spell_info.cpp attribute table / TrinityCore SharedDefines.h; global\n` +
    ` *   index = column × 32 + bit), see scripts/datagen/genUsableWhileCc.ts:\n` +
    `${bitsBlock}\n` +
    ` * Restricted to the observed corpus (observedSpellIdsGenerated.json) —\n` +
    ` *   .has()===false for an UNOBSERVED id means "unknown", not "confirmed not\n` +
    ` *   usable"; self-heals on the next observed-id refresh + regen.\n` +
    ` * Verification: ${verdict.checked} signed anchor cells (usableWhileCcAnchors.ts)\n` +
    ` *   agree with the bits; hand-exempted: ${verdict.exempted.length ? verdict.exempted.join("; ") : "none"}.\n` +
    ` * Withheld from stunned (signed conditional layer, cooldowns.ts\n` +
    ` *   USABLE_WHILE_CC_CONDITIONAL): ${withheld.length ? withheld.map((id) => `${id} ${spellNames[id] ?? ""}`).join(", ") : "none"}.\n` +
    ` * Purge route (stunned only): Attributes_1 bit 15 "Immunity Purges Effect"\n` +
    ` *   + an own SCHOOL_IMMUNITY (aura 39) or MECHANIC_IMMUNITY (aura 77) of\n` +
    ` *   mechanic 12; ids the named bits already admit are left out:\n` +
    ` *   ${
      Object.entries(purge)
        .map(
          ([id, r]) =>
            `${id} ${spellNames[id] ?? ""} (${r.stunMechanic ? "stun mechanic" : `schools 0x${r.schoolMask.toString(16)}`})`,
        )
        .join(", ") || "none"
    }.\n` +
    ` *   Nominated by the route and withheld by user ruling (cooldowns.ts\n` +
    ` *   STUN_PURGE_WITHHELD_IDS): ${purgeWithheld.map((id) => `${id} ${spellNames[id] ?? ""}`).join(", ") || "none"}.\n` +
    ` * ${countsLine} stunnedByPurge:${Object.keys(purge).length}\n` +
    DIMENSIONS.map((d) => ` * ${d} sample: ${sample(d) || "(none)"}`).join(
      "\n",
    ) +
    `\n */\n\n`;

  const body =
    `export interface UsableWhileCcGenerated {\n` +
    DIMENSIONS.map((d) => `  ${d}: ReadonlySet<string>;`).join("\n") +
    `\n}\n\n` +
    `export const USABLE_WHILE_CC_GENERATED: UsableWhileCcGenerated = {\n` +
    DIMENSIONS.map(
      (d) => `  ${d}: new Set(\n    ${JSON.stringify(sets[d])},\n  ),`,
    ).join("\n") +
    `\n};\n\n` +
    `/** The immunity route to "usable while stunned" (see the header): spell →\n` +
    ` * the school mask its own immunity covers (0 = none) and whether it is\n` +
    ` * immune to the stun mechanic itself. The immunity lands on the CASTER —\n` +
    ` * a targeted one (Blessing of Protection) only counts cast on oneself. */\n` +
    `export const STUN_PURGE_GENERATED: Readonly<\n` +
    `  Record<string, { schoolMask: number; stunMechanic: boolean }>\n` +
    `> = ${JSON.stringify(purge, null, 2)};\n`;

  const dataDir = new URL("../../src/data/", import.meta.url).pathname;
  writeArtifact(dataDir + "usableWhileCcGenerated.ts", header + body);
  console.log(
    `usableWhileCcGenerated.ts: ${countsLine} (build ${build}); withheld ${withheld.join(",") || "none"}`,
  );
}

if (
  typeof process !== "undefined" &&
  process.argv &&
  process.argv[1]?.endsWith("genUsableWhileCc.ts")
) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
