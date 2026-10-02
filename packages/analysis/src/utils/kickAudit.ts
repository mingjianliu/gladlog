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
import { kickCastSpellId } from "./enemyInterrupts";

type SpellEntry = { type: string };
const SPELLS = spellsData as Record<string, SpellEntry>;

/** A landed kick's SPELL_INTERRUPT event pairs with the cast within this
 * window. Also the burst-answered landed test's (sync-burst F-B1). */
export const LANDED_PAIR_MS = 1_000;
/** Two SPELL_CAST_SUCCESS rows of ONE kick: Skull Bash logs its cast id
 * 106839 and its effect id 93985 a millisecond apart (58 / 58 casts in the 60
 * triage rounds, none between 0.05 and 1 s). Kept apart from `LANDED_PAIR_MS`
 * — that one pairs a kick with its SPELL_INTERRUPT (triage 2026-09-29, other
 * F-O4). */
const DUPLICATE_KICK_ID_MS = 50;
/** Spell-queue tolerance: the next cast's SPELL_CAST_START is often logged
 * before this cast's SUCCESS (client-side queuing), so a SUCCESS may follow
 * the next start by this much and still complete THIS cast. Desktop's
 * `castBars.ts` draws the cast bars with the same number (imported from here
 * — one fact, two readers). */
export const CAST_QUEUE_TOLERANCE_MS = 400;
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
   * landed   — SPELL_INTERRUPT confirms the kick stopped a cast;
   * silenced — no SPELL_INTERRUPT, but the kick's own silence aura went onto
   *            the target (Silence 15487, Strangulate 47476): it landed — not
   *            a miss. Only in a match with cast-start data: without it every
   *            other kick that interrupted nothing is `unknown` and outside
   *            the landed rate, and a lone `silenced` would be the only one
   *            counted against it;
   * juked    — kick missed AND the target cancelled a cast just before (fake-cast bait);
   * missed   — kick missed with cast-start data present and no bait found (nothing kickable);
   * unknown  — kick missed but this match predates cast-start data (can't distinguish).
   */
  result: "landed" | "silenced" | "juked" | "missed" | "unknown";
  /** landed: what was interrupted. */
  interruptedSpellName?: string;
  /** landed: category of what was interrupted (GH #79). */
  interruptedCategory?: KickedSpellCategory;
  /** juked: the cast that was faked. */
  jukedBySpellName?: string;
  /** silenced: who carried the kick's aura. */
  silencedTargetName?: string;
  /** silenced: the cast that target had open AT the kick and never finished
   * (the juke test's pairing, restricted to a bar that was still running at
   * the kick — the latest one), when there was one. A silence stops a
   * cast bar without a SPELL_INTERRUPT row, so "no cast interrupted" may
   * only be said when this is absent — and whether the silence or the
   * target stopped it the log cannot tell, so the wording says neither. */
  openCastSpellName?: string;
}

/**
 * Audits every interrupt the player cast: did it land, get juked, or hit air?
 *
 * Shared predicates: "is an interrupt" = SPELL_CATEGORIES type "interrupts"
 * (same check the stats table uses); "kick landed" = the mirror of
 * ccTrinketAnalysis' interruptInstances (victim actionIn ∩ SPELL_INTERRUPT ∩
 * src = kicker); "cast was cancelled" mirrors the cast-bar pairing rule
 * (no same-spell SPELL_CAST_SUCCESS before the next start / 4s cap).
 *
 * Order of the three decisions (triage 2026-09-29, CROSS-THEME G11):
 *  1. one kick, one entry — two cast rows of the same kick are collapsed
 *     first (other F-O4);
 *  2. the landed branch: an interrupt, else the kick's own silence aura on
 *     the target (sync-burst F-L6) — decided before any juke test, so a
 *     Strangulate that silenced its target is never "juked";
 *  3. only what is left is tested for a juke, with a cast's completion
 *     bounded at the target's next cast start (kick-priority F-B1).
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

  const kickRows = player.spellCastEvents
    .filter(
      (e) =>
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        SPELLS[e.spellId ?? ""]?.type === "interrupts",
    )
    .sort((a, b) => a.logLine.timestamp - b.logLine.timestamp);
  if (kickRows.length === 0) return [];
  // 1. One kick, one entry. The rows themselves stay in `spellCastEvents`
  // (the cooldown ledger keys on 106839); only the audit collapses them. Of a
  // pair, the row that names a target is kept.
  const kicks: typeof kickRows = [];
  for (const k of kickRows) {
    const prev = kicks[kicks.length - 1];
    if (
      prev &&
      k.logLine.timestamp - prev.logLine.timestamp <= DUPLICATE_KICK_ID_MS &&
      kickCastSpellId(k.spellId ?? "") === kickCastSpellId(prev.spellId ?? "")
    ) {
      if (!prev.destUnitId && k.destUnitId) kicks[kicks.length - 1] = k;
      continue;
    }
    kicks.push(k);
  }

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
  /** The cast `enemy` started in the lookback before `kickMs` and never
   * finished: no same-spell success and no interrupt of it by anyone before
   * the cast was over. The juke test takes the earliest such cast — the bait
   * was stopped BEFORE the kick. `openAtKick` (the silenced branch) takes
   * only a bar still running at the kick, and of two the latest: a cast the
   * target's next cast start had already ended was not open when the silence
   * landed, and naming it would coach around the wrong spell. */
  const openCastOf = (
    enemy: ICombatUnit,
    kickMs: number,
    openAtKick = false,
  ) => {
    const successes = enemy.spellCastEvents.filter(
      (c) => c.logLine.event === LogEvent.SPELL_CAST_SUCCESS,
    );
    // 3. A cast is over at the unit's NEXT cast start (plus the queue
    // tolerance) or the 4 s cap, whichever is first — the rule the header
    // states. Without the bound a stopped cast followed by a completed
    // recast of the same spell read as completed, and the kick that hit
    // the stop was "missed" (2c6e85ec: Rebuke 75.6 on a stopped Cyclone,
    // recast and finished 0.4 s later). The last start has no next one.
    const starts = [...(enemy.castStartEvents ?? [])].sort(
      (a, b) => a.logLine.timestamp - b.logLine.timestamp,
    );
    let open: string | undefined;
    for (let i = 0; i < starts.length; i++) {
      const st = starts[i]!;
      const stMs = st.logLine.timestamp;
      if (stMs < kickMs - JUKE_LOOKBACK_MS || stMs > kickMs) continue;
      const nextStartMs = starts[i + 1]?.logLine.timestamp ?? Infinity;
      const endMs = Math.min(
        stMs + JUKE_LOOKBACK_MS,
        nextStartMs + CAST_QUEUE_TOLERANCE_MS,
      );
      if (openAtKick && endMs < kickMs) continue;
      const completed = successes.some(
        (c) =>
          c.spellId === st.spellId &&
          c.logLine.timestamp >= stMs &&
          c.logLine.timestamp <= endMs,
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
          a.logLine.timestamp <= endMs,
      );
      if (!completed && !wasInterrupted) {
        open = getEnglishSpellName(st.spellId ?? "", st.spellName ?? "");
        if (!openAtKick) return open;
      }
    }
    return open;
  };

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

    // 2b. The kick's own silence aura on an enemy: it landed without a cast
    // to stop (fa5e6c66: six Silences read "hit nothing"). The SAME spell id
    // only, applied by the kicker at or after the kick — a generic "any aura
    // from the kicker" test would accept Mass Entanglement 6 ms after a Solar
    // Beam that silenced nobody (2c6e85ec). A kick whose silence carries a
    // different id (Solar Beam 78675 → 81261) needs the cast→effect table of
    // CROSS-THEME G3 and stays "missed" until then.
    const carriesKickAura = (enemy: ICombatUnit) =>
      (enemy.auraEvents ?? []).some(
        (a) =>
          a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
          a.spellId === kick.spellId &&
          kickerIds.has(a.srcUnitId) &&
          a.timestamp >= kickMs &&
          a.timestamp <= kickMs + LANDED_PAIR_MS,
      );
    // The unit the kick was aimed at first: an aura that goes onto several
    // enemies under one id (Avenger's Shield 31935 bounces) would otherwise
    // name whichever of them the unit list holds first.
    const aimed = enemyPlayers.find((e) => e.id === kick.destUnitId);
    const silenced = !hasCastStartData
      ? undefined
      : aimed && carriesKickAura(aimed)
        ? aimed
        : enemyPlayers.find(carriesKickAura);
    if (silenced) {
      const open = openCastOf(silenced, kickMs, true);
      entries.push({
        ...base,
        result: "silenced",
        silencedTargetName: silenced.name,
        ...(open ? { openCastSpellName: open } : {}),
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
    for (const enemy of candidates) {
      jukedBy = openCastOf(enemy, kickMs);
      if (jukedBy) break;
    }

    entries.push(
      jukedBy
        ? { ...base, result: "juked", jukedBySpellName: jukedBy }
        : { ...base, result: "missed" },
    );
  }

  return entries.sort((a, b) => a.atSeconds - b.atSeconds);
}
