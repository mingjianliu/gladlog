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
    // `\bpower\b`, a whole word: bare `power` also matched "Em-power Rune
    // Weapon" 47568, which is a rotation button in 12.x (2 charges / 30 s,
    // no aura, cast 3-19 times a round - triage kick-eaten F-K2, ruling C7).
    // Its catalog Offensive tag went on 2026-10-01 and this rule put it
    // straight back on every Frost Death Knight who talented it (agy review
    // of that batch). Of the 493 active talent spells, the ones naming
    // "power" with a cooldown >= 30 s are Power Infusion, Power Word:
    // Barrier, Power Siphon and Empower Rune Weapon: the word boundary drops
    // exactly the last (pinned in test/data.test.ts).
    pattern:
      /avatar|wrath|\bpower\b|infusion|berserk|recklessness|lust|ascendance|metamorph|shadowfiend|bender/,
    tags: [SpellTag.Offensive],
  },
  {
    pattern: /scream|stun|blind|trap|sheep|nova|fear|horror|root|bash|clap|roar|shout|disorient/,
    tags: [SpellTag.Control],
  },
];
