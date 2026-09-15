/**
 * ccLifetimeScan.ts — observed aura lifetime per CC / root id vs the official
 * DB2 duration (the "test the official table" half of the Curated-List rule).
 *
 * Born 2026-09-02 (GH #44 tail, user ruling "羊本身永远是6秒"): the hand
 * durations in SPELL_CATEGORIES disagreed with DB2 on 50 of 135 ids, and this
 * scan settled every hard-CC / root disagreement in one minute — 21 of 22 sided
 * with DB2, Binding Shot was the one DB2 got wrong (2 s vs observed 3.0 s
 * ×1084), which is now `CORPUS_DURATION_PATCHES`. `ccFullDurationSeconds`
 * (spellEffectData.ts) reads DB2; this scan is how a season refresh checks
 * that DB2 still matches the game.
 *
 * Method: APPLIED / REFRESH → REMOVED lifetime per (caster, target, spell);
 * breaks shorten a lifetime and DR halves it, so the FULL duration is the
 * HIGHEST local-peak 0.5 s bin (for breakable CC the plain mode sits at the
 * half-duration DR cluster — see `fullDurationBin`). Targets carrying
 * Oppressing Roar (372048, +30 % in PvP) are tallied separately. A row is
 * flagged when that peak disagrees with ccFullDurationSeconds by ≥ 0.5 s; a
 * flag is a ruling question, not an auto-fix (the DB2 value wins unless the
 * corpus contradicts it this clearly).
 *
 * Usage:
 *   npx tsx packages/eval/scripts/ccLifetimeScan.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-<date>.txt [--every 30] [--all]
 *   --all also lists the ids whose observed mode agrees with DB2 (default: flags + DB2-blank ids only).
 */
import { SPELL_CATEGORIES } from "@gladlog/analysis/src/data/spellCategories";
import {
  CC_DURATION_TALENT_MODIFIERS,
  ccFullDurationSeconds,
  OPPRESSING_ROAR_SPELL_ID,
  spellEffectData,
} from "@gladlog/analysis/src/data/spellEffectData";
import spellNames from "@gladlog/analysis/src/data/spellNames.json";
import { readFileSync } from "fs";
import { gunzipSync } from "zlib";

const MIN_N = 20;
const BIN_S = 0.5;
const MIN_LIFETIME_S = 1.0;

function parseArgs() {
  const a = process.argv.slice(2);
  const out = { manifest: "", every: 30, all: false };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--manifest") out.manifest = a[++i] ?? "";
    else if (a[i] === "--every") out.every = Number(a[++i]);
    else if (a[i] === "--all") out.all = true;
  }
  if (!out.manifest || !Number.isFinite(out.every) || out.every < 1) {
    console.error(
      "usage: ccLifetimeScan.ts --manifest <path> [--every N] [--all]",
    );
    process.exit(1);
  }
  return out;
}

const TS = /^(\d+)\/(\d+)\/(\d+) (\d+):(\d+):(\d+)\.(\d+)/;
function tsMs(line: string): number | null {
  const m = TS.exec(line);
  if (!m) return null;
  return Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +m[6], +m[7]);
}

const args = parseArgs();
const files = readFileSync(args.manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % args.every === 0);

const tracked = new Set(
  Object.entries(SPELL_CATEGORIES)
    .filter(([, e]) => e.type === "cc" || e.type === "roots")
    .map(([id]) => id),
);
const stats = new Map<string, { plain: number[]; roar: number[] }>();
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
  const open = new Map<string, { at: number; roar: boolean }>();
  const roarOn = new Set<string>();
  for (const line of text.split("\n")) {
    const sep = line.indexOf("  ");
    if (sep < 0) continue;
    const body = line.slice(sep + 2);
    if (body.startsWith("ARENA_MATCH_")) {
      open.clear();
      roarOn.clear();
      continue;
    }
    if (!body.startsWith("SPELL_AURA_")) continue;
    const p = body.split(",");
    const ev = p[0];
    if (
      ev !== "SPELL_AURA_APPLIED" &&
      ev !== "SPELL_AURA_REMOVED" &&
      ev !== "SPELL_AURA_REFRESH"
    )
      continue;
    const src = p[1];
    const dst = p[5];
    const spell = p[9];
    if (spell === OPPRESSING_ROAR_SPELL_ID) {
      if (ev === "SPELL_AURA_REMOVED") roarOn.delete(dst);
      else roarOn.add(dst);
      continue;
    }
    if (!tracked.has(spell)) continue;
    const at = tsMs(line);
    if (at === null) continue;
    const key = `${src}|${dst}|${spell}`;
    if (ev === "SPELL_AURA_REMOVED") {
      const o = open.get(key);
      if (!o) continue;
      let s = stats.get(spell);
      if (!s) stats.set(spell, (s = { plain: [], roar: [] }));
      (o.roar ? s.roar : s.plain).push((at - o.at) / 1000);
      open.delete(key);
    } else {
      open.set(key, { at, roar: roarOn.has(dst) });
    }
  }
}

/**
 * The full duration is the HIGHEST local-peak bin, not the mode: for breakable
 * CC (Fear, Sleep Walk, Mind Control, roots) breaks and the 50 % DR cluster
 * outnumber natural expiries, so the mode sits at half duration while the full
 * duration is a smaller but distinct peak above it (Fear on 605 files: 3.0 s
 * ×264, 1.0 s ×233, 6.0 s ×178). A peak counts if it beats both neighbours
 * and carries ≥ MIN_N lifetimes and ≥ 25 % of the mode.
 */
const fullDurationBin = (arr: number[]): number | null => {
  const m = new Map<number, number>();
  for (const d of arr) {
    if (d < MIN_LIFETIME_S) continue;
    const b = Math.round(d / BIN_S) * BIN_S;
    m.set(b, (m.get(b) ?? 0) + 1);
  }
  if (m.size === 0) return null;
  const modeN = Math.max(...m.values());
  const floor = Math.max(MIN_N, 0.25 * modeN);
  let best: number | null = null;
  for (const [b, n] of m) {
    const left = m.get(Number((b - BIN_S).toFixed(1))) ?? 0;
    const right = m.get(Number((b + BIN_S).toFixed(1))) ?? 0;
    if (n >= floor && n >= left && n > right && (best === null || b > best))
      best = b;
  }
  return best;
};
const topBins = (arr: number[], k = 3) => {
  const m = new Map<string, number>();
  for (const d of arr) {
    const b = (Math.round(d / BIN_S) * BIN_S).toFixed(1);
    m.set(b, (m.get(b) ?? 0) + 1);
  }
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([b, n]) => `${b}s×${n}`)
    .join(" ");
};

const names = spellNames as Record<string, string>;
const rows: string[] = [];
let flagged = 0;
for (const id of [...tracked].sort(
  (a, b) =>
    (stats.get(b)?.plain.length ?? 0) - (stats.get(a)?.plain.length ?? 0),
)) {
  const s = stats.get(id);
  const n = s?.plain.length ?? 0;
  const db2 = spellEffectData[id]?.durationSeconds;
  const predicate = ccFullDurationSeconds(id);
  const mode = n >= MIN_N ? fullDurationBin(s!.plain) : null;
  const rawDisagree =
    mode !== null &&
    predicate !== undefined &&
    Math.abs(mode - predicate) >= BIN_S;
  // A peak that equals base × (1 + pct) for a registered talent modifier is
  // the talent-lengthened cluster (casters holding the talent), not a DB2
  // disagreement — labelled "talent" and not counted as a flag.
  const talentExplained =
    rawDisagree &&
    (CC_DURATION_TALENT_MODIFIERS[id] ?? []).some(
      (m) =>
        Math.abs(
          mode! -
            (m.includedInBase
              ? predicate! - (m.addSeconds ?? 0)
              : (predicate! + (m.addSeconds ?? 0)) * (1 + (m.pct ?? 0) / 100)),
        ) < BIN_S,
    );
  const disagree = rawDisagree && !talentExplained;
  const blank = db2 === undefined;
  if (disagree) flagged++;
  if (!args.all && !disagree && !blank && !talentExplained) continue;
  rows.push(
    [
      disagree
        ? "FLAG"
        : talentExplained
          ? "talent"
          : blank
            ? "db2-blank"
            : "ok",
      id,
      names[id] ?? "?",
      `db2=${db2 ?? "-"}`,
      `predicate=${predicate ?? "-"}`,
      `n=${n}`,
      `mode=${mode ?? "-"}`,
      `bins=${n ? topBins(s!.plain) : "-"}`,
      `roarN=${s?.roar.length ?? 0}${s && s.roar.length ? ` roarBins=${topBins(s.roar)}` : ""}`,
    ].join("\t"),
  );
}
console.log(
  `files=${read} tracked=${tracked.size} flagged=${flagged} (mode vs ccFullDurationSeconds differs by >= ${BIN_S}s with n >= ${MIN_N})`,
);
for (const r of rows) console.log(r);
