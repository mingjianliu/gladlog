import { getSpellNamesSnapshot, spellNamesReady } from "./spellEffectData";
import { SPELL_ICONS_GENERATED } from "./spellIconsGenerated";
import { SPELL_NAME_STOPWORDS } from "./spellNameStopwords";

let index: ReadonlyMap<string, readonly string[]> | null = null;

/** English spell name → candidate id list (ascending). Only ids that have an
 * icon are indexed (the icon set = observed ∪ SpellCooldowns ∪ candidates, i.e.
 * already the "worth displaying" universe). Returns null while the 12MB
 * spellNames table has not finished loading — the display path may degrade
 * (the ensure contract) and heals itself on the next render. */
export function englishNameIndex(): ReadonlyMap<
  string,
  readonly string[]
> | null {
  if (index) return index;
  if (!spellNamesReady()) return null;
  const names = getSpellNamesSnapshot();
  const m = new Map<string, string[]>();
  for (const id in SPELL_ICONS_GENERATED) {
    const n = names[id];
    if (!n) continue;
    // 1-2 character "names" are all DB2 placeholders/internal entries, never
    // real teachable spell names (the shortest real name is 3 characters, e.g.
    // Hex). Measured: id 405304's name is the single character "s" — without
    // this filter, the inline rich text (inlineRich.tsx) would wrap the
    // trailing letter of common duration spellings like "30s"/"5s." in the AI
    // prose with a random spell icon.
    if (n.length < 3) continue;
    // Common English words collide with rare/placeholder DB2 spell names (e.g.
    // "Stun" → id 56, a generic hammer icon) — see spellNameStopwords.ts for
    // the stopword list's inclusion criteria and batch notes.
    if (SPELL_NAME_STOPWORDS.has(n)) continue;
    const arr = m.get(n);
    if (arr) arr.push(id);
    else m.set(n, [id]);
  }
  for (const arr of m.values()) arr.sort((a, b) => Number(a) - Number(b));
  index = m;
  return index;
}
