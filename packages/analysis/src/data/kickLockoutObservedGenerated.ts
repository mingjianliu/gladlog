/**
 * Corpus-observed school-lockout length per kick id (GENERATED — do not
 * hand-edit; regenerate with `packages/eval/scripts/kickLockoutScan.ts`, see
 * docs/commands/update-wow-data.md §6b-pre-5).
 *
 * Role (2026-09-04): the VERIFICATION GATE and second fallback for
 * `kickLockoutSeconds` (spellEffectData.ts), which answers from the official
 * DB2 PvP duration of the kick spell first. GH #62 (2026-09-02) had built this
 * scan on the belief that "DB2 has no lockout field — Effect 68 with no
 * SpellDuration row"; that was wrong: `SpellMisc.PvPDurationIndex` on the
 * kick itself is the lockout (Kick 1766 → 3 s) and `genSpellEffects` already
 * emitted it. The scan stays because the official value must be re-checked
 * against the log each season: after SPELL_INTERRUPT the victim's first
 * same-school cast clusters at the lockout length (0.5 s bins), and
 * `test/kickLockout.test.ts` pins |official − p25| ≤ 0.5 s for every id here
 * with n ≥ 100. Note the bin MODE can sit one bin late (Counterspell 6 vs
 * official 5, p25 = 5.04), which is why the gate reads p25, not the mode.
 *
 * The data lives in the .json of the same name (vite json.stringify ->
 * JSON.parse loading — the big-JSON lesson).
 */
import raw from "./kickLockoutObservedGenerated.json";

export interface IKickLockoutObserved {
  name: string;
  /** 0.5 s-bin mode (lower edge) of the interrupt → first same-school cast gap. */
  lockoutSeconds: number;
  n: number;
  p25: number;
  p50: number;
}

export const KICK_LOCKOUT_OBSERVED: Record<string, IKickLockoutObserved> = (
  raw as { entries: Record<string, IKickLockoutObserved> }
).entries;
