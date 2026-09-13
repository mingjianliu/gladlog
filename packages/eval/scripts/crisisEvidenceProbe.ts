/**
 * crisisEvidenceProbe.ts — step 1 of the temporal-evidence experiment (GH #94,
 * spec docs/superpowers/specs/2026-09-13-temporal-evidence-experiment.md).
 *
 * Question: at this healer crisis, was there a NEW action, ONGOING protection,
 * or insufficient evidence? Renders, for a frozen set of 20 crisis moments, the
 * pre-action evidence with every premise marked known / estimated / unknown,
 * the feasible options, then (revealed after selection) the follow-up and the
 * permitted comparison sentence. Zero model calls; every fact comes from an
 * existing shared predicate — nothing is re-derived here.
 *
 * Frozen selection (pre-registered): local library, first 400 rounds ≥ 60 s,
 * owner = logging player when a healer; per round the EARLIEST crossing that is
 * `dangerous` and not `inCC` / `lockedOut` (all pre-action); round ids sorted by
 * SHA-1; first 20. `feasible`, `responded` and outcomes are never read for
 * selection — they are printed afterwards for the before/after ledger.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/crisisEvidenceProbe.ts [--n 400] [--take 20] [--out <dir>]
 */
import {
  cdAvailableAt,
  ensureAnalysisData,
  extractMajorCooldowns,
  isHealerSpec,
  specToString,
} from "@gladlog/analysis";
import {
  crisisDecisionPoints,
  type DecisionPoint,
} from "@gladlog/analysis/src/analysis/crisisDecisionPoints";
import { lookupBehaviorPrior } from "@gladlog/analysis/src/data/behaviorPrior";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { buildAuraIntervals } from "@gladlog/analysis/src/utils/auraIntervals";
import { bracketKey } from "@gladlog/analysis/src/utils/bracketKey";
import {
  getUnitPositionAtTime,
  hasLineOfSight,
} from "@gladlog/analysis/src/utils/losAnalysis";
import type { ICombatUnit } from "@gladlog/parser-compat";
import { createHash } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

import {
  DEFAULT_MATCH_DIR,
  loadIndex,
  loadLegacyRound,
  pickRows,
  splitTeams,
} from "../src/explore/storeAccess";

const RESPONSE_S = 3;
const fmtTime = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const pct = (x: number): string => `${Math.round(x * 100)} %`;
const k = (x: number): string => `${Math.round(x / 1000)}k`;

function argOf(flag: string, dflt: number): number {
  const i = process.argv.indexOf(flag);
  if (i < 0) return dflt;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}
function argStr(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i < 0 ? undefined : process.argv[i + 1];
}

type Status = "known" | "estimated" | "unknown";
interface Line {
  status: Status;
  text: string;
}

interface Moment {
  roundId: string;
  hash: string;
  bracket: string;
  ownerSpec: string;
  point: Pick<
    DecisionPoint,
    | "tSec"
    | "hpPct"
    | "dmg2s"
    | "attackers2s"
    | "enemyBurst"
    | "inCC"
    | "lockedOut"
    | "responses"
    | "responded"
    | "selfHealPct"
    | "feasible"
    | "dangerous"
    | "diedWithin10s"
  >;
  preAction: Line[];
  options: Line[];
  followUp: Line[];
  comparison: string;
}

function renderMoment(m: Moment, i: number): string {
  const p = m.point;
  const out: string[] = [];
  out.push(
    `## ${i + 1}. round ${m.roundId} · ${m.bracket} · ${m.ownerSpec} · crossing at ${fmtTime(p.tSec)}`,
  );
  out.push(
    `Trigger [known]: ${fmtTime(p.tSec)} HP ${p.hpPct}% after ${pct(p.dmg2s)} of max HP in the prior 2 s from ${p.attackers2s} attacker(s); enemy offensive cooldown active in the prior 8 s: ${p.enemyBurst ? "yes" : "no"}; owner CC'd: ${p.inCC ? "yes" : "no"}; locked out: ${p.lockedOut ? "yes" : "no"}.`,
  );
  out.push(`Before the crossing:`);
  for (const l of m.preAction) out.push(`  [${l.status}] ${l.text}`);
  out.push(`Options at the crossing:`);
  for (const l of m.options) out.push(`  [${l.status}] ${l.text}`);
  out.push(`Next ${RESPONSE_S} s (revealed after selection):`);
  for (const l of m.followUp) out.push(`  [${l.status}] ${l.text}`);
  out.push(
    `Product today: responses={selfHeal:${p.responses.selfHeal} wall:${p.responses.wall} external:${p.responses.external} control:${p.responses.control} peel:${p.responses.peel} kite:${p.responses.kite}} → responded=${p.responded} (selfHealPct ${pct(p.selfHealPct)}), feasible=${p.feasible}`,
  );
  out.push(`Comparison: ${m.comparison}`);
  out.push(
    `Outcome (last): died within 10 s = ${p.diedWithin10s ? "yes" : "no"}`,
  );
  return out.join("\n");
}

function momentFor(
  roundId: string,
  legacy: any,
  owner: ICombatUnit,
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
  p: DecisionPoint,
): Moment {
  const startMs: number = legacy.startTime;
  const tMs = startMs + p.tSec * 1000;
  const bracket = bracketKey(legacy.startInfo?.bracket ?? "") ?? "?";
  const friendNames = new Set(friends.map((f) => f.name));
  const enemyNames = new Set(enemies.map((e) => e.name));

  // ── pre-action: auras on the owner at tSec ────────────────────────────────
  const pre: Line[] = [];
  const auras = buildAuraIntervals(owner, legacy).filter(
    (iv) => iv.fromS <= p.tSec && iv.toS >= p.tSec,
  );
  const selfAuras = auras.filter((iv) => iv.srcUnitName === owner.name);
  const mateAuras = auras.filter(
    (iv) => iv.srcUnitName !== owner.name && friendNames.has(iv.srcUnitName),
  );
  const enemyAuras = auras.filter((iv) => enemyNames.has(iv.srcUnitName));
  for (const iv of selfAuras) {
    const name = getEnglishSpellName(iv.spellId, iv.spellName);
    const ago = Math.round(p.tSec - iv.fromS);
    pre.push({
      status: iv.inferredStart ? "estimated" : "known",
      text: `self-applied ${name} active, started ${ago} s before the crossing${iv.inferredStart ? " (start inferred)" : ""}`,
    });
  }
  for (const iv of mateAuras) {
    pre.push({
      status: iv.inferredStart ? "estimated" : "known",
      text: `${getEnglishSpellName(iv.spellId, iv.spellName)} from ${iv.srcUnitName} active, started ${Math.round(p.tSec - iv.fromS)} s before`,
    });
  }
  if (enemyAuras.length)
    pre.push({
      status: "known",
      text: `enemy effects on the owner: ${enemyAuras.map((iv) => getEnglishSpellName(iv.spellId, iv.spellName)).join(", ")}`,
    });
  if (selfAuras.length === 0 && mateAuras.length === 0)
    pre.push({
      status: "known",
      text: "no protective aura active on the owner",
    });

  // ── pre-action: position / LoS to the nearest enemy ────────────────────────
  const zoneId = String(legacy.startInfo?.zoneId ?? legacy.zoneId ?? "");
  const ownPos = getUnitPositionAtTime(owner, tMs);
  if (!ownPos) {
    pre.push({
      status: "unknown",
      text: "owner position at the crossing: no sample within tolerance",
    });
  } else {
    let best: { name: string; d: number; los: boolean | null } | null = null;
    for (const e of enemies) {
      if (!e.info) continue;
      const ep = getUnitPositionAtTime(e, tMs);
      if (!ep) continue;
      const d = Math.hypot(ep.x - ownPos.x, ep.y - ownPos.y);
      if (!best || d < best.d)
        best = {
          name: e.name,
          d,
          los: zoneId ? hasLineOfSight(zoneId, ep, ownPos) : null,
        };
    }
    if (!best)
      pre.push({
        status: "unknown",
        text: "no enemy position sample within tolerance",
      });
    else
      pre.push({
        status: "estimated",
        text: `nearest enemy ${best.name} at ${best.d.toFixed(0)} yd; line of sight ${best.los === null ? "unknown (no geometry)" : best.los ? "open" : "blocked"}`,
      });
  }
  pre.push({
    status: "unknown",
    text: "teammates' intended cover, target choice, communication (not logged)",
  });

  // ── options: major cooldown readiness at tSec ─────────────────────────────
  const options: Line[] = [];
  let cds: ReturnType<typeof extractMajorCooldowns> = [];
  try {
    cds = extractMajorCooldowns(owner, legacy);
  } catch {
    cds = [];
  }
  for (const cd of cds) {
    if (cd.neverUsed) {
      options.push({
        status: "unknown",
        text: `${cd.spellName}: never observed this round — readiness unknown`,
      });
      continue;
    }
    const ready = cdAvailableAt(cd, p.tSec);
    options.push({
      status: "estimated",
      text: `${cd.spellName}: ${ready ? "modelled ready" : "modelled on cooldown"} (±0.5 s rendered-second slack)`,
    });
  }
  if (cds.length === 0)
    options.push({
      status: "unknown",
      text: "no major cooldowns extracted for this owner",
    });

  // ── follow-up: new casts vs ongoing healing ───────────────────────────────
  const follow: Line[] = [];
  const w0 = tMs;
  const w1 = tMs + RESPONSE_S * 1000;
  const newCasts = (owner.spellCastEvents ?? [])
    .filter(
      (c: any) =>
        c.logLine.event === "SPELL_CAST_SUCCESS" &&
        c.logLine.timestamp > w0 &&
        c.logLine.timestamp <= w1,
    )
    .map(
      (c: any) =>
        `${getEnglishSpellName(String(c.spellId), c.spellName ?? "")} @${((c.logLine.timestamp - startMs) / 1000).toFixed(1)}s`,
    );
  follow.push({
    status: "known",
    text: newCasts.length
      ? `new successful casts: ${newCasts.join(", ")}`
      : "no new successful cast recorded",
  });
  const preExisting = new Set(
    selfAuras.filter((iv) => iv.fromS < p.tSec).map((iv) => iv.spellId),
  );
  let periodicFromPre = 0;
  let directNew = 0;
  let periodicOther = 0;
  for (const h of owner.healIn ?? []) {
    const ts = h.logLine?.timestamp ?? (h as any).timestamp;
    if (!(ts > w0 && ts <= w1)) continue;
    if (h.srcUnitId !== owner.id) continue;
    const amt = Math.abs(h.effectiveAmount ?? 0);
    const ev = String(h.logLine?.event ?? "");
    if (ev === "SPELL_PERIODIC_HEAL") {
      if (preExisting.has(String(h.spellId))) periodicFromPre += amt;
      else periodicOther += amt;
    } else directNew += amt;
  }
  const max = (owner as any).maxHp ?? null;
  const asPct = (x: number) =>
    max ? ` (${Math.round((100 * x) / max)} % of max)` : "";
  follow.push({
    status: "known",
    text: `own healing received: ${k(periodicFromPre)} from HoTs that were already running${asPct(periodicFromPre)}; ${k(directNew)} from direct heals${asPct(directNew)}; ${k(periodicOther)} other periodic`,
  });

  // ── permitted comparison ──────────────────────────────────────────────────
  const ref = lookupBehaviorPrior(bracket, "healer", p.dmg2s);
  const comparison = ref
    ? `Among recorded ${bracket} healer crises in this damage band (cell ${ref.cellKey}${ref.fellBack ? ", bracket-wide fallback" : ""}), ${ref.deathNoRespPct}% of players who recorded no qualifying response saw the counted outcome (${ref.outcome}) (n=${ref.nNoResp}) vs ${ref.deathRespPct}% of those who did (n=${ref.nResp}). Those groups include passive healing and distance gains and are not matched on your HoT, kit or line of sight.`
    : `no reference cell for ${bracket}/healer at this damage band — abstain from comparison`;

  return {
    roundId,
    hash: createHash("sha1").update(roundId).digest("hex").slice(0, 12),
    bracket,
    ownerSpec: specToString(owner.spec),
    point: {
      tSec: p.tSec,
      hpPct: p.hpPct,
      dmg2s: p.dmg2s,
      attackers2s: p.attackers2s,
      enemyBurst: p.enemyBurst,
      inCC: p.inCC,
      lockedOut: p.lockedOut,
      responses: p.responses,
      responded: p.responded,
      selfHealPct: p.selfHealPct,
      feasible: p.feasible,
      dangerous: p.dangerous,
      diedWithin10s: p.diedWithin10s,
    },
    preAction: pre,
    options,
    followUp: follow,
    comparison,
  };
}

async function main(): Promise<void> {
  await ensureAnalysisData();
  const limit = argOf("--n", 400);
  const take = argOf("--take", 20);
  const outDir =
    argStr("--out") ??
    join(
      process.env.GLADLOG_EVAL_HOME ??
        join(process.env.HOME ?? "", "code/gladlog-eval-private"),
      "reports/temporal-evidence-2026-09-13",
    );
  const rows = pickRows(loadIndex(DEFAULT_MATCH_DIR), {
    minDurationS: 60,
  }).slice(0, limit);
  // Selection pass: pre-action facts only.
  const candidates: Array<{ roundId: string; hash: string }> = [];
  const cache = new Map<
    string,
    {
      legacy: any;
      owner: ICombatUnit;
      friends: ICombatUnit[];
      enemies: ICombatUnit[];
      p: DecisionPoint;
    }
  >();
  let healerRounds = 0;
  for (const meta of rows) {
    let legacy;
    try {
      ({ legacy } = loadLegacyRound(DEFAULT_MATCH_DIR, meta.id));
    } catch {
      continue;
    }
    const { friends, enemies, owner } = splitTeams(legacy);
    if (!owner || owner.id !== legacy.playerId || !isHealerSpec(owner.spec))
      continue;
    healerRounds++;
    let points: DecisionPoint[];
    try {
      points = crisisDecisionPoints(owner, legacy, "healer");
    } catch {
      continue;
    }
    const first = points
      .filter((p) => p.dangerous && !p.inCC && !p.lockedOut)
      .sort((a, b) => a.tSec - b.tSec)[0];
    if (!first) continue;
    const hash = createHash("sha1").update(meta.id).digest("hex");
    candidates.push({ roundId: meta.id, hash });
    cache.set(meta.id, { legacy, owner, friends, enemies, p: first });
  }
  candidates.sort((a, b) => (a.hash < b.hash ? -1 : 1));
  const frozen = candidates.slice(0, take);
  const moments = frozen.map((c) => {
    const e = cache.get(c.roundId)!;
    return momentFor(c.roundId, e.legacy, e.owner, e.friends, e.enemies, e.p);
  });

  mkdirSync(outDir, { recursive: true });
  const ledger = {
    spec: "docs/superpowers/specs/2026-09-13-temporal-evidence-experiment.md",
    selection: {
      library: DEFAULT_MATCH_DIR,
      rounds: limit,
      healerOwnerRounds: healerRounds,
      eligibleRounds: candidates.length,
      rule: "earliest crossing with dangerous && !inCC && !lockedOut; sha1(roundId) ascending; first N",
      order: candidates.map((c) => ({
        roundId: c.roundId,
        hash: c.hash.slice(0, 12),
      })),
    },
    moments,
  };
  writeFileSync(join(outDir, "ledger.json"), JSON.stringify(ledger, null, 1));
  const text = [
    `# Temporal-evidence experiment — frozen ${moments.length} healer-crisis moments`,
    `library ${limit} rounds → ${healerRounds} healer-owner rounds → ${candidates.length} with an eligible crossing → first ${take} by sha1(roundId)`,
    "",
    ...moments.map((m, i) => renderMoment(m, i) + "\n"),
  ].join("\n");
  writeFileSync(join(outDir, "moments.md"), text);
  console.log(text);
  console.log(`\nledger → ${join(outDir, "ledger.json")}`);
}

if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")
) {
  void main();
}
