/**
 * teammateCrisisCards.ts — GH #95 step 3 (value gate 1, CLAUDE.md): print
 * COMPLETE real-match examples of the three shapes the user named before any
 * product predicate is written.
 *
 * Shapes (user 2026-09-13):
 *  under   — nobody answered: the teammate crossed the crisis line, answered
 *            nothing themselves, and the healer (who could act and was in
 *            range) did nothing either;
 *  double  — the teammate answered AND the healer answered the same crossing;
 *  timing  — the enemy burst had already started before the crossing and the
 *            healer's answer landed only after it ("如果提前开了也许能规避").
 *  idle    — 2026-09-16 refinement of `under`: the healer cast NOTHING at all
 *            in the window (measured death 37–41 % vs 8 % when the healer
 *            answers) — the sharpest accusable subset;
 *  doubleDefensive — the teammate spent a wall / protective AND the healer
 *            spent an external / protective on them; the card carries the
 *            second aura's marginal blocked damage (talent-aware pcts,
 *            multiplicative stacking: D × b / (1 − b)).
 *
 * Every card carries what a coach would need to judge it: the teammate's HP
 * and 2 s damage, who was hitting them, what the teammate pressed, what the
 * healer pressed (and when, relative to the crossing), which externals the
 * healer had OFF COOLDOWN at that second (cooldown ledger, talent-aware), the
 * healer↔teammate distance, and whether the teammate died within 10 s.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/teammateCrisisCards.ts --manifest <m> [--every 50]
 *     [--shape under|double|timing] [--limit 5]
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  actionBlockedAt,
  CRISIS_PROTECTIVE_ANSWER_IDS,
  crisisDecisionPoints,
  ENEMY_BURST_LOOKBACK_MS,
  RESPONSE_PRE_MS,
  RESPONSE_WINDOW_MS,
} from "@gladlog/analysis/src/analysis/crisisDecisionPoints";
import {
  resolveMitigation,
  strongestComponentPct,
} from "@gladlog/analysis/src/data/mitigationComponents";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { buildAuraIntervals } from "@gladlog/analysis/src/utils/auraIntervals";
import spellIdLists from "@gladlog/analysis/src/data/spellIdLists";
import { ccSpellIds, rootSpellIds } from "@gladlog/analysis/src/data/spellTags";
import {
  cdAvailableAt,
  extractMajorCooldowns,
  isHealerSpec,
} from "@gladlog/analysis/src/utils/cooldowns";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { LogEvent, toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync } from "fs";
import { resolve } from "path";
import { gunzipSync } from "zlib";

const a = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = a.indexOf(k);
  return i >= 0 ? (a[i + 1] ?? d) : d;
};
const manifest = arg("--manifest", "");
const every = Number(arg("--every", "50"));
const wantShape = arg("--shape", "");
const limit = Number(arg("--limit", "5"));

const EXTERNAL_IDS = new Set(
  spellIdLists.externalDefensiveSpellIds.map(String),
);
const CONTROL_IDS = new Set<string>([...ccSpellIds, ...rootSpellIds]);
const fmt = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const nameOf = (id: string) => getEnglishSpellName(id, "") || id;

await ensureAnalysisData();
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);

type Card = Record<string, unknown> & { shape: string };
const cards: Card[] = [];

for (const f of files) {
  // stop only when the requested shape (or, without --shape, EVERY shape) is full
  const SHAPES = ["under", "idle", "double", "doubleDefensive", "timing"];
  const full = (shape: string) =>
    cards.filter((c) => c.shape === shape).length >= limit;
  if (wantShape ? full(wantShape) : SHAPES.every(full)) break;
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  let text: string;
  try {
    const raw = readFileSync(resolve(f));
    text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  for (const m of items) {
    let legacy: any;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    const players = (Object.values(legacy.units ?? {}) as any[]).filter(
      (u) => u.info,
    );
    for (const owner of players.filter((u) => isHealerSpec(u.spec))) {
      const enemies = players.filter((u) => u.reaction !== owner.reaction);
      const enemyIds = new Set(enemies.map((u) => u.id));
      const mates = players.filter(
        (u) => u.reaction === owner.reaction && u.id !== owner.id,
      );
      let ledger: any[] = [];
      try {
        ledger = extractMajorCooldowns(owner, legacy);
      } catch {
        ledger = [];
      }
      const ownerCasts = ((owner.spellCastEvents ?? []) as any[]).filter(
        (c) => c.logLine?.event === LogEvent.SPELL_CAST_SUCCESS,
      );
      const posOf = (u: any, ms: number) => {
        let best: any = null;
        for (const s of u.advancedActions ?? []) {
          if ((s.advancedActorMaxHp ?? 0) <= 0) continue;
          const d = Math.abs(s.timestamp - ms);
          if (d <= 1500 && (!best || d < Math.abs(best.timestamp - ms)))
            best = s;
        }
        return best?.advancedActorPositionX == null
          ? null
          : { x: best.advancedActorPositionX, y: best.advancedActorPositionY };
      };
      for (const mate of mates) {
        const mateMax = Math.max(
          1,
          ...((mate.advancedActions ?? []) as any[]).map(
            (x) => x.advancedActorMaxHp ?? 0,
          ),
        );
        const role = isHealerSpec(mate.spec) ? "healer" : "dps";
        for (const p of crisisDecisionPoints(mate, legacy, role as never)) {
          if (!(p.feasible && p.dangerous)) continue;
          if (actionBlockedAt(owner, legacy, p.tMs).blocked) continue;
          const pos1 = posOf(owner, p.tMs);
          const pos2 = posOf(mate, p.tMs);
          const dist =
            pos1 && pos2 ? Math.hypot(pos1.x - pos2.x, pos1.y - pos2.y) : null;
          if (dist === null || dist > 40) continue;

          const w0 = p.tMs - RESPONSE_PRE_MS;
          const w1 = p.tMs + RESPONSE_WINDOW_MS;
          const attackers = new Map<string, number>();
          for (const d of (mate.damageIn ?? []) as any[]) {
            if (d.timestamp <= p.tMs - 2000 || d.timestamp > p.tMs) continue;
            const src = legacy.units[d.srcUnitId];
            const id = src?.info ? src.id : src?.ownerId;
            if (!id || !enemyIds.has(id)) continue;
            attackers.set(
              id,
              (attackers.get(id) ?? 0) +
                Math.abs(d.effectiveAmount ?? d.amount ?? 0),
            );
          }
          // the healer's answer toward this teammate, with its latency
          const healerActs: string[] = [];
          for (const c of ownerCasts) {
            if (c.timestamp < w0 || c.timestamp > w1) continue;
            const id = String(c.spellId ?? "");
            const onMate = c.destUnitId === mate.id;
            const lat = ((c.timestamp - p.tMs) / 1000).toFixed(1);
            if (onMate && EXTERNAL_IDS.has(id))
              healerActs.push(`${nameOf(id)} @${lat}s (external)`);
            else if (onMate && CRISIS_PROTECTIVE_ANSWER_IDS.has(id))
              healerActs.push(`${nameOf(id)} @${lat}s (protective)`);
            else if (
              CONTROL_IDS.has(id) &&
              c.destUnitId &&
              attackers.has(c.destUnitId)
            )
              healerActs.push(
                `${nameOf(id)} @${lat}s → ${legacy.units[c.destUnitId]?.name}`,
              );
          }
          // GH #93 rule: only heals from spells cast inside the window are the
          // healer answering; ticks of an earlier HoT are shown separately
          const castIdsInWin = new Set(
            ownerCasts
              .filter((c) => c.timestamp >= w0 && c.timestamp <= w1)
              .map((c) => String(c.spellId ?? "")),
          );
          const healEvents = ((mate.healIn ?? []) as any[]).filter(
            (h) =>
              h.srcUnitId === owner.id && h.timestamp > w0 && h.timestamp <= w1,
          );
          const sum = (xs: any[]) =>
            xs.reduce(
              (n, h) => n + Math.abs(h.effectiveAmount ?? h.amount ?? 0),
              0,
            ) / mateMax;
          const freshHeals = healEvents.filter((h) =>
            castIdsInWin.has(String(h.spellId ?? "")),
          );
          const carried = healEvents.filter(
            (h) => !castIdsInWin.has(String(h.spellId ?? "")),
          );
          const healed = sum(freshHeals);
          if (freshHeals.length)
            healerActs.push(
              `heals ${Math.round(healed * 100)}% max HP (${[
                ...new Set(freshHeals.map((h) => nameOf(String(h.spellId)))),
              ].join(", ")})`,
            );
          const carriedPct = Math.round(sum(carried) * 100);
          const healerAnswered = healerActs.length > 0;

          // the teammate's own answer, from the shipped taxonomy
          const mateActs = Object.entries(p.responses)
            .filter(([k, v]) => v && k !== "peel")
            .map(([k]) => k);

          // what the healer had OFF COOLDOWN at that second
          const readyExternals = ledger
            .filter(
              (cd: any) =>
                EXTERNAL_IDS.has(String(cd.spellId)) &&
                cdAvailableAt(cd, p.tSec),
            )
            .map((cd: any) => nameOf(String(cd.spellId)));

          const healerIdle = !ownerCasts.some(
            (c) => c.timestamp >= w0 && c.timestamp <= w1,
          );
          const mateSpentDefensive =
            p.responses.wall || p.responses.protective || p.responses.external;
          const healerSpentDefensive = healerActs.some(
            (x) => x.includes("(external)") || x.includes("(protective)"),
          );
          let marginal: Record<string, unknown> | null = null;
          if (mateSpentDefensive && healerSpentDefensive) {
            const ivs = buildAuraIntervals(mate, legacy).filter(
              (iv) =>
                iv.toS * 1000 + legacy.startTime >= w0 &&
                iv.fromS * 1000 + legacy.startTime <= w1 &&
                (iv.srcUnitName === mate.name || iv.srcUnitName === owner.name),
            );
            const priced = ivs
              .map((iv) => {
                const fromSelf = iv.srcUnitName === mate.name;
                const res = resolveMitigation(iv.spellId, {
                  carrierIsCaster: fromSelf,
                  caster: fromSelf ? mate : owner,
                });
                const pct = res
                  ? strongestComponentPct(res, { includeImmunity: true })
                  : undefined;
                return res && !res.positional && pct
                  ? { iv, pct: pct.pctMin, fromSelf }
                  : null;
              })
              .filter((x): x is NonNullable<typeof x> => x !== null);
            const own = priced.find((x) => x.fromSelf);
            const ext = priced.find((x) => !x.fromSelf);
            if (own && ext && own.pct < 100 && ext.pct < 100) {
              const second = own.iv.fromS <= ext.iv.fromS ? ext : own;
              const first = second === own ? ext : own;
              const oFrom = Math.max(own.iv.fromS, ext.iv.fromS);
              const oTo = Math.min(own.iv.toS, ext.iv.toS);
              const dmg = ((mate.damageIn ?? []) as any[])
                .filter((d) => {
                  const ts = (d.timestamp - legacy.startTime) / 1000;
                  return ts >= oFrom && ts <= oTo;
                })
                .reduce(
                  (n, d) => n + Math.abs(d.effectiveAmount ?? d.amount ?? 0),
                  0,
                );
              const b = second.pct / 100;
              marginal = {
                first: `${nameOf(first.iv.spellId)} ${first.pct}% by ${first.fromSelf ? "teammate" : "healer"} @${fmt(first.iv.fromS)}`,
                second: `${nameOf(second.iv.spellId)} ${second.pct}% by ${second.fromSelf ? "teammate" : "healer"} @${fmt(second.iv.fromS)}`,
                overlapS: Math.round((oTo - oFrom) * 10) / 10,
                damageTakenDuringOverlapPctMaxHp: Math.round(
                  (dmg / mateMax) * 100,
                ),
                secondAuraExtraBlockedPctMaxHp:
                  Math.round(((dmg * b) / (1 - b) / mateMax) * 1000) / 10,
              };
            }
          }
          const shape =
            mateSpentDefensive && healerSpentDefensive
              ? "doubleDefensive"
              : !healerAnswered && !p.responded && healerIdle
                ? "idle"
                : !healerAnswered && !p.responded
                  ? "under"
                  : healerAnswered && p.responded
                    ? "double"
                    : healerAnswered && p.enemyBurst
                      ? "timing"
                      : "other";
          if (shape === "other") continue;
          if (wantShape && shape !== wantShape) continue;
          if (cards.filter((c) => c.shape === shape).length >= limit) continue;
          cards.push({
            shape,
            file: f.split("/").slice(-1)[0],
            bracket: String(legacy.startInfo?.bracket ?? "?"),
            at: fmt(p.tSec),
            healer: `${owner.name} (${owner.spec})`,
            teammate: `${mate.name} (${mate.spec})`,
            teammateHpPct: p.hpPct,
            damage2sPct: Math.round(p.dmg2s * 100),
            attackers: [...attackers]
              .sort((x, y) => y[1] - x[1])
              .map(
                ([id, dmg]) =>
                  `${legacy.units[id]?.name} ${Math.round(dmg / 1000)}k`,
              ),
            enemyBurstBefore: p.enemyBurst,
            teammateDidThemselves: mateActs.length ? mateActs : ["nothing"],
            healerDid: healerActs.length ? healerActs : ["nothing"],
            healerHadReady: readyExternals.length ? readyExternals : ["none"],
            carriedHotPct: carriedPct,
            ...(marginal ? { marginal } : {}),
            healerCastingElsewhere: ownerCasts
              .filter(
                (c) =>
                  c.timestamp >= w0 &&
                  c.timestamp <= w1 &&
                  c.destUnitId !== mate.id,
              )
              .map(
                (c) =>
                  `${nameOf(String(c.spellId))} @${(
                    (c.timestamp - p.tMs) /
                    1000
                  ).toFixed(1)}s${
                    c.destUnitId
                      ? ` → ${legacy.units[c.destUnitId]?.name ?? "?"}`
                      : ""
                  }`,
              )
              .slice(0, 6),
            distanceYd: Math.round(dist),
            teammateDiedWithin10s: p.diedWithin10s,
          });
        }
      }
    }
  }
}
for (const c of cards) console.log(JSON.stringify(c, null, 1));
console.log(
  `\n${cards.length} cards (enemy-burst lookback ${ENEMY_BURST_LOOKBACK_MS / 1000}s)`,
);
