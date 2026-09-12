/**
 * GH #80 — backlash-dispel cost/benefit over the PvP log archive, and the
 * generator of `data/backlashDispelPriorGenerated.json`.
 *
 * v5 (2026-09-12): a THIN CONSUMER of the product's own decision-point
 * predicate `backlashDispelDecisionPoints` (analysis/candidates/backlashDispel.ts)
 * — the scan stores each point plus outcome-only extras (deaths, team damage,
 * lowest HP, the target's own output), and the report strata are the
 * product's `isAccusableBacklashDispel` / `isWorthWindow` / `isImmuneWindow`.
 * No second implementation of any predicate lives here (CLAUDE.md).
 *
 * Immunity bootstrapping: the decision point reads the immunity set from the
 * generated json, which this script produces. The point therefore also
 * carries EVERY buff on the reference dispeller (`refDispellerBuffIds`); the
 * report mines the set from those (backlash-landed rate per buff) and patches
 * `immuneBuffIds` before applying the product strata, so one scan suffices.
 *
 *   npx tsx packages/eval/scripts/backlashDispelOutcomeProbe.ts scan \
 *       --manifest <file> --out <file.jsonl> [--every N] [--offset N] [--limit N]
 *   npx tsx packages/eval/scripts/backlashDispelOutcomeProbe.ts report --in <file.jsonl> [--spell <id>]
 *   npx tsx packages/eval/scripts/backlashDispelOutcomeProbe.ts emit-table --in <file.jsonl> \
 *       --corpus "<label>" > /tmp/table.json && cp /tmp/table.json packages/analysis/src/data/backlashDispelPriorGenerated.json
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  BACKLASH_KIND,
  BACKLASH_WINDOW_S,
  backlashDispelDecisionPoints,
  type IBacklashDispelPoint,
  isAccusableBacklashDispel,
  isImmuneWindow,
  isWorthWindow,
} from "@gladlog/analysis/src/analysis/candidates/backlashDispel";
import { BACKLASH_PRIOR_N_FLOOR } from "@gladlog/analysis/src/data/backlashDispelPrior";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { bracketKey } from "@gladlog/analysis/src/utils/bracketKey";
import { gridHpPct } from "@gladlog/analysis/src/utils/cooldowns";
import { DISPEL_PENALTY_SPELLS } from "@gladlog/analysis/src/utils/dispelAnalysis";
import { GladLogParser } from "@gladlog/parser";
import type { ICombatUnit } from "@gladlog/parser-compat";
import { toLegacyMatch, toLegacyShuffle } from "@gladlog/parser-compat";
import { appendFileSync, createReadStream, existsSync, readFileSync } from "fs";
import { basename } from "path";
import { createInterface } from "readline";
import { gunzipSync } from "zlib";

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const num = (f: string, d: number): number => Number(flag(f) ?? d);
const pct = (a: number, b: number) =>
  b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`;
const median = (xs: number[]) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const spellName = (id: string) =>
  DISPEL_PENALTY_SPELLS.get(id)?.split("(")[1]?.replace(")", "") ?? id;

/** One decision point + outcome-only extras. Numbers only — no names. */
interface Rec {
  matchId: string;
  seq: number | null;
  bracket: string;
  p: Omit<IBacklashDispelPoint, "targetName" | "dispellerName" | "cdCcHit"> & {
    cdCcHit: { durationS: number; drLevel: string; spellName: string } | null;
  };
  friendDeath15: boolean;
  targetDeath15: boolean;
  dmg15: number;
  dmgPre15: number;
  out15: number;
  outPre15: number;
  minHp15: number | null;
}

function scanRound(
  legacy: any,
  matchId: string,
  seq: number | null,
  bracket: string,
): Rec[] {
  const out: Rec[] = [];
  const units: ICombatUnit[] = Object.values(legacy.units ?? {});
  const players = units.filter((u) => u.info);
  const byTeam = new Map<string, ICombatUnit[]>();
  for (const p of players) {
    const tid = String(p.info?.teamId ?? "?");
    byTeam.set(tid, [...(byTeam.get(tid) ?? []), p]);
  }
  if (byTeam.size !== 2) return out;
  const startMs: number = legacy.startTime;
  for (const [tid, friends] of byTeam) {
    const enemies = [...byTeam.entries()].find(([kk]) => kk !== tid)![1];
    const friendIds = new Set(friends.map((f) => f.id)),
      enemyIds = new Set(enemies.map((e) => e.id));
    const fp = units.filter((u) => !u.info && friendIds.has(u.ownerId)),
      ep = units.filter((u) => !u.info && enemyIds.has(u.ownerId));
    let points: IBacklashDispelPoint[];
    try {
      points = backlashDispelDecisionPoints(friends, enemies, legacy, fp, ep);
    } catch {
      continue;
    }
    for (const p of points) {
      const t0Ms = startMs + p.t0S * 1000,
        w = BACKLASH_WINDOW_S * 1000;
      const target = friends.find((f) => f.id === p.targetId)!;
      const inWin = (t: number) => t >= t0Ms && t <= t0Ms + w,
        pre = (t: number) => t >= t0Ms - w && t < t0Ms;
      let dmg15 = 0,
        dmgPre15 = 0;
      for (const f of friends)
        for (const d of f.damageIn) {
          const t = d.logLine.timestamp;
          if (inWin(t)) dmg15 += Math.abs(d.effectiveAmount);
          else if (pre(t)) dmgPre15 += Math.abs(d.effectiveAmount);
        }
      let out15 = 0,
        outPre15 = 0;
      for (const d of target.damageOut) {
        const t = d.logLine.timestamp;
        if (inWin(t)) out15 += Math.abs(d.effectiveAmount);
        else if (pre(t)) outPre15 += Math.abs(d.effectiveAmount);
      }
      let minHp: number | null = null;
      for (
        let s = Math.floor(p.t0S);
        s <= Math.ceil(p.t0S + BACKLASH_WINDOW_S);
        s++
      )
        for (const f of friends) {
          const h = gridHpPct(f, startMs + s * 1000);
          if (h != null && (minHp == null || h < minHp)) minHp = h;
        }
      const { targetName: _tn, dispellerName: _dn, cdCcHit, ...rest } = p;
      out.push({
        matchId,
        seq,
        bracket,
        p: {
          ...rest,
          cdCcHit: cdCcHit
            ? {
                durationS: cdCcHit.durationS,
                drLevel: cdCcHit.drLevel,
                spellName: cdCcHit.spellName,
              }
            : null,
        },
        friendDeath15: friends.some((f) =>
          (f.deathRecords ?? []).some((d) => inWin(d.timestamp)),
        ),
        targetDeath15: (target.deathRecords ?? []).some((d) =>
          inWin(d.timestamp),
        ),
        dmg15,
        dmgPre15,
        out15,
        outPre15,
        minHp15: minHp,
      });
    }
  }
  return out;
}

async function scan(): Promise<void> {
  const manifestPath = flag("--manifest"),
    out = flag("--out");
  if (!manifestPath || !out) {
    console.error(
      "usage: scan --manifest <file> --out <file.jsonl> [--every N] [--offset N] [--limit N]",
    );
    process.exit(1);
  }
  await ensureAnalysisData();
  const done = new Set<string>();
  if (existsSync(out))
    for (const l of readFileSync(out, "utf8").split("\n")) {
      if (!l.trim()) continue;
      try {
        done.add(JSON.parse(l).matchId);
      } catch {
        /* torn */
      }
    }
  let files = readFileSync(manifestPath, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const every = num("--every", 1);
  if (every > 1) files = files.filter((_, i) => i % every === 0);
  const offset = num("--offset", 0);
  if (offset) files = files.slice(offset);
  const limit = num("--limit", 0);
  if (limit) files = files.slice(0, limit);
  let scanned = 0,
    rounds = 0,
    opps = 0;
  const t0 = Date.now();
  for (const path of files) {
    const matchId = basename(path).replace(/\.txt\.gz$|\.gz$|\.txt$/, "");
    if (done.has(matchId)) continue;
    let text: string;
    try {
      const raw = readFileSync(path);
      text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
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
      for (const line of text.split("\n")) parser.push(line);
      parser.end();
    } catch {
      continue;
    }
    scanned++;
    let seq = 0;
    const lines: string[] = [];
    for (const legacy of combats) {
      const mySeq = combats.length > 1 ? seq++ : null;
      rounds++;
      for (const r of scanRound(
        legacy,
        matchId,
        mySeq,
        bracketKey(legacy.startInfo?.bracket ?? "") ?? "?",
      )) {
        opps++;
        lines.push(JSON.stringify(r));
      }
    }
    if (lines.length === 0)
      lines.push(JSON.stringify({ matchId, seq: null, marker: true }));
    appendFileSync(out, lines.join("\n") + "\n");
    if (scanned % 200 === 0)
      console.log(
        `scanned ${scanned}/${files.length} rounds ${rounds} opportunities ${opps} | ${((Date.now() - t0) / 1000).toFixed(0)}s`,
      );
  }
  console.log(
    `done: scanned ${scanned} rounds ${rounds} opportunities ${opps}`,
  );
}

async function load(inPath: string): Promise<{ recs: Rec[]; files: number }> {
  const recs: Rec[] = [];
  const files = new Set<string>();
  const rl = createInterface({
    input: createReadStream(inPath),
    crlfDelay: Infinity,
  });
  for await (const l of rl) {
    if (!l.trim()) continue;
    let o: any;
    try {
      o = JSON.parse(l);
    } catch {
      continue;
    }
    files.add(o.matchId);
    if (!o.marker) recs.push(o as Rec);
  }
  return { recs, files: files.size };
}

/** Corpus immunity mining: per debuff, buffs on the reference dispeller under
 * which the backlash landed < 35 % of the single-target baseline (n ≥ 40). */
function mineImmunity(recs: Rec[]): {
  sets: Map<string, Set<string>>;
  rows: Map<string, Array<{ id: string; n: number; rate: number }>>;
  base: Map<string, number>;
} {
  const sets = new Map<string, Set<string>>(),
    rows = new Map<string, Array<{ id: string; n: number; rate: number }>>(),
    base = new Map<string, number>();
  for (const sid of new Set(recs.map((r) => r.p.spellId))) {
    const Dk = recs.filter(
      (r) =>
        r.p.spellId === sid &&
        r.p.dispelled &&
        r.p.backlashLanded != null &&
        !["Mass Dispel", "Singe Magic", "Revival", "Devour Magic"].includes(
          r.p.dispelSpellName ?? "",
        ),
    );
    const b =
      Dk.filter((r) => r.p.backlashLanded).length / Math.max(Dk.length, 1);
    base.set(sid, b);
    const per = new Map<string, { n: number; landed: number }>();
    for (const r of Dk)
      for (const id of new Set(r.p.refDispellerBuffIds)) {
        const v = per.get(id) ?? { n: 0, landed: 0 };
        v.n++;
        if (r.p.backlashLanded) v.landed++;
        per.set(id, v);
      }
    const rs = [...per]
      .filter(([, v]) => v.n >= 40)
      .map(([id, v]) => ({ id, n: v.n, rate: v.landed / v.n }))
      .sort((x, y) => x.rate - y.rate);
    rows.set(sid, rs);
    sets.set(
      sid,
      new Set(rs.filter((r) => r.rate < b * 0.35).map((r) => r.id)),
    );
  }
  return { sets, rows, base };
}

function applyImmunity(recs: Rec[], sets: Map<string, Set<string>>): void {
  for (const r of recs) {
    const set = sets.get(r.p.spellId);
    r.p.immuneBuffIds = set
      ? r.p.refDispellerBuffIds.filter((id) => set.has(id))
      : [];
  }
}

const P = (r: Rec) => r.p as unknown as IBacklashDispelPoint;
const m = (rs: Rec[], f: (r: Rec) => number) => mean(rs.map(f));
const healLoss = (r: Rec) => r.p.healerHealBefore - r.p.healerHealAfter;
const backlashDmg = (r: Rec) =>
  (r.p.dispellerDmgAfter ?? 0) - (r.p.dispellerDmgBefore ?? 0);
const ccS = (r: Rec) => (r.p.cdCcHit ? r.p.cdCcHit.durationS : 0);
const hpBand = (r: Rec) =>
  r.p.targetHpPct == null
    ? "?"
    : r.p.targetHpPct < 40
      ? "0–40"
      : r.p.targetHpPct < 60
        ? "40–60"
        : r.p.targetHpPct < 80
          ? "60–80"
          : "80–100";

/** Reference-cell arithmetic — ONE place, used by report and emit-table. */
function cell(Ds: Rec[], Ls: Rec[]) {
  return {
    n: Ds.length,
    nLeft: Ls.length,
    removedK: Math.round(
      (m(Ls, (r) => r.p.casterDmgAfter) - m(Ds, (r) => r.p.casterDmgAfter)) /
        1000,
    ),
    healLostK: Math.round((m(Ds, healLoss) - m(Ls, healLoss)) / 1000),
    backlashDmgK: Math.round(m(Ds, backlashDmg) / 1000),
    ccExposureS: Number((m(Ds, ccS) - m(Ls, ccS)).toFixed(2)),
    deathDPct: Math.round(
      (100 * Ds.filter((r) => r.friendDeath15).length) / Math.max(Ds.length, 1),
    ),
    deathLPct: Math.round(
      (100 * Ls.filter((r) => r.friendDeath15).length) / Math.max(Ls.length, 1),
    ),
  };
}
const netK = (c: ReturnType<typeof cell>) =>
  c.removedK - c.healLostK - c.backlashDmgK;

/** The strata the product accuses / suggests in, and their matching left-on
 * populations (same target-HP band, same debuff) — the product predicates
 * decide membership, this only pairs D with its L control. */
function strata(recs: Rec[]) {
  const D = recs.filter((r) => isAccusableBacklashDispel(P(r)));
  const Lctl = (sid: string) =>
    recs.filter(
      (r) =>
        r.p.spellId === sid &&
        !r.p.dispelled &&
        r.p.available &&
        r.p.immuneBuffIds.length === 0 &&
        r.p.targetHpPct != null &&
        r.p.targetHpPct >= (sid === "1259790" ? 60 : 80),
    );
  const worthD = (sid: string) =>
    recs.filter(
      (r) =>
        r.p.spellId === sid &&
        r.p.dispelled &&
        !r.p.coRemovedCritical &&
        r.p.targetHpPct != null &&
        r.p.targetHpPct >= 40 &&
        r.p.targetHpPct < 60 &&
        r.p.dotCountPre >= 3,
    );
  const worthL = (sid: string) =>
    recs.filter((r) => r.p.spellId === sid && isWorthWindow(P(r)));
  const immuneD = (sid: string) =>
    recs.filter(
      (r) =>
        r.p.spellId === sid &&
        r.p.dispelled &&
        !r.p.coRemovedCritical &&
        r.p.immuneBuffIds.length > 0 &&
        r.p.targetHpPct != null &&
        r.p.targetHpPct >= 60,
    );
  const immuneL = (sid: string) =>
    recs.filter((r) => r.p.spellId === sid && isImmuneWindow(P(r)));
  return { D, Lctl, worthD, worthL, immuneD, immuneL };
}

async function report(): Promise<void> {
  const inPath = flag("--in");
  if (!inPath) {
    console.error("usage: report --in <file.jsonl> [--spell <id>]");
    process.exit(1);
  }
  const { recs: all, files } = await load(inPath);
  const only = flag("--spell");
  const recs = only ? all.filter((r) => r.p.spellId === only) : all;
  const { sets, rows, base } = mineImmunity(all);
  applyImmunity(recs, sets);
  const D = recs.filter((r) => r.p.dispelled),
    L = recs.filter((r) => !r.p.dispelled && r.p.available);
  console.log(
    `files ${files} | opportunities ${recs.length} (available ${recs.filter((r) => r.p.available).length}) | dispelled ${D.length} | left on (available) ${L.length}`,
  );
  console.log(
    `by spell: ${[...new Set(recs.map((r) => r.p.spellId))].map((s) => `${spellName(s)} D ${D.filter((r) => r.p.spellId === s).length} / L ${L.filter((r) => r.p.spellId === s).length}`).join(" | ")}`,
  );
  console.log(
    `backlash landed ${pct(D.filter((r) => r.p.backlashLanded).length, D.length)} | co-removed Critical/High ${pct(D.filter((r) => r.p.coRemovedCritical).length, D.length)} | median latency ${median(D.map((r) => r.p.dispelS! - r.p.applyS)).toFixed(1)}s`,
  );
  console.log("\n=== IMMUNITY (mined) ===");
  for (const [sid, rs] of rows) {
    if (only && sid !== only) continue;
    console.log(
      `  ${spellName(sid)}: baseline landed ${((base.get(sid) ?? 0) * 100).toFixed(1)}% → set: ${[...(sets.get(sid) ?? [])].map((id) => getEnglishSpellName(id, id)).join(", ") || "(none)"}`,
    );
    for (const r of rs.slice(0, 8))
      console.log(
        `    ${(r.id + " " + getEnglishSpellName(r.id, r.id)).padEnd(44)} n ${String(r.n).padStart(5)} landed ${(r.rate * 100).toFixed(1)}%`,
      );
  }
  const st = strata(recs);
  console.log("\n=== PRODUCT STRATA (the product's own predicates) ===");
  const line = (label: string, Ds: Rec[], Ls: Rec[]) => {
    const c = cell(Ds, Ls);
    console.log(
      `  ${label.padEnd(30)} D ${String(c.n).padStart(6)} L ${String(c.nLeft).padStart(7)} | removed ${String(c.removedK).padStart(4)}k − heal ${String(c.healLostK).padStart(4)}k − backlash ${String(c.backlashDmgK).padStart(4)}k = net ${String(netK(c)).padStart(5)}k | CC +${c.ccExposureS.toFixed(2)}s | death D ${c.deathDPct}% L ${c.deathLPct}%`,
    );
  };
  for (const sid of new Set(recs.map((r) => r.p.spellId))) {
    line(
      `accuse ${spellName(sid)}`,
      st.D.filter((r) => r.p.spellId === sid),
      st.Lctl(sid),
    );
    line(
      `worth ${spellName(sid)} (40–60% × 3+ DoTs)`,
      st.worthD(sid),
      st.worthL(sid),
    );
    line(`immune ${spellName(sid)} (≥60%)`, st.immuneD(sid), st.immuneL(sid));
  }
  console.log(
    "\n=== by target HP band (all dispelled, non-collateral, non-immune vs left-on) ===",
  );
  for (const b of ["0–40", "40–60", "60–80", "80–100"])
    line(
      `HP ${b}`,
      D.filter(
        (r) =>
          hpBand(r) === b &&
          !r.p.coRemovedCritical &&
          r.p.immuneBuffIds.length === 0,
      ),
      L.filter((r) => hpBand(r) === b),
    );
  if (recs.some((r) => r.p.spellId === "1259790")) {
    console.log(
      "\n=== UA by stacks (non-collateral, non-immune vs left-on) ===",
    );
    for (const s of [1, 2, 3, 4, 5])
      line(
        `${s === 5 ? "5+" : s} stack(s)`,
        D.filter(
          (r) =>
            r.p.spellId === "1259790" &&
            !r.p.coRemovedCritical &&
            r.p.immuneBuffIds.length === 0 &&
            (s === 5 ? r.p.stacks >= 5 : r.p.stacks === s),
        ),
        L.filter(
          (r) =>
            r.p.spellId === "1259790" &&
            (s === 5 ? r.p.stacks >= 5 : r.p.stacks === s),
        ),
      );
  }
  console.log("\n=== product fire counts ===");
  console.log(
    `  accusable points ${st.D.length} | worth windows ${recs.filter((r) => isWorthWindow(P(r))).length} | immune windows ${recs.filter((r) => isImmuneWindow(P(r))).length} | rounds ${new Set(recs.map((r) => `${r.matchId}:${r.seq ?? 0}`)).size}`,
  );
}

async function emitTable(): Promise<void> {
  const inPath = flag("--in");
  if (!inPath) {
    console.error("usage: emit-table --in <file.jsonl> --corpus <label>");
    process.exit(1);
  }
  const { recs, files } = await load(inPath);
  const { sets } = mineImmunity(recs);
  applyImmunity(recs, sets);
  const st = strata(recs);
  const cells: Record<string, unknown> = {};
  for (const sid of new Set(recs.map((r) => r.p.spellId))) {
    const kind = BACKLASH_KIND[sid];
    if (!kind) continue;
    const c = cell(
      st.D.filter((r) => r.p.spellId === sid),
      st.Lctl(sid),
    );
    cells[sid] = {
      n: c.n,
      nLeft: c.nLeft,
      removedK: c.removedK,
      healLostK: c.healLostK,
      backlashDmgK: c.backlashDmgK,
      ccExposureS: c.ccExposureS,
      backlashKind: kind.kind,
      backlashS: kind.seconds,
    };
    const w = cell(st.worthD(sid), st.worthL(sid));
    if (w.n >= BACKLASH_PRIOR_N_FLOOR && w.nLeft >= BACKLASH_PRIOR_N_FLOOR)
      cells[`${sid}:worth`] = {
        nD: w.n,
        nL: w.nLeft,
        deathDPct: w.deathDPct,
        deathLPct: w.deathLPct,
        netK: netK(w),
      };
    const im = cell(st.immuneD(sid), st.immuneL(sid));
    if (im.n >= BACKLASH_PRIOR_N_FLOOR && im.nLeft >= BACKLASH_PRIOR_N_FLOOR) cells[`${sid}:immune`] = { nD: im.n, nL: im.nLeft, deathDPct: im.deathDPct, deathLPct: im.deathLPct, netK: netK(im) };
  }
  const immunity: Record<string, string[]> = {};
  for (const [sid, set] of sets) immunity[sid] = [...set].sort();
  process.stdout.write(
    JSON.stringify(
      {
        meta: {
          corpus: flag("--corpus") ?? inPath,
          generatedAt: new Date().toISOString(),
          files,
          opportunities: recs.length,
          generator: "backlashDispelOutcomeProbe.ts emit-table",
          nFloor: BACKLASH_PRIOR_N_FLOOR,
        },
        cells,
        immunity,
      },
      null,
      1,
    ) + "\n",
  );
}

if (cmd === "scan")
  scan().catch((e) => {
    console.error(e);
    process.exit(1);
  });
else if (cmd === "report")
  report().catch((e) => {
    console.error(e);
    process.exit(1);
  });
else if (cmd === "emit-table")
  emitTable().catch((e) => {
    console.error(e);
    process.exit(1);
  });
else {
  console.error("usage: scan | report | emit-table");
  process.exit(1);
}
