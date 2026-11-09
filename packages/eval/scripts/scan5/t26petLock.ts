/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, petSpellCastEvents) */
/**
 * scan5/t26petLock.ts — pipeline T26 attempt 5 (assembly review of batch
 * B21, P2): does a pet's Spell Lock go out while its OWNER cannot act?
 * kick-priority's pet path (`kickBlockedOf`) adds the owner's casting locks
 * (`castingLockIntervalsOf(owner)` — Hex, Ice Block …); the enemy-interrupt
 * reader (`interruptCasterAt` → `castBlockingAuraAt(pet)`) reads only the
 * pet. The game behaviour decides which side is right, so the log is asked:
 * every pet Spell Lock SUCCESS, and the owner's state at its millisecond read
 * by the producers' own functions (called, never re-implemented):
 *
 *   ownerCastingLock — `castingLockIntervalsOf(owner, combat, "19647")`
 *                      covers the cast (kick-priority's owner reading)
 *   ownerBlocked     — `castBlockingAuraAt(owner, hostile, ms, "19647")`
 *                      (hard CC, silence, casting lock, own flight) holds
 *   petBlocked       — the same reading on the pet itself (sanity: a pet
 *                      kick under its own stun would be a parse problem)
 *   ownerCommand     — the owner logged Command Demon 119910 / Grimoire 132409
 *                      within 1 s before the pet's cast (button, not autocast)
 *
 *   ownerBlockedSettled[NoCommand] — that block began ≥ 500 ms before the
 *                      cast (no same-instant row-order question) [and the
 *                      owner logged no command: the pet acted on its own]
 *
 * The kinds are counts against `checked` = every pet Spell Lock cast; the
 * owner-lock time share (`petLockOwnerTime`, seconds) is the base rate a
 * cast falling under an owner lock by chance would show.
 */
import { castBlockingAuraAt } from "@gladlog/analysis/src/utils/cannotCastIntervals";
import { castingLockIntervalsOf } from "@gladlog/analysis/src/utils/castingLocks";
import { LogEvent } from "@gladlog/parser-compat";

import type { IRoundCtx } from "./ctx";

export const CHECKS = [
  "petKickOwnerLock",
  "petLockOwnerTimeS",
  "petLockOwnerLockedS",
] as const;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "petKickOwnerLock|ownerCommand",
  "petKickOwnerLock|ownerCommandWhileBlocked",
  "petKickOwnerLock|ownerBlockedSettled",
  "petKickOwnerLock|ownerBlockedSettledNoCommand",
]);
/** an owner block that began this long before the cast is no same-ms
 * ordering question (the aura row and the cast row of one instant) */
const SETTLED_MS = 500;

const PET_SPELL_LOCK = "19647";
const COMMAND_IDS = new Set(["119910", "132409"]);
const COMMAND_LEAD_MS = 1_000;

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  const combat = ctx.legacy;
  const players = ctx.units.filter((u: any) => u.info);
  for (const owner of players) {
    const casts = ((owner.petSpellCastEvents ?? []) as any[]).filter(
      (c) =>
        c.spellId === PET_SPELL_LOCK &&
        c.logLine?.event === LogEvent.SPELL_CAST_SUCCESS,
    );
    if (casts.length === 0) continue;
    const hostile = new Set<string>(
      ctx.units
        .filter(
          (u: any) =>
            u.reaction !== owner.reaction &&
            (u.info || players.some((p: any) => p.id === u.ownerId)),
        )
        .map((u: any) => u.id),
    );
    const locks = castingLockIntervalsOf(owner, combat, PET_SPELL_LOCK);
    // the base rate: owner seconds under a cast-blocking reading
    const roundS = Math.max(0, Math.floor((ctx.end - ctx.start) / 1000));
    ctx.bump("petLockOwnerTimeS", roundS);
    let lockedS = 0;
    for (let s = 0; s < roundS; s++)
      if (
        castBlockingAuraAt(owner, hostile, ctx.start + s * 1000, PET_SPELL_LOCK)
      )
        lockedS++;
    ctx.bump("petLockOwnerLockedS", lockedS);
    const commands = ((owner.spellCastEvents ?? []) as any[]).filter(
      (c) =>
        COMMAND_IDS.has(c.spellId) &&
        c.logLine?.event === LogEvent.SPELL_CAST_SUCCESS,
    );
    for (const c of casts) {
      const ms: number = c.logLine.timestamp;
      ctx.bump("petKickOwnerLock");
      const pet = ctx.units.find((u: any) => u.id === c.srcUnitId);
      const at = `${owner.name}'s pet Spell Lock at +${((ms - ctx.start) / 1000).toFixed(1)}s`;
      const fact = `${owner.id}:${ms}`;
      const lock = locks.find((iv) => iv.from <= ms && ms < iv.to);
      if (lock)
        ctx.violate(
          "petKickOwnerLock",
          "ownerCastingLock",
          ms,
          fact,
          `${at}: owner in casting lock ${lock.spellId} (from ${ms - lock.from} ms before)`,
        );
      const blocked = castBlockingAuraAt(owner, hostile, ms, PET_SPELL_LOCK);
      if (blocked)
        ctx.violate(
          "petKickOwnerLock",
          "ownerBlocked",
          ms,
          fact,
          `${at}: owner under ${blocked.spellName} (${blocked.spellId}, from ${ms - blocked.from} ms before)`,
        );
      if (pet) {
        const pb = castBlockingAuraAt(pet, hostile, ms, PET_SPELL_LOCK);
        if (pb)
          ctx.violate(
            "petKickOwnerLock",
            "petBlocked",
            ms,
            fact,
            `${at}: pet under ${pb.spellName} (${pb.spellId})`,
          );
      }
      const cmd = commands.some(
        (k) =>
          k.logLine.timestamp <= ms &&
          ms - k.logLine.timestamp <= COMMAND_LEAD_MS,
      );
      if (cmd) {
        ctx.violate(
          "petKickOwnerLock",
          "ownerCommand",
          ms,
          fact,
          `${at}: owner Command Demon within 1 s before`,
        );
        if (blocked)
          ctx.violate(
            "petKickOwnerLock",
            "ownerCommandWhileBlocked",
            ms,
            fact,
            `${at}: owner commanded under ${blocked.spellName}`,
          );
      }
      if (blocked && ms - blocked.from >= SETTLED_MS) {
        const d = `${at}: owner under ${blocked.spellName} (${blocked.spellId}) for ${ms - blocked.from} ms${cmd ? ", Command Demon logged" : ", no command logged"}`;
        ctx.violate("petKickOwnerLock", "ownerBlockedSettled", ms, fact, d);
        if (!cmd)
          ctx.violate(
            "petKickOwnerLock",
            "ownerBlockedSettledNoCommand",
            ms,
            fact,
            d,
          );
      }
    }
  }
}
