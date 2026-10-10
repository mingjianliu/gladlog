import {
  AtomicArenaCombat,
  CombatExtraSpellAction,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { isCastOrEffect } from "../data/castEffectAuras";
import {
  classifyKickedSpell,
  type KickedSpellCategory,
} from "../data/kickedSpellCategories";
import { SPELL_CATEGORIES as spellsData } from "../data/spellCategories";
import { getEnglishSpellName } from "../data/spellEffectData";
import { buffFullDurationForCaster } from "./buffDuration";
import { CHANNEL_AURA_LAG_MS, channelSpans } from "./castCommitSpans";
import {
  CANCEL_CC_NEAR_S,
  forcedStopInstantsMs,
  STOPPED_JUST_BEFORE_S,
} from "./castStopEvidence";
import { kickCastSpellId, LANDED_PAIR_MS } from "./enemyInterrupts";

type SpellEntry = { type: string };
const SPELLS = spellsData as Record<string, SpellEntry>;

// `LANDED_PAIR_MS` (a landed kick's SPELL_INTERRUPT pairs with the cast
// within it) lives in enemyInterrupts.ts, which also reads it for the
// on-interrupt cooldown talents; re-exported from here, its first home.
export { LANDED_PAIR_MS };
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
/** A channel counts as STOPPED (not run out) only when its logged length is
 * under this share of its official duration. Haste shortens a channel that
 * runs its course, and the log has no "channel finished" row, so the bound
 * is deliberately far below any hasted natural end: the direction that keeps
 * today's `missed` when unsure. 60 triage picks (2026-10-07): the 8 channels
 * that ended ≤ 0.5 s before a kick that stopped nothing ran 0.05–0.19 of
 * their duration (6) and 0.43 / 0.58 (two Void Torrents). */
export const CHANNEL_STOPPED_MAX_SHARE = 0.5;

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
  /** juked by a CHANNEL the target stopped itself: how long before the kick
   * it stopped, seconds (≤ `STOPPED_JUST_BEFORE_S`). Absent for a faked
   * hardcast. */
  jukedChannelStoppedAgoS?: number;
  /** missed: somebody else's interrupt had stopped a cast of the kick's
   * target at most `STOPPED_JUST_BEFORE_S` before this kick (B-tier B7a:
   * 1b930c17 1:36, a Wind Shear 0.07 s after the Hunter's Counter Shot had
   * interrupted the Hex). The result stays `missed`; this is why. */
  beatenBy?: {
    kickerId: string;
    kickerName: string;
    kickSpellName: string;
    interruptedSpellName: string;
    agoS: number;
  };
  /** not landed (juked / missed / unknown, and a `silenced` whose aura went
   * onto ANOTHER unit): the SPELL_MISSED line the log wrote for this kick — the
   * target reflected it, was immune to it, or it missed (FT-T11: 195 of the
   * 4,269 kicks that interrupted nothing on the 605-file capture have one;
   * the audit read none and they all said "hit nothing" or "JUKED"). A fact
   * beside `result`, which it does not change. */
  kickMiss?: IKickMiss;
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

export interface IKickMiss {
  /** the log's own miss type: REFLECT, IMMUNE, MISS, DODGE, … */
  missType: string;
  targetId: string;
  targetName: string;
}
/** A kick and its SPELL_MISSED line share the ms on every pair of the
 * 605-file probe; 100 ms is the allowance. */
export const KICK_MISS_PAIR_MS = 100;
const KICK_MISS_WORD: Readonly<Record<string, string>> = {
  MISS: "MISSED on",
  DODGE: "DODGED by",
  PARRY: "PARRIED by",
  EVADE: "EVADED by",
  DEFLECT: "DEFLECTED by",
  RESIST: "RESISTED by",
};
/** The one wording of `kickMiss`, for every rendering of the audit: the tag
 * vocabulary the control lines use (` [REFLECTED by X]`, ` [IMMUNE: X]`,
 * ` [MISSED on X]`). `label` resolves the target's roster label. */
export function kickMissTag(
  k: Pick<IKickAuditEntry, "kickMiss">,
  label: (name: string, unitId: string) => string,
): string {
  if (!k.kickMiss) return "";
  const who = label(k.kickMiss.targetName, k.kickMiss.targetId);
  if (k.kickMiss.missType === "REFLECT") return ` [REFLECTED by ${who}]`;
  if (k.kickMiss.missType === "IMMUNE") return ` [IMMUNE: ${who}]`;
  const word = KICK_MISS_WORD[k.kickMiss.missType];
  return word ? ` [${word} ${who}]` : "";
}

/** The one wording for a kick juked by a channel its target stopped
 * (`jukedChannelStoppedAgoS`): the prompt's `Kicks:` line and any other
 * rendering of the audit read it. The offset is floored to a tenth; under a
 * tenth it says so instead of "0.0s". */
export function jukedByStoppedChannelText(
  k: Pick<IKickAuditEntry, "jukedBySpellName" | "jukedChannelStoppedAgoS">,
): string {
  const ago = k.jukedChannelStoppedAgoS ?? 0;
  const shown =
    ago < 0.1
      ? "under 0.1s"
      : `${(Math.floor(ago * 10 + 1e-9) / 10).toFixed(1)}s`;
  return `JUKED — their ${k.jukedBySpellName} channel stopped ${shown} before the kick`;
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
 *     bounded at the target's next cast start (kick-priority F-B1). A channel
 *     the target stopped itself at most `STOPPED_JUST_BEFORE_S` before the
 *     kick is the bait before any earlier unfinished hardcast (B-tier B21b,
 *     user ruling 2026-10-06 — the mirror of kick-eaten's `stoppedJustBefore`:
 *     0e0663e6, a Mind Freeze 0.1 s after Divine Hymn stopped read "JUKED by
 *     fake Benediction", a bar from 3.4 s earlier).
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
  const kickerUnits: ICombatUnit[] = [player];
  for (const u of Object.values(
    (combat as { units?: Record<string, ICombatUnit> }).units ?? {},
  )) {
    if (u.ownerId === player.id) {
      kickerIds.add(u.id);
      kickerUnits.push(u);
    }
  }
  const kickerMisses = kickerUnits.flatMap((u) => u.missesOut ?? []);

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

  /** The channel `enemy` stopped itself just before `kickMs`: a logged
   * channel (`channelSpans`, the one channel-length predicate) that ended in
   * the `STOPPED_JUST_BEFORE_S` before the kick, short of its official
   * duration by `CHANNEL_STOPPED_MAX_SHARE`, that nobody interrupted, with
   * no control / silence / landed displacement on the unit within
   * `CANCEL_CC_NEAR_S` of its end (ruling A′17 applies here as it does to the
   * owner's own stops). Of two, the one that ended last. */
  const stoppedChannelOf = (enemy: ICombatUnit, kickMs: number) => {
    const forced = forcedStopInstantsMs(enemy);
    // A control / displacement forces a stop it PRECEDES: one that lands
    // after the channel already ended (and after our kick) forced nothing.
    // The window was symmetric (codex 45-FT-95: Divine Hymn ends 44.648, the
    // kick misses at 44.751, a stun lands at 44.800 → read as forced, so the
    // juke became a plain miss). Same width as before (ruling A′17's
    // CANCEL_CC_NEAR_S), one side; + 1 ms for a line across a ms boundary.
    const forcedNear = (ms: number) =>
      [...forced.cc, ...forced.displaced].some(
        (t) => t <= ms + 1 && ms - t <= CANCEL_CC_NEAR_S * 1000,
      );
    return channelSpans(enemy)
      .filter((ch) => {
        if (ch.endMs > kickMs) return false;
        if (kickMs - ch.endMs > STOPPED_JUST_BEFORE_S * 1000) return false;
        const fullS = buffFullDurationForCaster(ch.spellId, enemy, ch.startMs);
        if (fullS === undefined || !(fullS > 0)) return false;
        if (
          !((ch.endMs - ch.startMs) / 1000 < fullS * CHANNEL_STOPPED_MAX_SHARE)
        )
          return false;
        if (
          allInterrupts.some(
            (a) =>
              a.destUnitId === enemy.id &&
              (a as CombatExtraSpellAction).extraSpellId === ch.spellId &&
              a.logLine.timestamp >= ch.startMs &&
              a.logLine.timestamp <= ch.endMs + CHANNEL_AURA_LAG_MS,
          )
        )
          return false;
        return !forcedNear(ch.endMs);
      })
      .sort((a, b) => b.endMs - a.endMs)[0];
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

    // FT-T11: the miss line the log wrote for this kick, on the unit it was
    // aimed at (first) or on an enemy player. An ABSORB is no miss of a kick.
    const missLines = kickerMisses.filter(
      (m) =>
        isCastOrEffect(kick.spellId ?? "", m.spellId ?? "") &&
        Math.abs(m.timestamp - kickMs) <= KICK_MISS_PAIR_MS &&
        m.missType !== "ABSORB" &&
        !!m.destUnitId &&
        (m.destUnitId === kick.destUnitId ||
          enemyPlayers.some((e) => e.id === m.destUnitId)),
    );
    const missLine =
      missLines.find((m) => m.destUnitId === kick.destUnitId) ?? missLines[0];
    const missed: Pick<IKickAuditEntry, "kickMiss"> = missLine
      ? {
          kickMiss: {
            missType: missLine.missType,
            targetId: missLine.destUnitId,
            targetName: missLine.destUnitName,
          },
        }
      : {};

    // 2b. The kick's own silence aura on an enemy: it landed without a cast
    // to stop (fa5e6c66: six Silences read "hit nothing"). The kick's own id
    // or one of its effect auras in the cast→effect table (`isCastOrEffect`,
    // CROSS-THEME G3), applied by the kicker at or after the kick — a generic
    // "any aura from the kicker" test would accept Mass Entanglement 6 ms
    // after a Solar Beam that silenced nobody (2c6e85ec). The table holds no
    // interrupt row today (2026-10-03): Solar Beam's silence leaves no aura on
    // its target (only CAST_FAILED "silenced"), so a Solar Beam that stopped
    // nothing still reads "missed".
    const carriesKickAura = (enemy: ICombatUnit) =>
      (enemy.auraEvents ?? []).some(
        (a) =>
          a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
          isCastOrEffect(kick.spellId ?? "", a.spellId ?? "") &&
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
      // the aimed unit's miss stays beside "silenced <other>" — it is why
      // the intended target was unaffected (codex 40-FT-38: Avenger's Shield
      // IMMUNE on the aimed enemy, its silence on another)
      entries.push({
        ...base,
        ...missed,
        result: "silenced",
        silencedTargetName: silenced.name,
        ...(open ? { openCastSpellName: open } : {}),
      });
      continue;
    }

    if (!hasCastStartData) {
      entries.push({ ...base, ...missed, result: "unknown" });
      continue;
    }

    // Juke check: the kick's target (fall back to any enemy) cancelled a cast
    // in the lookback window — started, never completed before the kick.
    const candidates = kick.destUnitId
      ? enemyPlayers.filter((e) => e.id === kick.destUnitId)
      : enemyPlayers;
    const stopped = candidates
      .map((enemy) => stoppedChannelOf(enemy, kickMs))
      .filter((ch): ch is NonNullable<typeof ch> => ch !== undefined)
      .sort((a, b) => b.endMs - a.endMs)[0];
    if (stopped) {
      entries.push({
        ...base,
        ...missed,
        result: "juked",
        jukedBySpellName: getEnglishSpellName(
          stopped.spellId,
          stopped.spellName,
        ),
        jukedChannelStoppedAgoS: (kickMs - stopped.endMs) / 1000,
      });
      continue;
    }
    let jukedBy: string | undefined;
    for (const enemy of candidates) {
      jukedBy = openCastOf(enemy, kickMs);
      if (jukedBy) break;
    }

    if (jukedBy) {
      entries.push({
        ...base,
        ...missed,
        result: "juked",
        jukedBySpellName: jukedBy,
      });
      continue;
    }
    // B7a: nothing to kick because another interrupt had just landed on the
    // kick's target — the latest one in the 0.5 s before this kick
    const candidateIds = new Set(candidates.map((e) => e.id));
    const beat = allInterrupts
      .filter(
        (a) =>
          !kickerIds.has(a.srcUnitId) &&
          candidateIds.has(a.destUnitId) &&
          a.logLine.timestamp <= kickMs &&
          kickMs - a.logLine.timestamp <= STOPPED_JUST_BEFORE_S * 1000,
      )
      .sort((a, b) => b.logLine.timestamp - a.logLine.timestamp)[0] as
      CombatExtraSpellAction | undefined;
    entries.push({
      ...base,
      ...missed,
      result: "missed",
      ...(beat
        ? {
            beatenBy: {
              kickerId: beat.srcUnitId,
              kickerName: beat.srcUnitName,
              kickSpellName: getEnglishSpellName(
                beat.spellId ?? "",
                beat.spellName ?? "",
              ),
              interruptedSpellName: getEnglishSpellName(
                beat.extraSpellId ?? "",
                beat.extraSpellName ?? "",
              ),
              agoS: (kickMs - beat.logLine.timestamp) / 1000,
            },
          }
        : {}),
    });
  }

  return entries.sort((a, b) => a.atSeconds - b.atSeconds);
}
