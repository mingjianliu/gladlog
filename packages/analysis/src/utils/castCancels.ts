/**
 * The log owner's own cancelled hardcasts, and the enemy kicks those
 * cancellations made miss — the "you already fake-cast" contrast next to
 * kick-eaten (user request 2026-09-25: "读条我们能算出来读了多少吗 如果是主人自己
 * 取消的话").
 *
 * Only the player who RECORDED the log has cancellations: SPELL_CAST_FAILED is
 * written for that player alone (verified on the new-season archive — one GUID
 * per file). For anybody else `ownerCastCancels` returns null, never zero.
 *
 * A hardcast start (castStartEvents) ends with the first of:
 *  - a same-spell SPELL_CAST_SUCCESS within JUKE_LOOKBACK_MS → completed;
 *  - a SPELL_INTERRUPT of that spell on the owner → kicked;
 *  - a SPELL_CAST_FAILED of that spell (raw streams) → cancelled when the
 *    reason is an interruption (CAST_INTERRUPTED_REASONS, every client locale
 *    the corpus shows) and no control or silence aura (ccSpellIds,
 *    officialSilenceIds) landed on the owner within CANCEL_CC_NEAR_S of it; any other reason (line of sight, range,
 *    "another action is in progress") is not a cancel.
 * The window for all three is the next start or JUKE_LOOKBACK_MS, whichever is
 * first — the cast-bar pairing rule `kickAudit` uses.
 *
 * `progressPct` = elapsed ÷ the owner's median completed duration of the same
 * spell in the round (haste included, since it is the owner's own cast time)
 * — an ESTIMATE; null without a completed cast to compare with, or above 100 %.
 *
 * A cancel is not proof of a fake cast — moving breaks a cast bar the same way
 * and the log cannot tell the two apart. The fake-cast evidence is
 * `baitedKicks`: enemy kicks the product's kickAudit calls "juked" on this
 * unit (by GUID) that went out while one of the cancels above was being cast
 * or within BAIT_AFTER_CANCEL_S after it stopped, with no other cast started
 * in between — consistent with a working fake, not proof of intent. An
 * unrecognised localized reason makes a cancel invisible, so zero cancels
 * means "none detected", not "none".
 *
 * Corpus (605 files, recorder only, 15,591 hardcasts): completed 66 %,
 * cancelled 17 % (median progress 44 %), kicked 6 %, CC'd 4 %; enemy kicks
 * baited 199 vs landed 953.
 */
import type { AtomicArenaCombat, ICombatUnit } from "@gladlog/parser-compat";

import { ccSpellIds, officialSilenceIds } from "../data/spellTags";
import { analyzeKickAudit, JUKE_LOOKBACK_MS } from "./kickAudit";
import type { RawStreams } from "./rawStreams";

/** SPELL_CAST_FAILED reasons that mean "the cast bar was interrupted" — the
 * client writes them localized. Every entry was observed in the new-season
 * archive (605 files, 2026-09-25): Interrupted 2,781 · 被打断 322 ·
 * Interrumpido 65 · Interrompu 64 · 방해를 받아 취소되었습니다. 34 ·
 * Unterbrochen 30 · 被打斷 9 · Interrompido 9. */
export const CAST_INTERRUPTED_REASONS: ReadonlySet<string> = new Set([
  "Interrupted",
  "被打断",
  "被打斷",
  "Interrumpido",
  "Interrompu",
  "방해를 받아 취소되었습니다.",
  "Unterbrochen",
  "Interrompido",
]);

/** A control aura this close to the failure means CC broke the cast. */
export const CANCEL_CC_NEAR_S = 0.3;

/** A juked kick counts as baited by a cancel when it went out from this long
 * before the cancel (the same tick) to this long after it. */
export const BAIT_BEFORE_CANCEL_S = 0.3;
export const BAIT_AFTER_CANCEL_S = 1.5;

export interface CastCancel {
  spellId: string;
  spellName: string;
  /** Cast start, seconds since match start. */
  startS: number;
  /** The SPELL_CAST_FAILED, seconds since match start. */
  cancelS: number;
  progressPct: number | null;
}

export interface BaitedKick {
  atSeconds: number;
  kickerName: string;
  kickSpellName: string;
  /** The owner's cancelled cast the kick missed. */
  baitSpellName: string;
}

export interface OwnerCastCancels {
  hardcasts: number;
  cancels: CastCancel[];
  baitedKicks: BaitedKick[];
}

export function ownerCastCancels(params: {
  owner: ICombatUnit;
  friends: ICombatUnit[];
  enemies: ICombatUnit[];
  combat: AtomicArenaCombat;
  rawStreams?: RawStreams;
}): OwnerCastCancels | null {
  const { owner, friends, enemies, combat, rawStreams } = params;
  if (!rawStreams?.available) return null;
  const failed = rawStreams.castFailed.filter((e) => e.unitGuid === owner.id);
  if (failed.length === 0) return null; // not the recorder
  const start = combat.startTime;
  const sec = (ms: number) => (ms - start) / 1000;
  const capS = JUKE_LOOKBACK_MS / 1000;
  const successes = (owner.spellCastEvents ?? []).filter(
    (e) => e.logLine.event === "SPELL_CAST_SUCCESS",
  );
  const kicks = (owner.actionIn ?? []).filter(
    (a) => a.logLine.event === "SPELL_INTERRUPT",
  );
  const ccAt = (owner.auraEvents ?? [])
    .filter(
      (a) =>
        a.logLine.event === "SPELL_AURA_APPLIED" &&
        // a silence breaks a cast bar too (codex review 2026-09-26)
        (ccSpellIds.has(a.spellId) || officialSilenceIds.has(a.spellId)),
    )
    .map((a) => sec(a.timestamp));
  const starts = (owner.castStartEvents ?? [])
    .map((e) => ({
      id: e.spellId ?? "",
      name: e.spellName ?? "",
      t: sec(e.logLine.timestamp),
    }))
    .sort((a, b) => a.t - b.t);

  const completedDurations = new Map<string, number[]>();
  const pending: Array<{ id: string; name: string; t: number; failS: number }> =
    [];
  starts.forEach((s, i) => {
    const endS = Math.min(s.t + capS, starts[i + 1]?.t ?? Infinity);
    // Same window for all three endings (codex review 2026-09-26: a success
    // looked up past the next start was paired with two starts at once).
    const done = successes.find(
      (e) =>
        e.spellId === s.id &&
        sec(e.logLine.timestamp) >= s.t &&
        sec(e.logLine.timestamp) <= endS,
    );
    const fail = failed.find(
      (e) =>
        String(e.spellId) === s.id && e.tSeconds > s.t && e.tSeconds <= endS,
    );
    if (done && (!fail || sec(done.logLine.timestamp) <= fail.tSeconds)) {
      const d = sec(done.logLine.timestamp) - s.t;
      if (d > 0.2) {
        const list = completedDurations.get(s.id) ?? [];
        list.push(d);
        completedDurations.set(s.id, list);
      }
      return;
    }
    const kicked = kicks.some(
      (a) =>
        (a as { extraSpellId?: string }).extraSpellId === s.id &&
        sec(a.timestamp) >= s.t &&
        sec(a.timestamp) <= endS,
    );
    if (kicked || !fail) return;
    if (!CAST_INTERRUPTED_REASONS.has(fail.reason.trim())) return;
    if (ccAt.some((t) => Math.abs(t - fail.tSeconds) <= CANCEL_CC_NEAR_S))
      return;
    pending.push({ ...s, failS: fail.tSeconds });
  });
  const median = (id: string) => {
    const d = [...(completedDurations.get(id) ?? [])].sort((a, b) => a - b);
    return d.length ? d[Math.floor(d.length / 2)]! : null;
  };
  const cancels: CastCancel[] = pending.map((p) => {
    const m = median(p.id);
    const pct = m ? Math.round(((p.failS - p.t) / m) * 100) : null;
    return {
      spellId: p.id,
      spellName: p.name,
      startS: p.t,
      cancelS: p.failS,
      // An estimate against the round's median bar; above 100 % it is
      // measuring bar-length variance, not this cast (seen: 152 %) — omitted,
      // never clamped (codex review 2026-09-26).
      progressPct: pct !== null && pct <= 100 ? pct : null,
    };
  });

  // A baited kick is a kickAudit "juked" kick on THIS unit (by GUID) that went
  // out right after one of the cancels above — not any juked kick: kickAudit's
  // own juke test only needs an uncompleted cast start, which a CC'd or
  // line-of-sight-failed cast also satisfies (codex review 2026-09-26).
  const baitedKicks: BaitedKick[] = [];
  for (const enemy of enemies)
    for (const k of analyzeKickAudit(enemy, friends, combat)) {
      if (k.result !== "juked" || k.targetId !== owner.id) continue;
      // The same cast instance: it started before the kick, was stopped
      // around it, and no other cast of the owner started in between (else
      // the kick was aimed at that one).
      const bait = cancels.find(
        (c) =>
          c.startS <= k.atSeconds &&
          k.atSeconds >= c.cancelS - BAIT_BEFORE_CANCEL_S &&
          k.atSeconds <= c.cancelS + BAIT_AFTER_CANCEL_S &&
          !starts.some(
            (s) =>
              s.t > Math.min(c.startS, k.atSeconds) &&
              s.t <= k.atSeconds &&
              s.t !== c.startS,
          ),
      );
      if (!bait) continue;
      baitedKicks.push({
        atSeconds: k.atSeconds,
        kickerName: enemy.name,
        kickSpellName: k.kickSpellName,
        baitSpellName: bait.spellName,
      });
    }
  baitedKicks.sort((a, b) => a.atSeconds - b.atSeconds);
  return { hardcasts: starts.length, cancels, baitedKicks };
}
