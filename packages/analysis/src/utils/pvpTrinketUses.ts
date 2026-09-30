/**
 * The one "this unit used its PvP trinket" predicate (triage 2026-09-29
 * enemy-def F-E19 + res-readiness F-C15, G7-P2). Two log shapes:
 *
 *  - Gladiator's Medallion: a SPELL_CAST_SUCCESS of 336126 (the press);
 *  - Adaptation: no cast at all — the logged trigger is the self-aura
 *    283167 ("PvP Trinket", DB2 0.1 s, CD 120 s; observed), followed by the
 *    lockout debuff 336139. The product used to read Adaptation from
 *    SPELL_CAST_SUCCESS 195756, which occurs 0 times in the corpus (a dead
 *    id): 483f7433's Adaptation priest read "trinket up" through a 60 s
 *    lockout (283167 at 28.783, 336139 28.882 → 88.883).
 *
 * `readyAtMs` is when the trinket is back if the log says so — the matching
 * 336139 REMOVED for Adaptation, read from the log interval rather than a
 * constant (Game-Behaviour Rule: no DB2-checked constant yet); a lockout
 * still up at the round's end reads `Infinity`. Absent = the caller's
 * cooldown constant applies (the Medallion).
 *
 * Consumers: `ccTrinketAnalysis` (the [TRINKET] / [ENEMY TRINKET] lines and
 * every `pvpTrinketRemainingSecondsAt` reader), kill-attempt / kill-window
 * trinket state (`getTrinketStateAtTime`, `attributeFailure`), and
 * `spellOutcomeLines`' self-break test.
 */
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

/** Gladiator's Medallion (active break-CC). */
export const MEDALLION_SPELL_ID = "336126";
/** Adaptation's logged trigger — a self-aura, no cast. */
export const ADAPTATION_TRIGGER_AURA_ID = "283167";
/** Adaptation's lockout debuff: its REMOVED is when the trinket is back. */
export const ADAPTATION_LOCKOUT_AURA_ID = "336139";

export interface IPvpTrinketUse {
  atMs: number;
  /** when it is usable again per the log; undefined = use the cooldown */
  readyAtMs?: number;
  kind: "medallion" | "adaptation";
}

export function pvpTrinketUses(unit: ICombatUnit): IPvpTrinketUse[] {
  const out: IPvpTrinketUse[] = [];
  for (const c of unit.spellCastEvents ?? []) {
    if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
    if (c.spellId !== MEDALLION_SPELL_ID) continue;
    out.push({ atMs: c.logLine.timestamp, kind: "medallion" });
  }
  const auras = (unit.auraEvents ?? []).filter(
    (a) => a.srcUnitId === unit.id || a.destUnitId === unit.id,
  );
  for (const a of auras) {
    if (a.spellId !== ADAPTATION_TRIGGER_AURA_ID) continue;
    if (a.logLine.event !== LogEvent.SPELL_AURA_APPLIED) continue;
    if (a.destUnitId !== undefined && a.destUnitId !== unit.id) continue;
    const t = a.logLine.timestamp;
    // the lockout this trigger started: the first 336139 APPLIED at or
    // after it (≤ 1 s), closed by its REMOVED
    const lockOn = auras.find(
      (x) =>
        x.spellId === ADAPTATION_LOCKOUT_AURA_ID &&
        x.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
        x.logLine.timestamp >= t &&
        x.logLine.timestamp - t <= 1000,
    );
    let readyAtMs: number | undefined;
    if (lockOn) {
      const off = auras.find(
        (x) =>
          x.spellId === ADAPTATION_LOCKOUT_AURA_ID &&
          x.logLine.event === LogEvent.SPELL_AURA_REMOVED &&
          x.logLine.timestamp >= lockOn.logLine.timestamp,
      );
      readyAtMs = off ? off.logLine.timestamp : Number.POSITIVE_INFINITY;
    }
    out.push({
      atMs: t,
      ...(readyAtMs !== undefined ? { readyAtMs } : {}),
      kind: "adaptation",
    });
  }
  return out.sort((a, b) => a.atMs - b.atMs);
}

/**
 * Seconds until a trinket with these uses is back at round second `atS`
 * (0 = ready). THE one "has this use happened yet, and is it back" rule for
 * `pvpTrinketRemainingSecondsAt` (timeline / death / peel lines) and the
 * kill-attempt trinket state (`getTrinketStateAtTime`). Two modes, chosen by
 * what the caller's line means: `renderGrid` — a use counts from the whole
 * second it prints at (PEEL OPTION / CC BOOKMARK, whose gate re-parses the
 * rendered second); exact time — the state at a raw instant (the kill
 * attempt's start, the [CC ON TEAM] note, the death line).
 */
export function trinketUseRemainingSeconds(
  uses: ReadonlyArray<{ atSeconds: number; readyAtSeconds?: number | null }>,
  cooldownSeconds: number,
  atS: number,
  renderGrid: boolean,
): number {
  let remaining = 0;
  for (const u of uses) {
    const happened = renderGrid
      ? Math.floor(u.atSeconds) <= atS
      : u.atSeconds <= atS;
    if (!happened) continue;
    const ready = u.readyAtSeconds ?? u.atSeconds + cooldownSeconds;
    remaining = Math.max(remaining, ready - atS);
  }
  return remaining;
}
