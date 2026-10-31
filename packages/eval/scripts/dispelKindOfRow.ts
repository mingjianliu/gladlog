/**
 * The kind of one logged SPELL_DISPEL as the product stamps it: a press on a
 * teammate logged as the recipient's own dispel (Mending Bandage: the cast row
 * from the hunter, the dispel rows self → self on the warlock, fact7 D18) is
 * the presser's, and deliberate. `reconstructDispelSummary` rewrites the actor
 * before it classifies; this is that rewrite for the audit readers, which have
 * no unit objects to hand it (`confidenceAudit.ts`, `dispelKindScan.ts`). The
 * two are held equal by a test in `test/scan5ResidualChecks.test.ts`.
 */
import {
  type CastMatchIndex,
  classifyDispel,
  type DispelKind,
  dispelPressedBy,
} from "@gladlog/analysis";

export function dispelKindOfRow(
  index: CastMatchIndex,
  dispel: Parameters<typeof classifyDispel>[1],
  /** is this presser on the logged source's team */
  onSourceTeam: (presserId: string) => boolean,
): DispelKind {
  const presser = dispelPressedBy(index, dispel);
  return classifyDispel(
    index,
    presser !== undefined && onSourceTeam(presser)
      ? { ...dispel, srcUnitId: presser }
      : dispel,
  );
}
