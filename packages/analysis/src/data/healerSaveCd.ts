/**
 * Healer SAVE-cooldown roster (corpus + official data, GENERATED json) —
 * GH #63, user ruling 2026-09-04 ("先把这些数据上的问题补上").
 *
 * The hand-written class catalog (`classSpells.ts`) plus the name-regex
 * discovery rules missed 23 of the 53 save cooldowns healers actually press
 * (Healing Tide Totem, Lay on Hands, Revival, Chi-Ji, Rewind, Emerald
 * Communion, …), so every consumer of the Defensive roster — `cd-hoarded`,
 * `[CD PRIOR]`, the cooldown ledger — was blind to them. This table replaces
 * the hand list as the AUTHORITY for healer specs: `extractMajorCooldowns`
 * injects every roster spell the unit has evidence for, tagged Defensive,
 * and strips a catalog Offensive tag on the same id (Avenging Wrath is a
 * healing cooldown in the Holy Paladin's hands).
 *
 * Criterion (recorded in `meta.criterion`, computed in the generator, never
 * here): pressed in ≥ `meta.minShare` of the spec's archived 12.1+ rounds ×
 * official cooldown ≥ `MIN_CD_SECONDS` × official ability profile can save
 * (ally: mitigation / absorb / heals-others / healing-received / immunity via
 * official targeting; self: mitigation / absorb / immunity / self-heal) or
 * user-signed throughput-role. Spells that clear share + cooldown but whose
 * official profile is silent are written to `rejectedForReview` — that list
 * is for a ruling, not silently dropped (Curated-List Completeness Rule).
 *
 * Regenerate at season start and whenever the profile predicates change:
 *   npx tsx packages/eval/scripts/healerSaveCdScan.ts scan --manifest … --every 10 --out <counts.json>
 *   npx tsx packages/eval/scripts/healerSaveCdScan.ts emit-table --in <counts.json> \
 *     --out packages/analysis/src/data/healerSaveCdGenerated.json
 * then regenerate cdTriggerPriorGenerated.json (the roster is its input).
 */
import raw from "./healerSaveCdGenerated.json";

export interface HealerSaveCdEntry {
  spellId: string;
  name: string;
  cooldownSeconds: number;
  share: number;
  rounds: number;
  casts: number;
  savesAlly: boolean;
  savesSelf: boolean;
  why: string[];
}

const SPECS = (
  raw as unknown as {
    specs: Record<
      string,
      { rounds: number; spells: HealerSaveCdEntry[]; stripDefensive?: string[] }
    >;
  }
).specs;
export const HEALER_SAVE_CD_META = (
  raw as unknown as { meta: Record<string, unknown> }
).meta;

const byName = new Map<string, Map<string, HealerSaveCdEntry>>();
const stripByName = new Map<string, ReadonlySet<string>>();
for (const [spec, s] of Object.entries(SPECS ?? {})) {
  const m = new Map<string, HealerSaveCdEntry>();
  for (const e of s.spells ?? []) if (e && e.spellId) m.set(e.spellId, e);
  byName.set(spec, m);
  stripByName.set(spec, new Set(s.stripDefensive ?? []));
}

/** Ids whose catalog / name-regex Defensive tag the injector must DROP for
 * this spec: user-ruled out, profile-ineligible (CC relief, mobility), or
 * measured below the door with n ≥ the door minimum. Anything else the hand
 * catalog tags Defensive is left alone — only evidence overrides the hand
 * list (Power Word: Barrier, n < 100, stays). */
export function healerSaveCdStripDefensive(
  specName: string,
): ReadonlySet<string> {
  return stripByName.get(specName) ?? new Set();
}

/** The roster for one spec, keyed by spellId; null when the table has no
 * entry for the spec (a DPS spec, or a placeholder table). `specName` is
 * `specToString(unit.spec)` — the same function the generator keyed the
 * table with; the caller resolves it (data/ must not import utils/cooldowns,
 * which imports this module). */
export function healerSaveCdRoster(
  specName: string,
): ReadonlyMap<string, HealerSaveCdEntry> | null {
  return byName.get(specName) ?? null;
}

/** Every roster spell id across all specs (registry / rot-scan input). */
export const HEALER_SAVE_CD_IDS: ReadonlySet<string> = new Set(
  [...byName.values()].flatMap((m) => [...m.keys()]),
);
