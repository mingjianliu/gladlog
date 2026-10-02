/**
 * castEffectAuraScan.ts — the corpus half of the cast→effect table (triage
 * 2026-09-29 ruling A10 = both: DB2 nominates, the corpus verifies). Reads the
 * nominations `genCastEffectNominations.ts` wrote
 * (`castEffectNominationsGenerated.json`: cast C → aura-bearing spells E that
 * share C's name or sit on C's EffectTriggerSpell chain) and measures, on raw
 * logs, which of them the game actually applies for that cast.
 *
 * Method, per round (`ARENA_MATCH_START` resets), raw lines only (no parse —
 * the ccLifetimeScan approach, one pass, a minute per ~600 files):
 *   - a unit's owner comes from SPELL_SUMMON / SPELL_CREATE (dest → src) and
 *     from the advanced block of its own SPELL_CAST_SUCCESS (info GUID = the
 *     source → owner GUID); a source is resolved to its root owner, so a
 *     totem's / trap's / pet's aura counts for the player who cast C;
 *   - a cast C HITS its nominee E when the same root caster applies E
 *     (SPELL_AURA_APPLIED / _REFRESH) in [cast − 0.1 s, cast + WINDOW_S] —
 *     counted once per cast and aura, never more hits than casts (a trap
 *     thrown at 0 s and sprung at 40 s is still that cast's effect). Every
 *     nominating cast in the window is credited: crediting only the LATEST one
 *     handed Snowdrift's stun 389831 to the ticking 390171 casts the button
 *     389794 starts, and the button lost its own row;
 *   - per E: applications by any source, and how many of them had ANY of
 *     E's nominating casts by the same root caster in the window before them
 *     (`coveredShare`).
 *
 * Acceptance (`--emit`): a pair is kept when hits ≥ MIN_HITS, the effect is
 * mostly an effect of its nominating casts (coveredShare ≥ MIN_SHARE), AND
 * the cast's first application of it usually comes fast (≥ MIN_FAST_SHARE of
 * the hits within FAST_S). The last test is what makes "applied after the
 * cast" mean "applied BY the cast": with a 60 s window alone a frequent cast
 * collected every later aura of its name — Spell Reflection → 385391,
 * Master's Call → 62305, Divine Steed → seven mount variants, all with 0–3 %
 * of their hits within 3 s (2026-10-02, every 10th new-season file: 299 pairs
 * → 189). A trap still passes (Freezing Trap → 3355: 66 % within 3 s). The
 * forward rate (hits / casts) is reported, not required: a talent variant
 * fires for few casts (Diamond Ice's 203337 on Freezing Trap, 5 %). Both
 * thresholds are printed into the table's meta.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/castEffectAuraScan.ts --manifest <m> [--every N] [--emit]
 *     --emit writes packages/analysis/src/data/castEffectAuraGenerated.json
 */
import nominationsData from "@gladlog/analysis/src/data/castEffectNominationsGenerated.json";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { gunzipSync } from "zlib";

const WINDOW_S = 60;
const FAST_S = 3;
const MIN_HITS = 10;
const MIN_SHARE = 0.5;
const MIN_FAST_SHARE = 0.5;

function parseArgs() {
  const a = process.argv.slice(2);
  const out = { manifest: "", every: 1, emit: false };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--manifest") out.manifest = a[++i] ?? "";
    else if (a[i] === "--every") out.every = Number(a[++i]);
    else if (a[i] === "--emit") out.emit = true;
  }
  if (!out.manifest || !Number.isFinite(out.every) || out.every < 1) {
    console.error(
      "usage: castEffectAuraScan.ts --manifest <path> [--every N] [--emit]",
    );
    process.exit(1);
  }
  return out;
}

const TS = /^(\d+)\/(\d+)\/(\d+) (\d+):(\d+):(\d+)\.(\d+)/;
function tsMs(line: string): number | null {
  const m = TS.exec(line);
  if (!m) return null;
  // the parser's rule (packages/parser/src/l1/timestamp.ts): the first three
  // fraction digits are milliseconds, fewer are scaled (codex 35-CD-06: a
  // four-digit fraction read whole made 10.1000 → 10.5000 four seconds)
  const ms = Number(m[7]!.padEnd(3, "0").slice(0, 3));
  return Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +m[6], ms);
}
const NO_GUID = "0000000000000000";

const nominations = (
  nominationsData as unknown as {
    build: string;
    nominations: Record<string, Array<{ aura: string; via: string }>>;
  }
).nominations;
/** E → the casts that nominate it */
const nominators = new Map<string, Set<string>>();
for (const [c, list] of Object.entries(nominations))
  for (const { aura } of list) {
    if (!nominators.has(aura)) nominators.set(aura, new Set());
    nominators.get(aura)!.add(c);
  }

const args = parseArgs();
const files = readFileSync(args.manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % args.every === 0);

const casts = new Map<string, number>();
const pairHits = new Map<string, number>();
const pairFast = new Map<string, number>();
const pairDelays = new Map<string, number[]>();
const auraApps = new Map<string, number>();
const auraCovered = new Map<string, number>();
const inc = (m: Map<string, number>, k: string) =>
  m.set(k, (m.get(k) ?? 0) + 1);

let read = 0;
for (const f of files) {
  let text: string;
  try {
    const raw = readFileSync(f);
    text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  read++;
  let owner = new Map<string, string>();
  // root caster → its nominated casts this round, in log order; the round's
  // nominated aura applications. Paired when the round ends (codex
  // 35-CD-06: an aura logged a line BEFORE its own cast at the same
  // timestamp — Greater Invisibility 0284fcd9, Fortifying Brew cac1a6cd —
  // was lost when pairing ran as the lines streamed).
  let recent = new Map<
    string,
    Array<{ t: number; c: string; hit: Set<string> }>
  >();
  let apps: Array<{ t: number; e: string; who: string }> = [];
  const pairRound = () => {
    for (const { t, e, who } of apps) {
      const noms = nominators.get(e)!;
      const list = recent.get(who);
      if (!list) continue;
      let covered = false;
      for (let i = list.length - 1; i >= 0; i--) {
        const r = list[i]!;
        if (r.t > t + 100) continue;
        if (r.t < t - WINDOW_S * 1000) break;
        if (!noms.has(r.c)) continue;
        covered = true;
        if (r.hit.has(e)) continue;
        r.hit.add(e);
        const k = `${r.c}|${e}`;
        inc(pairHits, k);
        const d = (t - r.t) / 1000;
        if (d <= FAST_S) inc(pairFast, k);
        if (!pairDelays.has(k)) pairDelays.set(k, []);
        pairDelays.get(k)!.push(d);
      }
      if (covered) inc(auraCovered, e);
    }
    apps = [];
    recent = new Map();
  };
  const root = (g: string) => {
    let cur = g;
    for (let i = 0; i < 4; i++) {
      const o = owner.get(cur);
      if (!o || o === cur) break;
      cur = o;
    }
    return cur;
  };
  for (const line of text.split("\n")) {
    const sep = line.indexOf("  ");
    if (sep < 0) continue;
    const body = line.slice(sep + 2);
    if (body.startsWith("ARENA_MATCH_START")) {
      pairRound();
      owner = new Map();
      continue;
    }
    if (!body.startsWith("SPELL_")) continue;
    const p = body.split(",");
    const ev = p[0];
    if (ev === "SPELL_SUMMON" || ev === "SPELL_CREATE") {
      if (p[5] && p[5] !== NO_GUID) owner.set(p[5], p[1]!);
      continue;
    }
    if (ev === "SPELL_CAST_SUCCESS") {
      // advanced block: info GUID, owner GUID right after the spell school
      if (p[12] === p[1] && p[13] && p[13] !== NO_GUID && p[13] !== p[1])
        owner.set(p[1]!, p[13]);
      const c = p[9]!;
      if (!nominations[c]) continue;
      const t = tsMs(line);
      if (t === null) continue;
      inc(casts, c);
      const who = root(p[1]!);
      if (!recent.has(who)) recent.set(who, []);
      recent.get(who)!.push({ t, c, hit: new Set() });
      continue;
    }
    if (ev !== "SPELL_AURA_APPLIED" && ev !== "SPELL_AURA_REFRESH") continue;
    const e = p[9]!;
    const noms = nominators.get(e);
    if (!noms) continue;
    const t = tsMs(line);
    if (t === null) continue;
    inc(auraApps, e);
    apps.push({ t, e, who: root(p[1]!) });
  }
  pairRound();
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};
type Row = {
  aura: string;
  casts: number;
  hits: number;
  hitsWithin3s: number;
  medianDelayS: number;
  coveredShare: number;
  via: string;
};
const rows: Record<string, Row[]> = {};
let kept = 0;
const report: string[] = [];
for (const [k, hits] of pairHits) {
  const [c, e] = k.split("|") as [string, string];
  const share = (auraCovered.get(e) ?? 0) / (auraApps.get(e) ?? 1);
  const row: Row = {
    aura: e,
    casts: casts.get(c) ?? 0,
    hits,
    hitsWithin3s: pairFast.get(k) ?? 0,
    medianDelayS: Math.round(median(pairDelays.get(k) ?? []) * 100) / 100,
    coveredShare: Math.round(share * 1000) / 1000,
    via: nominations[c]!.find((n) => n.aura === e)?.via ?? "?",
  };
  const ok =
    hits >= MIN_HITS &&
    share >= MIN_SHARE &&
    row.hitsWithin3s / hits >= MIN_FAST_SHARE;
  report.push(
    `${ok ? "KEEP" : "drop"} ${c} -> ${e} casts=${row.casts} hits=${hits} (${((100 * hits) / Math.max(1, row.casts)).toFixed(0)}%) fast=${row.hitsWithin3s} p50=${row.medianDelayS}s share=${row.coveredShare} apps=${auraApps.get(e)} via=${row.via}`,
  );
  if (!ok) continue;
  kept++;
  (rows[c] ??= []).push(row);
}
for (const list of Object.values(rows)) list.sort((a, b) => b.hits - a.hits);
report.sort();
for (const r of report) console.log(r);
console.log(
  `files read ${read}/${files.length}; nominated casts seen ${casts.size}; pairs with any hit ${pairHits.size}; kept ${kept}`,
);

if (args.emit) {
  const out = resolve(
    import.meta.dirname,
    "../../analysis/src/data/castEffectAuraGenerated.json",
  );
  const sorted = Object.fromEntries(
    Object.entries(rows).sort((a, b) => Number(a[0]) - Number(b[0])),
  );
  writeFileSync(
    out,
    JSON.stringify(
      {
        meta: {
          producer: "packages/eval/scripts/castEffectAuraScan.ts",
          nominations: `castEffectNominationsGenerated.json (build ${(nominationsData as { build: string }).build})`,
          manifest: args.manifest,
          every: args.every,
          filesRead: read,
          rule: `a cast hits a nominated aura when the same root caster (summons resolved) applies it within ${WINDOW_S} s after the cast (once per cast); a pair is kept when hits >= ${MIN_HITS} the aura's covered share (applications with a nominating cast by the same root caster in the window before them / all applications) >= ${MIN_SHARE}, and >= ${MIN_FAST_SHARE} of the hits come within ${FAST_S} s of the cast`,
          generatedAt: new Date().toISOString(),
        },
        casts: sorted,
      },
      null,
      1,
    ) + "\n",
  );
  console.log(`wrote ${out}: ${Object.keys(rows).length} casts, ${kept} pairs`);
}
