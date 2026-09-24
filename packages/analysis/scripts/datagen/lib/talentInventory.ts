/**
 * Talent evidence inventory + the cooldown rule compiler (GH #96 M1, design
 * docs/superpowers/specs/2026-09-13-talent-integration-design.md D1/D2).
 *
 * The inventory is the ONE place that decides which DB2 SpellEffect rows a
 * talent reaches and which spells each row targets. Fact-specific compilers
 * (cooldown today; duration / mitigation later) read it and apply their own
 * semantics — codex astra GH #96 R1: shared extraction, typed rules, no
 * universal modifier schema.
 *
 *  - rows are stored once per SpellEffect row (keyed by `rowId` when the CSV
 *    carries an ID; synthetic test rows may not, and keep CSV order)
 *  - reachability is a separate edge list: {talentSpellId, spellId, hop, path}
 *    — one row can be reached from several talents; trigger hops (EffectTriggerSpell)
 *    are recorded up to MAX_TRIGGER_HOPS with the truncation noted in `meta`
 *  - `activation` is passive | whileAura | unknown (whileAura = the carrier
 *    spell has a finite duration; unknown = no SpellMisc row seen)
 *  - class family (SpellClassSet) per class is derived from DB2 (mode over the
 *    class's talent spells that carry SpellClassOptions), falling back to the
 *    verified constants only for a class with no evidence in the given rows
 *
 * The cooldown compiler reproduces genTalentModifiers' semantics row-for-row
 * (M1 parity gate: the generated talentModifiers.json must not change).
 */
import { CUSTOM_TALENT_MODIFIERS } from "../customTalentModifiers";
import { pvpMultiplierOf } from "./pvpMultiplier";

export const EFFECT_MOD_CHARGES = 121;
export const EFFECT_MOD_COOLDOWN = 148;
export const EFFECT_APPLY_AURA = 6;
export const AURA_MOD_MAX_CHARGES = 411;
export const AURA_ADD_FLAT_MODIFIER = 107;
export const AURA_ADD_PCT_MODIFIER = 108;
export const SPELLMOD_COOLDOWN = 11;
/** SpellModOp 5 / 6 — cast range and area radius (GH #83, 2026-09-23:
 * Phantom Reach +15 % range on every priest heal is why Discipline reaches
 * 46 yd; genSpellReach attaches these to the spells they reach). */
export const SPELLMOD_RANGE = 5;
export const SPELLMOD_RADIUS = 6;
export const AURA_CHARGE_RECOVERY_MULTIPLIER = 454;
export const AURA_MOD_CATEGORY_COOLDOWN = 453;
export const AURA_OVERRIDE_ACTION_SPELL = 332;
/**
 * GH #96 M6 (2026-09-14): two SpellMod encodings the class-mask path never
 * sees. Aura 341 changes the cooldown of every spell in a SpellCategories
 * `Category` (misc0 = category, points in ms) — Angel's Mercy: Desperate
 * Prayer −20 s, Eternal Hunt: The Hunt −15 s. Auras 218 / 219 are the pct /
 * flat SpellMod keyed by SpellLabel (misc0 = SpellModOp, misc1 = LabelID) —
 * Frequent Donor: Dark Pact −15 s. Found through the scripted-talent queue:
 * the talents looked script-driven only because no compiler read these rows.
 */
export const AURA_MOD_SPELL_CATEGORY_COOLDOWN = 341;
export const AURA_ADD_PCT_MODIFIER_BY_LABEL = 218;
export const AURA_ADD_FLAT_MODIFIER_BY_LABEL = 219;
export const MAX_TRIGGER_HOPS = 2;

/**
 * Verified SpellClassSet per ClassID — FALLBACK only (2026-09-13: Monk / DH /
 * Evoker were once 126/127/128 here and silently dropped every class-mask
 * modifier of those classes; SpellClassOptions@12.1.0.69587 says 53/107/224).
 * `deriveClassFamilies` reads the real value from DB2; the generator throws if
 * the two ever disagree on real data.
 */
export const CLASS_ID_TO_FAMILY_FALLBACK: Readonly<Record<number, number>> = {
  1: 4, // Warrior
  2: 10, // Paladin
  3: 9, // Hunter
  4: 8, // Rogue
  5: 6, // Priest
  6: 15, // Death Knight
  7: 11, // Shaman
  8: 3, // Mage
  9: 5, // Warlock
  10: 53, // Monk
  11: 7, // Druid
  12: 107, // Demon Hunter
  13: 224, // Evoker
};

export interface ICDModifier {
  talentSpellId: string;
  effect: "extra_charge" | "reduce_cd" | "reduce_cd_pct" | "replace_spell";
  value: number;
  isConditional?: boolean;
  sourceRowId?: string;
  /** set when the source is a spec passive (SpecializationSpells), not a
   * talent: every player of these specs owns it */
  specIds?: string[];
}

export type TargetVia =
  "mask" | "chargeCategory" | "cooldownCategory" | "label" | "direct";

export interface IInventoryRow {
  rowId?: string;
  spellId: string;
  effectIndex: number;
  effect: number;
  aura: number;
  misc0: number;
  basePoints: number;
  /** SpellEffect.PvpMultiplier (1 when absent) — kept alongside, never folded
   * into basePoints here: each compiler decides whether its fact is PvP-scaled */
  pvpMultiplier: number;
  schoolMask: number;
  masks: number[];
  targets: Array<{ spellId: string; via: TargetVia }>;
  activation: "passive" | "whileAura" | "unknown";
}

export interface IInventoryEdge {
  talentSpellId: string;
  /** the spell whose effect rows this edge reaches (talent itself at hop 0) */
  spellId: string;
  hop: number;
  path: "node" | "pvp" | "spec";
  classId: number;
  /** path "spec": the specializations whose SpecializationSpells grant it */
  specIds?: number[];
}

export interface ITalentInventory {
  meta: { maxTriggerHops: number; truncatedTriggerEdges: number };
  classFamily: Record<number, number>;
  rows: IInventoryRow[];
  edges: IInventoryEdge[];
  chargedSpellIds: Set<string>;
}

const toInt = (v: string | undefined): number => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? n : 0;
};

interface ITalentTree {
  classId: number;
  specId: number;
  classNodes?: unknown[];
  specNodes?: unknown[];
  heroNodes?: unknown[];
  subTreeNodes?: unknown[];
}

/** Talent spell id → classId, over node entries (all four node kinds) and the
 * PvP pool (granted + carrier ids). */
export function talentClassMapOf(
  talentTrees: readonly ITalentTree[],
  pvpPool: Readonly<Record<string, Readonly<Record<string, string>>>>,
): Map<string, { classId: number; path: "node" | "pvp" }> {
  const out = new Map<string, { classId: number; path: "node" | "pvp" }>();
  for (const tree of talentTrees) {
    const nodes = [
      ...(tree.classNodes || []),
      ...(tree.specNodes || []),
      ...(tree.heroNodes || []),
      ...(tree.subTreeNodes || []),
    ];
    for (const node of nodes) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const entry of (node as any).entries || []) {
        const id = String(entry.spellId || entry.visibleSpellId || "");
        if (id && id !== "0")
          out.set(id, { classId: tree.classId, path: "node" });
      }
    }
  }
  const classIdOfSpec = new Map<number, number>();
  for (const tree of talentTrees) classIdOfSpec.set(tree.specId, tree.classId);
  for (const [specId, granted] of Object.entries(pvpPool)) {
    const classId = classIdOfSpec.get(Number(specId));
    if (classId === undefined) continue;
    for (const [grantedId, carrierId] of Object.entries(granted)) {
      if (grantedId && grantedId !== "0")
        out.set(grantedId, { classId, path: "pvp" });
      if (carrierId && carrierId !== "0")
        out.set(carrierId, { classId, path: "pvp" });
    }
  }
  return out;
}

/** Mode of SpellClassSet over each class's talent spells; fallback constant
 * for classes with no evidence. */
export function deriveClassFamilies(
  talentClass: Map<string, { classId: number }>,
  spellClassOptionsRows: Record<string, string>[],
): { family: Record<number, number>; derived: Record<number, number> } {
  const setOf = new Map<string, number>();
  for (const r of spellClassOptionsRows)
    setOf.set(r.SpellID, toInt(r.SpellClassSet));
  const counts = new Map<number, Map<number, number>>();
  for (const [spellId, { classId }] of talentClass) {
    const set = setOf.get(spellId);
    if (!set) continue;
    const c = counts.get(classId) ?? new Map<number, number>();
    c.set(set, (c.get(set) ?? 0) + 1);
    counts.set(classId, c);
  }
  const derived: Record<number, number> = {};
  for (const [classId, c] of counts)
    derived[classId] = [...c.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  const family: Record<number, number> = { ...CLASS_ID_TO_FAMILY_FALLBACK };
  for (const [k, v] of Object.entries(derived)) family[Number(k)] = v;
  return { family, derived };
}

export function buildTalentInventory(input: {
  talentTrees: readonly ITalentTree[];
  pvpPool: Readonly<Record<string, Readonly<Record<string, string>>>>;
  spellEffectRows: Record<string, string>[];
  spellClassOptionsRows: Record<string, string>[];
  spellCategoriesRows: Record<string, string>[];
  /** SpellLabel rows (LabelID → SpellID) for aura 218 / 219; omitted → no label targets */
  spellLabelRows?: Record<string, string>[];
  /** finite-duration carrier spells; omitted → every carrier is "unknown" */
  temporarySpellIds?: ReadonlySet<string>;
  /** spells SpellMisc covers (activation "passive" when not temporary) */
  knownDurationSpellIds?: ReadonlySet<string>;
  /** restrict stored targets (the compiler filters on the same set anyway) */
  trackedSpellIds?: ReadonlySet<string>;
  /** SpecializationSpells: spell id → the specs it is granted to. Spec
   * passives carry cooldown SpellMods too (GH #106: the "Holy Paladin" aura
   * 1258016 takes 15 s off Divine Toll), and a talent-only universe never
   * sees them. Omitted → no spec sources. */
  specSpells?: ReadonlyMap<string, readonly number[]>;
}): ITalentInventory {
  const talentClass = talentClassMapOf(input.talentTrees, input.pvpPool);
  const { family } = deriveClassFamilies(
    talentClass,
    input.spellClassOptionsRows,
  );
  // Sources = talents, then spec passives that are not also talents. Added
  // AFTER the family derivation so they cannot move a class's family vote.
  const sources = new Map<
    string,
    { classId: number; path: "node" | "pvp" | "spec"; specIds?: number[] }
  >(talentClass);
  const classIdOfSpec = new Map<number, number>();
  for (const tree of input.talentTrees)
    classIdOfSpec.set(tree.specId, tree.classId);
  for (const [spellId, specIds] of input.specSpells ?? []) {
    if (sources.has(spellId)) continue;
    const classId = specIds
      .map((s) => classIdOfSpec.get(s))
      .find((c) => c !== undefined);
    if (classId === undefined) continue;
    sources.set(spellId, {
      classId,
      path: "spec",
      specIds: [...specIds].sort((a, b) => a - b),
    });
  }

  // target spells by family, SpellClassOptions order preserved within each
  const targetsByFamily = new Map<
    number,
    Array<{ spellId: string; masks: number[] }>
  >();
  const seenTarget = new Set<string>();
  const optRows = [...input.spellClassOptionsRows];
  // a later duplicate SpellID row overrides an earlier one (Map.set semantics
  // of the pre-M1 generator), so resolve the last row per spell first
  const lastOpt = new Map<string, Record<string, string>>();
  for (const r of optRows)
    if (r.SpellID && r.SpellID !== "0") lastOpt.set(r.SpellID, r);
  for (const r of optRows) {
    if (!r.SpellID || r.SpellID === "0" || seenTarget.has(r.SpellID)) continue;
    seenTarget.add(r.SpellID);
    const last = lastOpt.get(r.SpellID)!;
    const fam = toInt(last.SpellClassSet);
    const l = targetsByFamily.get(fam) ?? [];
    l.push({
      spellId: r.SpellID,
      masks: [0, 1, 2, 3].map((i) => toInt(last[`SpellClassMask_${i}`])),
    });
    targetsByFamily.set(fam, l);
  }
  const chargeCategorySpells = new Map<number, string[]>();
  for (const r of input.spellCategoriesRows) {
    const cat = toInt(r.ChargeCategory);
    if (!r.SpellID || cat === 0) continue;
    const l = chargeCategorySpells.get(cat) ?? [];
    l.push(r.SpellID);
    chargeCategorySpells.set(cat, l);
  }
  const cooldownCategorySpells = new Map<number, string[]>();
  for (const r of input.spellCategoriesRows) {
    const cat = toInt(r.Category);
    if (!r.SpellID || cat === 0) continue;
    if (r.DifficultyID && r.DifficultyID !== "0") continue;
    const l = cooldownCategorySpells.get(cat) ?? [];
    if (!l.includes(r.SpellID)) l.push(r.SpellID);
    cooldownCategorySpells.set(cat, l);
  }
  const labelSpells = new Map<number, string[]>();
  for (const r of input.spellLabelRows ?? []) {
    const label = toInt(r.LabelID);
    if (!r.SpellID || label === 0) continue;
    const l = labelSpells.get(label) ?? [];
    if (!l.includes(r.SpellID)) l.push(r.SpellID);
    labelSpells.set(label, l);
  }
  const tracked = input.trackedSpellIds;
  const keep = (id: string) => !tracked || tracked.has(id);

  // effect rows grouped by spell, CSV order preserved
  const rowsBySpell = new Map<string, Record<string, string>[]>();
  for (const r of input.spellEffectRows) {
    const l = rowsBySpell.get(r.SpellID) ?? [];
    l.push(r);
    rowsBySpell.set(r.SpellID, l);
  }

  // reachability: hop 0 = the talent spell; hops 1..MAX via EffectTriggerSpell
  const edges: IInventoryEdge[] = [];
  let truncated = 0;
  // spell → classId: a talent spell is always its own class; a spell reached
  // only through triggers takes the class of the first talent reaching it
  const reachClass = new Map<string, number>();
  for (const [spellId, { classId }] of sources)
    reachClass.set(spellId, classId);
  for (const [talentSpellId, { classId, path, specIds }] of sources) {
    let frontier = [talentSpellId];
    const seen = new Set(frontier);
    // spec passives: their own rows only (the cooldown compiler reads hop 0)
    const maxHops = path === "spec" ? 0 : MAX_TRIGGER_HOPS;
    for (let hop = 0; hop <= maxHops && frontier.length; hop++) {
      const next: string[] = [];
      for (const spellId of frontier) {
        edges.push({
          talentSpellId,
          spellId,
          hop,
          path,
          classId,
          ...(specIds ? { specIds } : {}),
        });
        if (!reachClass.has(spellId)) reachClass.set(spellId, classId);
        for (const r of rowsBySpell.get(spellId) ?? []) {
          const trig = r.EffectTriggerSpell;
          if (!trig || trig === "0" || seen.has(trig)) continue;
          if (hop === MAX_TRIGGER_HOPS) {
            truncated++;
            continue;
          }
          seen.add(trig);
          next.push(trig);
        }
      }
      frontier = next;
    }
  }

  // rows, in the original CSV order, for every reached spell
  const rows: IInventoryRow[] = [];
  for (const r of input.spellEffectRows) {
    const classId = reachClass.get(r.SpellID);
    if (classId === undefined) continue;
    const effect = toInt(r.Effect);
    const aura = toInt(r.EffectAura);
    const misc0 = toInt(r.EffectMiscValue_0);
    const masks = [0, 1, 2, 3].map((i) =>
      toInt(r[`EffectSpellClassMask_${i}`]),
    );
    const targets: IInventoryRow["targets"] = [];
    const fam = family[classId];
    if (fam !== undefined && masks.some((m) => m !== 0)) {
      for (const t of targetsByFamily.get(fam) ?? []) {
        if (masks.some((m, i) => (m & t.masks[i]!) !== 0) && keep(t.spellId))
          targets.push({ spellId: t.spellId, via: "mask" });
      }
    }
    const isCategoryEffect =
      effect === EFFECT_MOD_CHARGES ||
      effect === EFFECT_MOD_COOLDOWN ||
      aura === AURA_MOD_MAX_CHARGES ||
      aura === AURA_MOD_CATEGORY_COOLDOWN ||
      aura === AURA_CHARGE_RECOVERY_MULTIPLIER;
    const catTargets = isCategoryEffect
      ? chargeCategorySpells.get(misc0)
      : undefined;
    if (misc0 > 0 && catTargets)
      for (const t of catTargets)
        if (keep(t)) targets.push({ spellId: t, via: "chargeCategory" });
    const isLabelOrCooldownCategory =
      effect === EFFECT_APPLY_AURA &&
      (aura === AURA_MOD_SPELL_CATEGORY_COOLDOWN ||
        aura === AURA_ADD_PCT_MODIFIER_BY_LABEL ||
        aura === AURA_ADD_FLAT_MODIFIER_BY_LABEL);
    if (
      effect === EFFECT_APPLY_AURA &&
      aura === AURA_MOD_SPELL_CATEGORY_COOLDOWN
    )
      for (const t of cooldownCategorySpells.get(misc0) ?? [])
        if (keep(t)) targets.push({ spellId: t, via: "cooldownCategory" });
    if (
      effect === EFFECT_APPLY_AURA &&
      (aura === AURA_ADD_PCT_MODIFIER_BY_LABEL ||
        aura === AURA_ADD_FLAT_MODIFIER_BY_LABEL)
    )
      for (const t of labelSpells.get(toInt(r.EffectMiscValue_1)) ?? [])
        if (keep(t)) targets.push({ spellId: t, via: "label" });
    if (
      misc0 > 0 &&
      !isLabelOrCooldownCategory &&
      !chargeCategorySpells.has(misc0) &&
      keep(String(misc0))
    )
      targets.push({ spellId: String(misc0), via: "direct" });
    rows.push({
      ...(r.ID ? { rowId: String(r.ID) } : {}),
      spellId: r.SpellID,
      effectIndex: toInt(r.EffectIndex),
      effect,
      aura,
      misc0,
      basePoints: toInt(r.EffectBasePointsF),
      // the shared parser: a literal 0 is "no effect in PvP" (185 SpellEffect
      // rows, e.g. Frost/Unholy's Death Grip recharge −10 s), not a blank
      pvpMultiplier: pvpMultiplierOf(r),
      // school mask for mitigation / immunity auras (87 / 39 / 40 / 184 / 186)
      schoolMask: [87, 39, 40, 184, 186].includes(aura) ? misc0 : 0,
      masks,
      targets,
      activation: input.temporarySpellIds?.has(r.SpellID)
        ? "whileAura"
        : input.knownDurationSpellIds?.has(r.SpellID)
          ? "passive"
          : "unknown",
    });
  }

  return {
    meta: {
      maxTriggerHops: MAX_TRIGGER_HOPS,
      truncatedTriggerEdges: truncated,
    },
    classFamily: family,
    rows,
    edges,
    chargedSpellIds: new Set([...chargeCategorySpells.values()].flat()),
  };
}

/**
 * Cooldown rule compiler. Reads hop-0 rows only (a talent's own SpellMods —
 * trigger-reached rows are inventory, not permanent cooldown rules), then:
 * classify → skip temporary carriers (except replace_spell) → add per target
 * with row-identity dedup → one-effect-two-mechanisms reconciliation → custom
 * modifiers → tracked filter. Semantics identical to genTalentModifiers M0.
 */
export function compileCooldownModifiers(
  inv: ITalentInventory,
  trackedSpellIds: ReadonlySet<string>,
): Record<string, ICDModifier[]> {
  const hop0 = new Set(
    inv.edges.filter((e) => e.hop === 0).map((e) => e.spellId),
  );
  const specIdsOf = new Map<string, string[]>();
  for (const e of inv.edges)
    if (e.hop === 0 && e.path === "spec" && e.specIds)
      specIdsOf.set(e.spellId, e.specIds.map(String));
  const results: Record<string, ICDModifier[]> = {};
  const mechanismOf = new WeakMap<ICDModifier, "cooldown" | "charge">();

  const add = (
    targetId: string,
    mod: ICDModifier,
    mechanism?: "cooldown" | "charge",
  ) => {
    if (mechanism) mechanismOf.set(mod, mechanism);
    const list = (results[targetId] ??= []);
    const identical = list.find(
      (m) =>
        m.talentSpellId === mod.talentSpellId &&
        m.effect === mod.effect &&
        (mod.sourceRowId !== undefined && m.sourceRowId !== undefined
          ? m.sourceRowId === mod.sourceRowId
          : m.value === mod.value),
    );
    if (identical) {
      if (!!identical.isConditional !== !!mod.isConditional)
        console.warn(
          `[talentInventory] same modifier re-matched with conflicting isConditional: ` +
            `target=${targetId} talent=${mod.talentSpellId} effect=${mod.effect} value=${mod.value}`,
        );
      return;
    }
    list.push(mod);
  };

  for (const row of inv.rows) {
    if (!hop0.has(row.spellId)) continue;
    const { effect, aura, misc0 } = row;
    let type: ICDModifier["effect"] | null = null;
    let value = row.basePoints;
    // Cooldown numbers are PvP-scaled like every other generated number
    // (lib/pvpMultiplier.ts, user ruling 2026-09-04 "the PvP value IS the
    // official value"); until GH #106 this compiler read the bare base points.
    // Chrysalis 202424 −45 s × 0.667 = −30 s is what makes Life Cocoon's
    // modelled 75 s match the 90 s the corpus shows; Improved Conjuration
    // −30 s × 0.5, Bounding Stride −15 s × 0.7. Charges are counts, never scaled.
    const pvpValue =
      Math.round(row.basePoints * row.pvpMultiplier * 1000) / 1000;
    if (
      effect === EFFECT_MOD_CHARGES ||
      (effect === EFFECT_APPLY_AURA && aura === AURA_MOD_MAX_CHARGES)
    ) {
      type = "extra_charge";
      value = Math.abs(value);
    } else if (
      effect === EFFECT_APPLY_AURA &&
      (aura === AURA_ADD_PCT_MODIFIER ||
        aura === AURA_ADD_PCT_MODIFIER_BY_LABEL) &&
      misc0 === SPELLMOD_COOLDOWN
    ) {
      type = "reduce_cd_pct";
      value = Math.abs(pvpValue);
    } else if (
      effect === EFFECT_APPLY_AURA &&
      aura === AURA_CHARGE_RECOVERY_MULTIPLIER
    ) {
      type = "reduce_cd_pct";
      value = -pvpValue;
    } else if (
      effect === EFFECT_MOD_COOLDOWN ||
      (effect === EFFECT_APPLY_AURA && aura === AURA_MOD_CATEGORY_COOLDOWN) ||
      (effect === EFFECT_APPLY_AURA &&
        aura === AURA_MOD_SPELL_CATEGORY_COOLDOWN) ||
      (effect === EFFECT_APPLY_AURA &&
        (aura === AURA_ADD_FLAT_MODIFIER ||
          aura === AURA_ADD_FLAT_MODIFIER_BY_LABEL) &&
        misc0 === SPELLMOD_COOLDOWN)
    ) {
      type = "reduce_cd";
      value = -pvpValue;
      // milliseconds → seconds, kept to 0.1 s: a PvP-scaled −10.5 s must not
      // round to 11 (that is a half-second the model would claim is ready early)
      if (Math.abs(value) > 500) value = Math.round(value / 100) / 10;
    } else if (
      effect === EFFECT_APPLY_AURA &&
      aura === AURA_OVERRIDE_ACTION_SPELL
    ) {
      type = "replace_spell";
    }
    if (!type) continue;
    if (type !== "replace_spell" && row.activation === "whileAura") continue;
    // a no-op in the arena (base 0, or PvpMultiplier 0 = "off in PvP")
    if ((type === "reduce_cd" || type === "reduce_cd_pct") && value === 0)
      continue;
    for (const t of row.targets) {
      add(
        t.spellId,
        {
          talentSpellId: row.spellId,
          effect: type,
          value,
          ...(row.rowId ? { sourceRowId: row.rowId } : {}),
          ...(specIdsOf.has(row.spellId)
            ? { specIds: specIdsOf.get(row.spellId) }
            : {}),
        },
        t.via === "chargeCategory" ? "charge" : "cooldown",
      );
    }
  }

  for (const [targetId, mods] of Object.entries(results)) {
    const charged = inv.chargedSpellIds.has(targetId);
    const drop = new Set<ICDModifier>();
    for (const a of mods) {
      if (mechanismOf.get(a) !== "cooldown") continue;
      for (const b of mods) {
        if (mechanismOf.get(b) !== "charge") continue;
        if (
          a.talentSpellId === b.talentSpellId &&
          a.effect === b.effect &&
          a.value === b.value
        )
          drop.add(charged ? a : b);
      }
    }
    if (drop.size) results[targetId] = mods.filter((m) => !drop.has(m));
  }

  for (const [targetId, mods] of Object.entries(CUSTOM_TALENT_MODIFIERS))
    mods.forEach((m) => add(targetId, m));

  const filtered: Record<string, ICDModifier[]> = {};
  for (const [targetId, mods] of Object.entries(results))
    if (trackedSpellIds.has(targetId)) filtered[targetId] = mods;
  return filtered;
}

/** JSON-serialisable form of the inventory (Sets dropped, rows kept in CSV
 * order). Written by genTalentModifiers as talentEffectInventoryGenerated.json;
 * consumed by later fact compilers and eval scans, never imported at runtime. */
export function serializeTalentInventory(
  inv: ITalentInventory,
  build: string,
): string {
  return `${JSON.stringify(
    {
      _meta: { build, ...inv.meta, classFamily: inv.classFamily },
      rows: inv.rows,
      edges: inv.edges,
    },
    null,
    0,
  )}\n`;
}
