import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import {
  getPlayerTalentedSpellInfo,
  getPlayerTalentRanks,
  getSpecFreeOrEntrySpellIds,
  getSpecTalentTreeSpellInfo,
  isLoadoutFullyResolved,
} from "./talents";

import { PVP_TALENT_POOL_GENERATED } from "../data/pvpTalentPoolGenerated";
import { PVP_TALENT_REPLACES_GENERATED } from "../data/pvpTalentReplacesGenerated";

/**
 * Three-state verdict of "does THIS player actually have spell X in THIS
 * round". `unknown` must never be treated as `no`: it is reserved for genuine
 * data absence (old archives without COMBATANT_INFO, unparsed talents,
 * tables not loaded yet) — refusing to filter is always safer than a false
 * "you don't have it".
 */
export type TalentOwnership = "yes" | "no" | "unknown";

/**
 * Table-only ownership verdict — `talentOwnershipOf` WITHOUT the cast-evidence
 * override. Exported for the corpus contradiction audit
 * (`packages/desktop/scripts/auditTalentOwnership.ts`): "verdict says `no` but
 * the player cast it this round" is the audit's contradiction criterion, so
 * the audited verdict must not already consume the casts. Production callers
 * use `talentOwnershipOf`.
 *
 * Verdict order (first match wins):
 *  1. selected PvP talent grants it (incl. distinct ActionBar carrier) → yes
 *  2. selected PvP talent REPLACES it → no  (the button no longer exists)
 *  3. non-numeric spec / talent trees not loaded → unknown
 *  4. spell in this spec's talent trees (class/spec/hero, choice nodes count
 *     only the chosen entry) → yes/no by the player's parsed selection, with
 *     two would-be-"no" downgrades to unknown:
 *      - the spell is granted by a `freeNode`/`entryNode` node (auto-granted
 *        nodes are not reported in COMBATANT_INFO: Enhancement's Chain
 *        Lightning entry node was absent from 214/214 casting loadouts);
 *      - the loadout has purchased node ids the current map cannot resolve
 *        (`isLoadoutFullyResolved`): an older-build loadout, or pet-tree
 *        rows the player-tree export does not carry — the very row granting
 *        this spell may be among the unresolved ids (full-library audit
 *        2026-08-11: every Blessing of Spellwarding "didn't talent it but
 *        cast it" contradiction was an old-build round).
 *     Talents missing/unparsed → unknown.
 *  5. spell in this spec's official PvP-talent pool (DB2 PvpTalent) but not
 *     selected → no when the pvpTalents array is present; unknown otherwise
 *  6. in neither the trees nor the pool → baseline for this spec → yes
 *     (by official-data elimination, current build)
 *
 * Contract for step 6: the caller must already have established that the
 * spell is class/spec-plausible for this unit (every consumer walks a
 * spec-keyed whitelist first). This predicate judges TALENT gating only — it
 * does not know that e.g. Divine Shield is not a Priest spell.
 */
export function talentOwnershipFromTables(
  unit: Pick<ICombatUnit, "spec" | "info">,
  spellId: string,
): TalentOwnership {
  const pvpTalents = unit.info?.pvpTalents;
  const pvpTalentIds = new Set<string>(pvpTalents ?? []);
  // 1. Selected PvP talent grants the spell.
  if (pvpTalentIds.has(spellId)) return "yes";
  // 2. A selected PvP talent replaces the spell → the baseline button no
  // longer exists (official DB2 PvpTalent.OverridesSpellID).
  for (const [talentId, replaced] of Object.entries(
    PVP_TALENT_REPLACES_GENERATED,
  ))
    if (pvpTalentIds.has(talentId) && replaced.includes(spellId)) return "no";

  const specId = parseInt(unit.spec, 10);
  if (Number.isNaN(specId)) return "unknown";
  const specTree = getSpecTalentTreeSpellInfo(specId);
  // 3. Empty tree = talent data not loaded yet or a spec absent from
  // talentIdMap — either way we cannot judge anything below.
  if (specTree.size === 0) return "unknown";

  // 4. Talent-gated spell: judge by the player's actual selection
  // (choice/subtree nodes count only the chosen entry).
  const talents = unit.info?.talents;
  if (specTree.has(spellId)) {
    if (!talents || talents.length === 0) return "unknown";
    const selected = getPlayerTalentedSpellInfo(specId, talents);
    if (selected === null) return "unknown";
    if (selected.has(spellId)) return "yes";
    // Auto-granted (free/entry) nodes are not reported in COMBATANT_INFO —
    // their absence proves nothing.
    if (getSpecFreeOrEntrySpellIds(specId).has(spellId)) return "unknown";
    // Cross-build guard, scoped to the tree-"no" path ONLY: a loadout with
    // purchased node ids the current map cannot resolve was recorded on a
    // different game build (or carries pet-tree rows the player-tree export
    // does not know — hunters/frost mages on the CURRENT build), so "the
    // node is absent" proves nothing — the very row granting this spell may
    // be one of the unresolved ids. A positive selection above stays a "yes"
    // (the resolved row IS the evidence), and pool/baseline verdicts below
    // don't read node ids at all — pvp SPELL ids are build-stable (measured:
    // 110/111 distinct corpus pvpTalents ids match the current DB2 SpellID
    // column), so they must not be blanked by unresolved node rows.
    if (!isLoadoutFullyResolved(specId, talents)) return "unknown";
    return "no";
  }

  // 5. PvP-talent-gated spell (official per-spec pool, incl. the rare
  // distinct ActionBarSpellID carrier): owned iff its carrier is slotted.
  const carrier = PVP_TALENT_POOL_GENERATED[unit.spec]?.[spellId];
  if (carrier !== undefined) {
    if (pvpTalentIds.has(carrier)) return "yes";
    // pvpTalents present (even with empty slots) = data present → not taken.
    return pvpTalents ? "no" : "unknown";
  }

  // 6. In neither the trees nor the PvP pool → baseline ability of this spec
  // (official-data elimination): every player of the spec has it.
  return "yes";
}

/**
 * Single-source talent-ownership predicate (GitHub issue #8 / BACKLOG #23-1).
 *
 * Every "you had X available / X unused" style claim about a *specific spell
 * on a specific player* must consult this predicate before asserting the
 * player has the spell at all — a class/spec table only says the spec COULD
 * take it (Power Word: Barrier is a Discipline choice-node talent most
 * players skip, yet the spec table lists it unconditionally).
 *
 * Cast evidence this round beats all table data: whatever the tables say, a
 * successful cast proves ownership this round (guards against stale
 * generated data after a patch). Everything else is
 * `talentOwnershipFromTables` — see its verdict order.
 *
 * Granularity contract (Solo Shuffle): talents can change BETWEEN ROUNDS —
 * each round carries its own COMBATANT_INFO and the per-round `unit` object
 * carries that round's `info`. This predicate is a pure function of the unit
 * passed in and performs no caching keyed on player name/id; callers must
 * pass the CURRENT round's unit, never a unit cached from another round.
 */
export function talentOwnershipOf(
  unit: Pick<ICombatUnit, "spec" | "info" | "spellCastEvents">,
  spellId: string,
): TalentOwnership {
  if (
    (unit.spellCastEvents ?? []).some(
      (e) =>
        e.spellId === spellId &&
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS,
    )
  )
    return "yes";
  return talentOwnershipFromTables(unit, spellId);
}

/**
 * Purchased rank of a talent, for modifiers whose DB2 value is stated PER RANK
 * (`BUFF_DURATION_TALENT_MODIFIERS`). Returns 0 when the talent is not held,
 * and — deliberately — also when it IS held but the loadout carries no
 * readable rank.
 *
 * That second case extends `ccFullDurationForCaster`'s "unknown never
 * lengthens" rule down to ranks: the three `talentOwnershipOf` "yes" paths
 * that are not a parsed tree selection (cast evidence this round, a slotted
 * PvP talent, baseline-by-elimination) carry no rank, so a caster whose
 * loadout we cannot read never has a longer buff attributed to them. A claim
 * that someone's Barkskin lasted 12 s instead of 8 s must rest on evidence
 * they bought the rank.
 */
export function talentRankOf(
  unit: Pick<ICombatUnit, "spec" | "info" | "spellCastEvents">,
  talentSpellId: string,
): number {
  if (talentOwnershipOf(unit, talentSpellId) !== "yes") return 0;
  const specId = parseInt(unit.spec, 10);
  if (Number.isNaN(specId)) return 0;
  const talents = unit.info?.talents;
  if (!talents || talents.length === 0) return 0;
  return getPlayerTalentRanks(specId, talents)?.get(talentSpellId) ?? 0;
}
