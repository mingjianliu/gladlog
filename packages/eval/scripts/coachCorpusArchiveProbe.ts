/**
 * Coach-corpus probes over the PvP log ARCHIVE (2026-09-11, user: "跑归档,不要
 * 光用我自己的游戏"). Same predicates as coachCorpusWeekendProbe{,2}.ts, but:
 *
 *   - every player in every round is taken as an owner perspective in turn
 *     (both teams — the archive has full data for both), so the owner-side
 *     sections are no longer one healer's library;
 *   - rating comes from the archiver's ledger (team0MMR / team1MMR per side),
 *     so the rating-bucket splits are the cross-player axis the local library
 *     cannot give;
 *   - two commands, `scan` (streams the manifest, appends one compact record
 *     per player-perspective to a JSONL, resumable) and `report` (aggregates),
 *     the same shape as signalSkillGradientScan.ts.
 *
 * Sections (letters match the two library probes, issue numbers in the report):
 *   A #77 forfeited CC casts      B #78 unspent-interrupt ceiling
 *   C #82 CC with nothing behind  D #88 never-observed interrupt
 *   E #87 kick press depth        F #79 what a kick stopped
 *   G #80 dispels                 H #81 forfeited offensive casts
 *   I #85 raw swap rate           J #72 DR level of healer-CC windows
 *
 * Press depth (E) needs a per-spell reference cast duration; `scan` collects
 * completed start→success durations globally and writes them next to the
 * output as `<out>.castdur.json`, which `report` reads.
 *
 *   npx tsx packages/eval/scripts/coachCorpusArchiveProbe.ts scan \
 *       --manifest <file> --ledger <dir> --out <file.jsonl> [--every N] [--offset N] [--limit N]
 *   npx tsx packages/eval/scripts/coachCorpusArchiveProbe.ts report --in <file.jsonl>
 */
import {
  cdAvailableAt,
  computeOffensiveWindows,
  ensureAnalysisData,
  extractMajorCooldowns,
  isHealerSpec,
  specToString,
} from "@gladlog/analysis";
import { enemyHealerCcWindows } from "@gladlog/analysis/src/analysis/candidates/cooldownTiming";
import { SPELL_CATEGORIES } from "@gladlog/analysis/src/data/spellCategories";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import { bracketKey } from "@gladlog/analysis/src/utils/bracketKey";
import {
  DISPEL_PENALTY_SPELLS,
  purgePriorityForTest,
} from "@gladlog/analysis/src/utils/dispelAnalysis";
import { analyzeOutgoingCCChains } from "@gladlog/analysis/src/utils/drAnalysis";
import { computeEnemyInterruptAvailability } from "@gladlog/analysis/src/utils/enemyInterrupts";
import { OFFENSIVE_CD_SPELL_IDS } from "@gladlog/analysis/src/utils/spellDanger";
import { GladLogParser } from "@gladlog/parser";
import type { ICombatUnit } from "@gladlog/parser-compat";
import {
  LogEvent,
  toLegacyMatch,
  toLegacyShuffle,
} from "@gladlog/parser-compat";
import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { basename, join } from "path";
import { gunzipSync } from "zlib";

import { bucketOf, RATING_BUCKETS } from "../src/explore/signalSkillGradient";

const SPELLS = SPELL_CATEGORIES as Record<string, { type: string }>;
const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const num = (f: string, d: number): number => Number(flag(f) ?? d);
const pct = (a: number, b: number) =>
  b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`;
const bump = (m: Map<string, number>, k: string, by = 1) =>
  m.set(k, (m.get(k) ?? 0) + by);
const top = (m: Map<string, number>, n = 12) =>
  [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
const median = (xs: number[]) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const en = (id: string, name: string) => getEnglishSpellName(id, name);

/** One record per (round, owner perspective). Counts only — no names of
 * players, no verbatim anything. */
interface Rec {
  matchId: string;
  seq: number | null;
  bracket: string;
  rating: number | null;
  spec: string;
  healer: boolean;
  durS: number;
  // A
  ccMajors: number;
  ccForfeit: number;
  ccForfeitBySpell: Record<string, number>;
  // B
  hasKick: boolean;
  completed: number;
  completedReady: number;
  // C
  ccCasts: number;
  ccNoCd: number;
  ccNoWin: number;
  ccBoth: number;
  ccBothBySpell: Record<string, number>;
  // E/F
  landed: number;
  landedOnHealer: number;
  landedType: Record<string, number>;
  landedSpell: Record<string, number>;
  depth: Array<[string, number]>; // [stoppedSpellId, ms since cast start]
  landedNoStart: number;
  // G
  dispels: number;
  cleanse: number;
  purge: number;
  backlash: number;
  tier: Record<string, number>;
  // H
  offMajors: number;
  offForfeit: number;
  offNeverCastLong: number;
  // I
  swaps: number;
  // team-side, recorded on every perspective but aggregated once per (round, team) in report
  teamKey: string;
  enemyKit: number;
  enemyNeverKick: number;
  healerWinLevel: Record<string, number>;
}

function forfeits(
  cds: ReturnType<typeof extractMajorCooldowns>,
  by: Record<string, number>,
): number {
  let f = 0;
  for (const cd of cds) {
    const cdS = cd.cooldownSeconds;
    if (!cdS || cdS <= 0) continue;
    for (const w of cd.availableWindows ?? []) {
      const k = Math.floor(w.durationSeconds / cdS);
      if (k > 0) {
        f += k;
        by[cd.spellName] = (by[cd.spellName] ?? 0) + k;
      }
    }
  }
  return f;
}

function perspective(
  legacy: any,
  owner: ICombatUnit,
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
  castDur: Map<string, number[]>,
): Rec | null {
  const startMs: number = legacy.startTime;
  const durS = (legacy.endTime - legacy.startTime) / 1000;
  const enemyPlayers = enemies.filter((e) => e.info);
  if (enemyPlayers.length === 0) return null;
  const healerNames = new Set(
    enemyPlayers.filter((e) => isHealerSpec(e.spec)).map((e) => e.name),
  );
  let ownerCds: ReturnType<typeof extractMajorCooldowns>;
  try {
    ownerCds = extractMajorCooldowns(owner, legacy);
  } catch {
    ownerCds = [];
  }
  const r: Rec = {
    matchId: "",
    seq: null,
    bracket: "",
    rating: null,
    spec: specToString(owner.spec),
    healer: isHealerSpec(owner.spec),
    durS,
    ccMajors: 0,
    ccForfeit: 0,
    ccForfeitBySpell: {},
    hasKick: false,
    completed: 0,
    completedReady: 0,
    ccCasts: 0,
    ccNoCd: 0,
    ccNoWin: 0,
    ccBoth: 0,
    ccBothBySpell: {},
    landed: 0,
    landedOnHealer: 0,
    landedType: {},
    landedSpell: {},
    depth: [],
    landedNoStart: 0,
    dispels: 0,
    cleanse: 0,
    purge: 0,
    backlash: 0,
    tier: {},
    offMajors: 0,
    offForfeit: 0,
    offNeverCastLong: 0,
    swaps: 0,
    teamKey: "",
    enemyKit: 0,
    enemyNeverKick: 0,
    healerWinLevel: {},
  };

  // A
  const ccCds = ownerCds.filter((cd) => ccSpellIds.has(cd.spellId));
  r.ccMajors = ccCds.length;
  r.ccForfeit = forfeits(ccCds, r.ccForfeitBySpell);

  // B
  const ownerKick = computeEnemyInterruptAvailability([owner], startMs)[0];
  r.hasKick = Boolean(ownerKick);
  if (ownerKick) {
    const kickCasts = owner.spellCastEvents
      .filter(
        (c) =>
          c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
          SPELLS[c.spellId ?? ""]?.type === "interrupts",
      )
      .map((c) => c.logLine.timestamp);
    // cooldown seconds from the interrupt table via the availability helper
    // at each candidate instant would re-walk casts; a kick's cooldown is
    // constant, so derive "ready at t" as: no owner kick cast within cd before t.
    const cdS =
      ownerCds.find((cd) => SPELLS[cd.spellId]?.type === "interrupts")
        ?.cooldownSeconds ?? 24;
    for (const victim of enemyPlayers) {
      const starts = (victim.castStartEvents ?? []).filter(
        (e) => e.logLine.event === LogEvent.SPELL_CAST_START,
      );
      const succ = victim.spellCastEvents.filter(
        (e) => e.logLine.event === LogEvent.SPELL_CAST_SUCCESS,
      );
      const interrupts = victim.actionIn
        .filter((a) => a.logLine.event === LogEvent.SPELL_INTERRUPT)
        .map((a) => a.logLine.timestamp);
      for (const s of starts) {
        const done = succ.find(
          (c) =>
            c.spellId === s.spellId &&
            c.logLine.timestamp >= s.logLine.timestamp &&
            c.logLine.timestamp - s.logLine.timestamp <= 10000,
        );
        if (!done) continue;
        if (
          interrupts.some(
            (t) => t >= s.logLine.timestamp && t <= done.logLine.timestamp,
          )
        )
          continue;
        r.completed++;
        const t = done.logLine.timestamp;
        const ready = !kickCasts.some((k) => k < t && t - k < cdS * 1000);
        if (ready) r.completedReady++;
      }
    }
  }

  // C
  const teamOff: ReturnType<typeof extractMajorCooldowns> = [];
  for (const f of friends) {
    if (!f.info) continue;
    try {
      for (const cd of extractMajorCooldowns(f, legacy))
        if (OFFENSIVE_CD_SPELL_IDS.has(cd.spellId)) teamOff.push(cd);
    } catch {
      /* absent, not assumed */
    }
  }
  let windows: Array<{ fromSeconds: number; toSeconds: number }> = [];
  try {
    windows = computeOffensiveWindows(enemies, friends, legacy) as never;
  } catch {
    windows = [];
  }
  for (const c of owner.spellCastEvents) {
    if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
    const sid = c.spellId ?? "";
    if (!ccSpellIds.has(sid)) continue;
    r.ccCasts++;
    const t = (c.logLine.timestamp - startMs) / 1000;
    const cdReady = teamOff.some((cd) => cdAvailableAt(cd, t));
    const inWin = windows.some((w) => t >= w.fromSeconds && t <= w.toSeconds);
    if (!cdReady) r.ccNoCd++;
    if (!inWin) r.ccNoWin++;
    if (!cdReady && !inWin) {
      r.ccBoth++;
      const nm = en(sid, c.spellName ?? sid);
      r.ccBothBySpell[nm] = (r.ccBothBySpell[nm] ?? 0) + 1;
    }
  }

  // E/F
  const kickerIds = new Set<string>([owner.id]);
  for (const u of Object.values(
    (legacy.units ?? {}) as Record<string, ICombatUnit>,
  ))
    if (u.ownerId === owner.id) kickerIds.add(u.id);
  for (const victim of enemyPlayers) {
    const starts = (victim.castStartEvents ?? []).filter(
      (e) => e.logLine.event === LogEvent.SPELL_CAST_START,
    );
    for (const a of victim.actionIn) {
      if (
        a.logLine.event !== LogEvent.SPELL_INTERRUPT ||
        !kickerIds.has(a.srcUnitId)
      )
        continue;
      const stopped = a.extraSpellId ?? "";
      const nm = en(stopped, a.extraSpellName ?? stopped);
      r.landed++;
      const ty = SPELLS[stopped]?.type ?? "unlisted";
      r.landedType[ty] = (r.landedType[ty] ?? 0) + 1;
      r.landedSpell[nm] = (r.landedSpell[nm] ?? 0) + 1;
      if (healerNames.has(victim.name)) r.landedOnHealer++;
      const st = [...starts]
        .reverse()
        .find(
          (s) =>
            s.spellId === stopped &&
            s.logLine.timestamp <= a.logLine.timestamp &&
            a.logLine.timestamp - s.logLine.timestamp <= 10000,
        );
      if (!st) r.landedNoStart++;
      else r.depth.push([stopped, a.logLine.timestamp - st.logLine.timestamp]);
    }
  }

  // G
  const friendIds = new Set(friends.map((f) => f.id));
  for (const a of owner.actionOut) {
    if (a.logLine.event !== LogEvent.SPELL_DISPEL) continue;
    r.dispels++;
    const removed = a.extraSpellId ?? "";
    const isCleanse = friendIds.has(a.destUnitId);
    if (isCleanse) r.cleanse++;
    else r.purge++;
    if (DISPEL_PENALTY_SPELLS.has(removed)) r.backlash++;
    const k = `${isCleanse ? "cleanse" : "purge"}:${purgePriorityForTest(removed)}`;
    r.tier[k] = (r.tier[k] ?? 0) + 1;
  }

  // H
  const off = ownerCds.filter((cd) => OFFENSIVE_CD_SPELL_IDS.has(cd.spellId));
  r.offMajors = off.length;
  r.offForfeit = forfeits(off, {});
  for (const cd of off) {
    const cdS = cd.cooldownSeconds;
    if (!cdS || cdS <= 0) continue;
    const casts = owner.spellCastEvents.filter(
      (c) =>
        c.spellId === cd.spellId &&
        c.logLine.event === LogEvent.SPELL_CAST_SUCCESS,
    ).length;
    if (casts === 0 && durS > cdS) r.offNeverCastLong++;
  }

  // I
  {
    const enemyIds = new Set(enemyPlayers.map((e) => e.id));
    const byBucket = new Map<number, Map<string, number>>();
    for (const d of owner.damageOut) {
      // SIGN BUG FIXED 2026-09-12 (codex review of GH #85): legacy damage is
      // NEGATIVE, SPELL_ABSORBED rows POSITIVE — `<= 0` kept absorbs and dropped
      // damage. The archive swap rate (3.43/min DPS) posted on GH #85 was
      // measured on absorbs and is invalid. Same fix as coachCorpusWeekendProbe2.
      if (
        !enemyIds.has(d.destUnitId) ||
        d.logLine.event === "SPELL_ABSORBED" ||
        d.effectiveAmount >= 0
      )
        continue;
      const b = Math.floor((d.logLine.timestamp - startMs) / 3000);
      const m = byBucket.get(b) ?? new Map<string, number>();
      bump(m, d.destUnitId, -d.effectiveAmount);
      byBucket.set(b, m);
    }
    let prev: string | null = null;
    for (const b of [...byBucket.keys()].sort((x, y) => x - y)) {
      const dom = top(byBucket.get(b)!, 1)[0][0];
      if (prev !== null && dom !== prev) r.swaps++;
      prev = dom;
    }
  }

  // team-side D / J (same for every perspective on this team; report dedupes by teamKey)
  for (const e of enemyPlayers) {
    if (!computeEnemyInterruptAvailability([e], startMs)[0]) continue;
    r.enemyKit++;
    const cast = e.spellCastEvents.some(
      (c) =>
        c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        SPELLS[c.spellId ?? ""]?.type === "interrupts",
    );
    if (!cast) r.enemyNeverKick++;
  }
  try {
    const wins = enemyHealerCcWindows(friends, enemies, legacy);
    if (wins.length > 0) {
      const chains = analyzeOutgoingCCChains(friends, enemies, legacy);
      for (const w of wins) {
        const app = chains
          .find((c) => c.targetName === w.healerName)
          ?.applications.find(
            (a) => a.atSeconds === w.fromSeconds && a.spellId === w.spellId,
          );
        const lvl = app ? String(app.drInfo.level) : "?";
        r.healerWinLevel[lvl] = (r.healerWinLevel[lvl] ?? 0) + 1;
      }
    }
  } catch {
    /* no chain analysis → no windows counted */
  }

  // E reference durations (global, both teams, once per round — caller guards)
  void castDur;
  return r;
}

function collectCastDur(units: ICombatUnit[], castDur: Map<string, number[]>) {
  for (const u of units) {
    if (!u.info) continue;
    const starts = (u.castStartEvents ?? []).filter(
      (e) => e.logLine.event === LogEvent.SPELL_CAST_START,
    );
    const succ = u.spellCastEvents.filter(
      (e) => e.logLine.event === LogEvent.SPELL_CAST_SUCCESS,
    );
    let si = 0;
    for (const s of starts) {
      while (
        si < succ.length &&
        succ[si].logLine.timestamp < s.logLine.timestamp
      )
        si++;
      const next = succ
        .slice(si)
        .find(
          (c) =>
            c.spellId === s.spellId &&
            c.logLine.timestamp - s.logLine.timestamp <= 10000,
        );
      if (!next) continue;
      if (
        starts.some(
          (o) =>
            o.logLine.timestamp > s.logLine.timestamp &&
            o.logLine.timestamp < next.logLine.timestamp,
        )
      )
        continue;
      const d = next.logLine.timestamp - s.logLine.timestamp;
      if (d >= 300) {
        const arr = castDur.get(s.spellId ?? "") ?? [];
        if (arr.length < 400) arr.push(d); // cap per spell; median is stable long before
        castDur.set(s.spellId ?? "", arr);
      }
    }
  }
}

function loadLedger(dir: string): Map<string, any> {
  const out = new Map<string, any>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".jsonl")) continue;
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (r.id) out.set(String(r.id), r);
      } catch {
        /* torn last line */
      }
    }
  }
  return out;
}

async function scan(): Promise<void> {
  const manifestPath = flag("--manifest");
  const ledgerDir = flag("--ledger");
  const out = flag("--out");
  if (!manifestPath || !ledgerDir || !out) {
    console.error(
      "usage: scan --manifest <file> --ledger <dir> --out <file.jsonl> [--every N] [--offset N] [--limit N]",
    );
    process.exit(1);
  }
  await ensureAnalysisData();
  const ledger = loadLedger(ledgerDir);
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
  const castDurPath = `${out}.castdur.json`;
  const castDur = new Map<string, number[]>();
  if (existsSync(castDurPath))
    for (const [k, v] of Object.entries(
      JSON.parse(readFileSync(castDurPath, "utf8")) as Record<string, number[]>,
    ))
      castDur.set(k, v);

  let scanned = 0,
    skipped = 0,
    rounds = 0,
    perspectives = 0,
    noLedger = 0;
  const t0 = Date.now();
  for (const path of files) {
    const matchId = basename(path).replace(/\.txt\.gz$|\.gz$|\.txt$/, "");
    if (done.has(matchId)) {
      skipped++;
      continue;
    }
    const meta = ledger.get(matchId);
    if (!meta) noLedger++;
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
      const units: ICombatUnit[] = Object.values(legacy.units ?? {});
      const players = units.filter((u) => u.info);
      collectCastDur(players, castDur);
      const byTeam = new Map<string, ICombatUnit[]>();
      for (const p of players) {
        const tid = String(p.info?.teamId ?? "?");
        byTeam.set(tid, [...(byTeam.get(tid) ?? []), p]);
      }
      if (byTeam.size !== 2) continue;
      rounds++;
      const bracket =
        bracketKey(meta?.bracket ?? legacy.startInfo?.bracket ?? "") ?? "?";
      for (const [tid, team] of byTeam) {
        const other = [...byTeam.entries()].find(([k]) => k !== tid)![1];
        // pets/units of the other team count as enemies for damage/kick sources; players only for predicates
        const enemiesAll = units.filter((u) =>
          other.some((o) => o.id === u.id || o.id === u.ownerId),
        );
        const friendsAll = units.filter((u) =>
          team.some((o) => o.id === u.id || o.id === u.ownerId),
        );
        const rating: number | null =
          meta == null
            ? null
            : String(meta.playerTeamId) === tid
              ? (meta.playerTeamRating ?? meta.team0MMR ?? null)
              : tid === "0"
                ? (meta.team0MMR ?? null)
                : (meta.team1MMR ?? null);
        for (const owner of team) {
          const rec = perspective(
            legacy,
            owner,
            friendsAll,
            enemiesAll,
            castDur,
          );
          if (!rec) continue;
          rec.matchId = matchId;
          rec.seq = mySeq;
          rec.bracket = bracket;
          rec.rating = rating;
          rec.teamKey = `${matchId}:${mySeq ?? 0}:${tid}`;
          perspectives++;
          lines.push(JSON.stringify(rec));
        }
      }
    }
    if (lines.length) appendFileSync(out, lines.join("\n") + "\n");
    if (scanned % 200 === 0) {
      writeFileSync(castDurPath, JSON.stringify(Object.fromEntries(castDur)));
      const el = (Date.now() - t0) / 1000;
      console.log(
        `scanned ${scanned}/${files.length - skipped} rounds ${rounds} perspectives ${perspectives} | ${el.toFixed(0)}s, ${(scanned / el).toFixed(2)} files/s`,
      );
    }
  }
  writeFileSync(castDurPath, JSON.stringify(Object.fromEntries(castDur)));
  console.log(
    `done: scanned ${scanned} skipped ${skipped} rounds ${rounds} perspectives ${perspectives} noLedger ${noLedger}`,
  );
}

function report(): void {
  // Rating-bucket splits are OFF by default — user ruling 2026-09-11: future
  // corpora will be far smaller than this season's, and rating buckets drift
  // across a season (inflation), so a bucket table is not a stable axis.
  // Role (dps/healer) and bracket splits stay. `--buckets` re-enables them.
  const showBuckets = argv.includes("--buckets");
  const inPath = flag("--in");
  if (!inPath) {
    console.error("usage: report --in <file.jsonl>");
    process.exit(1);
  }
  const recs: Rec[] = [];
  for (const l of readFileSync(inPath, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try {
      recs.push(JSON.parse(l));
    } catch {
      /* torn */
    }
  }
  const castDur = existsSync(`${inPath}.castdur.json`)
    ? (JSON.parse(readFileSync(`${inPath}.castdur.json`, "utf8")) as Record<
        string,
        number[]
      >)
    : {};
  const refDur = new Map<string, number>();
  for (const [k, xs] of Object.entries(castDur))
    if (xs.length >= 5) refDur.set(k, median(xs));

  const roundsSet = new Set(recs.map((r) => `${r.matchId}:${r.seq ?? 0}`));
  const dps = recs.filter((r) => !r.healer),
    heal = recs.filter((r) => r.healer);
  console.log(
    `records (player-perspectives) ${recs.length} | rounds ${roundsSet.size} | dps ${dps.length} healer ${heal.length}`,
  );
  const bucketRows = (rs: Rec[]) => {
    if (!showBuckets) return new Map<string, Rec[]>();
    const m = new Map<string, Rec[]>();
    for (const r of rs) {
      const b = bucketOf(r.rating);
      if (b) m.set(b, [...(m.get(b) ?? []), r]);
    }
    return m;
  };
  const solo3 = (rs: Rec[]) =>
    rs.filter((r) => r.bracket === "solo" || r.bracket === "3v3");

  console.log(
    "\n==================== (A) GH #77 forfeited CC casts ====================",
  );
  const withCc = recs.filter((r) => r.ccMajors > 0);
  console.log(
    `perspectives with a CC major ${withCc.length} | forfeited>=1 ${withCc.filter((r) => r.ccForfeit > 0).length} (${pct(withCc.filter((r) => r.ccForfeit > 0).length, withCc.length)})  <- bar 1: >50% = norm`,
  );
  console.log(
    `  dps: ${pct(dps.filter((r) => r.ccMajors > 0 && r.ccForfeit > 0).length, dps.filter((r) => r.ccMajors > 0).length)} | healer: ${pct(heal.filter((r) => r.ccMajors > 0 && r.ccForfeit > 0).length, heal.filter((r) => r.ccMajors > 0).length)}`,
  );
  if (showBuckets)
    console.log(
      "by rating bucket (3v3 + solo, per bracket separately — bar 2: top must forfeit >=25% fewer per round than bottom):",
    );
  for (const br of ["3v3", "solo"]) {
    const m = bucketRows(withCc.filter((r) => r.bracket === br));
    for (const b of RATING_BUCKETS) {
      const rs = m.get(b.key);
      if (!rs) continue;
      const f = rs.reduce((s, r) => s + r.ccForfeit, 0);
      console.log(
        `  ${br.padEnd(5)} ${b.key.padEnd(10)} n ${String(rs.length).padStart(6)}  forfeit/round ${(f / rs.length).toFixed(2)}  any ${pct(rs.filter((r) => r.ccForfeit > 0).length, rs.length)}`,
      );
    }
  }
  const aBy = new Map<string, number>();
  for (const r of withCc)
    for (const [k, v] of Object.entries(r.ccForfeitBySpell)) bump(aBy, k, v);
  console.log("top forfeited spells:");
  for (const [k, v] of top(aBy, 10)) console.log(`  ${k.padEnd(30)} ${v}`);

  console.log(
    "\n==================== (B) GH #78 unspent-interrupt UPPER BOUND ====================",
  );
  const withKick = recs.filter((r) => r.hasKick);
  const comp = withKick.reduce((s, r) => s + r.completed, 0),
    ready = withKick.reduce((s, r) => s + r.completedReady, 0);
  console.log(
    `perspectives with a kick ${withKick.length} | completed enemy hardcasts ${comp} | while kick ready ${ready} (${pct(ready, comp)}) | per perspective-round ${(comp / Math.max(withKick.length, 1)).toFixed(1)}`,
  );
  console.log(
    `  dps only: ${pct(
      dps.filter((r) => r.hasKick).reduce((s, r) => s + r.completedReady, 0),
      dps.filter((r) => r.hasKick).reduce((s, r) => s + r.completed, 0),
    )}`,
  );

  console.log(
    "\n==================== (C) GH #82 CC with nothing behind it ====================",
  );
  const cc = recs.reduce((s, r) => s + r.ccCasts, 0),
    noCd = recs.reduce((s, r) => s + r.ccNoCd, 0),
    noWin = recs.reduce((s, r) => s + r.ccNoWin, 0),
    both = recs.reduce((s, r) => s + r.ccBoth, 0);
  console.log(
    `CC casts ${cc} | no team offensive CD ready ${noCd} (${pct(noCd, cc)}) | not in kill window ${noWin} (${pct(noWin, cc)}) | BOTH ${both} (${pct(both, cc)}) | per perspective-round ${(both / recs.length).toFixed(2)}`,
  );
  console.log(
    `  dps BOTH ${pct(
      dps.reduce((s, r) => s + r.ccBoth, 0),
      dps.reduce((s, r) => s + r.ccCasts, 0),
    )} | healer BOTH ${pct(
      heal.reduce((s, r) => s + r.ccBoth, 0),
      heal.reduce((s, r) => s + r.ccCasts, 0),
    )}`,
  );
  if (showBuckets)
    console.log("by rating bucket (3v3 + solo), BOTH share of CC casts:");
  for (const br of ["3v3", "solo"]) {
    const m = bucketRows(recs.filter((r) => r.bracket === br));
    for (const b of RATING_BUCKETS) {
      const rs = m.get(b.key);
      if (!rs) continue;
      console.log(
        `  ${br.padEnd(5)} ${b.key.padEnd(10)} n ${String(rs.length).padStart(6)}  BOTH ${pct(
          rs.reduce((s, r) => s + r.ccBoth, 0),
          rs.reduce((s, r) => s + r.ccCasts, 0),
        )}`,
      );
    }
  }
  const cBy = new Map<string, number>();
  for (const r of recs)
    for (const [k, v] of Object.entries(r.ccBothBySpell)) bump(cBy, k, v);
  console.log("top spells in BOTH:");
  for (const [k, v] of top(cBy, 12)) console.log(`  ${k.padEnd(30)} ${v}`);

  console.log(
    "\n==================== (D) GH #88 never-observed enemy interrupt (team-side, deduped per round-team) ====================",
  );
  const teams = new Map<string, Rec>();
  for (const r of recs) if (!teams.has(r.teamKey)) teams.set(r.teamKey, r);
  const kit = [...teams.values()].reduce((s, r) => s + r.enemyKit, 0),
    never = [...teams.values()].reduce((s, r) => s + r.enemyNeverKick, 0);
  console.log(
    `enemy players with a kick ${kit} | never cast in the round ${never} (${pct(never, kit)})`,
  );

  console.log(
    "\n==================== (E) GH #87 press depth of landed kicks ====================",
  );
  const depthsAll: number[] = [];
  const depthBuckets = new Map<string, number>();
  let noRef = 0;
  const depthByRole = new Map<string, number[]>();
  for (const r of recs)
    for (const [sid, ms] of r.depth) {
      const ref = refDur.get(sid);
      if (!ref) {
        noRef++;
        continue;
      }
      const f = ms / ref;
      depthsAll.push(f);
      const role = r.healer ? "healer" : "dps";
      depthByRole.set(role, [...(depthByRole.get(role) ?? []), f]);
      bump(
        depthBuckets,
        f < 0.25
          ? "<25%"
          : f < 0.5
            ? "25–50%"
            : f < 0.75
              ? "50–75%"
              : f < 0.9
                ? "75–90%"
                : f <= 1.1
                  ? "90–110%"
                  : ">110%",
      );
    }
  const landed = recs.reduce((s, r) => s + r.landed, 0),
    noStart = recs.reduce((s, r) => s + r.landedNoStart, 0);
  console.log(
    `landed kicks ${landed} | no cast start ${noStart} | no reference ${noRef} | measured ${depthsAll.length} | median depth ${(median(depthsAll) * 100).toFixed(0)}%`,
  );
  for (const k of ["<25%", "25–50%", "50–75%", "75–90%", "90–110%", ">110%"])
    console.log(
      `  ${k.padEnd(10)} ${String(depthBuckets.get(k) ?? 0).padStart(7)}  ${pct(depthBuckets.get(k) ?? 0, depthsAll.length)}`,
    );
  for (const [k, xs] of depthByRole)
    console.log(
      `  ${k.padEnd(8)} n ${xs.length}  median ${(median(xs) * 100).toFixed(0)}%  <25% share ${pct(xs.filter((x) => x < 0.25).length, xs.length)}`,
    );
  if (showBuckets)
    console.log(
      "by rating bucket (3v3 + solo): median depth and <25% (reflex) share:",
    );
  for (const br of ["3v3", "solo"]) {
    const m = bucketRows(recs.filter((r) => r.bracket === br));
    for (const b of RATING_BUCKETS) {
      const rs = m.get(b.key);
      if (!rs) continue;
      const xs: number[] = [];
      for (const r of rs)
        for (const [sid, ms] of r.depth) {
          const ref = refDur.get(sid);
          if (ref) xs.push(ms / ref);
        }
      if (xs.length < 30) continue;
      console.log(
        `  ${br.padEnd(5)} ${b.key.padEnd(10)} n ${String(xs.length).padStart(6)}  median ${(median(xs) * 100).toFixed(0)}%  <25% ${pct(xs.filter((x) => x < 0.25).length, xs.length)}  75–90% ${pct(xs.filter((x) => x >= 0.75 && x < 0.9).length, xs.length)}`,
      );
    }
  }

  console.log(
    "\n==================== (F) GH #79 what a landed kick stopped ====================",
  );
  const onHealer = recs.reduce((s, r) => s + r.landedOnHealer, 0);
  console.log(
    `landed ${landed} | on the enemy healer ${onHealer} (${pct(onHealer, landed)}) | dps kickers on healer ${pct(
      dps.reduce((s, r) => s + r.landedOnHealer, 0),
      dps.reduce((s, r) => s + r.landed, 0),
    )}`,
  );
  const fTy = new Map<string, number>(),
    fSp = new Map<string, number>();
  for (const r of recs) {
    for (const [k, v] of Object.entries(r.landedType)) bump(fTy, k, v);
    for (const [k, v] of Object.entries(r.landedSpell)) bump(fSp, k, v);
  }
  console.log("by SPELL_CATEGORIES type:");
  for (const [k, v] of top(fTy, 10))
    console.log(
      `  ${k.padEnd(22)} ${String(v).padStart(7)}  ${pct(v, landed)}`,
    );
  console.log("top stopped spells:");
  for (const [k, v] of top(fSp, 20)) console.log(`  ${k.padEnd(30)} ${v}`);

  console.log("\n==================== (G) GH #80 dispels ====================");
  const dsp = recs.reduce((s, r) => s + r.dispels, 0),
    cl = recs.reduce((s, r) => s + r.cleanse, 0),
    pu = recs.reduce((s, r) => s + r.purge, 0),
    bl = recs.reduce((s, r) => s + r.backlash, 0);
  console.log(
    `dispels ${dsp} | cleanse ${cl} | purge ${pu} | backlash ${bl} (${pct(bl, dsp)}) | backlash per perspective-round ${(bl / recs.length).toFixed(3)} | per healer-round ${(heal.reduce((s, r) => s + r.backlash, 0) / Math.max(heal.length, 1)).toFixed(3)}`,
  );
  if (showBuckets)
    console.log(
      "backlash by rating bucket (3v3 + solo), per perspective-round:",
    );
  for (const br of ["3v3", "solo"]) {
    const m = bucketRows(recs.filter((r) => r.bracket === br));
    for (const b of RATING_BUCKETS) {
      const rs = m.get(b.key);
      if (!rs) continue;
      console.log(
        `  ${br.padEnd(5)} ${b.key.padEnd(10)} n ${String(rs.length).padStart(6)}  backlash/round ${(rs.reduce((s, r) => s + r.backlash, 0) / rs.length).toFixed(3)}  share of dispels ${pct(
          rs.reduce((s, r) => s + r.backlash, 0),
          rs.reduce((s, r) => s + r.dispels, 0),
        )}`,
      );
    }
  }
  const gT = new Map<string, number>();
  for (const r of recs)
    for (const [k, v] of Object.entries(r.tier)) bump(gT, k, v);
  console.log("tier of removed aura:");
  for (const [k, v] of top(gT, 10))
    console.log(`  ${k.padEnd(20)} ${String(v).padStart(7)}  ${pct(v, dsp)}`);

  console.log(
    "\n==================== (H) GH #81 forfeited OFFENSIVE casts ====================",
  );
  const withOff = recs.filter((r) => r.offMajors > 0);
  console.log(
    `perspectives with an offensive major ${withOff.length} (dps ${withOff.filter((r) => !r.healer).length}) | forfeited>=1 ${withOff.filter((r) => r.offForfeit > 0).length} (${pct(withOff.filter((r) => r.offForfeit > 0).length, withOff.length)}) | never cast though round outlasted cd ${withOff.reduce((s, r) => s + r.offNeverCastLong, 0)} of ${withOff.reduce((s, r) => s + r.offMajors, 0)} majors`,
  );
  console.log(
    `  dps only: forfeited>=1 ${pct(withOff.filter((r) => !r.healer && r.offForfeit > 0).length, withOff.filter((r) => !r.healer).length)}`,
  );
  if (showBuckets)
    console.log("by rating bucket (3v3 + solo), dps, forfeited>=1:");
  for (const br of ["3v3", "solo"]) {
    const m = bucketRows(withOff.filter((r) => !r.healer && r.bracket === br));
    for (const b of RATING_BUCKETS) {
      const rs = m.get(b.key);
      if (!rs) continue;
      console.log(
        `  ${br.padEnd(5)} ${b.key.padEnd(10)} n ${String(rs.length).padStart(6)}  forfeited>=1 ${pct(rs.filter((r) => r.offForfeit > 0).length, rs.length)}  never-cast ${pct(
          rs.reduce((s, r) => s + r.offNeverCastLong, 0),
          rs.reduce((s, r) => s + r.offMajors, 0),
        )}`,
      );
    }
  }

  console.log(
    "\n==================== (I) GH #85 raw swap rate (3s buckets) ====================",
  );
  const spm = (rs: Rec[]) =>
    rs.reduce((s, r) => s + r.swaps, 0) /
    Math.max(
      rs.reduce((s, r) => s + r.durS / 60, 0),
      1,
    );
  console.log(
    `all ${spm(recs).toFixed(2)}/min | dps ${spm(dps).toFixed(2)}/min | healer ${spm(heal).toFixed(2)}/min`,
  );
  if (showBuckets) console.log("dps by rating bucket (3v3 + solo):");
  for (const br of ["3v3", "solo"]) {
    const m = bucketRows(dps.filter((r) => r.bracket === br));
    for (const b of RATING_BUCKETS) {
      const rs = m.get(b.key);
      if (!rs) continue;
      console.log(
        `  ${br.padEnd(5)} ${b.key.padEnd(10)} n ${String(rs.length).padStart(6)}  ${spm(rs).toFixed(2)}/min`,
      );
    }
  }

  console.log(
    "\n==================== (J) GH #72 DR level of enemy-healer hard-CC windows (deduped per round-team) ====================",
  );
  const jL = new Map<string, number>();
  for (const r of teams.values())
    for (const [k, v] of Object.entries(r.healerWinLevel)) bump(jL, k, v);
  const jTot = [...jL.values()].reduce((s, v) => s + v, 0);
  for (const [k, v] of [...jL].sort())
    console.log(
      `  DR ${k.padEnd(7)} ${String(v).padStart(7)}  ${pct(v, jTot)}`,
    );
  void solo3;
}

if (cmd === "scan")
  scan().catch((e) => {
    console.error(e);
    process.exit(1);
  });
else if (cmd === "report") report();
else {
  console.error("usage: scan | report");
  process.exit(1);
}
