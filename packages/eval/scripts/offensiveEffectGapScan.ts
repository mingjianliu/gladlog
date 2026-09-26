/**
 * offensiveEffectGapScan.ts — completeness scan for offensive-cooldown EFFECTS
 * that arrive under another spell id (GH #119, after GH #115's Radiant Glory
 * Avenging Wrath 454351). MEASUREMENT ONLY: nothing here feeds production.
 *
 * Why it exists: `OFFENSIVE_EFFECT_ACTIVATION_IDS` (spellDanger.ts) was born
 * with one entry, found by chance in one audited match. The Curated-List
 * Completeness Rule asks for its completeness to be verified separately from
 * its correctness. A name-match pass found two shapes: talent-granted
 * activations (Doom Winds 466772, Berserk 1269349) and registered cast-id
 * cooldowns whose AURA id no aura consumer knows (Summon Infernal 111685,
 * Shadow Dance 185422, …).
 *
 * Measurement contract (codex astra, plan review + acceptance review,
 * 2026-09-26):
 *  1. Candidates are NOMINATED by official relations only — DB2
 *     SpellEffect.EffectTriggerSpell (≤ 2 hops) from every root, the
 *     AURA_ONLY_ACTIVATION_IDS evidence ids, the registered activations.
 *     Names never nominate; `nameMatch` is a column.
 *  2. Everything is counted INSIDE the round [start, end]; the 45 s minimum
 *     only gates the lift sample.
 *  3. Cast ↔ application is TEMPORAL ASSOCIATION, not attribution: signed
 *     dt = cast − application within ±3 s, per root, nearest wins, every
 *     other root inside the window counted as ambiguity; same-name casts keep
 *     their actual cast ids. A cast under the aura's own id is its own column
 *     (procs log casts too). Nothing is inferred from the aura itself.
 *  4. Interval metrics (observed lifetime, exposure, lift, overlap) come from
 *     the shared `buildAuraIntervals` (duration-capped, observed vs inferred
 *     boundaries); raw-event patterns (re-applied while open, refresh,
 *     early close vs the duration, broken, unclosed) are separate
 *     diagnostics — observations, not diagnoses.
 *  5. Durations carry provenance: `dbBase` = the generated DB2 row
 *     (spellEffectGenerated.json), `effective` = the override layer
 *     (spellEffectData); the residual slice is cut on dbBase.
 *  6. The forward RESIDUAL keeps every aura id applied to a player that the
 *     relations do not explain, regardless of name; each application falls
 *     in exactly one exclusion bucket (printed). Only the self-applied / DPS
 *     / dbBase 6–40 s slice is lift-ranked (merged intervals, clipped at the
 *     player's death, ≥ 15 s outside, pet damage counted once — the converter
 *     already folds it), with coPressed and overlap with already-recognized
 *     offensive auras. Auras that land on PETS are counted apart (outside the
 *     player pass and every aura consumer). There is no cut.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/offensiveEffectGapScan.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-<date>.txt \
 *     [--every 30] [--limit N] [--examples 5] [--min-rounds 30] \
 *     --out <json> [--md <report.md>]
 *   DATAGEN_BUILD / DATAGEN_CACHE pick the cached DB2 build (default: the
 *   talent inventory's build).
 */
import {
  fetchTable,
  parseCsv,
} from "@gladlog/analysis/scripts/datagen/lib/wagoCsv";
import { ensureAnalysisData } from "@gladlog/analysis/src/data/ensure";
import {
  getEnglishSpellName,
  spellEffectData,
} from "@gladlog/analysis/src/data/spellEffectData";
import spellEffectGenerated from "@gladlog/analysis/src/data/spellEffectGenerated.json";
import inventoryGenerated from "@gladlog/analysis/src/data/talentEffectInventoryGenerated.json";
import { buildAuraIntervals } from "@gladlog/analysis/src/utils/auraIntervals";
import {
  AURA_ONLY_ACTIVATION_IDS,
  isHealerSpec,
  specToString,
} from "@gladlog/analysis/src/utils/cooldowns";
import { PATCH_121_GOLIVE_EPOCH_MS } from "@gladlog/analysis/src/utils/drAnalysis";
import {
  isOffensiveSpell,
  OFFENSIVE_CD_SPELL_IDS,
  OFFENSIVE_EFFECT_ACTIVATION_IDS,
} from "@gladlog/analysis/src/utils/spellDanger";
import { GladLogParser } from "@gladlog/parser";
import {
  LogEvent,
  toLegacyMatch,
  toLegacyShuffle,
} from "@gladlog/parser-compat";
import { readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { gunzipSync } from "zlib";

const argv = process.argv.slice(2);
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const num = (f: string, d: number) => Number(flag(f) ?? d);

const MIN_ROUND_S = 45;
const MIN_OUTSIDE_S = 15;
const ASSOC_S = 3;
const CO_PRESS_S = 3;
const CO_CAST_BEFORE_S = -4;
const CO_CAST_AFTER_S = 0.3;
const DUR_SLICE_MIN = 6;
const DUR_SLICE_MAX = 40;
/** signed dt = cast − application, seconds; bin edges */
const DT_EDGES = [-3, -1, -0.3, -0.1, 0.1, 0.3, 1, 3] as const;
const DT_LABELS = [
  "-3..-1",
  "-1..-.3",
  "-.3..-.1",
  "±.1",
  ".1...3",
  ".3..1",
  "1..3",
];

const GEN = spellEffectGenerated as Record<
  string,
  { durationSeconds?: number }
>;
const EFF = spellEffectData as Record<string, { durationSeconds?: number }>;
const pos = (d: unknown) => (typeof d === "number" && d > 0 ? d : undefined);
const dbBaseOf = (id: string) => pos(GEN[id]?.durationSeconds);
const effectiveOf = (id: string) => pos(EFF[id]?.durationSeconds);
const nameOf = (id: string) => getEnglishSpellName(id, id);
const q = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
};
const r2 = (x: number) => Math.round(x * 100) / 100;
const dtBin = (dt: number) => {
  for (let i = 0; i < DT_LABELS.length; i++)
    if (dt <= DT_EDGES[i + 1]!) return i;
  return DT_LABELS.length - 1;
};

function merge(iv: Array<[number, number]>): Array<[number, number]> {
  const s = iv.filter((x) => x[1] > x[0]).sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}
const total = (iv: Array<[number, number]>) =>
  iv.reduce((t, [a, b]) => t + (b - a), 0);
function overlap(
  a: Array<[number, number]>,
  b: Array<[number, number]>,
): number {
  let t = 0;
  for (const [x0, x1] of a)
    for (const [y0, y1] of b)
      t += Math.max(0, Math.min(x1, y1) - Math.max(x0, y0));
  return t;
}

type SourceClass = "self" | "pet" | "friendlyPlayer" | "enemyPlayer" | "other";
type Pattern =
  | "noAssociatedCast"
  | "ambiguous"
  | "reappliedWhileOpen"
  | "closedBeforeDuration"
  | "otherSource"
  | "unclosed";
const newSources = (): Record<SourceClass, number> => ({
  self: 0,
  pet: 0,
  friendlyPlayer: 0,
  enemyPlayer: 0,
  other: 0,
});
const newBins = () => DT_LABELS.map(() => 0);

interface CandStat {
  id: string;
  name: string;
  roots: string[];
  via: string[];
  talents: string[];
  canonical: boolean;
  nameMatch: boolean;
  dbBase?: number;
  effective?: number;
  rawCasts: number;
  apps: number;
  casters: Set<string>;
  unitRounds: Set<string>;
  rounds: Set<string>;
  bySource: Record<SourceClass, number>;
  bySpec: Record<string, number>;
  /** signed dt of the nearest exact-id root cast, per bin */
  assocExact: number[];
  /** "<root>" → applications whose nearest exact cast was that root's */
  assocByRoot: Record<string, number>;
  ambiguous: number;
  /** same-name casts (no exact root cast in window): signed dt bins + the
   * actual cast ids */
  assocSameName: number[];
  sameNameIds: Record<string, number>;
  /** a cast under the aura's OWN id near the application (not a press) */
  ownIdCast: number[];
  noAssociatedCast: number;
  /** for applications with no associated root cast: every cast id the same
   * player made within [CO_CAST_BEFORE_S, CO_CAST_AFTER_S] — counted once
   * per application (a lead for the producer, Game-Behaviour Rule 6) */
  noAssocCoCasts: Record<string, number>;
  /** --probe-cast cross-tab: "root|noRoot + probe|noProbe" (and
   * "noApplication" for intervals with no in-round application) → own
   * applications, complete observed lifetimes, per-unit-round lift */
  groups: Record<
    string,
    { apps: number; lifetimes: number[]; lifts: number[] }
  >;
  /** root → [presses followed within 3 s by this aura from the same actor, presses] */
  pressesByRoot: Record<string, [number, number]>;
  // raw-event diagnostics
  refreshes: number;
  reappliedWhileOpen: number;
  closedBeforeDuration: number;
  broken: number;
  unclosed: number;
  // interval metrics (shared builder, self-sourced)
  observedLifetimes: number[];
  exposureObservedS: number;
  exposureInferredS: number;
  lifts: number[];
  examples: Partial<Record<Pattern, string[]>>;
}
interface ResidualStat {
  id: string;
  name: string;
  nameMatchesRoot: boolean;
  dbBase?: number;
  effective?: number;
  apps: number;
  bySource: Record<SourceClass, number>;
  onDps: number;
  onHealer: number;
  casters: Set<string>;
  unitRounds: Set<string>;
  specs: Record<string, number>;
  examples: string[];
  // ranked slice (self-applied on DPS, dbBase 6–40 s)
  sliceApps: number;
  sliceUnitRounds: number;
  lifts: number[];
  observedS: number;
  inferredS: number;
  coPressed: number;
  overlapRecognizedS: number;
  sliceTimeS: number;
}
type Bucket =
  | "notSelf"
  | "selfOnHealer"
  | "selfDpsNoDbDuration"
  | "selfDpsShort"
  | "selfDpsLong"
  | "slice";

async function main() {
  const manifest = flag("--manifest");
  const outPath = flag("--out");
  if (!manifest || !outPath) {
    console.error(
      "usage: --manifest <txt> --out <json> [--md <md>] [--every 30] [--limit N] [--examples 5] [--min-rounds 30]",
    );
    process.exit(1);
  }
  await ensureAnalysisData();
  const every = num("--every", 30);
  const limit = num("--limit", 0);
  const maxExamples = num("--examples", 5);
  const minRounds = num("--min-rounds", 30);
  /** cast ids to cross-tab every candidate application against (e.g. Eye
   * Beam 198013 for Demonic's Metamorphosis) */
  const probeIds = (flag("--probe-cast") ?? "").split(",").filter(Boolean);

  // ── DB2 leg: nominate candidates from official relations ────────────────
  const build =
    process.env.DATAGEN_BUILD ??
    (inventoryGenerated as { _meta: { build: string } })._meta.build;
  const cacheDir =
    process.env.DATAGEN_CACHE ??
    path.join(homedir(), ".cache", "gladlog-datagen");
  const eff = parseCsv(await fetchTable("SpellEffect", build, cacheDir));
  const children = new Map<string, Set<string>>();
  for (const r of eff.rows) {
    const p = String(r.SpellID ?? "");
    const c = String(r.EffectTriggerSpell ?? "0");
    if (!p || c === "0" || c === "" || c === p) continue;
    (children.get(p) ?? children.set(p, new Set()).get(p)!).add(c);
  }
  const roots = new Set<string>(OFFENSIVE_CD_SPELL_IDS);
  for (const [, c] of OFFENSIVE_EFFECT_ACTIVATION_IDS) roots.add(c);
  for (const k of Object.keys(AURA_ONLY_ACTIVATION_IDS)) roots.add(k);
  const rootNames = new Set([...roots].map(nameOf));

  const inv = inventoryGenerated as unknown as {
    edges: { talentSpellId: string; spellId: string; hop: number }[];
  };
  const talentsOf = new Map<string, Set<string>>();
  for (const e of inv.edges)
    if (e.talentSpellId !== e.spellId)
      (
        talentsOf.get(e.spellId) ??
        talentsOf.set(e.spellId, new Set()).get(e.spellId)!
      ).add(e.talentSpellId);

  const cands = new Map<string, CandStat>();
  const addCand = (id: string, root: string, via: string) => {
    let c = cands.get(id);
    if (!c) {
      c = {
        id,
        name: nameOf(id),
        roots: [],
        via: [],
        talents: [...(talentsOf.get(id) ?? [])],
        canonical: OFFENSIVE_CD_SPELL_IDS.has(id),
        nameMatch: false,
        dbBase: dbBaseOf(id),
        effective: effectiveOf(id),
        rawCasts: 0,
        apps: 0,
        casters: new Set(),
        unitRounds: new Set(),
        rounds: new Set(),
        bySource: newSources(),
        bySpec: {},
        assocExact: newBins(),
        assocByRoot: {},
        ambiguous: 0,
        assocSameName: newBins(),
        sameNameIds: {},
        ownIdCast: newBins(),
        noAssociatedCast: 0,
        noAssocCoCasts: {},
        groups: {},
        pressesByRoot: {},
        refreshes: 0,
        reappliedWhileOpen: 0,
        closedBeforeDuration: 0,
        broken: 0,
        unclosed: 0,
        observedLifetimes: [],
        exposureObservedS: 0,
        exposureInferredS: 0,
        lifts: [],
        examples: {},
      };
      cands.set(id, c);
    }
    if (!c.roots.includes(root)) c.roots.push(root);
    if (!c.via.includes(via)) c.via.push(via);
    if (nameOf(root) === c.name) c.nameMatch = true;
  };
  for (const r of roots) {
    addCand(r, r, "self");
    let frontier = [r];
    for (let hop = 1; hop <= 2; hop++) {
      const next: string[] = [];
      for (const p of frontier)
        for (const ch of children.get(p) ?? []) {
          addCand(ch, r, `trigger${hop}:${p}`);
          next.push(ch);
        }
      frontier = next;
    }
  }
  for (const [k, auras] of Object.entries(AURA_ONLY_ACTIVATION_IDS))
    for (const a of auras) addCand(a, k, "auraOnly");
  for (const [a, c] of OFFENSIVE_EFFECT_ACTIVATION_IDS)
    addCand(a, c, "activation");

  const residual = new Map<string, ResidualStat>();
  const buckets: Record<Bucket, { apps: number; ids: Set<string> }> = {
    notSelf: { apps: 0, ids: new Set() },
    selfOnHealer: { apps: 0, ids: new Set() },
    selfDpsNoDbDuration: { apps: 0, ids: new Set() },
    selfDpsShort: { apps: 0, ids: new Set() },
    selfDpsLong: { apps: 0, ids: new Set() },
    slice: { apps: 0, ids: new Set() },
  };
  const petRecipient = new Map<
    string,
    {
      id: string;
      name: string;
      apps: number;
      candidate: boolean;
      nameMatchesRoot: boolean;
    }
  >();

  // ── corpus leg ───────────────────────────────────────────────────────────
  let files = readFileSync(manifest, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((_, i) => i % every === 0);
  if (limit) files = files.slice(0, limit);
  let scanned = 0;
  let rounds = 0;
  let liftRounds = 0;

  const example = (
    list: Partial<Record<Pattern, string[]>>,
    p: Pattern,
    where: string,
    relS: number,
  ) => {
    const l = (list[p] ??= []);
    if (l.length < maxExamples) l.push(`${where}@${relS.toFixed(1)}s`);
  };

  const scanRound = (c: any, where: string) => {
    if ((c.startTime ?? 0) < PATCH_121_GOLIVE_EPOCH_MS) return;
    const t0 = c.startTime as number;
    const t1 = c.endTime as number;
    if (!(t1 > t0)) return;
    rounds++;
    const liftEligible = t1 - t0 >= MIN_ROUND_S * 1000;
    if (liftEligible) liftRounds++;
    const inRound = (ts: number) => ts >= t0 && ts <= t1;
    const units: Record<string, any> = c.units ?? {};
    const players = Object.values(units).filter((u: any) => u.info) as any[];
    const isPlayer = (id: string) => !!units[id]?.info;
    const actorOf = (srcId: string): string | undefined => {
      if (isPlayer(srcId)) return srcId;
      const owner = units[srcId]?.ownerId;
      return owner && isPlayer(owner) ? owner : undefined;
    };
    const castersById = new Map(players.map((u) => [u.id as string, u]));

    // in-round casts per player, by id and by English name
    const castsOf = new Map<string, Map<string, number[]>>();
    const castsByName = new Map<string, Map<string, Array<[number, string]>>>();
    for (const u of players) {
      const byId = new Map<string, number[]>();
      const byName = new Map<string, Array<[number, string]>>();
      for (const e of u.spellCastEvents ?? []) {
        if (e.logLine?.event !== LogEvent.SPELL_CAST_SUCCESS || !e.spellId)
          continue;
        const ts = e.logLine.timestamp as number;
        if (!inRound(ts)) continue;
        const id = String(e.spellId);
        (byId.get(id) ?? byId.set(id, []).get(id)!).push(ts);
        const n = nameOf(id);
        (byName.get(n) ?? byName.set(n, []).get(n)!).push([ts, id]);
        const cs = cands.get(id);
        if (cs) cs.rawCasts++;
      }
      castsOf.set(u.id, byId);
      castsByName.set(u.id, byName);
    }
    // in-round candidate applications by actor (press → aura direction)
    const appsIndex = new Map<string, Array<[string, number]>>();
    for (const v of players)
      for (const a of v.auraEvents ?? []) {
        if (a.logLine?.event !== LogEvent.SPELL_AURA_APPLIED) continue;
        const ts = a.logLine.timestamp as number;
        if (!inRound(ts)) continue;
        const id = String(a.spellId ?? "");
        if (!cands.has(id)) continue;
        const who = actorOf(String(a.srcUnitId ?? ""));
        if (!who) continue;
        (appsIndex.get(id) ?? appsIndex.set(id, []).get(id)!).push([who, ts]);
      }
    // pets / guardians
    for (const pet of Object.values(units) as any[]) {
      if (pet.info || !pet.ownerId || !isPlayer(pet.ownerId)) continue;
      for (const a of pet.auraEvents ?? []) {
        if (a.logLine?.event !== LogEvent.SPELL_AURA_APPLIED) continue;
        if (!inRound(a.logLine.timestamp)) continue;
        const id = String(a.spellId ?? "");
        if (!id) continue;
        const p = petRecipient.get(id) ?? {
          id,
          name: nameOf(id),
          apps: 0,
          candidate: cands.has(id) || roots.has(id),
          nameMatchesRoot: rootNames.has(nameOf(id)),
        };
        p.apps++;
        petRecipient.set(id, p);
      }
    }
    const deathOf = (u: any) =>
      (u.deathRecords ?? [])
        .map((d: any) => d.timestamp)
        .filter((t: number) => t > t0 && t <= t1)
        .sort((a: number, b: number) => a - b)[0] as number | undefined;

    for (const u of players) {
      const uEnd = Math.min(t1, deathOf(u) ?? t1);
      const uEndRel = (uEnd - t0) / 1000;
      const dps = !isHealerSpec(u.spec);
      const spec = specToString(u.spec);
      const unitRound = `${where}:${u.id}`;
      const myCasts = castsOf.get(u.id)!;
      /** --probe-cast: candidate id → [application relS, group] (self-applied) */
      const appGroups = new Map<string, Array<[number, string]>>();

      // ── raw-event pass (in-round): applications, association, patterns
      const auras = [...(u.auraEvents ?? [])]
        .filter((a: any) => a.destUnitId === u.id || a.destUnitId === undefined)
        .sort((a: any, b: any) => a.logLine.timestamp - b.logLine.timestamp);
      const open = new Map<string, number>();
      for (const a of auras) {
        const ts = a.logLine.timestamp as number;
        if (!inRound(ts)) continue;
        const id = String(a.spellId ?? "");
        if (!id) continue;
        const ev = a.logLine.event;
        const src = String(a.srcUnitId ?? "");
        const key = `${id}\u0000${src}`;
        const cand = cands.get(id);
        const relS = (ts - t0) / 1000;
        if (ev === LogEvent.SPELL_AURA_APPLIED) {
          const sourceClass: SourceClass =
            src === u.id
              ? "self"
              : isPlayer(src)
                ? units[src]?.reaction === u.reaction
                  ? "friendlyPlayer"
                  : "enemyPlayer"
                : actorOf(src)
                  ? "pet"
                  : "other";
          const wasOpen = open.has(key);
          open.set(key, ts);
          const actor = actorOf(src);
          if (cand) {
            cand.apps++;
            cand.bySource[sourceClass]++;
            cand.bySpec[spec] = (cand.bySpec[spec] ?? 0) + 1;
            cand.casters.add(actor ?? src);
            cand.unitRounds.add(unitRound);
            cand.rounds.add(where);
            if (wasOpen) {
              cand.reappliedWhileOpen++;
              example(cand.examples, "reappliedWhileOpen", where, relS);
            }
            if (sourceClass !== "self")
              example(cand.examples, "otherSource", where, relS);
            if (actor) {
              let own: number | null = null;
              for (const t of myOrActorCasts(actor).get(id) ?? []) {
                const dt = (t - ts) / 1000;
                if (
                  Math.abs(dt) <= ASSOC_S &&
                  (own === null || Math.abs(dt) < Math.abs(own))
                )
                  own = dt;
              }
              if (own !== null) cand.ownIdCast[dtBin(own)]!++;
            }
            const otherRoots = cand.roots.filter((r) => r !== id);
            if (otherRoots.length && actor) {
              const hits: Array<{ root: string; dt: number }> = [];
              for (const root of otherRoots) {
                let best: number | null = null;
                for (const t of myOrActorCasts(actor).get(root) ?? []) {
                  const dt = (t - ts) / 1000;
                  if (
                    Math.abs(dt) <= ASSOC_S &&
                    (best === null || Math.abs(dt) < Math.abs(best))
                  )
                    best = dt;
                }
                if (best !== null) hits.push({ root, dt: best });
              }
              if (hits.length) {
                hits.sort((x, y) => Math.abs(x.dt) - Math.abs(y.dt));
                cand.assocExact[dtBin(hits[0]!.dt)]!++;
                cand.assocByRoot[hits[0]!.root] =
                  (cand.assocByRoot[hits[0]!.root] ?? 0) + 1;
                if (hits.length > 1) {
                  cand.ambiguous++;
                  example(cand.examples, "ambiguous", where, relS);
                }
              } else {
                let best: { dt: number; castId: string } | null = null;
                for (const root of otherRoots)
                  for (const [t, castId] of castsByName
                    .get(actor)
                    ?.get(nameOf(root)) ?? []) {
                    if (castId === id) continue;
                    const dt = (t - ts) / 1000;
                    if (
                      Math.abs(dt) <= ASSOC_S &&
                      (!best || Math.abs(dt) < Math.abs(best.dt))
                    )
                      best = { dt, castId };
                  }
                if (best) {
                  cand.assocSameName[dtBin(best.dt)]!++;
                  cand.sameNameIds[best.castId] =
                    (cand.sameNameIds[best.castId] ?? 0) + 1;
                } else {
                  cand.noAssociatedCast++;
                  example(cand.examples, "noAssociatedCast", where, relS);
                  // what else did this player cast around it? (Demonic: an
                  // Eye Beam cast logged up to 0.3 s AFTER the Metamorphosis
                  // it grants — no DB2 trigger row, tooltip + script only)
                  const seen = new Set<string>();
                  for (const [castId, tsList] of myOrActorCasts(actor))
                    if (
                      !seen.has(castId) &&
                      tsList.some(
                        (t) =>
                          (t - ts) / 1000 >= CO_CAST_BEFORE_S &&
                          (t - ts) / 1000 <= CO_CAST_AFTER_S,
                      )
                    ) {
                      seen.add(castId);
                      cand.noAssocCoCasts[castId] =
                        (cand.noAssocCoCasts[castId] ?? 0) + 1;
                    }
                }
              }
            } else if (otherRoots.length) {
              cand.noAssociatedCast++;
              example(cand.examples, "noAssociatedCast", where, relS);
            }
            // --probe-cast: cross-tab (root cast associated?) × (probe cast
            // within [CO_CAST_BEFORE_S, CO_CAST_AFTER_S]?) — each group keeps
            // its own lifetimes and lift below (codex: never pool a subgroup)
            if (probeIds.length) {
              const casts = actor ? myOrActorCasts(actor) : new Map();
              const within = (
                list: number[] | undefined,
                lo: number,
                hi: number,
              ) =>
                (list ?? []).some(
                  (t) => (t - ts) / 1000 >= lo && (t - ts) / 1000 <= hi,
                );
              const rootAssoc =
                !!actor &&
                otherRoots.some(
                  (r) =>
                    within(casts.get(r), -ASSOC_S, ASSOC_S) ||
                    (castsByName.get(actor)?.get(nameOf(r)) ?? []).some(
                      ([t, cid]) =>
                        cid !== id && Math.abs(t - ts) <= ASSOC_S * 1000,
                    ),
                );
              const probe = probeIds.some((p) =>
                within(casts.get(p), CO_CAST_BEFORE_S, CO_CAST_AFTER_S),
              );
              const g = `${rootAssoc ? "root" : "noRoot"}+${probe ? "probe" : "noProbe"}`;
              const cell = (cand.groups[g] ??= {
                apps: 0,
                lifetimes: [],
                lifts: [],
              });
              cell.apps++;
              if (sourceClass === "self") {
                const l = appGroups.get(id) ?? [];
                l.push([relS, g]);
                appGroups.set(id, l);
              }
            }
          } else if (!roots.has(id)) {
            const rs =
              residual.get(id) ??
              ({
                id,
                name: nameOf(id),
                nameMatchesRoot: rootNames.has(nameOf(id)),
                dbBase: dbBaseOf(id),
                effective: effectiveOf(id),
                apps: 0,
                bySource: newSources(),
                onDps: 0,
                onHealer: 0,
                casters: new Set(),
                unitRounds: new Set(),
                specs: {},
                examples: [],
                sliceApps: 0,
                sliceUnitRounds: 0,
                lifts: [],
                observedS: 0,
                inferredS: 0,
                coPressed: 0,
                overlapRecognizedS: 0,
                sliceTimeS: 0,
              } as ResidualStat);
            rs.apps++;
            rs.bySource[sourceClass]++;
            if (dps) rs.onDps++;
            else rs.onHealer++;
            rs.casters.add(actor ?? src);
            rs.unitRounds.add(unitRound);
            rs.specs[spec] = (rs.specs[spec] ?? 0) + 1;
            if (rs.examples.length < 3)
              rs.examples.push(`${where}@${relS.toFixed(1)}s`);
            const bucket: Bucket =
              sourceClass !== "self"
                ? "notSelf"
                : !dps
                  ? "selfOnHealer"
                  : rs.dbBase === undefined
                    ? "selfDpsNoDbDuration"
                    : rs.dbBase < DUR_SLICE_MIN
                      ? "selfDpsShort"
                      : rs.dbBase > DUR_SLICE_MAX
                        ? "selfDpsLong"
                        : "slice";
            buckets[bucket].apps++;
            buckets[bucket].ids.add(id);
            if (bucket === "slice") {
              rs.sliceApps++;
              if (
                [...myCasts].some(
                  ([cid, tsList]) =>
                    isOffensiveSpell(cid) &&
                    tsList.some((t) => Math.abs(t - ts) <= CO_PRESS_S * 1000),
                )
              )
                rs.coPressed++;
            }
            residual.set(id, rs);
          }
        } else if (ev === LogEvent.SPELL_AURA_REFRESH) {
          if (cand) cand.refreshes++;
        } else if (
          ev === LogEvent.SPELL_AURA_REMOVED ||
          ev === LogEvent.SPELL_AURA_BROKEN ||
          ev === LogEvent.SPELL_AURA_BROKEN_SPELL
        ) {
          const start = open.get(key);
          if (start === undefined) continue;
          open.delete(key);
          if (cand) {
            if (ev !== LogEvent.SPELL_AURA_REMOVED) cand.broken++;
            const d = cand.effective ?? cand.dbBase;
            if (d !== undefined && (ts - start) / 1000 < d - 0.5) {
              cand.closedBeforeDuration++;
              example(
                cand.examples,
                "closedBeforeDuration",
                where,
                (start - t0) / 1000,
              );
            }
          }
        }
      }
      for (const [key, start] of open) {
        const cand = cands.get(key.split("\u0000")[0]!);
        if (cand) {
          cand.unclosed++;
          example(cand.examples, "unclosed", where, (start - t0) / 1000);
        }
      }
      // presses of a root followed by the candidate aura from this actor
      for (const cand of cands.values())
        for (const root of cand.roots) {
          if (root === cand.id) continue;
          const presses = myCasts.get(root) ?? [];
          if (!presses.length) continue;
          const pr = (cand.pressesByRoot[root] ??= [0, 0]);
          for (const p of presses) {
            pr[1]++;
            if (
              (appsIndex.get(cand.id) ?? []).some(
                ([who, ts]) =>
                  who === u.id && ts - p >= -500 && ts - p <= ASSOC_S * 1000,
              )
            )
              pr[0]++;
          }
        }

      // ── interval pass: the shared builder on the ROUND-BOUNDED event stream
      // (it clamps timestamps, it does not drop them — a removal after the
      // round end would otherwise make an 8 s aura a 90 s "observed" one,
      // codex astra), self-sourced; a segment cut at the player's death is
      // censored, never a complete observed lifetime
      const bounded = {
        ...u,
        auraEvents: (u.auraEvents ?? []).filter((a: any) =>
          inRound(a.logLine.timestamp),
        ),
      };
      const intervals = buildAuraIntervals(
        bounded,
        { startTime: t0, endTime: t1 },
        castersById,
      ).filter((iv) => iv.srcUnitName === u.name && iv.fromS < uEndRel);
      const byId = new Map<
        string,
        { obs: Array<[number, number]>; inf: Array<[number, number]> }
      >();
      const recognizedIv: Array<[number, number]> = [];
      const groupIv = new Map<string, Map<string, Array<[number, number]>>>();
      for (const iv of intervals) {
        const seg: [number, number] = [iv.fromS, Math.min(iv.toS, uEndRel)];
        const censored = iv.toS > uEndRel;
        const inferred = iv.inferredStart || iv.inferredEnd || censored;
        const s = byId.get(iv.spellId) ?? { obs: [], inf: [] };
        (inferred ? s.inf : s.obs).push(seg);
        byId.set(iv.spellId, s);
        if (isOffensiveSpell(iv.spellId)) recognizedIv.push(seg);
        const cand = cands.get(iv.spellId);
        if (cand && !inferred) cand.observedLifetimes.push(seg[1] - seg[0]);
        if (cand && probeIds.length) {
          const app = (appGroups.get(iv.spellId) ?? []).find(
            ([rs]) => Math.abs(rs - iv.fromS) <= 0.05,
          );
          const g = app ? app[1] : "noApplication";
          const cell = (cand.groups[g] ??= {
            apps: 0,
            lifetimes: [],
            lifts: [],
          });
          if (!inferred) cell.lifetimes.push(seg[1] - seg[0]);
          const m = groupIv.get(iv.spellId) ?? new Map();
          (m.get(g) ?? m.set(g, []).get(g)!).push(seg);
          groupIv.set(iv.spellId, m);
        }
      }
      const recognized = merge(recognizedIv);
      let dmg: Array<[number, number]> | null = null;
      const damage = () => {
        if (dmg) return dmg;
        dmg = [];
        for (const d of u.damageOut ?? []) {
          const ts = d.timestamp ?? d.logLine?.timestamp;
          if (ts >= t0 && ts <= uEnd)
            dmg.push([
              (ts - t0) / 1000,
              Math.abs(d.effectiveAmount ?? d.amount ?? 0),
            ]);
        }
        return dmg;
      };
      const liftOf = (iv: Array<[number, number]>): number | null => {
        if (!liftEligible) return null;
        const inside = total(iv);
        const outside = uEndRel - inside;
        if (!(inside > 0) || outside < MIN_OUTSIDE_S) return null;
        let dIn = 0;
        let dAll = 0;
        for (const [t, amt] of damage()) {
          dAll += amt;
          if (iv.some(([a, b]) => t >= a && t <= b)) dIn += amt;
        }
        const rateOut = (dAll - dIn) / outside;
        return rateOut > 0 ? dIn / inside / rateOut : null;
      };
      for (const [id, s] of byId) {
        const iv = merge([...s.obs, ...s.inf]);
        const cand = cands.get(id);
        if (cand) {
          cand.exposureObservedS += total(merge(s.obs));
          cand.exposureInferredS += total(merge(s.inf));
          const l = liftOf(iv);
          if (l !== null) cand.lifts.push(l);
          for (const [g, segs] of groupIv.get(id) ?? []) {
            const gl = liftOf(merge(segs));
            if (gl !== null) cand.groups[g]!.lifts.push(gl);
          }
          continue;
        }
        const rs = residual.get(id);
        if (
          !rs ||
          !dps ||
          rs.dbBase === undefined ||
          rs.dbBase < DUR_SLICE_MIN ||
          rs.dbBase > DUR_SLICE_MAX
        )
          continue;
        rs.sliceUnitRounds++;
        rs.observedS += total(merge(s.obs));
        rs.inferredS += total(merge(s.inf));
        rs.sliceTimeS += total(iv);
        rs.overlapRecognizedS += overlap(iv, recognized);
        const l = liftOf(iv);
        if (l !== null) rs.lifts.push(l);
      }
    }

    function myOrActorCasts(actor: string) {
      return castsOf.get(actor) ?? new Map<string, number[]>();
    }
  };

  for (const file of files) {
    let text: string;
    try {
      const raw = readFileSync(file);
      text = (file.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
    } catch {
      continue;
    }
    const combats: any[] = [];
    try {
      const parser = new GladLogParser();
      parser.on("match", (m: any) => combats.push(toLegacyMatch(m)));
      parser.on("shuffle", (sh: any) => {
        for (const r of toLegacyShuffle(sh).rounds ?? []) combats.push(r);
      });
      for (const line of text.split(/\r?\n/)) parser.push(line);
      parser.end();
    } catch {
      continue;
    }
    scanned++;
    const tag = path.basename(file).replace(/\.txt(\.gz)?$/, "");
    combats.forEach((c, roundIdx) => scanRound(c, `${tag}#${roundIdx}`));
    if (scanned % 50 === 0)
      console.error(`… ${scanned}/${files.length} files, ${rounds} rounds`);
  }

  // ── output ───────────────────────────────────────────────────────────────
  const candOut = [...cands.values()]
    .filter((c) => c.apps > 0 || c.rawCasts > 0)
    .map((c) => ({
      ...c,
      casters: c.casters.size,
      unitRounds: c.unitRounds.size,
      rounds: c.rounds.size,
      observedLifetimeP50: r2(q(c.observedLifetimes, 0.5)),
      observedLifetimeN: c.observedLifetimes.length,
      observedLifetimes: undefined,
      liftP50: r2(q(c.lifts, 0.5)),
      liftN: c.lifts.length,
      lifts: undefined,
    }));
  const residOut = [...residual.values()].map((r) => ({
    ...r,
    casters: r.casters.size,
    unitRounds: r.unitRounds.size,
    liftP50: r2(q(r.lifts, 0.5)),
    liftP25: r2(q(r.lifts, 0.25)),
    liftN: r.lifts.length,
    lifts: undefined,
  }));
  const bucketOut = Object.fromEntries(
    Object.entries(buckets).map(([k, v]) => [
      k,
      { apps: v.apps, ids: v.ids.size },
    ]),
  );
  const ranked = residOut
    .filter((r) => r.sliceUnitRounds >= minRounds)
    .sort((a, b) => b.liftP50 - a.liftP50);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        meta: {
          files: scanned,
          rounds,
          liftEligibleRounds: liftRounds,
          build,
          every,
          roots: roots.size,
          candidates: cands.size,
          observedCandidates: candOut.length,
          residualIds: residual.size,
          buckets: bucketOut,
          dtBins: DT_LABELS,
          startedAt: new Date().toISOString(),
        },
        candidates: candOut,
        residual: residOut,
        petRecipient: [...petRecipient.values()].sort(
          (a, b) => b.apps - a.apps,
        ),
      },
      null,
      1,
    ),
  );

  const md: string[] = [];
  md.push(
    `# offensiveEffectGapScan — ${new Date().toISOString().slice(0, 10)}`,
  );
  md.push(
    `files ${scanned}, rounds ${rounds} (${liftRounds} long enough for lift), DB2 build ${build}; roots ${roots.size}, candidates ${cands.size} (observed ${candOut.length}); residual aura ids ${residual.size}. Signed dt = cast − application, bins ${DT_LABELS.join(" | ")}.`,
  );
  md.push("");
  md.push("## Candidates (nominated by DB2 / registered relations)");
  md.push(
    "| id | name | roots | via | canon | dbBase/eff | casts | apps | casters | unit-rounds | self/pet/fr/en/oth | nearest exact root cast (signed dt bins) | by root | ambiguous | same-name (bins) · cast ids | own-id cast (bins) | no assoc cast | presses→aura by root | obs life p50 (n) | exposure obs/inf s | reapplied | closed<dur | broken | unclosed | lift p50 (n) | top specs |",
  );
  md.push("|" + "---|".repeat(26));
  for (const c of candOut.sort((a, b) =>
    a.roots[0]!.localeCompare(b.roots[0]!),
  )) {
    const specs = Object.entries(c.bySpec)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([s, n]) => `${s} ${n}`)
      .join("; ");
    md.push(
      `| ${c.id} | ${c.name} | ${c.roots.join(",")} | ${c.via.join(" ")} | ${c.canonical ? "Y" : ""} | ${c.dbBase ?? "–"}/${c.effective ?? "–"} | ${c.rawCasts} | ${c.apps} | ${c.casters} | ${c.unitRounds} | ${Object.values(c.bySource).join("/")} | ${c.assocExact.join("/")} | ${Object.entries(
        c.assocByRoot,
      )
        .map(([k, n]) => `${k}:${n}`)
        .join(
          " ",
        )} | ${c.ambiguous} | ${c.assocSameName.join("/")} · ${Object.entries(
        c.sameNameIds,
      )
        .map(([k, n]) => `${k}:${n}`)
        .join(
          " ",
        )} | ${c.ownIdCast.join("/")} | ${c.noAssociatedCast} | ${Object.entries(
        c.pressesByRoot,
      )
        .map(([k, [e, t]]) => `${k} ${e}/${t}`)
        .join(
          ", ",
        )} | ${c.observedLifetimeP50} (${c.observedLifetimeN}) | ${r2(c.exposureObservedS)}/${r2(c.exposureInferredS)} | ${c.reappliedWhileOpen} | ${c.closedBeforeDuration} | ${c.broken} | ${c.unclosed} | ${c.liftP50} (${c.liftN}) | ${specs} |`,
    );
  }
  md.push("");
  md.push(
    `### Applications with no associated root cast — the same player's casts within ${CO_CAST_BEFORE_S}…+${CO_CAST_AFTER_S} s (share of those applications, top 5)`,
  );
  for (const c of candOut) {
    if (!c.noAssociatedCast) continue;
    const top = Object.entries(c.noAssocCoCasts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(
        ([id, n]) =>
          `${id} ${nameOf(id)} ${Math.round((100 * n) / c.noAssociatedCast)} %`,
      )
      .join(", ");
    md.push(`- ${c.id} ${c.name} (${c.noAssociatedCast}): ${top || "—"}`);
  }
  md.push("");
  if (probeIds.length) {
    md.push(
      `### --probe-cast ${probeIds.join(",")}: (root cast associated?) × (probe cast within ${CO_CAST_BEFORE_S}…+${CO_CAST_AFTER_S} s?) — each cell's own lifetimes and lift`,
    );
    md.push(
      "| id | name | group | applications | complete observed lifetime p50 (n) | lift p50 (n) |",
    );
    md.push("|---|---|---|---|---|---|");
    for (const c of candOut) {
      // every group of a candidate the probe touched at least once
      const hasProbe = Object.entries(c.groups).some(
        ([k, x]) => k.endsWith("+probe") && x.apps > 0,
      );
      if (!hasProbe) continue;
      for (const [g, cell] of Object.entries(c.groups).sort())
        md.push(
          `| ${c.id} | ${c.name} | ${g} | ${cell.apps} | ${r2(q(cell.lifetimes, 0.5))} (${cell.lifetimes.length}) | ${r2(q(cell.lifts, 0.5))} (${cell.lifts.length}) |`,
        );
    }
    md.push("");
  }
  md.push("### Examples per pattern (file#round@t)");
  for (const c of candOut)
    for (const [p, l] of Object.entries(c.examples))
      md.push(`- ${c.id} ${c.name} · ${p}: ${l!.join(", ")}`);
  md.push("");
  md.push(
    "## Auras on players' pets / guardians (outside the player pass and every aura consumer)",
  );
  md.push("| id | name | apps | candidate/root | nameMatchesRoot |");
  md.push("|---|---|---|---|---|");
  for (const p of [...petRecipient.values()]
    .filter((p) => p.candidate || p.nameMatchesRoot)
    .sort((a, b) => b.apps - a.apps))
    md.push(
      `| ${p.id} | ${p.name} | ${p.apps} | ${p.candidate ? "Y" : ""} | ${p.nameMatchesRoot ? "Y" : ""} |`,
    );
  md.push("");
  md.push(
    "## Forward residual — aura ids on players the candidate relations do not explain",
  );
  md.push(
    "Every application falls in exactly one bucket (applications / distinct ids); the JSON keeps every residual id.",
  );
  md.push("| bucket | applications | ids |");
  md.push("|---|---|---|");
  for (const [k, v] of Object.entries(bucketOut))
    md.push(`| ${k} | ${v.apps} | ${v.ids} |`);
  md.push("");
  md.push(
    "### Name-matching residual ids (a registered cooldown's English name, any bucket)",
  );
  md.push(
    "| id | name | apps | dbBase/eff | self/pet/fr/en/oth | casters | unit-rounds | top specs | examples |",
  );
  md.push("|---|---|---|---|---|---|---|---|---|");
  for (const r of residOut
    .filter((r) => r.nameMatchesRoot)
    .sort((a, b) => b.apps - a.apps))
    md.push(
      `| ${r.id} | ${r.name} | ${r.apps} | ${r.dbBase ?? "–"}/${r.effective ?? "–"} | ${Object.values(r.bySource).join("/")} | ${r.casters} | ${r.unitRounds} | ${Object.entries(
        r.specs,
      )
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([s, n]) => `${s} ${n}`)
        .join("; ")} | ${r.examples.join(", ")} |`,
    );
  md.push("");
  md.push(
    `### Ranked slice: self-applied on DPS, dbBase ${DUR_SLICE_MIN}–${DUR_SLICE_MAX} s, ≥ ${minRounds} unit-rounds — by lift p50 (no cut)`,
  );
  md.push(
    "| id | name | nameMatchesRoot | dbBase/eff | unit-rounds | lift n | casters | apps | lift p50 | lift p25 | inferred share | coPressed | overlap w/ recognized |",
  );
  md.push("|" + "---|".repeat(13));
  for (const r of ranked.slice(0, 60))
    md.push(
      `| ${r.id} | ${r.name} | ${r.nameMatchesRoot ? "Y" : ""} | ${r.dbBase}/${r.effective ?? "–"} | ${r.sliceUnitRounds} | ${r.liftN} | ${r.casters} | ${r.sliceApps} | ${r.liftP50} | ${r.liftP25} | ${r2(r.inferredS / Math.max(1e-9, r.observedS + r.inferredS))} | ${r2(r.coPressed / Math.max(1, r.sliceApps))} | ${r2(r.overlapRecognizedS / Math.max(1e-9, r.sliceTimeS))} |`,
    );
  const mdPath = flag("--md");
  if (mdPath) writeFileSync(mdPath, md.join("\n") + "\n");
  console.log(md.slice(0, 3).join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
