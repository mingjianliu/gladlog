/**
 * Which DB2 override variants share their button's cooldown on a log of a
 * given date — the dated half of `OVERRIDE_VARIANTS_GENERATED` (`logDatedAt`,
 * utils/logEra.ts).
 *
 * Predator's Wake 1259431 / The Hunt 1246167 (fact11 D22 D25 D26 D29, user
 * rulings 2026-11-05): DB2 12.1.0.69933 gives each its own RecoveryTime 90 s
 * and no Category; 12.1.5.70688 puts both in Category 2427 (90 s, shared).
 * On 12.1.0 logs the two are pressed 5–21 s apart with no Collapsing Star
 * reset (8114d8f6, 9efe5b38, be1686eb, 211fe2a6), Predator's Wake once per
 * Void Metamorphosis entry. Before 12.1.5 Predator's Wake is its own 90 s
 * offensive cooldown — its own row and name, no press of The Hunt; from
 * 12.1.5 it is The Hunt's button under Demonsurge, as the generated table
 * says. A log the date cannot place (inside the zone uncertainty before the
 * go-live) takes the 12.1.0 reading like every reader of that cutover
 * (`PATCH_1215_ZONE_BAND_TAKES`); an undatable log, or a reading with no
 * log date at all (`logEpochMs` undefined), takes the shared one — it spends
 * The Hunt rather than call it ready.
 */
import { OVERRIDE_VARIANTS_GENERATED } from "../data/overrideVariantsGenerated";
import type { LogInstant } from "./logEra";
import {
  type ILogDated,
  logDatedAt,
  PATCH_1215_ZONE_BAND_TAKES,
} from "./logEra";
import { offensiveEffectCdId } from "./spellDanger";
import { PATCH_1215_GOLIVE_EPOCH_MS } from "./talents";

/** variant id → whether it shares its overridden button's cooldown, by log
 * date (a variant with no row always shares it) */
export const OVERRIDE_VARIANT_SHARES_BY_ERA: Readonly<
  Record<string, ILogDated<boolean>>
> = {
  "1259431": {
    cutoverEpochMs: PATCH_1215_GOLIVE_EPOCH_MS,
    before: false,
    since: true,
    zoneBandTakes: PATCH_1215_ZONE_BAND_TAKES,
  },
};

/** Does the override variant `variantId` share its button's cooldown on a
 * log at `logEpochMs`? True for every id without a dated row, and for an
 * undated reading (`logEpochMs` undefined: the current game). */
export function variantSharesCooldownAt(
  variantId: string,
  logEpochMs: LogInstant | undefined,
): boolean {
  const dated = OVERRIDE_VARIANT_SHARES_BY_ERA[variantId];
  if (dated === undefined || logEpochMs === undefined) return true;
  return logDatedAt(dated, logEpochMs);
}

/** The button a variant overrides when, on this log, it is NOT that
 * button's press but a cooldown of its own (Predator's Wake before 12.1.5 →
 * The Hunt); undefined otherwise. Such a variant takes the overridden
 * button's kind (an offensive cooldown) on its own row. */
export function ownCooldownVariantOf(
  spellId: string,
  logEpochMs: LogInstant | undefined,
): string | undefined {
  if (variantSharesCooldownAt(spellId, logEpochMs)) return undefined;
  return OVERRIDE_VARIANTS_GENERATED[spellId];
}

/** The cooldown an offensive press spends on a log at `logEpochMs`:
 * `offensiveEffectCdId`, except that a variant which is its own cooldown on
 * that log spends its own (Predator's Wake before 12.1.5). What the press
 * IS (an offensive cooldown's effect) stays `offensiveEffectCdId`'s
 * undated answer. */
export function offensiveCooldownIdAt(
  spellId: string,
  logEpochMs: LogInstant | undefined,
  /** the caster's spec, for a spec-gated member (`offensiveEffectCdId`) */
  spec?: unknown,
): string | undefined {
  const cdId = offensiveEffectCdId(spellId, spec);
  if (cdId === undefined) return undefined;
  return ownCooldownVariantOf(spellId, logEpochMs) !== undefined
    ? spellId
    : cdId;
}
