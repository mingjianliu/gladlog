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
 * byte-identical (findings + context hashes). Cross-aura stacking is not this
 * design.
 *
 * M3b: talent value-modifiers (`talentMitigationModifiers.ts`), behind the
 * `talentMitigation` fact switch. A modifier only applies when the resolver is
 * told who CAST the aura (talents belong to the caster). Promoted rows held
 * for certain raise pctMin and pctMax; unvalidated rows, "unknown" ownership,
 * a missing caster, or an ally-carried copy (Obsidian Scales' 15 % — whether
 * the modifier reaches the ally is unmeasured) only raise pctMax and record why
 * in `unresolved`.
 *
 * Bounds: `pctMin` / `pctMax` are the protection a component can provide under
 * every configuration the resolver cannot rule out. In M3a nothing is
 * unresolved, so min = max. Consumers pick the bound their CLAIM needs (design
 * D3): "the target sat in a ≥ 30 % wall" uses pctMin; "this would have saved
 * them" uses the lower saved-damage bound.
 */
import type { ICombatUnit } from "@gladlog/parser-compat";

import { getFactConfig } from "../facts/factProviderConfig";
import { talentModifierOwnershipOf } from "../utils/talentOwnership";
import { MITIGATION_TABLE, mitigationPctFor } from "./mitigationData";
import { talentMitigationModifiersFor } from "./talentMitigationModifiers";

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
  /** what could not be settled for this application */
  unresolved: string[];
}

export interface IMitigationContext {
  /** the unit carrying the aura is the unit that cast it (self-applied) */
  carrierIsCaster: boolean;
  /** the unit that cast the aura, THIS round's unit (talent ownership is per
   * round in Solo Shuffle). Absent = talents cannot be attributed. */
  caster?: Pick<ICombatUnit, "spec" | "info" | "spellCastEvents">;
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
  const components: IResolvedMitigationComponent[] = [
    {
      kind: pct >= 100 ? "immunity" : "pct",
      schoolMask: entry.schoolMask,
      pctMin: pct,
      pctMax: pct,
    },
  ];
  const unresolved: string[] = [];
  const mods = talentMitigationModifiersFor(spellId);
  if (mods.length && getFactConfig().talentMitigation)
    applyTalentModifiers(
      spellId,
      ctx,
      // an ally copy priced differently from the caster's own (Obsidian
      // Scales) — whether the talent reaches that copy is unmeasured
      !ctx.carrierIsCaster && entry.pctOnOthers !== undefined,
      mods,
      components,
      unresolved,
    );
  return {
    spellId,
    positional: !!entry.positional,
    components,
    unresolved,
  };
}

function applyTalentModifiers(
  spellId: string,
  ctx: IMitigationContext,
  allyCopy: boolean,
  mods: ReturnType<typeof talentMitigationModifiersFor>,
  components: IResolvedMitigationComponent[],
  unresolved: string[],
): void {
  for (const m of mods) {
    const own = ctx.caster
      ? talentModifierOwnershipOf(ctx.caster, m.talentSpellId)
      : "unknown";
    if (own === "no") continue;
    const certain = m.validation === "promoted" && own === "yes" && !allyCopy;
    if (!certain)
      unresolved.push(
        `talent ${m.talentSpellId} on ${spellId}: ${
          m.validation !== "promoted"
            ? "unvalidated"
            : !ctx.caster
              ? "caster unknown"
              : own !== "yes"
                ? "ownership unknown"
                : "ally-carried copy"
        }`,
      );
    // the modifier adds points to the percentage component covering its
    // schools; a school the aura does not reduce at all (Cloak's physical,
    // BoP's magic) becomes its own component starting from 0
    let target = components.find(
      (c) => c.kind === "pct" && (c.schoolMask & m.schoolMask) === m.schoolMask,
    );
    if (!target) {
      target = { kind: "pct", schoolMask: m.schoolMask, pctMin: 0, pctMax: 0 };
      components.push(target);
    }
    target.pctMax = Math.min(99, target.pctMax + m.modPct);
    if (certain) target.pctMin = Math.min(99, target.pctMin + m.modPct);
  }
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
