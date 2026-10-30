/**
 * Generated at: 2026-10-16T15:38:28.049Z
 * Build: 12.1.5.70391
 * Mined: 43527 (universe = corpus-attested u SpellCooldowns u candidates)
 * The data lives in the .json of the same name (vite json.stringify ->
 * JSON.parse loading — the big-JSON lesson).
 * That .json is dictionary-encoded {names, ids}: icon names repeat heavily, so
 * a flat Record would be nearly half duplicated bytes. It is expanded back into
 * a Record here; the consumer-facing API is unchanged.
 */

import rawIcons from "./spellIconsGenerated.json";

const { names, ids } = rawIcons as unknown as {
  names: string[];
  ids: Record<string, number>;
};

const expanded: Record<string, string> = {};
for (const id in ids) expanded[id] = names[ids[id]!]!;

export const SPELL_ICONS_GENERATED: Record<string, string> = expanded;
