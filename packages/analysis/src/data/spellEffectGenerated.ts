/**
 * Generated at: 2026-10-16T15:37:42.034Z
 * Build: 12.1.5.70391
 * Candidates: 9615
 * Mined: 9609
 * The data lives in the .json of the same name (vite json.stringify ->
 * JSON.parse loading — the big-JSON lesson).
 */

import type { IMinedSpell } from "./spellEffectData";
import rawEffects from "./spellEffectGenerated.json";

export const SPELL_EFFECTS_GENERATED: Record<string, IMinedSpell> =
  rawEffects as unknown as Record<string, IMinedSpell>;
