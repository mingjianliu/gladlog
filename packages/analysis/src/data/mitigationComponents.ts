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
import { isCasterSideLinkAura } from "../utils/brokenRowBreaker";
import type { LogInstant } from "../utils/logEra";
import { logInstantOf } from "../utils/logEra";
import { UNDATED_LOG_INSTANT } from "../utils/logEra";
import { logDatedNumberAt } from "../utils/logEra";
import { specPassiveOwnership } from "../utils/talentModifiers";
import { talentModifierOwnershipOf } from "../utils/talentOwnership";
import { unitLogInstant } from "../utils/talents";
import {
  immunityMaskStopsSchool,
  MITIGATION_TABLE,
  mitigationPctFor,
} from "./mitigationData";
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
  caster?: Pick<ICombatUnit, "spec" | "info" | "spellCastEvents"> &
    Partial<Pick<ICombatUnit, "auraEvents" | "logClockOffsetMs">>;
  /** the application's log epoch, for a dated modifier (`datedModPct`);
   * absent = the caster's earliest cast or aura row (`unitLogEpochMs` — a
   * match is minutes long, a cutover's zone uncertainty 14 h), else today's
   * value */
  atMs?: number;
}

/** The log epoch a dated modifier is read at (`IMitigationContext.atMs`).
 * codex review 2026-11-05: a caster with aura rows and no cast row read NaN
 * — today's value — on a historical log. */
function mitigationLogMs(ctx: IMitigationContext): LogInstant {
  if (!ctx.caster) return ctx.atMs ?? UNDATED_LOG_INSTANT;
  return ctx.atMs === undefined
    ? unitLogInstant(ctx.caster)
    : logInstantOf(ctx.caster, ctx.atMs);
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
  // the whole reduction is a talent's (Fade = Translucent Image, GH #126 row
  // 203): a caster without it gets 0, an unknown one 0 as the claim and the
  // table value as the ceiling
  const gate = entry.wholeReductionTalentId;
  // the damage-transfer link on its own caster carries none of it (Blessing
  // of Sacrifice with Echoing Blessings: the paladin's end reads 1.002 on
  // 605, the ally's 0.854 — GH #126 row 170)
  if (
    gate !== undefined &&
    getFactConfig().talentMitigation &&
    isCasterSideLinkAura(spellId, ctx.carrierIsCaster)
  ) {
    components[0].pctMin = 0;
    components[0].pctMax = 0;
  } else if (gate !== undefined && getFactConfig().talentMitigation) {
    const own = ctx.caster
      ? talentModifierOwnershipOf(ctx.caster, gate)
      : "unknown";
    if (own !== "yes") components[0].pctMin = 0;
    if (own === "no") components[0].pctMax = 0;
    if (own !== "yes" && own !== "no")
      unresolved.push(
        `talent ${gate} on ${spellId}: ${ctx.caster ? "ownership unknown" : "caster unknown"}`,
      );
  }
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
    const own = !ctx.caster
      ? "unknown"
      : m.specIds
        ? specPassiveOwnership(m.specIds, ctx.caster.spec)
        : talentModifierOwnershipOf(ctx.caster, m.talentSpellId);
    if (own === "no") continue;
    const certain = m.validation === "promoted" && own === "yes" && !allyCopy;
    const modPct = m.datedModPct
      ? logDatedNumberAt(m.datedModPct, mitigationLogMs(ctx))
      : m.modPct;
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
    if (m.ownEffectSlot) {
      applyOwnSlotModifier(m.schoolMask, modPct, certain, components);
      continue;
    }
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
    // an uncertain modifier widens the range in its own direction only: a
    // strengthening one raises pctMax, a weakening one lowers pctMin (GH #96
    // review, agy — no row is negative today)
    const clamp = (x: number) => Math.max(0, Math.min(99, x));
    if (modPct >= 0 || certain) target.pctMax = clamp(target.pctMax + modPct);
    if (modPct < 0 || certain) target.pctMin = clamp(target.pctMin + modPct);
  }
}

/**
 * The ONE component that prices a hit of school mask `hitSchoolMask`: of the
 * components whose schools the hit touches, the strongest (an immunity
 * first, then the higher lower bound). A hybrid hit (Tremor, physical + fire)
 * into a split row (Evasion with Elusiveness and Bait and Switch: physical
 * 20, magic 32 — the magic one already includes Elusiveness's 20) is priced
 * once, by the 32 the game applies to it, not by both (codex review of
 * batch B7, T27 attempt 2). An immunity component ranks first only when it
 * covers every school of the hit (`immunityMaskStopsSchool`, the reading
 * `immunityStopsSpellSchool` takes): a physical+fire hit into Cloak of
 * Shadows with Bait and Switch meets the physical 20, not the magic
 * immunity (codex review 85-tk-C-T27-2 #3). One that covers part of the hit
 * ranks last — it is still the hit's component when nothing else touches
 * it, so a one-component row prices every hit it touches, exactly as
 * `windowDamage` on its mask did before. Undefined = no component touches
 * the hit.
 */
export function componentForSchool(
  res: IResolvedMitigation,
  hitSchoolMask: number,
): IResolvedMitigationComponent | undefined {
  let best: IResolvedMitigationComponent | undefined;
  const rank = (c: IResolvedMitigationComponent) =>
    c.kind !== "immunity"
      ? c.pctMin
      : immunityMaskStopsSchool(c.schoolMask, hitSchoolMask)
        ? 100
        : -1;
  for (const c of res.components) {
    if ((c.schoolMask & hitSchoolMask) === 0) continue;
    if (
      !best ||
      rank(c) > rank(best) ||
      (rank(c) === rank(best) && c.pctMax > best.pctMax)
    )
      best = c;
  }
  return best;
}

/**
 * The component a stretch of damage met, from that damage split by school
 * (`{ [schoolMask]: amount }`): the one that priced most of it
 * (`componentForSchool` per school). A physical-only burst into an Evasion
 * with Bait and Switch met its 20, not its magic 32. Undefined = no damage
 * any component touches.
 */
export function componentForDamage(
  res: IResolvedMitigation,
  bySchool: Readonly<Record<string, number>>,
): IResolvedMitigationComponent | undefined {
  const share = new Map<IResolvedMitigationComponent, number>();
  for (const [mask, amount] of Object.entries(bySchool)) {
    const c = componentForSchool(res, Number(mask));
    if (c && amount > 0) share.set(c, (share.get(c) ?? 0) + amount);
  }
  let best: IResolvedMitigationComponent | undefined;
  for (const [c, n] of share) if (!best || n > share.get(best)!) best = c;
  return best;
}

/**
 * A talent's whole reduction no claim can stand on — the caster lacks the
 * talent, nobody knows, or it is the paladin's own link — on a row that says
 * the aura is otherwise the off-table mechanic (`unheldIsMechanic`: Blessing
 * of Sacrifice, GH #126 row 170). Its readers print what they printed before
 * the row existed: the death audit's off-table row, [STACKED DEFENSIVES]'
 * "(off-table)".
 */
export function isUnheldMechanic(
  spellId: string,
  res: IResolvedMitigation | undefined,
): boolean {
  return (
    res !== undefined &&
    MITIGATION_TABLE[spellId]?.unheldIsMechanic === true &&
    res.components.every((c) => c.pctMin <= 0)
  );
}

/**
 * A modifier on an aura 87 slot of its own (`ownEffectSlot`): the game
 * multiplies it with the row's reduction on the schools both cover, so the
 * row's component splits there — Evasion with Elusiveness and Bait and
 * Switch is physical 20 and magic 1 − 0.80 × 0.85 = 32 (GH #126 row 234).
 * Same bounds rule as the additive path: an uncertain modifier moves only
 * the bound in its own direction.
 */
function applyOwnSlotModifier(
  schoolMask: number,
  modPct: number,
  certain: boolean,
  components: IResolvedMitigationComponent[],
): void {
  const clamp = (x: number) => Math.max(0, Math.min(99, x));
  const compound = (p: number) =>
    clamp(100 - ((100 - p) * (100 - modPct)) / 100);
  let left = schoolMask;
  for (const c of [...components]) {
    const both = c.schoolMask & schoolMask;
    if (both === 0) continue;
    left &= ~both;
    if (c.kind !== "pct") continue; // an immunity there takes everything
    let target = c;
    if (both !== c.schoolMask) {
      c.schoolMask &= ~both;
      target = { ...c, schoolMask: both };
      components.push(target);
    }
    if (modPct >= 0 || certain) target.pctMax = compound(target.pctMax);
    if (modPct < 0 || certain) target.pctMin = compound(target.pctMin);
  }
  if (left === 0) return;
  components.push({
    kind: "pct",
    schoolMask: left,
    pctMin: certain || modPct < 0 ? clamp(modPct) : 0,
    pctMax: certain || modPct >= 0 ? clamp(modPct) : 0,
  });
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

/**
 * The % one wall application is worth for a "burst into a wall" / "popped a
 * wall" claim: the strongest component's LOWER bound, immunity components
 * included. The single source for burst-into-mitigation's door and `mitPct`
 * (`candidateFindings.ts`) and the `[ENEMY DEF]` line's `(N%, …)`
 * (`enemyDefensives.ts`) — the line used to read the raw table and printed
 * Barkskin 20 % while the candidate priced the same aura 30 % with the
 * caster's talents (GH #114). Undefined = not a table entry.
 */
export function wallDoorPct(
  spellId: string,
  ctx: IMitigationContext,
): number | undefined {
  const res = resolveMitigation(spellId, ctx);
  return res
    ? strongestComponentPct(res, { includeImmunity: true })?.pctMin
    : undefined;
}
