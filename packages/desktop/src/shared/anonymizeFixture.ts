/**
 * Match document anonymization (for exporting fixtures).
 *
 * Two consumers: the "export anonymized fixture" action in the developer
 * page's right column, and `scripts/make-report-fixture.mjs`. Per the
 * single-source predicate rule in CLAUDE.md, both import the same function ——
 * the cost of two separate copies is that the day one side misses an update,
 * real player names get committed into the repo (`test/anonymizeFixture.test.ts`
 * has an assertion that the script really does import this module).
 *
 * Replacement is done on the **serialized text**, not field by field: real
 * names show up in deaths.victim, event source/target, pet owner and a pile of
 * other places — changing only units[].name is the same as not anonymizing.
 */

/**
 * Name-Realm → PlayerA-Test. Past 26 players a numeric suffix is appended so
 * aliases never collide.
 */
function aliasFor(i: number): string {
  const letter = String.fromCharCode(65 + (i % 26));
  const round = Math.floor(i / 26);
  return round === 0 ? `Player${letter}-Test` : `Player${letter}${round}-Test`;
}

interface UnitLike {
  kind?: string;
  name?: string;
}
interface DocLike {
  units?: Record<string, UnitLike>;
  rounds?: Array<{ units?: Record<string, UnitLike> }>;
}

/**
 * Collect the real Player name → alias map for the whole document (including
 * every shuffle round).
 */
export function playerAliasMap(doc: unknown): Record<string, string> {
  const d = (doc ?? {}) as DocLike;
  const unitSets: Array<Record<string, UnitLike> | undefined> = [d.units];
  if (Array.isArray(d.rounds))
    for (const r of d.rounds) unitSets.push(r?.units);

  const names: string[] = [];
  for (const set of unitSets) {
    if (!set) continue;
    for (const u of Object.values(set)) {
      if (u?.kind !== "Player") continue;
      const n = u.name;
      if (typeof n !== "string" || !n || names.includes(n)) continue;
      names.push(n);
    }
  }
  // Replace longer names first: when a short name is a substring of a long one
  // (Bob vs Bobby), replacing the short one first shreds the long one.
  const order = [...names].sort((a, b) => b.length - a.length);
  const aliasByName: Record<string, string> = {};
  names.forEach((n, i) => (aliasByName[n] = aliasFor(i)));
  const out: Record<string, string> = {};
  for (const n of order) out[n] = aliasByName[n]!;
  return out;
}

/**
 * Recursively strip rawLines (whole raw log lines carry real names and account
 * info).
 */
function stripRawLines(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripRawLines);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === "rawLines") continue;
      out[k] = stripRawLines(val);
    }
    return out;
  }
  return v;
}

interface AnonymizeResult {
  /** Anonymized JSON text (indent 1, matching the existing fixtures) */
  text: string;
  /** Number of players that were replaced */
  players: number;
}

interface AnonymizeOptions {
  /** Keep real names (only for gitignored local stress-test samples: CN /
   *  special-character original names are themselves the rendering edge-case
   *  under test). rawLines are stripped all the same. */
  keepNames?: boolean;
}

export function anonymizeMatchDoc(
  doc: unknown,
  opts: AnonymizeOptions = {},
): AnonymizeResult {
  const aliases = opts.keepNames ? {} : playerAliasMap(doc);
  let text = JSON.stringify(stripRawLines(doc), null, 1);
  for (const [name, alias] of Object.entries(aliases)) {
    // What we replace inside the JSON text is the escaped literal (only makes
    // a difference when the name contains " or \)
    const literal = JSON.stringify(name).slice(1, -1);
    text = text.split(literal).join(alias);
  }
  return { text, players: Object.keys(aliases).length };
}
