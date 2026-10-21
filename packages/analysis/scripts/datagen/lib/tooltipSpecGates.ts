/**
 * Which specs an effect row of a talent applies to, read from the talent's
 * own tooltip (GH #124, cooldown mastery round 2026-10-20).
 *
 * DB2 has no per-spec column on SpellEffect: a talent several specs can take
 * carries one row per spec's version and the TOOLTIP says which is which —
 * Elemental Affinity 431067: "$?c2[The cooldown of Frost spells … is reduced
 * by $s1%.]?c3[The cooldown of Fire spells is reduced by $s3%.][]". Effect 0
 * (the Frost-spell mask) is the Fire mage's, effect 2 (the Fire-spell mask,
 * Dragon's Breath included) the Frost mage's. Applied to every holder, Fire
 * Dragon's Breath was modelled 28 s against a corpus floor of 40.0 s (372
 * recasts) — a "ready" 12 s early, the accusing direction.
 *
 * The grammar handled: `$?COND[text]` followed by any number of
 * `?COND[text]` and an optional final `[else]`, nested anywhere in text.
 * COND is built from `cN` (the holder's spec is the class's N-th, by
 * ChrSpecialization.OrderIndex + 1), `aID` / `sID` (has aura / knows spell:
 * DEFINITE when the id is a spec passive — SpecializationSpells — and
 * unknown otherwise), `!`, `&`, `|` and parentheses. An effect is referenced
 * by `$sN` / `$mN` (effect N−1 of the talent itself; `$123s1` names another
 * spell and is ignored).
 *
 * The gate of an effect is the union, over its references, of the specs for
 * which the enclosing branches can be taken (nested branches intersect). An
 * unknown condition can be taken by any spec, and the specs that make an
 * EARLIER condition definitely true cannot take a later branch. An effect
 * referenced outside any branch, or never referenced, has no gate.
 */

export interface IClassSpecs {
  /** spec ids in OrderIndex order: c1 is [0] */
  ordered: readonly string[];
}

/** Three-valued: true / false / undefined (could be either). */
type Tri = boolean | undefined;

function and(a: Tri, b: Tri): Tri {
  if (a === false || b === false) return false;
  if (a === true && b === true) return true;
  return undefined;
}
function or(a: Tri, b: Tri): Tri {
  if (a === true || b === true) return true;
  if (a === false && b === false) return false;
  return undefined;
}
function not(a: Tri): Tri {
  return a === undefined ? undefined : !a;
}

/** Evaluate a condition for one spec. `specOfSpell` maps a spec-passive spell
 * id to the specs that own it. Unparseable → undefined. */
export function evalCondition(
  cond: string,
  specIndex: number,
  specId: string,
  specOfSpell: (spellId: string) => readonly string[] | undefined,
): Tri {
  let i = 0;
  const peek = () => cond[i];
  const parseAtom = (): Tri => {
    const ch = peek();
    if (ch === "!") {
      i++;
      return not(parseAtom());
    }
    if (ch === "(") {
      i++;
      const v = parseOr();
      if (peek() === ")") i++;
      return v;
    }
    const m = /^([cas])(\d+)/.exec(cond.slice(i));
    if (!m) {
      i = cond.length;
      return undefined;
    }
    i += m[0].length;
    if (m[1] === "c") return Number(m[2]) === specIndex + 1;
    const owners = specOfSpell(m[2]!);
    return owners ? owners.includes(specId) : undefined;
  };
  const parseAnd = (): Tri => {
    let v = parseAtom();
    while (peek() === "&") {
      i++;
      v = and(v, parseAtom());
    }
    return v;
  };
  const parseOr = (): Tri => {
    let v = parseAnd();
    while (peek() === "|") {
      i++;
      v = or(v, parseAnd());
    }
    return v;
  };
  return parseOr();
}

/** The index of the `]` closing the `[` at `open`, or -1. */
function closeOf(text: string, open: number): number {
  let depth = 0;
  for (let k = open; k < text.length; k++) {
    if (text[k] === "[") depth++;
    else if (text[k] === "]") {
      depth--;
      if (depth === 0) return k;
    }
  }
  return -1;
}

/**
 * effectIndex (0-based) → the spec ids its references can apply to; an
 * effect with an unconditional reference maps to every spec of the class,
 * an unreferenced one is absent.
 */
export function effectSpecGates(
  description: string,
  specs: IClassSpecs,
  specOfSpell: (spellId: string) => readonly string[] | undefined,
): Map<number, Set<string>> {
  const all = new Set(specs.ordered);
  const out = new Map<number, Set<string>>();
  const note = (effectIndex: number, allowed: ReadonlySet<string>) => {
    const s = out.get(effectIndex) ?? new Set<string>();
    for (const x of allowed) s.add(x);
    out.set(effectIndex, s);
  };
  const walk = (text: string, allowed: ReadonlySet<string>) => {
    let k = 0;
    while (k < text.length) {
      if (text.startsWith("$?", k)) {
        // a chain: $?COND[..] (?COND[..])* ([..])?
        let p = k + 1;
        const conds: string[] = [];
        const bodies: string[] = [];
        let elseBody: string | undefined;
        for (;;) {
          if (text[p] === "?") {
            const open = text.indexOf("[", p);
            if (open < 0) break;
            const close = closeOf(text, open);
            if (close < 0) break;
            conds.push(text.slice(p + 1, open));
            bodies.push(text.slice(open + 1, close));
            p = close + 1;
          } else if (text[p] === "[" && conds.length) {
            const close = closeOf(text, p);
            if (close < 0) break;
            elseBody = text.slice(p + 1, close);
            p = close + 1;
            break;
          } else break;
        }
        if (!conds.length) {
          k += 2;
          continue;
        }
        const taken = (branch: number | "else", specIdx: number) => {
          const specId = specs.ordered[specIdx]!;
          const upto = branch === "else" ? conds.length : branch;
          for (let j = 0; j < upto; j++)
            if (evalCondition(conds[j]!, specIdx, specId, specOfSpell) === true)
              return false;
          if (branch === "else") return true;
          return (
            evalCondition(conds[branch]!, specIdx, specId, specOfSpell) !==
            false
          );
        };
        const specsFor = (branch: number | "else") =>
          new Set(
            specs.ordered.filter(
              (s, idx) => allowed.has(s) && taken(branch, idx),
            ),
          );
        bodies.forEach((b, j) => walk(b, specsFor(j)));
        if (elseBody !== undefined) walk(elseBody, specsFor("else"));
        k = p;
        continue;
      }
      const m = /^\$([sSmM])(\d+)/.exec(text.slice(k));
      if (m) {
        note(Number(m[2]) - 1, allowed);
        k += m[0].length;
        continue;
      }
      k++;
    }
  };
  walk(description, all);
  return out;
}

/** An effect the tooltip never names: its gate is not known from the text
 * (`compileCooldownModifiers` may take a sibling row's gate by shared
 * targets). */
export const UNREFERENCED = "unreferenced" as const;

/**
 * The spec ids an effect row is restricted to; undefined when it applies to
 * every holder (an unconditional reference, or every spec); UNREFERENCED when
 * the tooltip never names the effect.
 */
export function onlySpecIdsFor(
  gates: ReadonlyMap<number, ReadonlySet<string>>,
  effectIndex: number,
  specs: IClassSpecs,
): string[] | typeof UNREFERENCED | undefined {
  const g = gates.get(effectIndex);
  if (!g) return UNREFERENCED;
  if (g.size === 0 || g.size >= specs.ordered.length) return undefined;
  return specs.ordered.filter((s) => g.has(s));
}
