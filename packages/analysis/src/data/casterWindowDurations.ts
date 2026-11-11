/**
 * Auras that run longer when they are applied while another effect of the
 * SAME caster is running — a state-conditional length no flat talent row can
 * hold (`BUFF_DURATION_TALENT_MODIFIERS` prices what a caster owns, not what
 * is up at the application). Read by `buffFullDurationForCaster` when it is
 * given the application's time; without one nothing is added. Registered in
 * curatedIdRegistry.
 *
 * Game-Behaviour evidence per row (DB2 row, mask, corpus split, arithmetic)
 * is in the row's note. Upward only: a row lengthens, never shortens.
 */
export interface ICasterWindowDuration {
  /** the caster's own presses whose running effect lengthens the aura; the
   * window is the press → the press's own length (`buffFullDurationForCaster`
   * of the press, so a talent that shortens it shortens the window) */
  windowCastIds: readonly string[];
  addSeconds: number;
  /** only a caster known NOT to hold this talent is lengthened: its
   * holders' corpus split does not show the extension, and a caster whose
   * talents cannot be read is not lengthened on a guess */
  notWithTalentSpellId?: string;
  note: string;
}

export const CASTER_WINDOW_DURATIONS: Readonly<
  Record<string, ICasterWindowDuration>
> = {
  // Enveloping Mist
  "124682": {
    windowCastIds: ["322118", "325197"],
    addSeconds: 4,
    notWithTalentSpellId: "388212",
    note: "Invoke Yu'lon 322118 / Invoke Chi-Ji 325197 on Enveloping Mist (pipeline T84, GH #123 item 16) — (a) DB2 SpellEffect 1242459 (322118 #4) and 1242462 (325197 #4): aura 107 misc 1 (duration) +4000 ms; (b) class mask 0/0/32768/0 covers 124682 (talentEffectInventoryGenerated, via mask; no label row); (c) 605 files, clean pressed runs of monks without Gift of the Celestials (2026-11-11): celestial alive at the application (SPELL_SUMMON → its UNIT_DIED, 25–26 s) 92 of 114 at 11 s and 7 at 7 s; celestial gone 9 of 322 at 11 s and 275 at 7 s; no Invoke before it 4 of 156 at 11 s and 137 at 7 s; (d) DB2 6 s + Mist Wrap 1 s + 4 s = 11 s. Gift of the Celestials 388212 holders (12 s celestial) are left out: alive, 7 of 22 pressed runs at 11 s and 14 at 7 s — unexplained, FLAG. A copy no press of the monk put up runs 4 s (8 s with the celestial alive: 10 of 21 multi-target copies) — the model's 7 s / 11 s is an upper bound there.",
  },
};
