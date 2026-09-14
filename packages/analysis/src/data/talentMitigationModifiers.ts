/**
 * Talent value-modifiers on MITIGATION_TABLE auras — GH #96 M3b (design
 * docs/superpowers/specs/2026-09-13-talent-integration-design.md D3/D7).
 *
 * Each row is a DB2 SpellEffect (aura 107, SpellModOp on the effect index that
 * carries the reduction) whose class mask reaches the aura, found by the talent
 * catalog × gap audit. Game-Behaviour Rule: DB2 row + mask are the first two
 * legs; the third is `packages/eval/scripts/mitigationTalentScan.ts` under the
 * band predeclared in the design doc BEFORE it ran (2a23b9da).
 *
 * `validation`:
 *  - "promoted"    — the scan's 90 % interval sat inside ±0.04 of the expected
 *                    pass-through with ≥ 20 holder units. The resolver may
 *                    raise the component's LOWER bound for a caster who holds
 *                    the talent.
 *  - "unvalidated" — anything else. The resolver may only widen the UPPER
 *                    bound (pctMax); no claim that needs the lower bound moves.
 *
 * Talent modifiers add percentage points to the component they target
 * (Barkskin 20 + Oakskin 10 = 30), design D3.
 */
export type TalentMitigationValidation = "promoted" | "unvalidated";

export interface ITalentMitigationModifier {
  auraSpellId: string;
  talentSpellId: string;
  /** school mask the modified effect covers */
  schoolMask: number;
  modPct: number;
  validation: TalentMitigationValidation;
  /** scan evidence: holder unit median, 90 % interval, units (or why not) */
  evidence: string;
}

export const TALENT_MITIGATION_MODIFIERS: readonly ITalentMitigationModifier[] =
  [
    {
      auraSpellId: "22812",
      talentSpellId: "449191",
      schoolMask: 127,
      modPct: 10,
      validation: "promoted",
      evidence:
        "Barkskin + Oakskin: holders 0.688 (90% 0.682–0.697), 302 units, expected 0.70; S2 archive every 30, run 2 2026-09-13",
    },
    {
      auraSpellId: "22812",
      talentSpellId: "393618",
      schoolMask: 127,
      modPct: 10,
      validation: "unvalidated",
      evidence:
        "Barkskin + Reinforced Fur (Guardian): 0 holder units with Barkskin as the only table aura; S2 archive every 30, run 2 2026-09-13",
    },
    {
      auraSpellId: "498",
      talentSpellId: "1261562",
      schoolMask: 127,
      modPct: 10,
      validation: "unvalidated",
      evidence:
        "Divine Protection + Shield of Vengeance (Retribution): 0 holder units on aura 498 (Retribution's copy is 403876, not a table entry); S2 archive every 30, run 2 2026-09-13",
    },
    {
      auraSpellId: "33206",
      talentSpellId: "440738",
      schoolMask: 127,
      modPct: 10,
      validation: "promoted",
      evidence:
        "Pain Suppression + 洞悉大局: holders 0.500 (0.500–0.500), 205 units, non-holders 0.600 (70), expected 0.50; S2 archive every 30, run 2 2026-09-13",
    },
    {
      auraSpellId: "264735",
      talentSpellId: "472707",
      schoolMask: 127,
      modPct: 10,
      validation: "promoted",
      evidence:
        "Survival of the Fittest + Shell Cover: holders 0.667 (0.667–0.667), 230 units, non-holders 0.752 (217), expected 0.65; S2 archive every 30, run 2 2026-09-13",
    },
    {
      auraSpellId: "363916",
      talentSpellId: "441180",
      schoolMask: 127,
      modPct: 10,
      validation: "promoted",
      evidence:
        "Obsidian Scales + Hardened Scales: holders 0.600 (0.600–0.612), 42 units, non-holders 0.701 (102), expected 0.60; S2 archive every 30, run 2 2026-09-13",
    },
    {
      auraSpellId: "104773",
      talentSpellId: "317138",
      schoolMask: 127,
      modPct: 15,
      validation: "promoted",
      evidence:
        "Unending Resolve + Strength of Will: holders 0.600 (0.600–0.604), 229 units, non-holders 0.750 (27), expected 0.60; S2 archive every 30, run 2 2026-09-13",
    },
    {
      auraSpellId: "31224",
      talentSpellId: "457034",
      schoolMask: 1,
      modPct: 20,
      validation: "unvalidated",
      evidence:
        "Cloak of Shadows physical + Bait and Switch: holders 0.707 (0.657–0.800), 23 units, non-holders 0.989 (222), expected 0.80 — interval wider than ±0.04; S2 archive every 30, run 2 2026-09-13",
    },
    {
      auraSpellId: "1022",
      talentSpellId: "387801",
      schoolMask: 126,
      modPct: 15,
      validation: "promoted",
      evidence:
        "Blessing of Protection magic + Echoing Blessings: holders 0.845 (0.814–0.875), 23 units, non-holders 0.983 (135), expected 0.85; S2 archive every 30, run 2 2026-09-13",
    },
    {
      auraSpellId: "108271",
      talentSpellId: "377933",
      schoolMask: 127,
      modPct: 20,
      validation: "promoted",
      evidence:
        "Astral Shift + Astral Bulwark: holders 0.400 (0.398–0.409), 34 units, non-holders 0.600 (171), expected 0.40; S2 archive every 30, run 2 2026-09-13",
    },
    {
      auraSpellId: "186265",
      talentSpellId: "1267218",
      schoolMask: 127,
      modPct: 20,
      validation: "unvalidated",
      evidence:
        "Aspect of the Turtle + 甲壳壁垒: 1 holder unit; S2 archive every 30, run 2 2026-09-13",
    },
  ];

const BY_AURA = new Map<string, ITalentMitigationModifier[]>();
for (const row of TALENT_MITIGATION_MODIFIERS) {
  const list = BY_AURA.get(row.auraSpellId) ?? [];
  list.push(row);
  BY_AURA.set(row.auraSpellId, list);
}

export function talentMitigationModifiersFor(
  auraSpellId: string,
): readonly ITalentMitigationModifier[] {
  return BY_AURA.get(auraSpellId) ?? [];
}
