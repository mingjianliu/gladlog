/**
 * pipeline T40: a press whose effect is a SERIES of auras, each applied when
 * the one before it ends — keyed by the first aura, the rest in order. A
 * `[PRESS]` line's `lasts Ns` is the whole series (`pressDuration`), not its
 * first aura: 1122db73 printed `Chimaeral Sting (lasts 3s, …)` while its
 * venoms ran 9.0 s on the target.
 *
 * Game-Behaviour Rule: the mechanism is each button's own tooltip (the
 * follow-ups are scripted — DB2 carries no trigger row from one aura to the
 * next), the corpus is the split (`packages/eval/scripts/scan5/t40.ts`,
 * `pressChainLasts`, 605 files at 4882aca85):
 *  - Chimaeral Sting 356719 → Scorpid Venom 356723 → Spider Venom 356727 →
 *    Viper Venom 356730. Tooltip: "initiating a series of venoms. Each lasts
 *    $356723d and applies the next effect after the previous one ends."
 *    353 press facts whose first venom was followed by the next within
 *    150 ms of its end, 3 + 3 + 3 s.
 *  - Aspect of the Cheetah 186257 → 186258. Tooltip: "Increases your
 *    movement speed by $s1% for $d. Upon expiring, increases your movement
 *    speed by $186258s1% for another $186258d." 290 press facts, 3 + 9 s.
 *  - the same burst's copy on the hunter's allies, 356781 → 186258 (codex
 *    85-tk-G-T40-1 #3): the line reads that copy when the hunter's own row
 *    is logged ahead of the cast row. Its second phase is the ally's own
 *    aura (`PRESS_EFFECT_CHAIN_HOLDER_SOURCED`): 3cd1a2aa at 1:41, 3.0 +
 *    9.0 s on the ally while the hunter's own, with Aspect of the Fox, ran
 *    3.0 + 13.0 s.
 * A series cut short (a dispel, a death) ends early like any other aura:
 * the line states the full length, as it does for one aura.
 *
 * Registered in `curatedIdRegistry.ts`.
 */
export const PRESS_EFFECT_CHAIN_AURAS: Readonly<
  Record<string, readonly string[]>
> = {
  "356723": ["356727", "356730"],
  "186257": ["186258"],
  "356781": ["186258"],
};

/** The heads whose follow-ups the unit wearing the aura applies to itself,
 * not the press's caster: priced for that unit, and its rows carry that
 * unit as their source. */
export const PRESS_EFFECT_CHAIN_HOLDER_SOURCED: ReadonlySet<string> = new Set([
  "356781",
]);
