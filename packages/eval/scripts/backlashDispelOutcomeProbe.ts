/**
 * GH #80 value gate, v3 — a cost/benefit model of dispelling a backlash
 * debuff (Vampiric Touch / Unstable Affliction, `DISPEL_PENALTY_SPELLS`).
 * User brief 2026-09-12: "认真建模,把这个算清楚" — how much DoT damage a dispel
 * actually removes, and what the 8 s dispel cooldown costs when the next CC
 * lands on a teammate whose DR has reset.
 *
 * Opportunity = a backlash debuff applied by an enemy player to a friendly
 * player while ≥ 1 capable friendly dispeller was NOT on cleanse cooldown
 * (`reconstructDispelSummary`'s own availability predicate replayed:
 * capable = `canDefensiveCleanse(unit, getDispelType(id))`; on cooldown = a
 * cleanse by that dispeller within `DISPEL_COOLDOWNS_BY_SPELL` (default 8 s)
 * before the application). Lockout/LoS not applied — both groups share it.
 *
 * Groups: D = dispelled by a friendly (t0 = the dispel); L = left on
 * (t0 = application + D's median latency, computed at report time).
 *
 * BENEFIT side (both groups, measured in [t0, t0+15 s]):
 *   - DoT damage the debuff's caster dealt to the target via
 *     SPELL_PERIODIC_DAMAGE (per spell). L − D = damage the dispel removed,
 *     net of the caster re-applying.
 *   - what else the SAME cast removed (same source, ±100 ms): CC / High auras
 *     make the backlash the price of a cleanse that was needed anyway.
 *   - the target's own damage output (did the DPS keep hitting).
 * COST side:
 *   - backlash on the dispeller: damage taken 4 s after vs before
 *     (summary's own penaltyDamageTaken / Baseline), backlash aura landed.
 *   - the dispeller's healing output 4 s after vs before (the silence /
 *     horrify eats casts); for L the reference is the available dispeller.
 *   - the 8 s cooldown: dispellable hard CC (HARD_CC_CATEGORIES, official
 *     dispel type ∈ Magic/Curse/Poison/Disease, some capable friend) that lands
 *     on ANY friendly in (t0, t0+8 s]; per hit: observed duration, DR level
 *     (Full = the teammate's DR had reset — the long one), whether a capable
 *     dispeller was off cooldown at that instant, and how fast it was dispelled.
 * FEASIBILITY: the target's HP % at t0.
 *
 * Records are numbers only — no names.
 *
 *   npx tsx packages/eval/scripts/backlashDispelOutcomeProbe.ts scan \
 *       --manifest <file> --out <file.jsonl> [--every N] [--offset N] [--limit N]
 *   npx tsx packages/eval/scripts/backlashDispelOutcomeProbe.ts report --in <file.jsonl>
 */
import { ensureAnalysisData, isHealerSpec } from "@gladlog/analysis";
import { HARD_CC_CATEGORIES } from "@gladlog/analysis/src/analysis/candidates/cooldownTiming";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { bracketKey } from "@gladlog/analysis/src/utils/bracketKey";
import { getUnitHpAtTimestamp } from "@gladlog/analysis/src/utils/cooldowns";
import {
  canDefensiveCleanse,
  DISPEL_COOLDOWNS_BY_SPELL,
  DISPEL_PENALTY_SPELLS,
  getDispelType,
  reconstructDispelSummary,
} from "@gladlog/analysis/src/utils/dispelAnalysis";
import {
  analyzeOutgoingCCChains,
  getDRCategory,
} from "@gladlog/analysis/src/utils/drAnalysis";
import { GladLogParser } from "@gladlog/parser";
import type { ICombatUnit } from "@gladlog/parser-compat";
import {
  LogEvent,
  toLegacyMatch,
  toLegacyShuffle,
} from "@gladlog/parser-compat";
import { appendFileSync, createReadStream, existsSync, readFileSync } from "fs";
import { basename } from "path";
import { createInterface } from "readline";
import { gunzipSync } from "zlib";

const WINDOW_S = 15;
const CD_WINDOW_S = 8;
const SILENCE_S = 4;
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
const k = (x: number) => `${(x / 1000).toFixed(0)}k`;

type TA = [number, number]; // [relSeconds, amount]
type TAS = [number, number, string]; // [relSeconds, amount, spellName]
interface CcHit {
  at: number;
  durS: number;
  dr: string;
  spell: string;
  dtype: string;
  /** a capable friendly dispeller was off cooldown when it landed */
  answerable: boolean;
  /** seconds until a friendly dispelled it, null = never */
  dispelledAfterS: number | null;
  onHealer: boolean;
}
interface Opp {
  matchId: string;
  seq: number | null;
  bracket: string;
  spellId: string;
  dispelled: boolean;
  backlashLanded: boolean | null;
  latencyS: number | null;
  applyRel: number;
  auraLifeS: number;
  targetHealer: boolean;
  dispellerHealer: boolean | null;
  dispelSpell: string | null;
  dispelKind: string | null;
  coRemoved: Array<[string, string]>; // [spellName, priority]
  targetHpApply: number | null;
  targetHpDispel: number | null;
  dispelRel: number | null;
  friendDeathsRel: number[];
  targetDeathsRel: number[];
  dmgIn: TA[]; // friendly team damage taken
  dmgOut: TA[]; // target's own damage dealt
  dotIn: TAS[]; // periodic damage from the debuff's caster on the target
  casterIn: TA[]; // ALL damage from the debuff's caster on the target (periodic + direct — Malefic Rapture scales with DoT count)
  healOut: TA[]; // D: the dispeller's healing; L: the available dispeller's healing
  hpGrid: TA[]; // [relSecond, min friendly HP %]
  penaltyDamageTaken: number | null;
  penaltyDamageBaseline: number | null;
  ccHits: CcHit[]; // dispellable hard CC on any friendly in [apply-2, apply+30]
  /** [relSeconds, stackCount] from SPELL_AURA_APPLIED_DOSE / REMOVED_DOSE of this debuff on the target during its life (UA stacks; VT has none) */
  stackEvents: TA[];
  /** BUFF spell ids active on the dispeller (D) / the reference dispeller (L, at apply+5 s) at t0 — mined at report time for the ones that block the backlash CC (immunities) */
  dispellerBuffs: string[];
}

function scanRound(
  legacy: any,
  matchId: string,
  seq: number | null,
  bracket: string,
): Opp[] {
  const out: Opp[] = [];
  const units: ICombatUnit[] = Object.values(legacy.units ?? {});
  const players = units.filter((u) => u.info);
  const byTeam = new Map<string, ICombatUnit[]>();
  for (const p of players) {
    const tid = String(p.info?.teamId ?? "?");
    byTeam.set(tid, [...(byTeam.get(tid) ?? []), p]);
  }
  if (byTeam.size !== 2) return out;
  const startMs: number = legacy.startTime;
  const rel = (ms: number) => (ms - startMs) / 1000;
  const en = (id: string, name: string) => getEnglishSpellName(id, name);

  for (const [tid, friends] of byTeam) {
    const enemies = [...byTeam.entries()].find(([kk]) => kk !== tid)![1];
    const friendIds = new Set(friends.map((f) => f.id));
    const enemyIds = new Set(enemies.map((e) => e.id));
    const friendPets = units.filter((u) => !u.info && friendIds.has(u.ownerId));
    const enemyPets = units.filter((u) => !u.info && enemyIds.has(u.ownerId));
    let summary;
    try {
      summary = reconstructDispelSummary(
        friends,
        enemies,
        legacy,
        friendPets,
        enemyPets,
      );
    } catch {
      continue;
    }
    const cleanses = summary.allyCleanse;

    // incoming CC on our friendlies, with DR (the outgoing analysis mirrored)
    let incoming: Array<{
      target: string;
      app: {
        atSeconds: number;
        durationSeconds: number;
        spellId: string;
        spellName: string;
        drInfo: { category: string; level: string };
      };
    }> = [];
    try {
      for (const ch of analyzeOutgoingCCChains(enemies, friends, legacy))
        for (const app of ch.applications)
          incoming.push({ target: ch.targetName, app: app as never });
    } catch {
      incoming = [];
    }
    const capableFor = (dtype: string) =>
      friends.filter((f) => canDefensiveCleanse(f, dtype as never));
    const dispellerOffCd = (f: ICombatUnit, atRel: number): boolean => {
      for (const c of cleanses) {
        if (c.sourceName !== f.name || c.timeSeconds >= atRel) continue;
        const cd = DISPEL_COOLDOWNS_BY_SPELL.get(c.dispelSpellId) ?? 8;
        if (cd > 0 && c.timeSeconds + cd > atRel) return false;
      }
      return true;
    };
    const healerNames = new Set(
      friends.filter((f) => isHealerSpec(f.spec)).map((f) => f.name),
    );

    for (const target of friends) {
      const auras = target.auraEvents ?? [];
      for (let i = 0; i < auras.length; i++) {
        const a = auras[i];
        if (
          a.logLine.event !== LogEvent.SPELL_AURA_APPLIED ||
          a.auraType !== "DEBUFF"
        )
          continue;
        const sid = a.spellId ?? "";
        if (!DISPEL_PENALTY_SPELLS.has(sid)) continue;
        const caster = a.srcUnitId;
        if (!enemyIds.has(caster)) continue; // player-cast only
        const applyMs = a.timestamp;
        const removed = auras
          .slice(i + 1)
          .find(
            (b) =>
              b.spellId === sid &&
              (b.logLine.event === LogEvent.SPELL_AURA_REMOVED ||
                b.logLine.event === LogEvent.SPELL_AURA_APPLIED),
          );
        const endMs = removed ? removed.timestamp : legacy.endTime;
        const applyRel = rel(applyMs);

        const dtype = getDispelType(sid);
        if (!dtype) continue;
        const capable = capableFor(dtype);
        if (capable.length === 0) continue;
        const available = capable.filter((f) => dispellerOffCd(f, applyRel));
        if (available.length === 0) continue;

        const dispel = cleanses.find(
          (c) =>
            c.targetName === target.name &&
            c.removedSpellId === sid &&
            c.timeSeconds >= applyRel - 0.05 &&
            c.timeSeconds <= rel(endMs) + 0.15,
        );
        const dispeller = dispel
          ? friends.find((f) => f.name === dispel.sourceName)
          : undefined;
        const refHealer =
          dispeller ??
          available.find((f) => isHealerSpec(f.spec)) ??
          available[0];
        const lo = applyMs - 20000,
          hi = applyMs + 40000;
        const inRange = (t: number) => t >= lo && t <= hi;
        const r1 = (t: number) => Math.round(rel(t) * 10) / 10;

        const dmgIn: TA[] = [];
        for (const f of friends)
          for (const d of f.damageIn)
            if (inRange(d.logLine.timestamp))
              dmgIn.push([
                r1(d.logLine.timestamp),
                Math.abs(d.effectiveAmount),
              ]);
        const dmgOut: TA[] = target.damageOut
          .filter((d) => inRange(d.logLine.timestamp))
          .map((d) => [r1(d.logLine.timestamp), Math.abs(d.effectiveAmount)]);
        const dotIn: TAS[] = target.damageIn
          .filter(
            (d) =>
              inRange(d.logLine.timestamp) &&
              d.logLine.event === LogEvent.SPELL_PERIODIC_DAMAGE &&
              d.srcUnitId === caster,
          )
          .map((d) => [
            r1(d.logLine.timestamp),
            Math.abs(d.effectiveAmount),
            en(d.spellId ?? "", d.spellName ?? ""),
          ]);
        const casterIn: TA[] = target.damageIn
          .filter((d) => inRange(d.logLine.timestamp) && d.srcUnitId === caster)
          .map((d) => [r1(d.logLine.timestamp), Math.abs(d.effectiveAmount)] as TA);
        const healOut: TA[] = refHealer.healOut
          .filter((h) => inRange(h.logLine.timestamp))
          .map((h) => [r1(h.logLine.timestamp), Math.abs(h.effectiveAmount)]);
        const hpGrid: TA[] = [];
        for (let s = Math.floor(rel(lo)); s <= Math.ceil(rel(hi)); s++) {
          let m: number | null = null;
          for (const f of friends) {
            const h = getUnitHpAtTimestamp(f, startMs + s * 1000);
            if (h != null && (m == null || h < m)) m = h;
          }
          if (m != null) hpGrid.push([s, m]);
        }
        const buffAtMs = dispel ? startMs + dispel.timeSeconds * 1000 : applyMs + 5000;
        const active = new Map<string, boolean>();
        for (const b of refHealer.auraEvents ?? []) {
          if (b.auraType !== "BUFF" || !b.spellId) continue;
          if (b.timestamp > buffAtMs) break;
          if (b.logLine.event === LogEvent.SPELL_AURA_APPLIED || b.logLine.event === LogEvent.SPELL_AURA_REFRESH || b.logLine.event === LogEvent.SPELL_AURA_APPLIED_DOSE) active.set(b.spellId, true);
          else if (b.logLine.event === LogEvent.SPELL_AURA_REMOVED) active.set(b.spellId, false);
        }
        const dispellerBuffs = [...active].filter(([, on]) => on).map(([id]) => id);
        const stackEvents: TA[] = [];
        for (const b of auras.slice(i + 1)) {
          if (b.timestamp > endMs) break;
          if (b.spellId !== sid) continue;
          if (b.logLine.event === LogEvent.SPELL_AURA_APPLIED_DOSE || b.logLine.event === LogEvent.SPELL_AURA_REMOVED_DOSE) {
            const amt = Number(b.amount ?? b.logLine.parameters?.[b.logLine.parameters.length - 1]);
            if (Number.isFinite(amt)) stackEvents.push([r1(b.timestamp), amt]);
          }
        }
        const ccHits: CcHit[] = [];
        for (const { target: tn, app } of incoming) {
          if (app.atSeconds < applyRel - 2 || app.atSeconds > applyRel + 30)
            continue;
          if (!HARD_CC_CATEGORIES.has(getDRCategory(app.spellId))) continue;
          const ct = getDispelType(app.spellId);
          if (!ct) continue;
          const cap = capableFor(ct);
          if (cap.length === 0) continue;
          const answerable = cap.some((f) => dispellerOffCd(f, app.atSeconds));
          const dsp = cleanses.find(
            (c) =>
              c.targetName === tn &&
              c.removedSpellId === app.spellId &&
              c.timeSeconds >= app.atSeconds - 0.05 &&
              c.timeSeconds <= app.atSeconds + app.durationSeconds + 0.15,
          );
          ccHits.push({
            at: app.atSeconds,
            durS: app.durationSeconds,
            dr: String(app.drInfo.level),
            spell: en(app.spellId, app.spellName),
            dtype: ct,
            answerable,
            dispelledAfterS: dsp ? dsp.timeSeconds - app.atSeconds : null,
            onHealer: healerNames.has(tn),
          });
        }

        out.push({
          matchId,
          seq,
          bracket,
          spellId: sid,
          dispelled: Boolean(dispel),
          // VT's registered backlash id (34914) is stale — corpus 2026-09-12: the
          // horror that lands on the dispeller is 87204 Sin and Punishment (88% of
          // library VT dispels vs 0.4% for 34914). Until BACKLASH_CC_SPELL_IDS is
          // corrected this probe checks 87204 itself, same 3 s window the UA
          // evidence used.
          backlashLanded: dispel
            ? Boolean(dispel.backlashCcSpellId) ||
              (sid === "34914" && Boolean(dispeller) &&
                (dispeller!.auraEvents ?? []).some((b) => b.spellId === "87204" && b.logLine.event === LogEvent.SPELL_AURA_APPLIED && b.timestamp >= startMs + dispel.timeSeconds * 1000 && b.timestamp <= startMs + dispel.timeSeconds * 1000 + 3000))
            : null,
          latencyS: dispel ? dispel.timeSeconds - applyRel : null,
          applyRel,
          auraLifeS: rel(endMs) - applyRel,
          targetHealer: isHealerSpec(target.spec),
          dispellerHealer: dispeller ? isHealerSpec(dispeller.spec) : null,
          dispelSpell: dispel ? dispel.dispelSpellName : null,
          dispelKind: dispel ? dispel.dispelKind : null,
          coRemoved: dispel
            ? cleanses
                .filter(
                  (c) =>
                    c.sourceName === dispel.sourceName &&
                    Math.abs(c.timeSeconds - dispel.timeSeconds) <= 0.1 &&
                    !(c.removedSpellId === sid && c.targetName === target.name),
                )
                .map(
                  (c) => [c.removedSpellName, c.priority] as [string, string],
                )
            : [],
          targetHpApply: getUnitHpAtTimestamp(target, applyMs),
          targetHpDispel: dispel
            ? getUnitHpAtTimestamp(target, startMs + dispel.timeSeconds * 1000)
            : null,
          dispelRel: dispel ? dispel.timeSeconds : null,
          friendDeathsRel: friends
            .flatMap((f) => (f.deathRecords ?? []).map((d) => rel(d.timestamp)))
            .filter((t) => t >= applyRel - 20 && t <= applyRel + 40),
          targetDeathsRel: (target.deathRecords ?? [])
            .map((d) => rel(d.timestamp))
            .filter((t) => t >= applyRel - 20 && t <= applyRel + 40),
          dmgIn,
          dmgOut,
          dotIn,
          casterIn,
          healOut,
          hpGrid,
          penaltyDamageTaken: dispel?.penaltyDamageTaken ?? null,
          penaltyDamageBaseline: dispel?.penaltyDamageBaseline ?? null,
          ccHits,
          stackEvents,
          dispellerBuffs,
        });
      }
    }
  }
  return out;
}

async function scan(): Promise<void> {
  const manifestPath = flag("--manifest");
  const out = flag("--out");
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
      const bracket = bracketKey(legacy.startInfo?.bracket ?? "") ?? "?";
      rounds++;
      for (const o of scanRound(legacy, matchId, mySeq, bracket)) {
        opps++;
        lines.push(JSON.stringify(o));
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

function sumIn(xs: TA[] | TAS[], a: number, b: number): number {
  let s = 0;
  for (const x of xs) if (x[0] >= a && x[0] <= b) s += x[1];
  return s;
}

/** Streams the JSONL (the merged archive file is > 1 GB — readFileSync's
 * string limit) and hands each non-marker record to `fn`. */
async function eachOpp(path: string, fn: (o: Opp) => void): Promise<number> {
  const files = new Set<string>();
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const l of rl) {
    if (!l.trim()) continue;
    let o: any;
    try { o = JSON.parse(l); } catch { continue; }
    files.add(o.matchId);
    if (!o.marker) fn(o as Opp);
  }
  return files.size;
}

/** One opportunity reduced to the scalars the report needs, so 180k records fit in memory. */
interface C {
  bracket: string; spellId: string; dispelled: boolean; backlashLanded: boolean | null;
  dispelSpell: string | null; dispelKind: string | null; coRemoved: Array<[string, string]>;
  targetHealer: boolean; dispellerHealer: boolean | null; hp: number | null; auraLifeS: number;
  penaltyTaken: number | null; penaltyBase: number | null;
  dot15: number; dotPre: number; dotBySpell: Array<[string, number]>; all15: number; allPre: number;
  out15: number; outPre: number; heal4A: number; heal4B: number; dmg15: number; dmgPre: number;
  minHp: number | null; friendDeath: boolean; targetDeath: boolean; hits: CcHit[];
  /** stack count of the debuff at t0 (1 when no dose events preceded t0) */
  stacks: number;
  buffs: string[];
  /** distinct DoT spells from the caster ticking on the target in the 5 s before t0 */
  dotCountPre: number;
}
function compact(o: Opp, t0: number): C {
  const w = (xs: TA[] | TAS[], a: number, b: number) => sumIn(xs ?? [], a, b);
  const dotBy = new Map<string, number>();
  for (const [t, a, n] of o.dotIn ?? []) if (t >= t0 && t <= t0 + WINDOW_S) dotBy.set(n, (dotBy.get(n) ?? 0) + a);
  const hp = (o.hpGrid ?? []).filter(([s]) => s >= t0 && s <= t0 + WINDOW_S).map(([, h]) => h);
  return {
    bracket: o.bracket, spellId: o.spellId, dispelled: o.dispelled, backlashLanded: o.backlashLanded,
    dispelSpell: o.dispelSpell, dispelKind: o.dispelKind, coRemoved: o.coRemoved ?? [],
    targetHealer: o.targetHealer, dispellerHealer: o.dispellerHealer,
    hp: o.dispelled ? o.targetHpDispel : o.targetHpApply, auraLifeS: o.auraLifeS,
    penaltyTaken: o.penaltyDamageTaken, penaltyBase: o.penaltyDamageBaseline,
    dot15: w(o.dotIn, t0, t0 + WINDOW_S), dotPre: w(o.dotIn, t0 - WINDOW_S, t0), dotBySpell: [...dotBy],
    all15: w(o.casterIn, t0, t0 + WINDOW_S), allPre: w(o.casterIn, t0 - WINDOW_S, t0),
    out15: w(o.dmgOut, t0, t0 + WINDOW_S), outPre: w(o.dmgOut, t0 - WINDOW_S, t0),
    heal4A: w(o.healOut, t0, t0 + SILENCE_S), heal4B: w(o.healOut, t0 - SILENCE_S, t0),
    dmg15: w(o.dmgIn, t0, t0 + WINDOW_S), dmgPre: w(o.dmgIn, t0 - WINDOW_S, t0),
    minHp: hp.length ? Math.min(...hp) : null,
    friendDeath: (o.friendDeathsRel ?? []).some((t) => t >= t0 && t <= t0 + WINDOW_S),
    targetDeath: (o.targetDeathsRel ?? []).some((t) => t >= t0 && t <= t0 + WINDOW_S),
    hits: (o.ccHits ?? []).filter((h) => h.at > t0 && h.at <= t0 + CD_WINDOW_S),
    buffs: o.dispellerBuffs ?? [],
    stacks: (() => { let st = 1; for (const [t, a] of o.stackEvents ?? []) if (t <= t0) st = a; return st; })(),
    dotCountPre: new Set((o.dotIn ?? []).filter(([t]) => t >= t0 - 5 && t < t0).map(([, , n]) => n)).size,
  };
}

async function report(): Promise<void> {
  const inPath = flag("--in");
  if (!inPath) { console.error("usage: report --in <file.jsonl>"); process.exit(1); }
  // pass 1: D's median latency (L's t0 depends on it)
  const lats: number[] = [];
  await eachOpp(inPath, (o) => { if (o.dispelled && Number.isFinite(o.latencyS)) lats.push(o.latencyS!); });
  const lat = median(lats);
  // pass 2: reduce
  const all: C[] = [];
  const files = await eachOpp(inPath, (o) => { all.push(compact(o, o.dispelled ? o.dispelRel! : o.applyRel + lat)); });
  const onlySpell = flag("--spell");
  const pop = onlySpell ? all.filter((o) => o.spellId === onlySpell) : all;
  if (onlySpell) console.log(`[filtered to spell ${onlySpell}: ${pop.length} of ${all.length} opportunities]`);
  const D = pop.filter((o) => o.dispelled), L = pop.filter((o) => !o.dispelled);
  const isCollateral = (o: C) => o.coRemoved.some(([, pr]) => pr === "Critical" || pr === "High");
  const Dpure = D.filter((o) => !isCollateral(o)), Dcol = D.filter(isCollateral);
  const spellName = (id: string) => DISPEL_PENALTY_SPELLS.get(id)?.split("(")[1]?.replace(")", "") ?? id;
  const spells = [...new Set(pop.map((o) => o.spellId))];

  console.log(`files ${files} | opportunities (backlash debuff by an enemy player, a cleanse available) ${pop.length}`);
  console.log(`D dispelled ${D.length} (${pct(D.length, pop.length)}) | L left on ${L.length} | D median latency ${lat.toFixed(1)}s | D pure ${Dpure.length} / collateral (CC or High co-removed) ${Dcol.length}`);
  console.log(`by spell: ${spells.map((s) => `${spellName(s)} D ${D.filter((o) => o.spellId === s).length} / L ${L.filter((o) => o.spellId === s).length}`).join(" | ")}`);
  console.log(`backlash aura landed on the dispeller: ${pct(D.filter((o) => o.backlashLanded).length, D.length)} of D | dispeller is the healer ${pct(D.filter((o) => o.dispellerHealer).length, D.length)}`);
  const bySp = new Map<string, { n: number; landed: number }>();
  for (const o of D) { const kk = `${o.dispelSpell ?? "?"} [${o.dispelKind ?? "?"}]`; const v = bySp.get(kk) ?? { n: 0, landed: 0 }; v.n++; if (o.backlashLanded) v.landed++; bySp.set(kk, v); }
  console.log("  D by dispel spell:"); for (const [kk, v] of [...bySp].sort((a, b) => b[1].n - a[1].n).slice(0, 12)) console.log(`    ${kk.padEnd(40)} n ${String(v.n).padStart(6)}  backlash landed ${pct(v.landed, v.n)}`);

  console.log("\n=== BENEFIT 1. damage from the debuff's caster on the target, next 15 s (what the dispel removed, net of re-application) ===");
  const m = (rs: C[], f: (o: C) => number) => mean(rs.map(f));
  for (const [label, rs] of [["L left on", L], ["D dispelled (all)", D], ["D pure", Dpure], ["D collateral", Dcol]] as const) console.log(`  ${label.padEnd(20)} n ${String(rs.length).padStart(7)}  periodic: ${k(m(rs, (o) => o.dotPre)).padStart(5)} → ${k(m(rs, (o) => o.dot15)).padStart(5)} | ALL (periodic+direct): ${k(m(rs, (o) => o.allPre)).padStart(5)} → ${k(m(rs, (o) => o.all15)).padStart(5)}`);
  console.log(`  → removed per dispel: periodic ${k(m(L, (o) => o.dot15) - m(D, (o) => o.dot15))} (pure ${k(m(L, (o) => o.dot15) - m(Dpure, (o) => o.dot15))}) | ALL ${k(m(L, (o) => o.all15) - m(D, (o) => o.all15))} (pure ${k(m(L, (o) => o.all15) - m(Dpure, (o) => o.all15))})`);
  for (const s of spells) { const Ls = L.filter((o) => o.spellId === s), Ds = Dpure.filter((o) => o.spellId === s); console.log(`    ${spellName(s).padEnd(22)} periodic L ${k(m(Ls, (o) => o.dot15))} vs D-pure ${k(m(Ds, (o) => o.dot15))} → ${k(m(Ls, (o) => o.dot15) - m(Ds, (o) => o.dot15))} | ALL L ${k(m(Ls, (o) => o.all15))} vs D-pure ${k(m(Ds, (o) => o.all15))} → ${k(m(Ls, (o) => o.all15) - m(Ds, (o) => o.all15))}`); }
  const perSpell = new Map<string, number[]>();
  for (const o of L) for (const [n, a] of o.dotBySpell) perSpell.set(n, [...(perSpell.get(n) ?? []), a]);
  console.log("  L: which DoTs from that caster tick on the target in the 15 s (mean where present):"); for (const [n, xs] of [...perSpell].sort((a, b) => b[1].length - a[1].length).slice(0, 8)) console.log(`    ${n.padEnd(28)} present in ${pct(xs.length, L.length).padStart(6)}  mean ${k(mean(xs))}`);

  console.log("\n=== BENEFIT 2. what else the same cast removed ===");
  const co = new Map<string, number>(); for (const o of D) for (const [n, pr] of o.coRemoved) co.set(`${n} [${pr}]`, (co.get(`${n} [${pr}]`) ?? 0) + 1);
  console.log(`  D with ≥1 co-removed aura ${pct(D.filter((o) => o.coRemoved.length > 0).length, D.length)} | mean co-removed ${mean(D.map((o) => o.coRemoved.length)).toFixed(2)} | with a CC/High co-removed ${pct(Dcol.length, D.length)}`);
  for (const [kk, v] of [...co].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`    ${kk.padEnd(40)} ${v}`);

  console.log("\n=== BENEFIT 3. the target's own damage output, 15 s before → after ===");
  for (const [label, rs] of [["L left on", L], ["D dispelled", D], ["D pure", Dpure]] as const) console.log(`  ${label.padEnd(14)} ${k(m(rs, (o) => o.outPre))} → ${k(m(rs, (o) => o.out15))}  (ratio ${(m(rs, (o) => o.out15) / Math.max(m(rs, (o) => o.outPre), 1)).toFixed(2)})`);

  console.log("\n=== COST 1. backlash on the dispeller (4 s after vs before) ===");
  const pd = D.filter((o) => o.penaltyTaken != null);
  console.log(`  damage taken by the dispeller: before ${k(m(pd, (o) => o.penaltyBase!))} → after ${k(m(pd, (o) => o.penaltyTaken!))}  (n ${pd.length}; landed-only after ${k(m(pd.filter((o) => o.backlashLanded), (o) => o.penaltyTaken!))})`);
  const Dl = D.filter((o) => o.backlashLanded);
  console.log(`  healing output of the dispeller, 4 s before → after: D ${k(m(D, (o) => o.heal4B))} → ${k(m(D, (o) => o.heal4A))} (ratio ${(m(D, (o) => o.heal4A) / Math.max(m(D, (o) => o.heal4B), 1)).toFixed(2)}) | landed-only ${k(m(Dl, (o) => o.heal4B))} → ${k(m(Dl, (o) => o.heal4A))} (ratio ${(m(Dl, (o) => o.heal4A) / Math.max(m(Dl, (o) => o.heal4B), 1)).toFixed(2)}) | L reference (available dispeller) ${k(m(L, (o) => o.heal4B))} → ${k(m(L, (o) => o.heal4A))} (ratio ${(m(L, (o) => o.heal4A) / Math.max(m(L, (o) => o.heal4B), 1)).toFixed(2)})`);

  console.log("\n=== COST 2. the 8 s dispel cooldown: dispellable hard CC landing on ANY friendly in (t0, t0+8] ===");
  for (const [label, rs] of [["L left on", L], ["D dispelled (all)", D], ["D pure", Dpure]] as const) {
    const withHit = rs.filter((o) => o.hits.length > 0);
    const hits = rs.flatMap((o) => o.hits);
    const unans = hits.filter((h) => !h.answerable);
    const full = hits.filter((h) => h.dr === "Full"), fullUnans = full.filter((h) => !h.answerable);
    const disp = hits.filter((h) => h.dispelledAfterS != null);
    console.log(`  ${label.padEnd(18)} n ${String(rs.length).padStart(7)} | a dispellable hard CC lands in 8s: ${pct(withHit.length, rs.length).padStart(6)} | hits ${hits.length}: no dispeller off CD ${pct(unans.length, hits.length).padStart(6)}, dispelled within the CC ${pct(disp.length, hits.length).padStart(6)} (median ${median(disp.map((h) => h.dispelledAfterS!)).toFixed(1)}s) | observed CC duration mean ${mean(hits.map((h) => h.durS)).toFixed(1)}s | DR Full share ${pct(full.length, hits.length)} (Full & no dispeller: ${fullUnans.length}, mean ${mean(fullUnans.map((h) => h.durS)).toFixed(1)}s) | on the healer ${pct(hits.filter((h) => h.onHealer).length, hits.length)}`);
  }
  const ccSp = new Map<string, number>(); for (const o of D) for (const h of o.hits) ccSp.set(h.spell, (ccSp.get(h.spell) ?? 0) + 1);
  console.log("  D: which CC landed inside the cooldown:"); for (const [n, v] of [...ccSp].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`    ${n.padEnd(28)} ${v}`);
  const expCost = (rs: C[]) => mean(rs.map((o) => o.hits.filter((h) => !h.answerable).reduce((s, h) => s + h.durS, 0)));
  console.log(`  → expected unanswerable-CC seconds per opportunity: D ${expCost(D).toFixed(2)}s (pure ${expCost(Dpure).toFixed(2)}s) vs L ${expCost(L).toFixed(2)}s`);

  console.log("\n=== IMMUNITY MINING. D: which buffs on the dispeller block the backlash CC (landed rate per buff, n ≥ 40; corpus-mined, not a hand list) ===");
  const Dk = D.filter((o) => o.backlashLanded != null && !["Mass Dispel", "Singe Magic", "Revival", "Devour Magic"].includes(o.dispelSpell ?? ""));
  const base = Dk.filter((o) => o.backlashLanded).length / Math.max(Dk.length, 1);
  const perBuff = new Map<string, { n: number; landed: number }>();
  for (const o of Dk) for (const id of new Set(o.buffs)) { const v = perBuff.get(id) ?? { n: 0, landed: 0 }; v.n++; if (o.backlashLanded) v.landed++; perBuff.set(id, v); }
  const rows = [...perBuff].filter(([, v]) => v.n >= 40).map(([id, v]) => ({ id, n: v.n, rate: v.landed / v.n })).sort((a, b) => a.rate - b.rate);
  console.log(`  baseline landed rate (single-target dispels) ${(base * 100).toFixed(1)}% over ${Dk.length}`);
  console.log("  lowest landed rate (immunity candidates):"); for (const r of rows.slice(0, 15)) console.log(`    ${(r.id + " " + getEnglishSpellName(r.id, r.id)).padEnd(44)} n ${String(r.n).padStart(5)}  landed ${(r.rate * 100).toFixed(1)}%`);
  const IMMUNE = new Set(rows.filter((r) => r.rate < base * 0.35).map((r) => r.id));
  console.log(`  → immunity set (landed < 35% of baseline): ${[...IMMUNE].map((id) => getEnglishSpellName(id, id)).join(", ") || "(none)"}`);
  const isImmune = (o: C) => o.buffs.some((id) => IMMUNE.has(id));
  const Dimm = Dpure.filter(isImmune), Dnon = Dpure.filter((o) => !isImmune(o));
  const Limm = L.filter(isImmune), Lnon = L.filter((o) => !isImmune(o));
  console.log(`  D pure: immune at dispel ${Dimm.length} (${pct(Dimm.length, Dpure.length)}) | L: reference dispeller immune at t0 ${Limm.length} (${pct(Limm.length, L.length)})`);
  const costRow = (label: string, Ds: C[], Ls: C[]) => { if (Ds.length < 20) return; console.log(`    ${label.padEnd(30)} D ${String(Ds.length).padStart(5)} | removed ${k(m(Ls, (o) => o.all15) - m(Ds, (o) => o.all15)).padStart(5)} | dispeller heal 4s ${k(m(Ds, (o) => o.heal4B))} → ${k(m(Ds, (o) => o.heal4A))} (L ref ${k(m(Ls, (o) => o.heal4B))} → ${k(m(Ls, (o) => o.heal4A))}) | backlash dmg +${k(m(Ds, (o) => (o.penaltyTaken ?? 0) - (o.penaltyBase ?? 0)))} | CC +${(expCost(Ds) - expCost(Ls)).toFixed(2)}s | death D ${pct(Ds.filter((o) => o.friendDeath).length, Ds.length)} L ${pct(Ls.filter((o) => o.friendDeath).length, Ls.length)}`); };
  console.log("  cost when immune vs not (D pure vs matching L):"); costRow("immune", Dimm, Limm); costRow("not immune", Dnon, Lnon);
  console.log("  missed cheap dispels — L with an immune dispeller at t0, by target HP (the 'unless HP is critical' split):");
  for (const b of ["0–40", "40–60", "60–80", "80–100"]) { const ls = Limm.filter((o) => (o.hp == null ? "?" : o.hp < 40 ? "0–40" : o.hp < 60 ? "40–60" : o.hp < 80 ? "60–80" : "80–100") === b); if (ls.length) console.log(`    HP ${b.padEnd(7)} n ${String(ls.length).padStart(5)}  caster dmg next 15s ${k(m(ls, (o) => o.all15))}  death ${pct(ls.filter((o) => o.friendDeath).length, ls.length)}`); }
  console.log("\n=== DECISION STRATA. per stratum: n, damage removed (L−D all-damage 15 s), dispeller healing lost 4 s (D vs L ref), unanswerable-CC s, friendly death ===");
  const strat = (label: string, Ds: C[], Ls: C[]) => {
    if (Ds.length < 30 || Ls.length < 30) return;
    const rem = m(Ls, (o) => o.all15) - m(Ds, (o) => o.all15);
    const healLoss = (m(Ds, (o) => o.heal4B) - m(Ds, (o) => o.heal4A)) - (m(Ls, (o) => o.heal4B) - m(Ls, (o) => o.heal4A));
    const ccS = expCost(Ds) - expCost(Ls);
    const outGain = (m(Ds, (o) => o.out15) - m(Ds, (o) => o.outPre)) - (m(Ls, (o) => o.out15) - m(Ls, (o) => o.outPre));
    const dmgTaken = m(Ds, (o) => o.penaltyTaken ?? 0) - m(Ds, (o) => o.penaltyBase ?? 0);
    const net = rem + outGain - healLoss - dmgTaken;
    console.log(`  ${label.padEnd(44)} D ${String(Ds.length).padStart(5)} L ${String(Ls.length).padStart(6)} | removed ${k(rem).padStart(5)} + out ${k(outGain).padStart(5)} − heal ${k(healLoss).padStart(5)} − backlash dmg ${k(dmgTaken).padStart(5)} = net ${k(net).padStart(6)} | CC +${ccS.toFixed(2)}s | death D ${pct(Ds.filter((o) => o.friendDeath).length, Ds.length).padStart(5)} L ${pct(Ls.filter((o) => o.friendDeath).length, Ls.length).padStart(5)}`);
  };
  const hpBand = (o: C) => (o.hp == null ? "?" : o.hp < 40 ? "0–40" : o.hp < 60 ? "40–60" : o.hp < 80 ? "60–80" : "80–100");
  const dotBand = (o: C) => (o.dotCountPre <= 1 ? "1 DoT" : o.dotCountPre === 2 ? "2 DoTs" : "3+ DoTs");
  const preBand = (o: C, q1: number, q2: number) => (o.dmgPre < q1 ? "low" : o.dmgPre < q2 ? "mid" : "high");
  const pres = pop.map((o) => o.dmgPre).sort((a, b) => a - b); const q1 = pres[Math.floor(pres.length / 3)], q2 = pres[Math.floor((2 * pres.length) / 3)];
  console.log("  by target HP at t0:"); for (const b of ["0–40", "40–60", "60–80", "80–100"]) strat(`    HP ${b}%`, Dpure.filter((o) => hpBand(o) === b), L.filter((o) => hpBand(o) === b));
  console.log("  by DoTs from that caster on the target (5 s before t0):"); for (const b of ["1 DoT", "2 DoTs", "3+ DoTs"]) strat(`    ${b}`, Dpure.filter((o) => dotBand(o) === b), L.filter((o) => dotBand(o) === b));
  console.log(`  by team pressure before t0 (15 s damage taken terciles: <${k(q1)}, <${k(q2)}, ≥):`); for (const b of ["low", "mid", "high"]) strat(`    pressure ${b}`, Dpure.filter((o) => preBand(o, q1, q2) === b), L.filter((o) => preBand(o, q1, q2) === b));
  console.log("  by stacks at t0 (UA only meaningful):"); for (const st of [1, 2, 3, 4, 5]) strat(`    ${st === 5 ? "5+" : String(st)} stack(s)`, Dpure.filter((o) => (st === 5 ? o.stacks >= 5 : o.stacks === st)), L.filter((o) => (st === 5 ? o.stacks >= 5 : o.stacks === st)));
  console.log("  HP × DoTs (the tradeoff grid):"); for (const hb of ["40–60", "60–80", "80–100"]) for (const db of ["1 DoT", "2 DoTs", "3+ DoTs"]) strat(`    HP ${hb}% × ${db}`, Dpure.filter((o) => hpBand(o) === hb && dotBand(o) === db), L.filter((o) => hpBand(o) === hb && dotBand(o) === db));
  const stackPen = new Map<number, number[]>(); for (const o of D) if (o.penaltyTaken != null) stackPen.set(Math.min(o.stacks, 5), [...(stackPen.get(Math.min(o.stacks, 5)) ?? []), o.penaltyTaken - (o.penaltyBase ?? 0)]);
  console.log("  backlash damage on the dispeller by stacks:"); for (const [st, xs] of [...stackPen].sort((a, b) => a[0] - b[0])) console.log(`    ${st === 5 ? "5+" : String(st)} stack(s)  n ${String(xs.length).padStart(5)}  mean +${k(mean(xs))}`);
  console.log("\n=== OUTCOME. next 15 s ===");
  const row = (label: string, rs: C[]) => {
    const mh = rs.map((o) => o.minHp).filter((x): x is number => x != null);
    console.log(`  ${label.padEnd(30)} n ${String(rs.length).padStart(7)}  friendly death ${pct(rs.filter((o) => o.friendDeath).length, rs.length).padStart(6)}  target death ${pct(rs.filter((o) => o.targetDeath).length, rs.length).padStart(6)}  team dmg taken ${k(m(rs, (o) => o.dmg15)).padStart(6)} (pre ${k(m(rs, (o) => o.dmgPre))}, ratio ${(m(rs, (o) => o.dmg15) / Math.max(m(rs, (o) => o.dmgPre), 1)).toFixed(2)})  min HP% med ${median(mh).toFixed(0)}`);
  };
  row("L left on", L); row("D dispelled (all)", D); row("D pure", Dpure); row("D collateral", Dcol);
  console.log("\n=== FEASIBILITY. target HP% at the decision instant ===");
  for (const [lo, hi] of [[0, 40], [40, 60], [60, 80], [80, 101]] as const) { row(`D pure  target HP ${lo}–${hi === 101 ? 100 : hi}%`, Dpure.filter((o) => o.hp != null && o.hp >= lo && o.hp < hi)); row(`L       target HP ${lo}–${hi === 101 ? 100 : hi}%`, L.filter((o) => o.hp != null && o.hp >= lo && o.hp < hi)); }
  console.log("\n=== by bracket / target role (pure D vs L) ===");
  for (const br of ["3v3", "solo", "2v2"]) { row(`D pure ${br}`, Dpure.filter((o) => o.bracket === br)); row(`L ${br}`, L.filter((o) => o.bracket === br)); }
  row("D pure target=healer", Dpure.filter((o) => o.targetHealer)); row("L target=healer", L.filter((o) => o.targetHealer));
  row("D pure target=dps", Dpure.filter((o) => !o.targetHealer)); row("L target=dps", L.filter((o) => !o.targetHealer));
  console.log(`\nL aura lifetime median ${median(L.map((o) => o.auraLifeS)).toFixed(1)}s`);
}

if (cmd === "scan") scan().catch((e) => { console.error(e); process.exit(1); });
else if (cmd === "report") report().catch((e) => { console.error(e); process.exit(1); });
else { console.error("usage: scan | report"); process.exit(1); }
