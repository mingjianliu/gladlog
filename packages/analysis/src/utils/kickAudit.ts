import {
  AtomicArenaCombat,
  CombatExtraSpellAction,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { SPELL_CATEGORIES as spellsData } from "../data/spellCategories";
import { getEnglishSpellName } from "../data/spellEffectData";
import {
  classifyKickedSpell,
  type KickedSpellCategory,
} from "../data/kickedSpellCategories";

type SpellEntry = { type: string };
const SPELLS = spellsData as Record<string, SpellEntry>;

/** A landed kick's SPELL_INTERRUPT event pairs with the cast within this window. */
const LANDED_PAIR_MS = 1_000;
/** How far back before the kick a cancelled enemy cast still counts as the juke bait.
 * Anchored on the cast-bar cap: an uncompleted cast is over within this long
 * (desktop castBars CAST_BAR_MAX_MS renders the same fact — keep equal). */
export const JUKE_LOOKBACK_MS = 4_000;

export interface IKickAuditEntry {
  atSeconds: number;
  kickSpellId: string;
  kickSpellName: string;
  /** Kick's dest unit (the enemy it was aimed at), when the log recorded one. */
  targetId?: string;
  targetName?: string;
  /**
   * landed  — SPELL_INTERRUPT confirms the kick stopped a cast;
   * juked   — kick missed AND the target cancelled a cast just before (fake-cast bait);
   * missed  — kick missed with cast-start data present and no bait found (nothing kickable);
   * unknown — kick missed but this match predates cast-start data (can't distinguish).
   */
  result: "landed" | "juked" | "missed" | "unknown";
  /** landed: what was interrupted. */
  interruptedSpellName?: string;
  /** landed: category of what was interrupted (GH #79). */
  interruptedCategory?: KickedSpellCategory;
  /** juked: the cast that was faked. */
  jukedBySpellName?: string;
}

/**
 * Audits every interrupt the player cast: did it land, get juked, or hit air?
 *
 * Shared predicates: "is an interrupt" = SPELL_CATEGORIES type "interrupts"
 * (same check the stats table uses); "kick landed" = the mirror of
 * ccTrinketAnalysis' interruptInstances (victim actionIn ∩ SPELL_INTERRUPT ∩
 * src = kicker); "cast was cancelled" mirrors the cast-bar pairing rule
 * (no same-spell SPELL_CAST_SUCCESS before the next start / 4s cap).
 */
export function analyzeKickAudit(
  player: ICombatUnit,
  enemies: ICombatUnit[],
  combat: AtomicArenaCombat,
): IKickAuditEntry[] {
  const matchStartMs = combat.startTime;
  const enemyPlayers = enemies.filter((e) => e.info);
  // For interrupts performed by a pet (Warlock Spell Lock, etc.) the
  // SPELL_INTERRUPT src is the pet's id — so landed detection must accept the
  // owner's pets as well (~5 matches mislabeled in the 2026-07-16 DPS
  // baseline).
  const kickerIds = new Set<string>([player.id]);
  for (const u of Object.values(
    (combat as { units?: Record<string, ICombatUnit> }).units ?? {},
  )) {
    if (u.ownerId === player.id) kickerIds.add(u.id);
  }

  const kicks = player.spellCastEvents.filter(
    (e) =>
      e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
      SPELLS[e.spellId ?? ""]?.type === "interrupts",
  );
  if (kicks.length === 0) return [];

  // Landed evidence: every SPELL_INTERRUPT on any enemy sourced by this player
  // (or their pet). ALL interrupt events are also kept: a cast-start that ended
  // because ANYONE kicked it is not a fake cast.
  const allInterrupts = enemyPlayers.flatMap((enemy) =>
    enemy.actionIn.filter((a) => a.logLine.event === LogEvent.SPELL_INTERRUPT),
  );
  const landedEvents = allInterrupts.filter((a) => kickerIds.has(a.srcUnitId));

  // Whether ANY cast-start data exists in this match (old archives have none).
  const hasCastStartData = enemyPlayers.some(
    (e) => (e.castStartEvents ?? []).length > 0,
  );

  const entries: IKickAuditEntry[] = [];
  for (const kick of kicks) {
    const kickMs = kick.logLine.timestamp;
    const base = {
      atSeconds: (kickMs - matchStartMs) / 1000,
      kickSpellId: kick.spellId ?? "",
      kickSpellName: getEnglishSpellName(
        kick.spellId ?? "",
        kick.spellName ?? "",
      ),
      targetId: kick.destUnitId || undefined,
      targetName: kick.destUnitName || undefined,
    };

    const landed = landedEvents.find(
      (a) => Math.abs(a.logLine.timestamp - kickMs) <= LANDED_PAIR_MS,
    );
    if (landed) {
      // Raw SPELL_INTERRUPT semantics: spellId = the interrupt ability,
      // extraSpellId = the spell that got interrupted
      const extra = landed as CombatExtraSpellAction;
      entries.push({
        ...base,
        result: "landed",
        interruptedSpellName: getEnglishSpellName(
          extra.extraSpellId ?? "",
          extra.extraSpellName ?? "",
        ),
        interruptedCategory: classifyKickedSpell(extra.extraSpellId ?? ""),
        kickSpellName: getEnglishSpellName(
          landed.spellId ?? base.kickSpellId,
          landed.spellName ?? base.kickSpellName,
        ),
      });
      continue;
    }

    if (!hasCastStartData) {
      entries.push({ ...base, result: "unknown" });
      continue;
    }

    // Juke check: the kick's target (fall back to any enemy) cancelled a cast
    // in the lookback window — started, never completed before the kick.
    const candidates = kick.destUnitId
      ? enemyPlayers.filter((e) => e.id === kick.destUnitId)
      : enemyPlayers;
    let jukedBy: string | undefined;
    outer: for (const enemy of candidates) {
      const successes = enemy.spellCastEvents.filter(
        (c) => c.logLine.event === LogEvent.SPELL_CAST_SUCCESS,
      );
      for (const st of enemy.castStartEvents ?? []) {
        const stMs = st.logLine.timestamp;
        if (stMs < kickMs - JUKE_LOOKBACK_MS || stMs > kickMs) continue;
        const completed = successes.some(
          (c) =>
            c.spellId === st.spellId &&
            c.logLine.timestamp >= stMs &&
            c.logLine.timestamp <= stMs + JUKE_LOOKBACK_MS,
        );
        // If that cast was interrupted by ANYONE (including a teammate!), it
        // was a real cast that got kicked, not a fake cast
        // (2026-07-16 DPS baseline: a teammate's kick was mislabeled
        // "JUKED by fake")
        const wasInterrupted = allInterrupts.some(
          (a) =>
            a.destUnitId === enemy.id &&
            (a as CombatExtraSpellAction).extraSpellId === st.spellId &&
            a.logLine.timestamp >= stMs &&
            a.logLine.timestamp <= stMs + JUKE_LOOKBACK_MS,
        );
        if (!completed && !wasInterrupted) {
          jukedBy = getEnglishSpellName(st.spellId ?? "", st.spellName ?? "");
          break outer;
        }
      }
    }

    entries.push(
      jukedBy
        ? { ...base, result: "juked", jukedBySpellName: jukedBy }
        : { ...base, result: "missed" },
    );
  }

  return entries.sort((a, b) => a.atSeconds - b.atSeconds);
}
