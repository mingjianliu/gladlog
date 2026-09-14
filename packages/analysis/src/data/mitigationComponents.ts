/**
 * Mitigation components + the one resolver every consumer prices through —
 * GH #96 M3a (design docs/superpowers/specs/2026-09-13-talent-integration-design.md D3).
 *
 * Why components: a single `{pct, schoolMask}` cannot say "magic immunity AND
 * 20 % physical" (Cloak of Shadows with Bait and Switch), and the Obsidian
 * Scales self/ally split already needed a second number (`pctOnOthers`). M3a
 * only changes the REPRESENTATION: every MITIGATION_TABLE entry becomes one
 * component, and every consumer asks `resolveMitigation` instead of reading
 * the table or `mitigationPctFor` itself. Acceptance: product output
 * byte-identical (findings + context hashes). Talent components (M3b) and
 * cross-aura stacking (not this design) come later.
 *
 * Bounds: `pctMin` / `pctMax` are the protection a component can provide under
 * every configuration the resolver cannot rule out. In M3a nothing is
 * unresolved, so min = max. Consumers pick the bound their CLAIM needs (design
 * D3): "the target sat in a ≥ 30 % wall" uses pctMin; "this would have saved
 * them" uses the lower saved-damage bound.
 */
import { MITIGATION_TABLE, mitigationPctFor } from "./mitigationData";

export type MitigationComponentKind = "pct" | "immunity";

export interface IResolvedMitigationComponent {
  kind: MitigationComponentKind;
  /** school mask the component applies to (log spellSchoolId bit semantics) */
  schoolMask: number;
  pctMin: number;
  pctMax: number;
}

export interface IResolvedMitigation {
  spellId: string;
  /** Darkness class: applies only inside an area the log cannot always place */
  positional: boolean;
  components: IResolvedMitigationComponent[];
  /** what could not be settled for this application (empty in M3a) */
  unresolved: string[];
}

export interface IMitigationContext {
  /** the unit carrying the aura is the unit that cast it (self-applied) */
  carrierIsCaster: boolean;
}

/** Resolve one aura application. Undefined = the aura is not a table entry. */
export function resolveMitigation(
  spellId: string,
  ctx: IMitigationContext,
): IResolvedMitigation | undefined {
  const entry = MITIGATION_TABLE[spellId];
  if (!entry) return undefined;
  // carrier pricing stays in ONE accessor (shared-predicate rule)
  const pct = mitigationPctFor(entry, ctx.carrierIsCaster);
  return {
    spellId,
    positional: !!entry.positional,
    components: [
      {
        kind: pct >= 100 ? "immunity" : "pct",
        schoolMask: entry.schoolMask,
        pctMin: pct,
        pctMax: pct,
      },
    ],
    unresolved: [],
  };
}

/**
 * The strongest percentage component, as the lower (`pctMin`) and upper
 * (`pctMax`) bound. Immunity components are excluded unless asked for —
 * "burst into a wall" and "popped a wall" are claims about percentage walls.
 */
export function strongestComponentPct(
  res: IResolvedMitigation,
  opts: { includeImmunity?: boolean } = {},
): { pctMin: number; pctMax: number } | undefined {
  const comps = res.components.filter(
    (c) => opts.includeImmunity || c.kind !== "immunity",
  );
  if (!comps.length) return undefined;
  return {
    pctMin: Math.max(...comps.map((c) => c.pctMin)),
    pctMax: Math.max(...comps.map((c) => c.pctMax)),
  };
}
