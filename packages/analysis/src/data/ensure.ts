import { ensureSpellNames } from "./spellEffectData";
import { ensureTalentData, talentDataReady } from "./talentStrings";
import { ensureHeroTalents } from "../utils/talents";

/** The large data tables (spellNames 12MB / talentIdMap 1.6MB) load in the
 * background: module evaluation kicks the load off without blocking the module
 * graph (top-level await once made the renderer's first paint wait serially on
 * 12MB).
 *
 * Contract: **every entry point that builds a prompt must await this function
 * first** — spell and talent names must never degrade inside a prompt (the
 * gate recomputes the rendered text). UI display paths need not wait (they
 * fall back to logName / empty arrays and heal themselves on the next render
 * after loading completes).
 * Degradation is not only cosmetic: without the talent table the roster loses
 * talent cooldown modifiers and replacement abilities (2026-09-24: Divine
 * Shield rendered 300 s instead of 210 s, phantom charges, six abilities
 * missing).
 * App entry points: the renderer's StructuredAnalysisPanel (via the dataReady
 * gate) and main's deepenInner / analysis service. Scripts: every file under a
 * `scripts/` directory that reaches a prompt builder — enforced by
 * packages/eval/test/ensureAnalysisDataEntrypoints.test.ts. */
export async function ensureAnalysisData(): Promise<void> {
  await Promise.all([
    ensureSpellNames(),
    ensureTalentData(),
    ensureHeroTalents(),
  ]);
}

/** Synchronous readiness probe (for the UI: skip one setState round-trip when
 * everything is already loaded). Testing only the talent gate is strictly
 * speaking not enough — all three datasets are ensured together — but
 * talentDataReady is kept as the conservative representative: all three
 * imports are kicked off in the same batch and finish at almost the same
 * moment, and the probe only ever saves one re-render, so a false negative is
 * harmless. */
export const analysisDataReady = (): boolean => talentDataReady();
