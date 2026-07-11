import { SpellTag } from './spellTypes';

/**
 * Keywords used to intelligently tag dynamically discovered spells.
 * These are matched against the spell name (lowercase).
 */
export const DISCOVERY_TAG_RULES: { pattern: RegExp; tags: SpellTag[] }[] = [
  {
    pattern:
      /unending|resolv|embrace|fortitude|cloak|shell|bark|cocoon|spirit|suppress|protection|ward|block|wall|shield/,
    tags: [SpellTag.Defensive],
  },
  {
    pattern: /avatar|wrath|power|infusion|berserk|recklessness|lust|ascendance|darkness|metamorph|shadowfiend|bender/,
    tags: [SpellTag.Offensive],
  },
  {
    pattern: /scream|stun|blind|trap|sheep|nova|fear|horror|root|bash|clap|roar|shout|disorient/,
    tags: [SpellTag.Control],
  },
];
