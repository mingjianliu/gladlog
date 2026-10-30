/**
 * Druid form auras. A form-bound buff (Frenzied Regeneration, Ironfur, …)
 * ends the instant the druid leaves the form; its [BUFF FADED] line used to read
 * "(expired)" / "(ended early — absorbed, dispelled, or cancelled)" (reliability
 * round 1 rerun #5, e9ea8a0c). Hand table, registered in curatedIdRegistry (kind aura).
 */
export const DRUID_FORM_AURA_IDS: ReadonlySet<string> = new Set([
  "5487", // Bear Form
  "9634", // Dire Bear Form (legacy id still logged by some builds)
  "768", // Cat Form
  "24858", // Moonkin Form
  "33891", // Incarnation: Tree of Life
  "165961", // Travel Form
]);

/**
 * A form a COOLDOWN opens: cast id → the cooldown's own buff on the caster.
 * Incarnation: Tree of Life (33891) puts up two auras in the instant it is
 * pressed — the form, under the cast's id, and "Incarnation" (117679, DB2
 * duration 30 s), the buff that lets the druid leave the form and shift back
 * for as long as it lasts. Every shift back logs another SPELL_CAST_SUCCESS
 * 33891 and re-applies the form ALONE; a Reforestation proc applies both
 * auras with no cast. Read off the log, both ids observed in the corpus:
 *  - 14055cb2: SUCCESS 19:25:20.030 and 19:27:33.964, each with 117679
 *    APPLIED in the same ms; SUCCESS 19:27:57.698 with 117679 up since
 *    19:27:33 and only 33891 re-applied — a shift back, 24 s after the press;
 *  - b711d4ac: SUCCESS 0:22.9 (117679 applied 3 ms later, removed 1:02.9),
 *    SUCCESS 1:00.8 inside it (form only), SUCCESS 2:06.9 (117679 applied);
 *    three 10 s applications of both auras with no cast in between;
 *  - f4da82c5: three SUCCESS, each with 117679 applied; 539fef93: one.
 * `isFormReshiftCast` (utils/castPress.ts) is the one reader. Registered in
 * curatedIdRegistry (kind mixed).
 */
export const FORM_COOLDOWN_BUFF_BY_CAST_ID: Readonly<Record<string, string>> = {
  "33891": "117679", // Incarnation: Tree of Life → Incarnation
};

/** Tolerance between a buff's removal and the form removal that caused it. */

/**
 * Buffs that exist only inside a form and drop the instant the druid leaves it
 * — the only buffs whose early removal a same-instant form removal explains
 * (codex review 2026-09-26: timestamp proximity alone would relabel a buff on
 * a teammate who died at that second). Hand table, registered (kind aura).
 */
export const FORM_BOUND_BUFF_IDS: ReadonlySet<string> = new Set([
  "22842", // Frenzied Regeneration (Bear Form)
  "192081", // Ironfur (Bear Form)
  "5217", // Tiger's Fury (Cat Form)
]);
