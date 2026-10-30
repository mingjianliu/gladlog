/**
 * kickLockoutScan.ts — observed school-lockout length per kick id (GH #62).
 *
 * Role since 2026-09-04: the VERIFICATION table for `kickLockoutSeconds`
 * (data/spellEffectData.ts), which answers from the official DB2 PvP duration
 * of the kick spell (SpellMisc.PvPDurationIndex via genSpellEffects) first.
 * GH #62 built this scan believing DB2 had no lockout field; it does, and the
 * generated table already carried Kick = 3. The scan stays because the
 * official value must be re-checked against the log each season: after
 * `SPELL_INTERRUPT` the victim cannot cast the locked school, and players
 * re-cast the moment it unlocks — so the gap from the interrupt to the
 * victim's FIRST subsequent `SPELL_CAST_START` / `SPELL_CAST_SUCCESS` whose
 * school mask overlaps the locked school clusters tightly at the lockout
 * length (0.5 s bins, lower edge). `test/kickLockout.test.ts` gates on the
 * p25 (|official − p25| ≤ 0.5 s, n ≥ 100) — the bin mode can sit one bin
 * late (Counterspell mode 6, p25 5.04, official 5).
 *
 * Output: `packages/analysis/src/data/kickLockoutObservedGenerated.json`
 * (consumed by `kickLockoutSeconds`; listed in `writeManifest.ts`). Only kick
 * ids with ≥ MIN_N pairs and a mode ≥ MIN_LOCKOUT_S are written; everything
 * else falls through to the official value / 3 s. Re-run each season
 * (update-wow-data §6b-pre-5).
 *
 * Usage:
 *   npx tsx packages/eval/scripts/kickLockoutScan.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-2026-08-28-newseason.txt \
 *     [--every 30] [--out packages/analysis/src/data/kickLockoutObservedGenerated.json]
 *
 * 2026-09-02 (S2 archive, every 30th file = 605 files, 6,134 interrupts, 5,322
 * pairs): Counterspell 6, Spell Lock 5, Quell 4, Wind Shear 2, Shambling Rush 2,
 * every other kick 3 — melee kicks are genuinely 3 s in 12.1, so the old
 * fallback was right by accident for them and wrong for the five above.
 *
 * Victim modifiers (triage kick-eaten F-K8, ruling A23): every pair is also
 * split by the victim lockout modifiers of `KICK_LOCKOUT_VICTIM_MODIFIERS`
 * (utils/kickLockout.ts — Storm Conduit 1217092 on an interrupted Lightning
 * Bolt / Chain Lightning), the holder read from the victim's COMBATANT_INFO
 * PvP talents. Printed only — the table above is the kick's own lockout and
 * is unchanged by it. The split is what keeps the modifier re-runnable:
 * holder × modified spell, holder × other spell, non-holder × modified
 * spell, each with its gap / table-lockout ratios.
 *
 * By log date (2026-10-11): a modifier's number can be dated (Storm Conduit:
 * ×0.35 before its 2026-08-18 hotfix, ×0.6 since), so every pair of the split
 * is also printed by the side of the modifier's cutover its SPELL_INTERRUPT
 * row is on and by the victim's spec, and every holder × modified pair
 * against the product's own number for that timestamp
 * (`kickLockoutVictimMultiplierAt`): a first cast of a locked school more
 * than `EARLY_MS` before the modelled end says the model is too long, a "not
 * ready" refusal after it that it is too short. 2026-10-11, 605 files, 15
 * holder pairs: 8 before the cutover at ×0.344–×0.456; 7 since, six at
 * ×0.622–×1.225 and one at ×0.351 (an Oceanic log of the hotfix day — the
 * cutover's hour is the open FLAG in kickLockout.ts); too long 9 with ×0.6
 * alone, 1 dated; too short 0.
 *
 * Timestamps are the parser's (`parseRawTimestamp`), for the gaps as well as
 * for the date. Until 2026-10-11 the scan read them with its own regex, which
 * took every digit after the dot for milliseconds: a line whose UTC offset
 * is written without a sign (`…32.16710` — .167 and +10) was 16.7 s into its
 * second, and a gap in such a file could be seconds off. The table in the
 * repo was generated before that: on the same 605 files the parser's reading
 * pairs 5,720 instead of 5,322, moves no kick's mode and moves p25 by at
 * most 0.44 s (Quell 3.55 → 3.99, Spell Lock 4.66 → 4.95).
 *
 * Two dates per pair (2026-10-11). The parser's date of a row whose offset
 * has no sign is its wall clock in the zone of the machine running this
 * scan, so "before / since the cutover" above depends on where the scan is
 * run. Every dated pair is therefore also printed with the instant the row
 * states for itself (`rawLineInstantMs`: wall clock minus the row's own UTC
 * offset — the same everywhere), and the pairs the two readings put on
 * different sides of the cutover are counted. The model column stays the
 * product's number at the product's date: the dated rules are asked with
 * the parser's timestamps (utils/logEra.ts says why).
 */
import { NOT_READY_REASONS } from "@gladlog/analysis/src/analysis/candidates/shared";
import { kickLockoutSeconds } from "@gladlog/analysis/src/data/spellEffectData";
import { schoolLockedBy } from "@gladlog/analysis/src/data/spellSchools";
import {
  KICK_LOCKOUT_VICTIM_MODIFIERS,
  kickLockoutVictimMultiplierAt,
} from "@gladlog/analysis/src/utils/kickLockout";
import { logIsFrom } from "@gladlog/analysis/src/utils/logEra";
import {
  parseRawTimestamp,
  rawLineInstantMs,
} from "@gladlog/analysis/src/utils/rawStreams";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { gunzipSync } from "zlib";

const MIN_N = 20;
const MIN_LOCKOUT_S = 1.5;
const BIN_S = 0.5;
const MAX_GAP_S = 20;
/** A first cast this much before a modelled lockout end is "before it". The
 * log's clock is the recording client's, so two rows of one server instant
 * can sit a few ms apart: of the pairs no modifier applies to that land
 * within 15 ms of the table lockout, about a third land before it (the scan
 * prints the bands). */
const EARLY_MS = 15;
/** The longest global cooldown: a "not ready" refusal this long after the
 * interrupt is not the interrupted cast's own. */
const GCD_MS = 1_500;

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    manifest: "",
    every: 30,
    // Relative to the repo root (every eval CLI is run from there)
    out: resolve(
      "packages/analysis/src/data/kickLockoutObservedGenerated.json",
    ),
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--manifest") out.manifest = args[++i] ?? "";
    else if (args[i] === "--every") out.every = Number(args[++i]);
    else if (args[i] === "--out") out.out = resolve(args[++i] ?? "");
  }
  if (!out.manifest || !Number.isFinite(out.every) || out.every < 1) {
    console.error(
      "usage: kickLockoutScan.ts --manifest <path> [--every N] [--out <json>]",
    );
    process.exit(1);
  }
  return out;
}

/** A log line's instant as the parser reads it — the epoch the product's
 * events carry, so a gap here is the gap the product sees and a date here is
 * the date its dated rules are asked with. */
function tsMs(line: string): number | null {
  const sep = line.indexOf("  ");
  return sep < 0 ? null : parseRawTimestamp(line.slice(0, sep));
}

const quantile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

function modeBinLowerEdge(gaps: number[]): number | null {
  const counts = new Map<number, number>();
  for (const g of gaps) {
    if (g < MIN_LOCKOUT_S) continue;
    const edge = Math.floor(g / BIN_S) * BIN_S;
    counts.set(edge, (counts.get(edge) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestN = 0;
  for (const [edge, n] of counts) {
    if (n > bestN || (n === bestN && best !== null && edge < best)) {
      best = edge;
      bestN = n;
    }
  }
  return best;
}

const args = parseArgs();
const all = readFileSync(args.manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);
const files = all.filter((_, i) => i % args.every === 0);

const stats = new Map<string, { name: string; gaps: number[] }>();
/** "<talent> holder|non-holder × modified|other spell" → gap / table lockout */
const victimSplit = new Map<string, number[]>();
/** One pair of the split with what dates it (the SPELL_INTERRUPT row's own
 * timestamp) and who the victim is. */
interface SplitPair {
  modifier: (typeof KICK_LOCKOUT_VICTIM_MODIFIERS)[number];
  key: string;
  holderOnSpell: boolean;
  file: string;
  dateText: string;
  epochMs: number;
  /** the instant the SPELL_INTERRUPT row states for itself — its wall clock
   * minus its own UTC offset, signed or not (`rawLineInstantMs`); the
   * parser's reading when the row states no offset */
  statedMs: number;
  spec: string;
  kick: string;
  interrupted: string;
  firstCast: string;
  gapS: number;
  lockS: number;
  /** the last "not ready" refusal of that same spell between the interrupt
   * and its first success, at least a global cooldown after the interrupt
   * and with no cast of the victim's in between (seconds after the
   * interrupt) — the lock was still on then. Only the log's own recorder
   * has these rows, and the spell's own cooldown refuses the same way. */
  refusedAtS: number | null;
}
const splitPairs: SplitPair[] = [];
/** gap − table lockout (ms) of every split pair no modifier applies to */
const unmodifiedMs: number[] = [];
let interrupts = 0;
let paired = 0;
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
  const pending = new Map<
    string,
    { at: number; school: number; kick: string; interrupted: string }
  >();
  // the modifier split's own pairing: the first cast the lock really covers
  // (`schoolLockedBy`, the production all-bits rule — codex review: the
  // table's any-overlap pairing took a Fire/Nature Flame Shock 0.83 s into a
  // Nature lock as the unlock)
  const pendingSplit = new Map<
    string,
    {
      at: number;
      school: number;
      kick: string;
      interrupted: string;
      dateText: string;
      /** "not ready" SPELL_CAST_FAILED rows of a locked-school spell since
       * the interrupt (or since the victim's last cast of any kind): spell
       * id → last ms */
      refused: Map<string, number>;
    }
  >();
  // victim GUID → PvP talent ids (COMBATANT_INFO's "(a,b,c,d)" group)
  const pvp = new Map<string, Set<string>>();
  // victim GUID → spec id (COMBATANT_INFO: the field before the talent list)
  const specOf = new Map<string, string>();
  for (const line of text.split("\n")) {
    const sep = line.indexOf("  ");
    if (sep < 0) continue;
    const body = line.slice(sep + 2);
    if (body.startsWith("ARENA_MATCH_")) {
      pending.clear();
      pendingSplit.clear();
      pvp.clear();
      specOf.clear();
      continue;
    }
    if (body.startsWith("COMBATANT_INFO,")) {
      const guid = body.split(",")[1] ?? "";
      const held = new Set<string>();
      for (const m of KICK_LOCKOUT_VICTIM_MODIFIERS)
        if (new RegExp(`[(,]${m.talentId}[,)]`).test(body))
          held.add(m.talentId);
      pvp.set(guid, held);
      specOf.set(guid, /,(\d+),\[/.exec(body)?.[1] ?? "?");
      continue;
    }
    if (body.startsWith("SPELL_INTERRUPT,")) {
      const p = body.split(",");
      const dst = p[5];
      const kick = p[9];
      const name = (p[10] ?? "").replace(/"/g, "");
      const school = Number(p[14]);
      const at = tsMs(line);
      if (at === null || !Number.isFinite(school) || school === 0) continue;
      interrupts++;
      if (!stats.has(kick)) stats.set(kick, { name, gaps: [] });
      pending.set(dst, { at, school, kick, interrupted: p[12] ?? "" });
      pendingSplit.set(dst, {
        at,
        school,
        kick,
        interrupted: p[12] ?? "",
        dateText: line.slice(0, sep),
        refused: new Map(),
      });
      continue;
    }
    if (body.startsWith("SPELL_CAST_FAILED,")) {
      const p = body.split(",");
      const split = pendingSplit.get(p[1] ?? "");
      const school = Number(p[11]);
      if (
        split &&
        Number.isFinite(school) &&
        schoolLockedBy(school, split.school) &&
        NOT_READY_REASONS.has((p[12] ?? "").replace(/"/g, "").trim())
      ) {
        const at = tsMs(line);
        // a global cooldown the interrupted cast started refuses with the
        // same words until it has run out
        if (at !== null && at - split.at >= GCD_MS)
          split.refused.set(p[9] ?? "", at);
      }
      continue;
    }
    if (
      body.startsWith("SPELL_CAST_START,") ||
      body.startsWith("SPELL_CAST_SUCCESS,")
    ) {
      const p = body.split(",");
      const split = pendingSplit.get(p[1]);
      const castSchool = Number(p[11]);
      if (
        split &&
        Number.isFinite(castSchool) &&
        schoolLockedBy(castSchool, split.school)
      ) {
        const at = tsMs(line);
        pendingSplit.delete(p[1]);
        const gap = at === null ? -1 : (at - split.at) / 1000;
        const victimHolds = (
          m: (typeof KICK_LOCKOUT_VICTIM_MODIFIERS)[number],
        ) => pvp.get(p[1] ?? "")?.has(m.talentId) ?? false;
        if (
          gap >= 0 &&
          gap <= MAX_GAP_S &&
          !KICK_LOCKOUT_VICTIM_MODIFIERS.some(
            (m) =>
              victimHolds(m) && m.interruptedSpellIds.has(split.interrupted),
          )
        )
          unmodifiedMs.push(
            Math.round((gap - kickLockoutSeconds(split.kick)) * 1000),
          );
        if (gap >= 0 && gap <= MAX_GAP_S)
          for (const m of KICK_LOCKOUT_VICTIM_MODIFIERS) {
            const holder = pvp.get(p[1] ?? "")?.has(m.talentId) ?? false;
            const onSpell = m.interruptedSpellIds.has(split.interrupted);
            if (!holder && !onSpell) continue;
            const key = `${m.talentId} ${holder ? "holder" : "non-holder"} × ${onSpell ? "modified spell" : "other spell"}`;
            const list = victimSplit.get(key) ?? [];
            list.push(gap / kickLockoutSeconds(split.kick));
            victimSplit.set(key, list);
            const refusedMs = split.refused.get(p[9] ?? "");
            splitPairs.push({
              modifier: m,
              key,
              holderOnSpell: holder && onSpell,
              file: f.replace(/^.*\//, "").slice(0, 8),
              dateText: split.dateText,
              epochMs: split.at,
              statedMs: rawLineInstantMs(split.dateText) ?? split.at,
              spec: specOf.get(p[1] ?? "") ?? "?",
              kick: split.kick,
              interrupted: split.interrupted,
              firstCast: `${p[9]} ${(p[10] ?? "").replace(/"/g, "")}`,
              gapS: gap,
              lockS: kickLockoutSeconds(split.kick),
              refusedAtS:
                refusedMs === undefined ? null : (refusedMs - split.at) / 1000,
            });
          }
      } else if (split) {
        // a cast the lock does not cover: a refusal before it may be its
        // global cooldown's, not the lock's
        split.refused.clear();
      }
      const pend = pending.get(p[1]);
      if (!pend) continue;
      const school = Number(p[11]);
      if (!Number.isFinite(school) || (school & pend.school) === 0) continue; // another school is not locked
      const at = tsMs(line);
      if (at === null) continue;
      pending.delete(p[1]);
      const gap = (at - pend.at) / 1000;
      if (gap < 0 || gap > MAX_GAP_S) continue;
      paired++;
      stats.get(pend.kick)!.gaps.push(gap);
    }
  }
}

const entries: Record<
  string,
  { name: string; lockoutSeconds: number; n: number; p25: number; p50: number }
> = {};
const skipped: string[] = [];
for (const [id, s] of [...stats.entries()].sort(
  (a, b) => b[1].gaps.length - a[1].gaps.length,
)) {
  const sorted = [...s.gaps].sort((a, b) => a - b);
  const mode = modeBinLowerEdge(sorted);
  if (sorted.length < MIN_N || mode === null) {
    skipped.push(`${id} ${s.name} (n=${sorted.length})`);
    continue;
  }
  entries[id] = {
    name: s.name,
    lockoutSeconds: mode,
    n: sorted.length,
    p25: Number(quantile(sorted, 0.25).toFixed(2)),
    p50: Number(quantile(sorted, 0.5).toFixed(2)),
  };
}

const doc = {
  generatedAt: new Date().toISOString(),
  generator: "packages/eval/scripts/kickLockoutScan.ts",
  manifest: args.manifest.replace(/^.*\/corpus\//, "corpus/"),
  every: args.every,
  files: read,
  interrupts,
  paired,
  rule: `first same-school cast after SPELL_INTERRUPT; ${BIN_S}s-bin mode (lower edge) over gaps >= ${MIN_LOCKOUT_S}s; n >= ${MIN_N}`,
  entries,
};
writeFileSync(args.out, JSON.stringify(doc, null, 2) + "\n");
console.log(
  `files=${read} interrupts=${interrupts} paired=${paired} entries=${Object.keys(entries).length} → ${args.out}`,
);
for (const [id, e] of Object.entries(entries))
  console.log(
    `  ${id}\t${e.name}\t${e.lockoutSeconds}s\tn=${e.n}\tp25=${e.p25}\tp50=${e.p50}`,
  );
if (skipped.length) console.log(`skipped (fallback 3s): ${skipped.join(", ")}`);
console.log(
  "victim lockout modifiers (gap / table lockout; < 0.9 = ended early):",
);
for (const [key, ratios] of [...victimSplit.entries()].sort()) {
  const sorted = [...ratios].sort((a, b) => a - b);
  const early = sorted.filter((r) => r < 0.9).length;
  console.log(
    `  ${key}: n=${sorted.length} early=${early}/${sorted.length} p50=${quantile(sorted, 0.5)?.toFixed(3)} min=${sorted[0]?.toFixed(3)}`,
  );
}

// ── The same pairs by the date of the log ───────────────────────────────────
const cutoverOf = (x: SplitPair) =>
  typeof x.modifier.multiplier === "number"
    ? null
    : x.modifier.multiplier.cutoverEpochMs;
const sideAt = (x: SplitPair, logEpochMs: number) => {
  const cut = cutoverOf(x);
  return cut === null
    ? "undated"
    : logIsFrom(logEpochMs, cut)
      ? "since"
      : "before";
};
/** the side the product puts the pair on: the parser's date of the row */
const sideOf = (x: SplitPair) => sideAt(x, x.epochMs);
/** the side the row's own stated instant is on */
const statedSideOf = (x: SplitPair) => sideAt(x, x.statedMs);
console.log(
  "victim lockout modifiers by log date (the SPELL_INTERRUPT row as the parser dates it, against the modifier's own cutover) and victim spec; gap / table lockout:",
);
const cells = new Map<string, SplitPair[]>();
for (const x of splitPairs) {
  const k = `${x.key} | ${sideOf(x)} | spec ${x.spec}`;
  cells.set(k, [...(cells.get(k) ?? []), x]);
}
for (const [k, xs] of [...cells.entries()].sort()) {
  const r = xs.map((x) => x.gapS / x.lockS).sort((a, b) => a - b);
  const band = (lo: number, hi: number) =>
    r.filter((v) => v >= lo && v < hi).length;
  console.log(
    `  ${k}: n=${r.length} min=${r[0]?.toFixed(3)} p50=${quantile(r, 0.5)?.toFixed(3)} | <0.33: ${band(0, 0.33)}  0.33-0.40: ${band(0.33, 0.4)}  0.40-0.58: ${band(0.4, 0.58)}  0.58-0.70: ${band(0.58, 0.7)}  0.70-0.97: ${band(0.7, 0.97)}  0.97-1.10: ${band(0.97, 1.1)}  >=1.10: ${band(1.1, Infinity)}`,
  );
}
const control = [...unmodifiedMs].sort((a, b) => a - b);
const within = (lo: number, hi: number) =>
  control.filter((v) => v >= lo && v < hi).length;
console.log(
  `pairs no modifier applies to, gap − table lockout in ms: n=${control.length} | < -100: ${within(-Infinity, -100)}  -100..-30: ${within(-100, -30)}  -30..-${EARLY_MS}: ${within(-30, -EARLY_MS)}  -${EARLY_MS}..0: ${within(-EARLY_MS, 0)}  0..${EARLY_MS}: ${within(0, EARLY_MS)}  ${EARLY_MS}..100: ${within(EARLY_MS, 100)}  >= 100: ${within(100, Infinity)}`,
);
const modified = splitPairs
  .filter((x) => x.holderOnSpell)
  .sort((a, b) => a.epochMs - b.epochMs);
const modelOf = (x: SplitPair) =>
  kickLockoutVictimMultiplierAt(x.modifier, x.epochMs);
/** the modifier's number for a log of today — what an undated table says */
const currentOf = (x: SplitPair) =>
  kickLockoutVictimMultiplierAt(x.modifier, Number.NaN);
const earlyMs = (x: SplitPair, mult: number) =>
  Math.round((x.gapS - mult * x.lockS) * 1000);
console.log(
  "holder × modified spell, every pair (model = the product's multiplier at the interrupt's timestamp; Δ = first cast − modelled end):",
);
for (const x of modified)
  console.log(
    `  ${x.file} ${x.dateText} → ${new Date(x.epochMs).toISOString()} ${sideOf(x)} (the row states ${new Date(x.statedMs).toISOString()}${statedSideOf(x) === sideOf(x) ? "" : `: ${statedSideOf(x).toUpperCase()} — the parser's date is on the other side`}) spec ${x.spec} kick ${x.kick} (${x.lockS}s) on ${x.interrupted} → first locked-school cast ${x.firstCast} at ${x.gapS.toFixed(3)}s = ×${(x.gapS / x.lockS).toFixed(3)} | model ×${modelOf(x)}: Δ ${earlyMs(x, modelOf(x))} ms | current ×${currentOf(x)} alone: Δ ${earlyMs(x, currentOf(x))} ms${x.refusedAtS === null ? "" : ` | still refused at ${x.refusedAtS.toFixed(3)}s = ×${(x.refusedAtS / x.lockS).toFixed(3)}`}`,
  );
const otherSide = (xs: SplitPair[]) =>
  xs.filter((x) => statedSideOf(x) !== sideOf(x)).length;
const dated = splitPairs.filter((x) => cutoverOf(x) !== null);
console.log(
  `pairs the parser's date puts on the other side of the cutover than the instant their SPELL_INTERRUPT row states (an offset without a sign is read in this machine's zone): ${otherSide(dated)} of ${dated.length} dated pairs; holder × modified spell ${otherSide(modified)} of ${modified.length}`,
);
const tooLong = (mult: (x: SplitPair) => number) =>
  modified.filter((x) => earlyMs(x, mult(x)) < -EARLY_MS).length;
const tooShort = (mult: (x: SplitPair) => number) =>
  modified.filter(
    (x) =>
      x.refusedAtS !== null &&
      Math.round((x.refusedAtS - mult(x) * x.lockS) * 1000) > EARLY_MS,
  ).length;
console.log(
  `holder × modified spell, n=${modified.length}: first cast more than ${EARLY_MS} ms BEFORE the modelled end (model too long) — dated model ${tooLong(modelOf)}, current value alone ${tooLong(currentOf)}; still refused more than ${EARLY_MS} ms AFTER the modelled end (model too short) — dated model ${tooShort(modelOf)}, current value alone ${tooShort(currentOf)}`,
);
