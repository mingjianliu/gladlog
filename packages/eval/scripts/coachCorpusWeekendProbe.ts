/**
 * 三项预注册测量,一次遍历本机库(2026-09-11 夜,给周末人工处理用)。
 * 每项的判据都先写在对应 issue 里,本脚本只产数字,不下结论。
 *
 *  (A) GH #77 —— 损失施放次数。population 与 ccHeldEvents 完全相同(ownerCds ∩
 *      ccSpellIds),闲置区间直接取 production 的 cd.availableWindows,不重算。
 *      forfeited = Σ floor(window.durationSeconds / cd.cooldownSeconds)。
 *      分段用 signalSkillGradient 的 RATING_BUCKETS(绝对评级),只报单排。
 *  (B) GH #78 —— 「该打断却没按」的上界。敌方硬读条(CAST_START→SUCCESS 且中间无
 *      SPELL_INTERRUPT)完成时,我方打断是否不在冷却。打断可用性把 production 的
 *      computeEnemyInterruptAvailability 反向用在 owner 上 —— 消费不重写。
 *      **这是上界**:不看射程/视线/学派锁定,且 never-observed=ready 是该函数的
 *      已知乐观假设(#88)。castStartEvents 缺失的回合计 unknown,不计零。
 *  (C) GH #82 —— 控制放出去时「没有进攻冷却可用 且 不在击杀窗口内」。进攻冷却走
 *      正典表 OFFENSIVE_CD_SPELL_IDS + cdAvailableAt;击杀窗口走 computeOffensiveWindows。
 *
 * 用法: npx tsx packages/eval/scripts/coachCorpusWeekendProbe.ts [--n 1046]
 */
import {
  cdAvailableAt,
  computeOffensiveWindows,
  ensureAnalysisData,
  extractMajorCooldowns,
} from "@gladlog/analysis";
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import { bracketKey } from "@gladlog/analysis/src/utils/bracketKey";
import { computeEnemyInterruptAvailability } from "@gladlog/analysis/src/utils/enemyInterrupts";
import { OFFENSIVE_CD_SPELL_IDS } from "@gladlog/analysis/src/utils/spellDanger";
import { LogEvent } from "@gladlog/parser-compat";

import { bucketOf, RATING_BUCKETS } from "../src/explore/signalSkillGradient";
import {
  DEFAULT_MATCH_DIR,
  loadIndex,
  loadLegacyRound,
  pickRows,
  splitTeams,
} from "../src/explore/storeAccess";

function argOf(flag: string, dflt: number): number {
  const i = process.argv.indexOf(flag);
  if (i < 0) return dflt;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}
const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`);

async function main(): Promise<void> {
  const limit = argOf("--n", 100000);
  await ensureAnalysisData();
  const rows = pickRows(loadIndex(DEFAULT_MATCH_DIR), { minDurationS: 60 }).slice(0, limit);

  // (A)
  let aRounds = 0, aRoundsWithCc = 0, aRoundsForfeit = 0, aTotalForfeit = 0;
  const aBySpell = new Map<string, number>();
  const aSolo = new Map<string, { rounds: number; forfeit: number; anyForfeit: number }>();
  // (B)
  let bRounds = 0, bNoOwnerInterrupt = 0, bNoCastStarts = 0, bCompleted = 0, bCompletedWhileReady = 0;
  const bBySpell = new Map<string, number>();
  // (C)
  let cCcCasts = 0, cNoCdNoWindow = 0, cNoCd = 0, cNoWindow = 0;
  const cBySpell = new Map<string, number>();

  for (const meta of rows) {
    let legacy;
    try { ({ legacy } = loadLegacyRound(DEFAULT_MATCH_DIR, meta.id)); } catch { continue; }
    const { friends, enemies, owner } = splitTeams(legacy);
    if (!owner || enemies.length === 0) continue;
    const startMs = legacy.startTime;
    const bk = bracketKey((legacy as { startInfo?: { bracket?: string } }).startInfo?.bracket ?? "") ?? "?";
    const bucket = bucketOf((meta as { avgRating?: number }).avgRating);

    let ownerCds; try { ownerCds = extractMajorCooldowns(owner, legacy); } catch { continue; }

    // ---------- (A) ----------
    aRounds++;
    const ccCds = ownerCds.filter((cd) => ccSpellIds.has(cd.spellId));
    if (ccCds.length > 0) aRoundsWithCc++;
    let roundForfeit = 0;
    for (const cd of ccCds) {
      const cdS = cd.cooldownSeconds;
      if (!cdS || cdS <= 0) continue; // unknown cooldown → cannot normalise → skip, never guess
      for (const w of cd.availableWindows ?? []) {
        const f = Math.floor(w.durationSeconds / cdS);
        if (f > 0) { roundForfeit += f; aBySpell.set(cd.spellName, (aBySpell.get(cd.spellName) ?? 0) + f); }
      }
    }
    aTotalForfeit += roundForfeit;
    if (roundForfeit > 0) aRoundsForfeit++;
    if (bk === "solo" && bucket) {
      const s = aSolo.get(bucket) ?? { rounds: 0, forfeit: 0, anyForfeit: 0 };
      s.rounds++; s.forfeit += roundForfeit; if (roundForfeit > 0) s.anyForfeit++;
      aSolo.set(bucket, s);
    }

    // ---------- (B) ----------
    bRounds++;
    const ownerKick = computeEnemyInterruptAvailability([owner], startMs)[0];
    if (!ownerKick) { bNoOwnerInterrupt++; }
    else {
      let anyStarts = false;
      for (const e of enemies) {
        const starts = (e as { castStartEvents?: Array<{ spellId?: string; logLine: { timestamp: number } }> }).castStartEvents ?? [];
        if (starts.length > 0) anyStarts = true;
        const succ = e.spellCastEvents.filter((x) => x.logLine.event === LogEvent.SPELL_CAST_SUCCESS);
        const ints = e.spellCastEvents.filter((x) => x.logLine.event === LogEvent.SPELL_INTERRUPT).map((x) => x.logLine.timestamp);
        for (const s of starts) {
          const sid = s.spellId ?? "";
          const done = succ.find((x) => (x.spellId ?? "") === sid && x.logLine.timestamp >= s.logLine.timestamp && x.logLine.timestamp - s.logLine.timestamp <= 8000);
          if (!done) continue;
          if (ints.some((t) => t >= s.logLine.timestamp && t <= done.logLine.timestamp)) continue;
          bCompleted++;
          const st = computeEnemyInterruptAvailability([owner], done.logLine.timestamp)[0];
          if (st && st.cdRemainingSeconds === 0) {
            bCompletedWhileReady++;
            const nm = done.spellName ?? sid;
            bBySpell.set(nm, (bBySpell.get(nm) ?? 0) + 1);
          }
        }
      }
      if (!anyStarts) bNoCastStarts++;
    }

    // ---------- (C) ----------
    const teamOff: ReturnType<typeof extractMajorCooldowns> = [];
    for (const f of friends) { try { for (const cd of extractMajorCooldowns(f, legacy)) if (OFFENSIVE_CD_SPELL_IDS.has(cd.spellId)) teamOff.push(cd); } catch { /* absent, not assumed */ } }
    let windows: Array<{ fromSeconds: number; toSeconds: number }> = [];
    try { windows = computeOffensiveWindows(enemies, friends, legacy as never) as never; } catch { windows = []; }
    for (const c of owner.spellCastEvents) {
      if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      const sid = c.spellId ?? ""; if (!ccSpellIds.has(sid)) continue;
      cCcCasts++;
      const t = (c.logLine.timestamp - startMs) / 1000;
      const cdReady = teamOff.some((cd) => cdAvailableAt(cd, t));
      const inWin = windows.some((w) => t >= w.fromSeconds && t <= w.toSeconds);
      if (!cdReady) cNoCd++;
      if (!inWin) cNoWindow++;
      if (!cdReady && !inWin) { cNoCdNoWindow++; const nm = c.spellName ?? sid; cBySpell.set(nm, (cBySpell.get(nm) ?? 0) + 1); }
    }
  }

  console.log("==================== (A) GH #77 forfeited casts ====================");
  console.log(`rounds ${aRounds} | with a CC major ${aRoundsWithCc} | forfeited>=1 ${aRoundsForfeit} (${pct(aRoundsForfeit, aRoundsWithCc)} of rounds with a CC major)  <- pre-registered bar 1: >50% = describes the norm`);
  console.log(`total forfeited ${aTotalForfeit}  (${(aTotalForfeit / Math.max(aRoundsWithCc, 1)).toFixed(2)} per round-with-CC)`);
  console.log("solo shuffle by avgRating bucket (bar 2: top must forfeit >=25% fewer per round than bottom) — NOTE: user library = ONE player, so buckets are that player's own rating over time, not a cross-player skill axis:");
  for (const b of RATING_BUCKETS) { const s = aSolo.get(b.key); if (s) console.log(`  ${b.key.padEnd(10)} rounds ${String(s.rounds).padStart(4)}  forfeit/round ${(s.forfeit / s.rounds).toFixed(2)}  any ${pct(s.anyForfeit, s.rounds)}`); }
  console.log("top contributors (bar 3: must be spells coaches named):");
  for (const [n, v] of [...aBySpell].sort((x, y) => y[1] - x[1]).slice(0, 12)) console.log(`  ${n.padEnd(30)} ${v}`);

  console.log("\n==================== (B) GH #78 unspent-interrupt UPPER BOUND ====================");
  console.log(`rounds ${bRounds} | owner has no interrupt ${bNoOwnerInterrupt} (excluded) | no castStartEvents on any enemy ${bNoCastStarts} (unknown, not zero)`);
  console.log(`enemy hardcasts that COMPLETED (uninterrupted) ${bCompleted}`);
  console.log(`  ...while owner's interrupt was not on cooldown ${bCompletedWhileReady} (${pct(bCompletedWhileReady, bCompleted)})  <- UPPER bound: ignores range/LoS/lockout; never-observed=ready (#88)`);
  console.log(`  per round with an interrupt: ${(bCompletedWhileReady / Math.max(bRounds - bNoOwnerInterrupt, 1)).toFixed(1)}`);
  console.log("top completed-while-ready spells:");
  for (const [n, v] of [...bBySpell].sort((x, y) => y[1] - x[1]).slice(0, 15)) console.log(`  ${n.padEnd(30)} ${v}`);

  console.log("\n==================== (C) GH #82 CC with no damage behind it ====================");
  console.log(`owner CC casts ${cCcCasts}`);
  console.log(`  no team offensive CD ready       ${cNoCd} (${pct(cNoCd, cCcCasts)})`);
  console.log(`  not inside any kill window       ${cNoWindow} (${pct(cNoWindow, cCcCasts)})`);
  console.log(`  BOTH (the candidate population)  ${cNoCdNoWindow} (${pct(cNoCdNoWindow, cCcCasts)})  <- resources/procs NOT visible; this is the cooldown-half only`);
  console.log("top spells in the BOTH bucket:");
  for (const [n, v] of [...cBySpell].sort((x, y) => y[1] - x[1]).slice(0, 12)) console.log(`  ${n.padEnd(30)} ${v}`);
}
void main();
