import { SpellTag } from './spellTypes';

/**
 * Keywords used to intelligently tag dynamically discovered spells.
 * These are matched against the spell name (lowercase).
 */
export const DISCOVERY_TAG_RULES: { pattern: RegExp; tags: SpellTag[] }[] = [
  {
    // "darkness" (triage 2026-09-29, menu-coverage F-MC1): Darkness 196718 is
    // a 40 % group wall in this repo's own tables (`MITIGATION_TABLE`,
    // `TEAM_SAVE_CD_IDS`); the name rule had it under Offensive, so it was
    // ledgered as throughput and no "never used" / cd-hoarded line could name
    // it. test/data.test.ts pins: nothing in those two tables discovers as
    // Offensive.
    pattern:
      /unending|resolv|embrace|fortitude|cloak|shell|bark|cocoon|spirit|suppress|protection|ward|block|wall|shield|darkness/,
    tags: [SpellTag.Defensive],
  },
  {
    pattern: /avatar|wrath|power|infusion|berserk|recklessness|lust|ascendance|metamorph|shadowfiend|bender/,
    tags: [SpellTag.Offensive],
  },
  {
    pattern: /scream|stun|blind|trap|sheep|nova|fear|horror|root|bash|clap|roar|shout|disorient/,
    tags: [SpellTag.Control],
  },
];
