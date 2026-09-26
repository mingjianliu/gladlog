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
