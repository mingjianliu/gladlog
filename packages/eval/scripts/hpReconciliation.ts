/**
 * HP reconciliation residual: does the logged heal/damage stream explain the HP
 * deltas the advanced log itself reports?
 *
 * For each Player unit U, consecutive advanced samples (t0,hp0)→(t1,hp1) with the
 * same maxHp, no UNIT_DIED for U in between, dt ≤ MAX_GAP_MS:
 *   residual = (hp1 - hp0) - (healsReceived - damageTaken)   [events with t0 < t ≤ t1]
 * Positive residual  → HP rose more than logged heals explain (missing heals).
 * Negative residual  → HP fell more than logged damage explains (missing damage).
 *
 * Usage: npx tsx packages/eval/scripts/hpReconciliation.ts <file-or-dir>... [--max N]
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

import { parseLine } from "@gladlog/parser";

const MAX_GAP_MS = 5000;
const HEALER_SPECS: Record<number, string> = {
  105: "RDruid", 270: "MW", 65: "HPal", 256: "Disc", 257: "HPriest", 264: "RSham", 1468: "Pres",
};

const args = process.argv.slice(2);
let maxMatches = Infinity;
let subtractHealAbsorb = false;
const inputs: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--max") maxMatches = Number(args[++i]);
  else if (args[i] === "--heal-absorb") subtractHealAbsorb = true;
  else inputs.push(args[i]);
}
const files: string[] = [];
for (const p of inputs) {
  const st = fs.statSync(p);
  if (st.isDirectory()) for (const f of fs.readdirSync(p)) { const fp = path.join(p, f); if (f.endsWith(".txt") && fs.statSync(fp).isFile()) files.push(fp); }
  else files.push(p);
}

interface Acc { heal: number; dmg: number; }
interface Sample { t: number; hp: number; maxHp: number; }
interface MatchStat {
  bracket: string; healers: string[]; build: string;
  intervals: number; heal: number; dmg: number; posRes: number; negRes: number;
  hpUp: number; hpDown: number;
  // per-unit breakdown for healer-vs-others
  byUnit: Map<string, { pos: number; neg: number; heal: number; dmg: number; hpUp: number }>;
}
const matches: MatchStat[] = [];

function newMatch(bracket: string, build: string): MatchStat {
  return { bracket, healers: [], build, intervals: 0, heal: 0, dmg: 0, posRes: 0, negRes: 0, hpUp: 0, hpDown: 0, byUnit: new Map() };
}

async function processFile(file: string) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let cur: MatchStat | null = null;
  let build = "?";
  let last = new Map<string, Sample>();
  let acc = new Map<string, Acc>();
  let dead = new Set<string>();
  let specOf = new Map<string, number>();
  for await (const line of rl) {
    if (matches.length >= maxMatches) break;
    if (line.includes("COMBAT_LOG_VERSION")) { const m = /BUILD_VERSION,([0-9.]+)/.exec(line); if (m) build = m[1]; }
    const ev = parseLine(line);
    if (!ev) continue;
    if (ev.arenaStart) {
      cur = newMatch(ev.arenaStart.bracket, build);
      last = new Map(); acc = new Map(); dead = new Set(); specOf = new Map();
      continue;
    }
    if (!cur) continue;
    if (ev.arenaEnd) {
      cur.healers = [...new Set([...specOf.values()].filter((s) => HEALER_SPECS[s]).map((s) => HEALER_SPECS[s]))];
      matches.push(cur); cur = null; continue;
    }
    if (ev.combatantInfo) { specOf.set(ev.combatantInfo.playerGuid ?? (ev.params[0] as string), ev.combatantInfo.specId); continue; }
    const b = ev.base; if (!b) continue;
    const t = ev.timestamp;
    // accumulate dest-side HP changes
    if (b.destGuid?.startsWith("Player-")) {
      const a = acc.get(b.destGuid) ?? { heal: 0, dmg: 0 };
      if (ev.heal && ev.eventName.endsWith("_HEAL") && Number.isFinite(ev.heal.amount)) a.heal += Math.max(0, ev.heal.amount - (Number.isFinite(ev.heal.overheal) ? ev.heal.overheal : 0) - (subtractHealAbsorb && Number.isFinite(ev.heal.absorbed) ? ev.heal.absorbed : 0));
      if (ev.damage && ev.eventName.endsWith("_DAMAGE") && Number.isFinite(ev.damage.amount)) a.dmg += Math.max(0, ev.damage.amount - Math.max(0, Number.isFinite(ev.damage.overkill) ? ev.damage.overkill : 0));
      acc.set(b.destGuid, a);
      if (ev.unitDied) dead.add(b.destGuid);
    }
    // source-side HP sample
    const adv = ev.advanced;
    if (adv && adv.actorGuid.startsWith("Player-") && Number.isFinite(adv.hp) && adv.maxHp > 0) {
      const g = adv.actorGuid;
      const prev = last.get(g);
      const a = acc.get(g) ?? { heal: 0, dmg: 0 };
      if (prev && !dead.has(g) && prev.maxHp === adv.maxHp && t - prev.t <= MAX_GAP_MS && t >= prev.t) {
        const dHp = adv.hp - prev.hp;
        const res = dHp - (a.heal - a.dmg);
        cur.intervals++; cur.heal += a.heal; cur.dmg += a.dmg;
        if (dHp > 0) cur.hpUp += dHp; else cur.hpDown += -dHp;
        if (res > 0) cur.posRes += res; else cur.negRes += -res;
        const u = cur.byUnit.get(g) ?? { pos: 0, neg: 0, heal: 0, dmg: 0, hpUp: 0 };
        u.heal += a.heal; u.dmg += a.dmg; if (res > 0) u.pos += res; else u.neg += -res; if (dHp > 0) u.hpUp += dHp;
        cur.byUnit.set(g, u);
      }
      last.set(g, { t, hp: adv.hp, maxHp: adv.maxHp });
      acc.set(g, { heal: 0, dmg: 0 });
      if (ev.unitDied) dead.add(g); else if (adv.hp > 0) dead.delete(g);
    }
  }
}

(async () => {
  for (const f of files) { if (matches.length >= maxMatches) break; await processFile(f); }
  const pct = (a: number, b: number) => (b > 0 ? ((100 * a) / b).toFixed(1) + "%" : "n/a");
  const tot = matches.reduce((s, m) => ({ heal: s.heal + m.heal, dmg: s.dmg + m.dmg, pos: s.pos + m.posRes, neg: s.neg + m.negRes, hpUp: s.hpUp + m.hpUp, hpDown: s.hpDown + m.hpDown, iv: s.iv + m.intervals }), { heal: 0, dmg: 0, pos: 0, neg: 0, hpUp: 0, hpDown: 0, iv: 0 });
  console.log(`matches=${matches.length} intervals=${tot.iv} files=${files.length}`);
  console.log(`logged heal=${tot.heal} logged dmg=${tot.dmg} hpUp=${tot.hpUp} hpDown=${tot.hpDown}`);
  console.log(`posResidual (HP rose unexplained) = ${tot.pos}  = ${pct(tot.pos, tot.heal)} of logged heal, ${pct(tot.pos, tot.hpUp)} of HP gained`);
  console.log(`negResidual (HP fell unexplained) = ${tot.neg}  = ${pct(tot.neg, tot.dmg)} of logged dmg, ${pct(tot.neg, tot.hpDown)} of HP lost`);
  // by build
  const byBuild = new Map<string, { n: number; heal: number; pos: number; dmg: number; neg: number }>();
  for (const m of matches) { const b = byBuild.get(m.build) ?? { n: 0, heal: 0, pos: 0, dmg: 0, neg: 0 }; b.n++; b.heal += m.heal; b.pos += m.posRes; b.dmg += m.dmg; b.neg += m.negRes; byBuild.set(m.build, b); }
  console.log("\nby build: build n posRes/heal negRes/dmg");
  for (const [k, v] of [...byBuild].sort()) console.log(`  ${k} ${v.n} ${pct(v.pos, v.heal)} ${pct(v.neg, v.dmg)}`);
  // by healer spec present (match-level, multi-count)
  const bySpec = new Map<string, { n: number; heal: number; pos: number }>();
  for (const m of matches) for (const h of m.healers.length ? m.healers : ["(none)"]) { const b = bySpec.get(h) ?? { n: 0, heal: 0, pos: 0 }; b.n++; b.heal += m.heal; b.pos += m.posRes; bySpec.set(h, b); }
  console.log("\nby healer spec present: spec n posRes/heal");
  for (const [k, v] of [...bySpec].sort((a, b) => b[1].n - a[1].n)) console.log(`  ${k} ${v.n} ${pct(v.pos, v.heal)}`);
  // per-match distribution of posRes/heal
  const ratios = matches.filter((m) => m.heal > 1e5).map((m) => m.posRes / m.heal).sort((a, b) => a - b);
  const q = (p: number) => ratios.length ? (100 * ratios[Math.min(ratios.length - 1, Math.floor(p * ratios.length))]).toFixed(1) + "%" : "n/a";
  console.log(`\nper-match posRes/heal: p10=${q(0.1)} p50=${q(0.5)} p90=${q(0.9)} max=${q(0.999)} (n=${ratios.length})`);
  // worst matches
  const worst = [...matches].filter((m) => m.heal > 1e6).sort((a, b) => b.posRes / b.heal - a.posRes / a.heal).slice(0, 5);
  console.log("\nworst 5 matches:");
  for (const m of worst) {
    console.log(`  ${m.bracket} build=${m.build} healers=${m.healers.join("+")} heal=${m.heal} posRes=${m.posRes} (${pct(m.posRes, m.heal)})`);
    for (const [g, u] of [...m.byUnit].sort((a, b) => b[1].pos - a[1].pos).slice(0, 3)) console.log(`     ${g} pos=${u.pos} heal=${u.heal} hpUp=${u.hpUp}`);
  }
})();
