import type { CombatUnitSpec } from "@gladlog/parser-compat";

import { specToString } from "../utils/cooldowns";

/**
 * Roster-class lint (2026-09-22, user report "对面明明是神牧,你确认定是圣骑").
 *
 * The prompt is unambiguous about specs — a 762-round scan of every local
 * Holy Priest round found 0 rounds whose prompt mentions a class absent from
 * the roster — so a finding that names a class nobody on the roster plays is
 * a model-side identity error, and one the reader catches in a second. This
 * is the deterministic guard auditFindings applies: title + explanation are
 * scanned (pre-interpolation, so player names inside placeholders never
 * trip it) for class words, English and Chinese including the common
 * nicknames (奶骑 / 神牧 / 暗牧 / DK / DH …), and any class not derivable
 * from `rosterSpecs` is a violation.
 *
 * Multi-word classes are matched first and blanked out before the
 * single-word ones run, so "Demon Hunter" never reads as Hunter and
 * "死亡骑士" never reads as 骑士 (Paladin).
 */
interface ClassTerms {
  /** The class name as it ends specToString's output ("Holy Priest" → "Priest"). */
  cls: string;
  terms: RegExp[];
}

const CLASS_TERMS: readonly ClassTerms[] = [
  // Multi-word / compound first — see the blanking rule above.
  {
    cls: "Death Knight",
    terms: [/\bDeath Knights?\b/g, /死亡骑士/g, /死骑/g, /\bDKs?\b/g],
  },
  {
    cls: "Demon Hunter",
    terms: [/\bDemon Hunters?\b/g, /恶魔猎手/g, /\bDHs?\b/g],
  },
  { cls: "Warrior", terms: [/\bWarriors?\b/g, /战士/g] },
  {
    cls: "Paladin",
    terms: [/\bPaladins?\b/g, /圣骑/g, /骑士/g],
  },
  { cls: "Hunter", terms: [/\bHunters?\b/g, /猎人/g] },
  { cls: "Rogue", terms: [/\bRogues?\b/g, /盗贼/g, /潜行者/g] },
  {
    cls: "Priest",
    terms: [/\bPriests?\b/g, /牧师/g],
  },
  { cls: "Shaman", terms: [/\bShamans?\b/g, /萨满/g] },
  { cls: "Mage", terms: [/\bMages?\b/g, /法师/g] },
  { cls: "Warlock", terms: [/\bWarlocks?\b/g, /术士/g] },
  { cls: "Monk", terms: [/\bMonks?\b/g, /武僧/g] },
  { cls: "Druid", terms: [/\bDruids?\b/g, /德鲁伊/g, /小德/g] },
  { cls: "Evoker", terms: [/\bEvokers?\b/g, /唤魔师/g] },
];

/**
 * Spec-level terms (2026-09-22, the user's own instance): a Chinese nickname
 * or a full English spec name pins a SPEC, not a class. The model wrote
 * "对饰品在手的奶骑开锤" about an enemy Holy Priest — the stun was the
 * friendly Retribution Paladin's Hammer of Justice, and "Holy healer + a
 * paladin hammer" became 奶骑 (Holy Paladin). A class-level check passes it
 * (a Paladin IS on the roster); only "is a Holy Paladin on the roster" catches
 * it. Matched and blanked before the class terms so 神圣骑士 never reads as
 * 骑士 and "Holy Paladin" never reads as "Paladin".
 */
interface SpecTerms {
  /** specToString output ("Holy Paladin"). */
  spec: string;
  terms: RegExp[];
}

const SPEC_TERMS: readonly SpecTerms[] = [
  {
    spec: "Holy Paladin",
    terms: [/\bHoly Paladins?\b/g, /神圣骑士/g, /神圣骑/g, /奶骑/g],
  },
  {
    spec: "Retribution Paladin",
    terms: [/\bRetribution Paladins?\b/g, /惩戒骑士/g, /惩戒骑/g],
  },
  {
    spec: "Protection Paladin",
    terms: [/\bProtection Paladins?\b/g, /防护骑士/g, /防骑/g],
  },
  {
    spec: "Holy Priest",
    terms: [/\bHoly Priests?\b/g, /神圣牧师/g, /神牧/g, /奶牧/g],
  },
  {
    spec: "Discipline Priest",
    terms: [/\bDiscipline Priests?\b/g, /戒律牧师/g, /戒律牧/g],
  },
  {
    spec: "Shadow Priest",
    terms: [/\bShadow Priests?\b/g, /暗影牧师/g, /暗牧/g],
  },
  {
    spec: "Restoration Druid",
    terms: [/\bRestoration Druids?\b/g, /恢复德鲁伊/g, /奶德/g],
  },
  {
    spec: "Restoration Shaman",
    terms: [/\bRestoration Shamans?\b/g, /恢复萨满/g, /奶萨/g],
  },
  {
    spec: "Mistweaver Monk",
    terms: [/\bMistweaver Monks?\b/g, /织雾武僧/g, /奶僧/g],
  },
  {
    spec: "Preservation Evoker",
    terms: [/\bPreservation Evokers?\b/g, /恩护唤魔师/g, /奶龙/g],
  },
];

/** Class name of a spec, keyed the way CLASS_TERMS is ("Priest", "Death
 * Knight"); null for an unknown spec. */
export function classOfSpec(spec: CombatUnitSpec | string): string | null {
  const name = specToString(spec as CombatUnitSpec);
  for (const { cls } of CLASS_TERMS) {
    if (name.endsWith(cls)) return cls;
  }
  return null;
}

/**
 * Class or spec words in `text` that nobody in `rosterSpecs` plays, as
 * `Paladin ("圣骑士")` / `Holy Paladin ("奶骑")` strings; empty when clean. An empty / all-unknown
 * roster disables the lint (nothing to check against) rather than flagging
 * everything.
 */
export function rosterClassViolations(
  text: string,
  rosterSpecs: readonly (CombatUnitSpec | string)[],
): string[] {
  const roster = new Set<string>();
  const rosterSpecNames = new Set<string>();
  for (const spec of rosterSpecs) {
    const cls = classOfSpec(spec);
    if (cls) {
      roster.add(cls);
      rosterSpecNames.add(specToString(spec as CombatUnitSpec));
    }
  }
  if (roster.size === 0) return [];
  const out: string[] = [];
  let rest = text;
  // Spec level first (see SPEC_TERMS): a nickname pins the spec, and the
  // match is blanked so the class pass below never re-reads it.
  for (const { spec, terms } of SPEC_TERMS) {
    for (const re of terms) {
      const hits = rest.match(re);
      if (!hits) continue;
      rest = rest.replace(re, (m) => " ".repeat(m.length));
      if (!rosterSpecNames.has(spec)) out.push(`${spec} ("${hits[0]}")`);
    }
  }
  for (const { cls, terms } of CLASS_TERMS) {
    for (const re of terms) {
      const hits = rest.match(re);
      if (!hits) continue;
      // Blank the matches so a compound class never leaks into a later,
      // shorter term (Demon Hunter → Hunter, 死亡骑士 → 骑士).
      rest = rest.replace(re, (m) => " ".repeat(m.length));
      if (!roster.has(cls)) out.push(`${cls} ("${hits[0]}")`);
    }
  }
  return out;
}
