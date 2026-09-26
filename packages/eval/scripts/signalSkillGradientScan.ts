/**
 * signalSkillGradientScan.ts CLI — dumb shell over
 * `../src/explore/signalSkillGradient.ts` (which holds the design rationale,
 * the denominator table and every aggregation rule; per the repo convention
 * this file contains no analysis logic of its own).
 *
 * Walks the PvP log archive (raw .gz, one match per file), joins each match to
 * its ledger row for the RATING — the external ground truth this experiment
 * turns on — and emits one JSONL row per healer-owner round: which signals
 * fired, plus the exposure counts that serve as their opportunity denominators.
 *
 *   scan    tsx signalSkillGradientScan.ts scan --manifest <file> --ledger <dir>
 *             --out <file.jsonl> [--offset N] [--limit N]
 *           Resumable: appends, and skips matches already present in --out.
 *   report  tsx signalSkillGradientScan.ts report --in <file.jsonl> [--md <out>]
 *
 * Run scans in a few shards at most: a 2026-08-18 incident froze this machine
 * with 74 concurrent corpus-scanning node processes (~150GB).
 */
import {
  ccSpellIds,
  ensureAnalysisData,
  extractCandidateFindings,
  isHealerSpec,
  specToString,
  spellIdLists,
} from "@gladlog/analysis";
import { burstWindowDecisionPoints } from "@gladlog/analysis/src/analysis/burstWindowDecisionPoints";
import { BURST_WINDOW_MIN_JUDGED_S } from "@gladlog/analysis/src/analysis/candidates/burstWindowResponse";
import { crisisDecisionPoints } from "@gladlog/analysis/src/analysis/crisisDecisionPoints";
import {
  burstRefClearsMinContrast,
  lookupBurstWindowPrior,
} from "@gladlog/analysis/src/data/burstWindowPrior";
import {
  cdAvailableAt,
  extractMajorCooldowns,
} from "@gladlog/analysis/src/utils/cooldowns";
import {
  getDispelType,
  PURGE_BLOCKLIST,
  purgePriorityForTest,
} from "@gladlog/analysis/src/utils/dispelAnalysis";
import { reconstructEnemyCDTimeline } from "@gladlog/analysis/src/utils/enemyCDs";
import { isOffensiveSpell } from "@gladlog/analysis/src/utils/spellDanger";
import { GladLogParser } from "@gladlog/parser";
import {
  CombatUnitReaction,
  toLegacyMatch,
  toLegacyShuffle,
} from "@gladlog/parser-compat";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "fs";
import { basename, join } from "path";
import { gunzipSync } from "zlib";

import {
  bucketOf,
  CRISIS_HP_PCT,
  CRISIS_WINDOW_GAP_MS,
  formatStratifiedReport,
  type RoundExposure,
  type RoundRecord,
} from "../src/explore/signalSkillGradient";

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const num = (f: string, d: number): number => Number(flag(f) ?? d);

/** ledger JSONL rows → matchId → { rating, bracket, win-side, startTime } */
function loadLedger(dir: string): Map<string, any> {
  const out = new Map<string, any>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".jsonl")) continue;
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        // the archiver keys its ledger rows `id` (= the GCS object name, which
        // is also the archived file's basename)
        if (r.id) out.set(String(r.id), r);
      } catch {
        /* a torn last line is expected while the archiver is running */
      }
    }
  }
  return out;
}

/** Exposure counts: plain event tallies over the round, no analysis re-entry.
 * Field names follow parser-compat's legacy shape (auraEvents carry
 * `logLine.event` + `auraType`, damage amounts are NEGATIVE, casts live in
 * `castStartEvents`, max HP only exists on `advancedActions` samples). */
// Canonical offensive-cooldown table (unified 2026-09-02, GH #60 tail) — was
// a private classMetadata-only copy, one of the three consumers the
// unification pointed at the shared export. Since GH #115 through
// `isOffensiveSpell`, which also admits a registered effect activation.
const EXTERNAL_IDS = new Set<string>(
  (spellIdLists as any).externalDefensiveSpellIds.map(String),
);
const CYCLONE_ID = "33786";

// cc-held-burst conversion window around a burst opening. The pre-window is
// overridable for the GH #50 variant probe ("did the CC land before the burst
// as setup?"); the default is the landed definition.
const CC_HELD_PRE_S = Number(process.env.CC_HELD_PRE_S ?? 2);
const CC_HELD_POST_S = Number(process.env.CC_HELD_POST_S ?? 5);

function exposureOf(legacy: any, owner: any, friends: any[]): RoundExposure {
  const e: RoundExposure = {
    rounds: 1,
    ccOnOwner: 0,
    enemyCcOnTeam: 0,
    cleansableOnTeam: 0,
    enemyHighValuePurgeables: 0,
    friendlyDeaths: 0,
    ownerHardCasts: 0,
    friendlyDamageSpikes: 0,
    crisisWindows: 0,
    ownerMajorCdCasts: 0,
    ownerMajorCdsInKit: 0,
    ownerExternalCasts: 0,
    teamOffensiveCdCasts: 0,
    enemyCyclones: 0,
    crisisDecisionPoints: 0,
    ccBurstOpportunities: 0,
    burstWindowOpportunities: 0,
  };
  const friendIds = new Set(friends.map((u) => u.id));
  for (const u of Object.values(legacy.units ?? {}) as any[]) {
    for (const ev of (u.auraEvents ?? []) as any[]) {
      if (ev.logLine?.event !== "SPELL_AURA_APPLIED") continue;
      const sid = String(ev.spellId ?? "");
      if (!sid) continue;
      const destFriendly = friendIds.has(ev.destUnitId);
      const srcFriendly = friendIds.has(ev.srcUnitId);
      if (destFriendly && !srcFriendly && ev.auraType === "DEBUFF") {
        if (ccSpellIds.has(sid)) {
          e.enemyCcOnTeam++;
          if (ev.destUnitId === owner.id) e.ccOnOwner++;
        }
        if (getDispelType(sid)) e.cleansableOnTeam++;
      }
      // Purge denominator — the analysis predicate verbatim (dispelAnalysis's
      // purge-window loop): enemy-cast BUFF, Magic-dispellable, not
      // blocklisted, priority Critical/High. Counting "any dispellable buff"
      // instead averaged ~150/round of routine HoTs the type never looks at.
      if (
        !destFriendly &&
        !srcFriendly &&
        ev.auraType === "BUFF" &&
        getDispelType(sid) === "Magic" &&
        !PURGE_BLOCKLIST.has(sid)
      ) {
        const priority = purgePriorityForTest(sid, friends);
        if (priority === "Critical" || priority === "High")
          e.enemyHighValuePurgeables++;
      }
    }
    if (friendIds.has(u.id))
      e.friendlyDeaths += ((u.deathRecords ?? []) as any[]).length;
    if (u.id === owner.id)
      e.ownerHardCasts += ((u.castStartEvents ?? []) as any[]).length;
    for (const c of (u.spellCastEvents ?? []) as any[]) {
      const sid = String(c.spellId ?? "");
      if (!sid) continue;
      if (friendIds.has(u.id) && isOffensiveSpell(sid))
        e.teamOffensiveCdCasts++;
      if (u.id === owner.id && EXTERNAL_IDS.has(sid)) e.ownerExternalCasts++;
      if (!friendIds.has(u.id) && sid === CYCLONE_ID) e.enemyCyclones++;
    }
  }
  // Major cooldowns the owner owns / actually pressed — the production
  // predicate, not a re-implementation (cd-waste is "per cooldown you own",
  // cd-spent-idle is "per cooldown you spent").
  try {
    const cds = extractMajorCooldowns(owner, legacy);
    e.ownerMajorCdsInKit = cds.length;
    e.ownerMajorCdCasts = cds.reduce(
      (n: number, cd: any) => n + (cd.casts?.length ?? 0),
      0,
    );
  } catch {
    /* kit not resolvable → stays 0, round drops out of those denominators */
  }
  // Crisis windows: any friendly at or below CRISIS_HP_PCT, merged within
  // CRISIS_WINDOW_GAP_MS. HP only exists on advanced samples, so a round
  // logged without advanced combat logging contributes none (and is therefore
  // excluded from those signals' denominators rather than counted as zero).
  {
    const lows: number[] = [];
    for (const u of friends)
      for (const a of (u.advancedActions ?? []) as any[]) {
        const max = a.advancedActorMaxHp ?? 0;
        const cur = a.advancedActorCurrentHp ?? 0;
        if (max > 0 && cur > 0 && cur / max <= CRISIS_HP_PCT)
          lows.push(a.timestamp);
      }
    lows.sort((a, b) => a - b);
    let last = -Infinity;
    for (const t of lows)
      if (t - last > CRISIS_WINDOW_GAP_MS) {
        e.crisisWindows++;
        last = t;
      }
  }
  // Damage spikes on the owner's team: ≥20% of max HP inside 2s. Counted only
  // as an opportunity denominator for "slow defensive response" — never rendered,
  // so it deliberately does not import matchTimeline's DMG SPIKE predicate.
  for (const u of friends) {
    const maxHp = Math.max(
      0,
      ...((u.advancedActions ?? []) as any[]).map(
        (a) => a.advancedActorMaxHp ?? 0,
      ),
    );
    if (!maxHp) continue;
    const dmg = ((u.damageIn ?? []) as any[])
      .map((d) => ({
        t: d.timestamp,
        a: Math.abs(d.effectiveAmount ?? d.amount ?? 0),
      }))
      .sort((x, y) => x.t - y.t);
    if (!dmg.length) continue;
    let i = 0;
    let sum = 0;
    for (let j = 0; j < dmg.length; j++) {
      sum += dmg[j]!.a;
      while (dmg[i]!.t < dmg[j]!.t - 2000) {
        sum -= dmg[i]!.a;
        i++;
      }
      if (sum >= maxHp * 0.2) {
        e.friendlyDamageSpikes++;
        i = j + 1;
        sum = 0;
      }
    }
  }
  // I3: the candidate fires on feasible && dangerous (gate 5, spec §1b) — a
  // feasible-but-not-dangerous point is never an opportunity for it, so
  // counting `feasible` alone inflates the denominator. Role (spec §1d, GH
  // #59) is threaded through even though this scan's owners are all healers
  // today (line ~315: `friends.find(u => isHealerSpec(u.spec))`) — feeding
  // gate 3 the wrong role would silently mis-gate `feasible` the day a DPS
  // owner is added here.
  e.crisisDecisionPoints = crisisDecisionPoints(
    owner,
    legacy,
    isHealerSpec(owner.spec) ? "healer" : "dps",
  ).filter((p) => p.feasible && p.dangerous).length;
  // slow-defensive-response's opportunity gate, read off the candidate's own
  // engine rather than re-derived (GH #60 phase 2): a window that was not
  // feasible or not triaged was never a chance the team had.
  try {
    const bracket: string = legacy?.startInfo?.bracket ?? "";
    e.burstWindowOpportunities = burstWindowDecisionPoints(legacy, {
      friendlyReaction: owner.reaction,
    }).filter((p) => {
      if (
        !p.feasible ||
        !p.triaged ||
        p.durationSec < BURST_WINDOW_MIN_JUDGED_S
      )
        return false;
      // 2026-09-01: a window whose reference cell is missing or under the
      // minimum-contrast door can NEVER convert into a finding, so counting
      // it as an opportunity deflates the conversion rate for no reason.
      // Same predicate as the producer's own door.
      const ref = lookupBurstWindowPrior(bracket, p.leadCd.spellId);
      return ref !== null && burstRefClearsMinContrast(ref);
    }).length;
  } catch {
    /* engine not computable for this round → 0 opportunities */
  }
  return e;
}

async function scan(): Promise<void> {
  const manifestPath = flag("--manifest");
  const ledgerDir = flag("--ledger");
  const out = flag("--out");
  if (!manifestPath || !ledgerDir || !out) {
    console.error(
      "usage: scan --manifest <file> --ledger <dir> --out <file.jsonl> [--offset N] [--limit N]",
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
        /* torn line */
      }
    }
  let files = readFileSync(manifestPath, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const offset = num("--offset", 0);
  const limit = num("--limit", 0);
  if (offset) files = files.slice(offset);
  if (limit) files = files.slice(0, limit);

  let scanned = 0,
    skipped = 0,
    rounds = 0,
    noLedger = 0;
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
      const units: any[] = Object.values(legacy.units ?? {});
      const players = units.filter((u) => u.info);
      const friends = players.filter(
        (u) => u.reaction === CombatUnitReaction.Friendly,
      );
      const owner = friends.find((u) => isHealerSpec(u.spec));
      const mySeq = combats.length > 1 ? seq++ : null;
      if (!owner) continue;
      const winningTeamId = legacy.winningTeamId;
      const ownerTeamId = owner.info?.teamId;
      const win =
        winningTeamId != null && ownerTeamId != null
          ? String(winningTeamId) === String(ownerTeamId)
          : null;
      const rating = meta?.playerTeamRating || meta?.team0MMR || null;
      let fired: string[] = [];
      const counts: Record<string, number> = {};
      try {
        for (const c of extractCandidateFindings(legacy, owner.id))
          counts[c.type] = (counts[c.type] ?? 0) + 1;
        fired = Object.keys(counts);
      } catch {
        continue;
      }
      const exposure = exposureOf(legacy, owner, friends);
      // cc-held-burst (2026-08-29, GH #50 (a)): opportunity = a friendly aligned
      // burst window opening while the owner has a CC major available;
      // unconverted = no own CC (ccSpellIds) SPELL_CAST_SUCCESS in
      // [open - 2 s, open + 5 s]. Scan-side signal, no candidate involved.
      try {
        const enemies = players.filter(
          (u) => u.reaction !== CombatUnitReaction.Friendly,
        );
        const bursts =
          reconstructEnemyCDTimeline(friends, legacy, owner, enemies)
            .alignedBurstWindows ?? [];
        const ccMajors = extractMajorCooldowns(owner, legacy).filter((cd) =>
          ccSpellIds.has(cd.spellId),
        );
        const ownCcCasts = (owner.spellCastEvents ?? [])
          .filter(
            (c: any) =>
              c.logLine?.event === "SPELL_CAST_SUCCESS" &&
              ccSpellIds.has(String(c.spellId)),
          )
          .map((c: any) => (c.timestamp - legacy.startTime) / 1000);
        let held = 0;
        for (const w of bursts) {
          const t = w.fromSeconds;
          if (!ccMajors.some((cd) => cdAvailableAt(cd, t))) continue;
          exposure.ccBurstOpportunities++;
          if (
            !ownCcCasts.some(
              (c: number) => c >= t - CC_HELD_PRE_S && c <= t + CC_HELD_POST_S,
            )
          )
            held++;
        }
        if (held > 0) {
          counts["cc-held-burst"] = held;
          fired = Object.keys(counts);
        }
      } catch {
        /* no burst timeline → 0 opportunities, round drops out of that denominator */
      }
      const rec: RoundRecord = {
        matchId,
        seq: mySeq,
        bracket: meta?.bracket ?? legacy.startInfo?.bracket ?? "?",
        startTime: meta?.startTime ?? legacy.startTime ?? 0,
        rating,
        bucket: bucketOf(rating),
        win,
        ownerSpec: specToString(owner.spec),
        durationS: (legacy.endTime - legacy.startTime) / 1000,
        fired,
        counts,
        exposure,
      };
      lines.push(JSON.stringify(rec));
      rounds++;
    }
    if (lines.length) appendFileSync(out, lines.join("\n") + "\n");
    if (scanned % 100 === 0)
      console.error(
        `… ${scanned} matches, ${rounds} healer rounds, ${noLedger} without ledger meta`,
      );
  }
  console.error(
    `done: scanned=${scanned} skipped=${skipped} rounds=${rounds} noLedgerMeta=${noLedger}`,
  );
}

function report(): void {
  const inPath = flag("--in");
  if (!inPath) {
    console.error("usage: report --in <file.jsonl> [--md <out>]");
    process.exit(1);
  }
  const records: RoundRecord[] = [];
  for (const l of readFileSync(inPath, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try {
      records.push(JSON.parse(l));
    } catch {
      /* torn line */
    }
  }
  const withBucket = records.filter((r) => r.bucket);
  const meta = `rounds: ${records.length} (${withBucket.length} with a rating), matches: ${new Set(records.map((r) => r.matchId)).size}`;
  const md = formatStratifiedReport(withBucket, meta);
  const mdOut = flag("--md");
  if (mdOut) {
    appendFileSync(mdOut, md);
    console.error(`wrote ${mdOut}`);
  } else process.stdout.write(md);
}

if (cmd === "scan") await scan();
else if (cmd === "report") report();
else {
  console.error("usage: signalSkillGradientScan.ts scan|report ...");
  process.exit(1);
}
