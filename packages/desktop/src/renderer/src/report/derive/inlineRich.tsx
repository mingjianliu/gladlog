import type { ReactNode } from "react";

import {
  OBSERVED_SPELL_IDS,
  SPELL_NAMES_ZH_GENERATED,
  englishNameIndex,
} from "@gladlog/analysis";

import { SPEC_ID_BY_EN, SPEC_NAMES_ZH } from "../data/specNames";
import { SpecInline, SpellInline } from "../components/SpellInline";
import type { ReportSource } from "./types";

export interface RichDeps {
  /** English spell name → candidate ids (ascending); null = the 12MB table
   * hasn't finished loading, so the whole passage degrades to plain text. */
  nameIndex: ReadonlyMap<string, readonly string[]> | null;
  zhNames: Record<string, string>;
  observed: ReadonlySet<string>;
  specByName: Record<string, number>;
  specZh: Record<string, string>;
}

const defaultDeps = (): RichDeps => ({
  nameIndex: englishNameIndex(),
  zhNames: SPELL_NAMES_ZH_GENERATED,
  observed: OBSERVED_SPELL_IDS,
  specByName: SPEC_ID_BY_EN,
  specZh: SPEC_NAMES_ZH,
});

type Entry =
  | { name: string; kind: "spell"; ids: readonly string[] }
  | { name: string; kind: "spec"; specId: number };

const ASCII = /[A-Za-z]/;
// Apostrophes are deliberately excluded from the token: the bucket key only
// controls bucketing granularity, while exact full-name matching is left to
// text.startsWith(e.name, i) below. If this greedily swallowed the apostrophe
// ("Renew's"), the bucket key of a single-word entry ("Renew") would no longer
// line up with the lookup key derived from possessive text ("Renew" vs
// "Renew's"), silently producing zero hits for every possessive phrasing.
const firstToken = (s: string): string => /^[A-Za-z]+/.exec(s)?.[0] ?? "";

/** First word → candidate entries (sorted by descending name length within a
 * bucket = longest match wins). The index is a singleton on the analysis side,
 * so the whole bucket table is cached by its identity (rebuilding 41k buckets
 * on every makeRichText is not worth it). */
let bucketCache: {
  idx: RichDeps["nameIndex"];
  map: Map<string, Entry[]>;
} | null = null;
function entryBuckets(deps: RichDeps): Map<string, Entry[]> | null {
  if (!deps.nameIndex) return null;
  if (bucketCache && bucketCache.idx === deps.nameIndex) return bucketCache.map;
  const m = new Map<string, Entry[]>();
  const add = (e: Entry) => {
    const k = firstToken(e.name);
    if (!k) return; // name doesn't start with a letter → dropped silently (no such entry in current data)
    const arr = m.get(k);
    if (arr) arr.push(e);
    else m.set(k, [e]);
  };
  for (const [name, ids] of deps.nameIndex) add({ name, kind: "spell", ids });
  for (const [name, specId] of Object.entries(deps.specByName))
    add({ name, kind: "spec", specId });
  for (const arr of m.values())
    arr.sort((a, b) => b.name.length - a.name.length);
  bucketCache = { idx: deps.nameIndex, map: m };
  return m;
}

interface MatchSpellIndex {
  ids: ReadonlySet<string>;
  logNames: ReadonlyMap<string, string>;
}

/** This match's spellId → log name (a CN log gives the Chinese name). All five
 * event arrays use ?? []: trimmed fixtures strip arrays (same lesson as
 * toLegacySafe) and a missing surface must never throw. */
export function buildMatchSpellIndex(source: ReportSource): MatchSpellIndex {
  const ids = new Set<string>();
  const logNames = new Map<string, string>();
  type Ev = { spellId?: number | string; spellName?: string };
  type UnitLike = Partial<
    Record<
      | "casts"
      | "castStarts"
      | "petCasts"
      | "damageOut"
      | "healOut"
      | "auraEvents",
      Ev[]
    >
  >;
  const eat = (evs?: Ev[]) => {
    for (const e of evs ?? []) {
      if (e.spellId == null) continue;
      const id = String(e.spellId);
      ids.add(id);
      if (e.spellName && !logNames.has(id)) logNames.set(id, e.spellName);
    }
  };
  for (const u of Object.values(source.units ?? {}) as UnitLike[]) {
    eat(u.casts);
    // Casts that started but may not have completed (e.g. interrupted/kicked)
    // — scenarios the AI often comments on, such as "Tranquility got kicked",
    // appear only in castStarts, and missing this key degrades disambiguation
    // and the display name for those spells (see the finding #15 review).
    eat(u.castStarts);
    eat(u.petCasts);
    eat(u.damageOut);
    eat(u.healOut);
    eat(u.auraEvents);
  }
  return { ids, logNames };
}

interface Ctx {
  match: MatchSpellIndex;
  lang: "zh" | "en";
  deps: RichDeps;
}

function renderEntry(
  e: Entry,
  original: string,
  ctx: Ctx,
  key: number,
): ReactNode {
  if (e.kind === "spec") {
    const display =
      ctx.lang === "zh" ? (ctx.deps.specZh[e.name] ?? original) : original;
    return (
      <SpecInline
        key={key}
        specId={e.specId}
        display={display}
        original={original}
      />
    );
  }
  const id =
    e.ids.find((x) => ctx.match.ids.has(x)) ??
    e.ids.find((x) => ctx.deps.observed.has(x)) ??
    e.ids[0]!;
  const display =
    ctx.lang === "zh"
      ? (ctx.match.logNames.get(id) ?? ctx.deps.zhNames[id] ?? original)
      : original;
  return (
    <SpellInline key={key} spellId={id} display={display} original={original} />
  );
}

function renderRichText(text: string, ctx: Ctx): ReactNode {
  const buckets = entryBuckets(ctx.deps);
  if (!buckets) return text;
  const out: ReactNode[] = [];
  let plainStart = 0;
  let i = 0;
  let key = 0;
  while (i < text.length) {
    // Only attempt at the start of an ASCII word (the previous character is not
    // an ASCII letter; adjacency to CJK is naturally a word start)
    if (!ASCII.test(text[i]!) || (i > 0 && ASCII.test(text[i - 1]!))) {
      i++;
      continue;
    }
    const token = firstToken(text.slice(i, i + 48)); // assumes the first token is ≤48 chars (holds for current data)
    let hit: Entry | null = null;
    for (const e of buckets.get(token) ?? []) {
      if (!text.startsWith(e.name, i)) continue;
      const after = text[i + e.name.length];
      if (after === undefined || !ASCII.test(after)) {
        hit = e;
        break; // bucket is sorted by descending name length → first hit is the longest
      }
    }
    if (!hit) {
      i += token.length || 1;
      continue;
    }
    if (plainStart < i) out.push(text.slice(plainStart, i));
    out.push(renderEntry(hit, text.slice(i, i + hit.name.length), ctx, key++));
    i += hit.name.length;
    plainStart = i;
  }
  if (out.length === 0) return text; // no hits: return the original string (=== short-circuit)
  if (plainStart < text.length) out.push(text.slice(plainStart));
  return out;
}

/** Built once per match and per language (useMemo at the call site); the
 * returned render function is invoked per passage. */
export function makeRichText(
  source: ReportSource,
  lang: "zh" | "en",
  deps: RichDeps = defaultDeps(),
): (text?: string | null) => ReactNode {
  const match = buildMatchSpellIndex(source);
  return (text) =>
    text ? renderRichText(text, { match, lang, deps }) : (text ?? null);
}
