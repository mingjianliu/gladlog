/**
 * Ten fact-checking queries over a single `LegacyRound`, plus the single
 * shared dispatch (`runQuery`) both the prescreen (a later task) and the
 * exploration CLI call. Per CLAUDE.md's shared-predicate rule and the plan's
 * global constraint, this file writes zero sampling logic of its own — every
 * fact below is read off an existing `@gladlog/analysis` export, and every
 * instant is floored to the prompt's render grid (`toRenderSecond`) BEFORE
 * that export is called, so a query's answer always matches what the same
 * instant would render as in a prompt.
 *
 * `mana`/`drink` (BACKLOG #26 Task 5) are the two exceptions to "no I/O":
 * they need raw.txt's parsed streams (`RawStreams`, Task 1), which this
 * module cannot read itself (`runQuery` stays pure — no `fs` import here)
 * — the caller loads it via `storeAccess.ts`'s `readRawText` +
 * `parseRawStreams` and passes it in as `runQuery`'s optional third
 * argument. `baseMs` for that parse must be `legacy.startTime` — the SAME
 * base every `tSeconds`/`atSeconds` fact in this file already uses
 * (`hpLineFor`'s `matchStartMs`, `posLines`' `tMs`), matching
 * `rawStreamsCache.ts`'s desktop-side convention
 * (`toLegacySafe(source).startTime`). Getting this wrong makes every
 * `mana`/`drink` window silently miss — verified against real match
 * `60ab1e8f`: its healer's terminal mana (545/273000) and Holy Shock
 * rejection burst land exactly where the death timestamp says they should
 * only when `baseMs = legacy.startTime`.
 *
 * `runQuery` is otherwise pure (no `process.exit`) — it only parses `argv`,
 * floors times, and calls the per-query line-builders below.
 */
import {
  analyzeOutgoingCCChains,
  castFailedInWindow,
  cdAvailableAt,
  cdIsProcOnly,
  cdMaybeAvailableAt,
  cdSecondsUntilReady,
  detectHealingGaps,
  distanceBetween,
  drinkingSegments,
  extractMajorCooldowns,
  selfCastNoopAnnotatedName,
  fmtTime,
  formatHealingGapsForContext,
  getHpPercentAtTime,
  getUnitPositionAtTime,
  type IMajorCooldownInfo,
  INTERP_MAX_GAP_MS,
  type IOutgoingCCApplication,
  isHealerSpec,
  LOS_SWEEP_GAP_MS,
  MANA_PRESSURE_LOW_PCT,
  manaAt,
  oomWindows,
  type RawStreams,
  specToString,
  toRenderSecond,
} from "@gladlog/analysis";
import {
  aurasActiveAt,
  buildCastFlowLines,
} from "@gladlog/analysis/src/analysis/momentSnapshot";
import {
  getUnitRawPositionAtTime,
  hasLineOfSight,
} from "@gladlog/analysis/src/utils/losAnalysis";
import type { ICombatUnit } from "@gladlog/parser-compat";

import { type LegacyRound, overviewLines, splitTeams } from "./storeAccess";

const NO_DATA = "(无数据)";

/** All player units (friends + enemies), same population every query below
 * iterates — `splitTeams` is the single source for "who counts as a player"
 * (see its own header comment). */
function allPlayers(legacy: LegacyRound): ICombatUnit[] {
  const { friends, enemies } = splitTeams(legacy);
  return [...friends, ...enemies];
}

// ---------------------------------------------------------------------------
// cd
// ---------------------------------------------------------------------------

/** "还剩 Ns" through the shared `cdSecondsUntilReady` (GH #106 step 3 —
 * this used to hand-copy cdAvailableAt's last-cast lookup); a cooldown combat
 * shortens reads as a range, or "可能已好" once its fastest recast is past. */
function remainingNote(cd: IMajorCooldownInfo, tt: number): string {
  const latest = Math.max(0, Math.round(cdSecondsUntilReady(cd, tt)));
  if (cdMaybeAvailableAt(cd, tt)) return `可能已好,最多还剩 ${latest}s`;
  if (cd.earliestCooldownSeconds !== undefined) {
    const soonest = Math.max(
      0,
      Math.round(cdSecondsUntilReady(cd, tt, cd.earliestCooldownSeconds)),
    );
    if (soonest < latest) return `还剩 ${soonest}–${latest}s`;
  }
  return `还剩 ${latest}s`;
}

export function cdLines(legacy: LegacyRound, t: number): string[] {
  const tt = toRenderSecond(t);
  const lines = [`## cd @ ${fmtTime(tt)}`];
  const players = allPlayers(legacy);
  if (players.length === 0) {
    lines.push(NO_DATA);
    return lines;
  }
  for (const u of players) {
    // no button → neither "ready" nor "on cooldown" (GH #106 step 2)
    const cds = extractMajorCooldowns(u, legacy).filter(
      (cd) => !cdIsProcOnly(cd),
    );
    const ready = cds.filter((cd) => cdAvailableAt(cd, tt));
    const onCd = cds.filter((cd) => !cdAvailableAt(cd, tt));
    // #25-1: ledger surfaces render damage-redirect externals through the
    // shared guard-annotation helper (never a bare "ready: Blessing of
    // Sacrifice" on a dying player's own row) — same predicate as
    // momentSnapshot's cd-ledger.
    const readyStr = ready.length
      ? ready.map((cd) => selfCastNoopAnnotatedName(cd)).join(",")
      : "无";
    const onCdStr = onCd.length
      ? onCd
          .map(
            (cd) =>
              `${selfCastNoopAnnotatedName(cd)}(${remainingNote(cd, tt)})`,
          )
          .join(",")
      : "无";
    lines.push(
      `${fmtTime(tt)} ${u.name} ready: ${readyStr} | onCd: ${onCdStr}`,
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------
// hp / hpcurve
// ---------------------------------------------------------------------------

function hpLineFor(u: ICombatUnit, tt: number, matchStartMs: number): string {
  const pct = getHpPercentAtTime(u, tt, matchStartMs);
  const pctStr = pct === null ? "无样本" : `${pct.toFixed(0)}%`;
  return `${fmtTime(tt)} ${u.name} HP: ${pctStr}`;
}

export function hpLines(legacy: LegacyRound, t: number): string[] {
  const tt = toRenderSecond(t);
  const lines = [`## hp @ ${fmtTime(tt)}`];
  const players = allPlayers(legacy);
  if (players.length === 0) {
    lines.push(NO_DATA);
    return lines;
  }
  for (const u of players) lines.push(hpLineFor(u, tt, legacy.startTime));
  return lines;
}

export function hpCurveLines(
  legacy: LegacyRound,
  fromS: number,
  toS: number,
  stepS: number,
): string[] {
  const fromTT = toRenderSecond(fromS);
  const toTT = toRenderSecond(toS);
  const stepTT = Math.max(1, toRenderSecond(stepS));
  const lines = [`## hpcurve @ ${fmtTime(fromTT)}-${fmtTime(toTT)}`];
  const players = allPlayers(legacy);
  if (players.length === 0 || toTT < fromTT) {
    lines.push(NO_DATA);
    return lines;
  }
  for (let tt = fromTT; tt <= toTT; tt += stepTT) {
    for (const u of players) lines.push(hpLineFor(u, tt, legacy.startTime));
  }
  return lines;
}

// ---------------------------------------------------------------------------
// auras
// ---------------------------------------------------------------------------

export function auraLines(legacy: LegacyRound, t: number): string[] {
  const tt = toRenderSecond(t);
  const lines = [`## auras @ ${fmtTime(tt)}`];
  const players = allPlayers(legacy);
  if (players.length === 0) {
    lines.push(NO_DATA);
    return lines;
  }
  for (const u of players) {
    const auras = aurasActiveAt(u, legacy, tt);
    lines.push(
      `${fmtTime(tt)} ${u.name} auras: ${auras.length ? auras.join("、") : "无"}`,
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------
// pos
// ---------------------------------------------------------------------------

export function posLines(legacy: LegacyRound, t: number): string[] {
  const tt = toRenderSecond(t);
  const tMs = legacy.startTime + tt * 1000;
  const lines = [`## pos @ ${fmtTime(tt)}`];
  const { owner } = splitTeams(legacy);
  const others = allPlayers(legacy).filter((u) => u !== owner);

  const ownerPos = owner
    ? getUnitPositionAtTime(owner, tMs, INTERP_MAX_GAP_MS)
    : null;
  const ownerRaw = owner
    ? getUnitRawPositionAtTime(owner, tMs, LOS_SWEEP_GAP_MS)
    : null;
  const zoneId = legacy.startInfo?.zoneId;

  let any = false;
  if (owner && ownerPos) {
    for (const u of others) {
      const pos = getUnitPositionAtTime(u, tMs, INTERP_MAX_GAP_MS);
      if (!pos) continue;
      const dist = distanceBetween(ownerPos, pos).toFixed(1);

      let losStr = "未知";
      if (ownerRaw && zoneId) {
        const otherRaw = getUnitRawPositionAtTime(u, tMs, LOS_SWEEP_GAP_MS);
        if (otherRaw) {
          const los = hasLineOfSight(zoneId, ownerRaw, otherRaw);
          // null → "未知", never treated as false (per shared-predicate rule).
          losStr = los === null ? "未知" : los ? "通" : "挡";
        }
      }
      lines.push(`${fmtTime(tt)} ${u.name} dist ${dist}yd | LoS ${losStr}`);
      any = true;
    }
  }
  if (!any) lines.push(NO_DATA);
  return lines;
}

// ---------------------------------------------------------------------------
// dr
// ---------------------------------------------------------------------------

export function drLines(
  legacy: LegacyRound,
  fromS: number,
  toS: number,
): string[] {
  const fromTT = toRenderSecond(fromS);
  const toTT = toRenderSecond(toS);
  const lines = [`## dr @ ${fmtTime(fromTT)}-${fmtTime(toTT)}`];
  const { friends, enemies } = splitTeams(legacy);

  interface Row {
    atTT: number;
    casterName: string;
    casterSpec: string;
    targetName: string;
    targetSpec: string;
    app: IOutgoingCCApplication;
  }
  const rows: Row[] = [];

  const collect = (
    chains: ReturnType<typeof analyzeOutgoingCCChains>,
  ): void => {
    for (const chain of chains) {
      for (const app of chain.applications) {
        const atTT = toRenderSecond(app.atSeconds);
        if (atTT < fromTT || atTT > toTT) continue;
        rows.push({
          atTT,
          casterName: app.casterName,
          casterSpec: app.casterSpec,
          targetName: chain.targetName,
          targetSpec: chain.targetSpec,
          app,
        });
      }
    }
  };

  // Both directions: friends' CC landing on enemies, and enemies' CC landing
  // on friends — "双向 CC 链" per the brief.
  collect(analyzeOutgoingCCChains(friends, enemies, legacy));
  collect(analyzeOutgoingCCChains(enemies, friends, legacy));

  rows.sort((a, b) => a.atTT - b.atTT);
  if (rows.length === 0) {
    lines.push(NO_DATA);
    return lines;
  }
  for (const r of rows) {
    lines.push(
      `${fmtTime(r.atTT)} ${r.casterName}(${r.casterSpec}) → ${r.targetName}(${r.targetSpec}) ${r.app.spellName} DR:${r.app.drInfo.level} 时长${r.app.durationSeconds.toFixed(1)}s`,
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------
// flow
// ---------------------------------------------------------------------------

export function flowLines(
  legacy: LegacyRound,
  fromS: number,
  toS: number,
): string[] {
  const fromTT = toRenderSecond(fromS);
  const toTT = toRenderSecond(toS);
  const lines = [`## flow @ ${fmtTime(fromTT)}-${fmtTime(toTT)}`];
  const flow = buildCastFlowLines(legacy, fromTT, toTT);
  lines.push(...(flow.length ? flow : [NO_DATA]));
  return lines;
}

// ---------------------------------------------------------------------------
// gaps
// ---------------------------------------------------------------------------

export function gapLines(legacy: LegacyRound): string[] {
  const lines = ["## gaps"];
  const { friends, enemies } = splitTeams(legacy);
  const healers = friends.filter((u) => isHealerSpec(u.spec));
  if (healers.length === 0) {
    lines.push(NO_DATA);
    return lines;
  }
  let any = false;
  for (const healer of healers) {
    const gaps = detectHealingGaps(healer, friends, enemies, legacy);
    if (gaps.length === 0) continue;
    any = true;
    lines.push(`-- ${healer.name}(${specToString(healer.spec)}) --`);
    lines.push(...formatHealingGapsForContext(gaps));
  }
  if (!any) lines.push(NO_DATA);
  return lines;
}

// ---------------------------------------------------------------------------
// mana / drink (BACKLOG #26 Task 5) — the two rawStreams deep-dive queries
// ---------------------------------------------------------------------------

const NO_RAW = "(无数据:raw.txt 不可用)";

/** `--unit`'s name resolution: an exact `name` match wins outright; failing
 * that, a case-insensitive substring match is accepted ONLY if it narrows to
 * exactly one unit. Zero or ambiguous (>1) substring matches both throw so a
 * typo picks nothing rather than silently the wrong unit; the error lists
 * every candidate name so the caller can fix the flag without a second
 * round-trip. This exact-then-single-substring-else-throw shape is specific
 * to this CLI flag — it is not a mirror of any existing filter convention
 * elsewhere in the codebase (e.g. desktop's `eventsView.ts` `spellQuery` is a
 * plain substring filter that returns every match for a UI multi-select and
 * never throws; that's a genuinely different job — filtering a list to show,
 * versus resolving a flag to exactly one unit). */
function resolveUnitByName(players: ICombatUnit[], query: string): ICombatUnit {
  const exact = players.find((u) => u.name === query);
  if (exact) return exact;
  const q = query.toLowerCase();
  const matches = players.filter((u) => u.name.toLowerCase().includes(q));
  if (matches.length === 1) return matches[0]!;
  const names = players.map((u) => u.name).join(", ");
  if (matches.length > 1) {
    throw new Error(
      `--unit "${query}" 匹配到多个单位:${matches.map((u) => u.name).join(", ")}`,
    );
  }
  throw new Error(`--unit "${query}" 未匹配到任何单位(候选:${names})`);
}

/**
 * Decimates a time-ordered mana-sample run down to its turning points (local
 * peaks/troughs) plus the first and last sample — every monotonic run
 * between two direction reversals collapses to just its two endpoints, so a
 * long steady drain or a full drink-up prints as two points, not one line
 * per `SPELL_CAST_SUCCESS`. A flat step (two equal consecutive readings)
 * never counts as a reversal on its own — it just continues whatever trend
 * was already running.
 */
function manaKeyPoints(samples: RawStreams["manaSamples"]): typeof samples {
  if (samples.length === 0) return [];
  const points: typeof samples = [samples[0]!];
  let trend = 0; // sign of the most recent nonzero step
  for (let i = 1; i < samples.length; i++) {
    const diff = samples[i]!.mana - samples[i - 1]!.mana;
    const step = diff > 0 ? 1 : diff < 0 ? -1 : 0;
    if (step !== 0 && trend !== 0 && step !== trend) {
      points.push(samples[i - 1]!); // trend reversed AT the previous sample
    }
    if (step !== 0) trend = step;
  }
  const last = samples[samples.length - 1]!;
  if (points[points.length - 1] !== last) points.push(last);
  return points;
}

/**
 * `mana --unit X [--from A --to B]`: one unit's mana trajectory over
 * `rawStreams` — decimated key points (`manaKeyPoints`, peaks/troughs +
 * endpoints, never every raw sample), OOM windows at the SAME threshold
 * `mana-pressure` (Task 3) gates on (`MANA_PRESSURE_LOW_PCT`, imported not
 * redeclared — shared-predicate rule), and rejected-cast intent events
 * (`castFailedInWindow`, Task 1/2's predicate) inside the window. `--from`/
 * `--to` default to the whole round. `rawStreams` unavailable (no raw.txt,
 * or the caller never loaded one) degrades to a `NO_RAW` line, same
 * graceful-degradation contract as every other rawStreams consumer — never
 * throws on missing raw data (an unresolvable `--unit`, by contrast, IS a
 * usage error and throws, same as every other subcommand's bad input).
 */
export function manaLines(
  legacy: LegacyRound,
  rawStreams: RawStreams | undefined,
  unitQuery: string,
  fromS: number | undefined,
  toS: number | undefined,
): string[] {
  const fromTT = toRenderSecond(fromS ?? 0);
  const toTT = toRenderSecond(
    toS ?? (legacy.endTime - legacy.startTime) / 1000,
  );
  const unit = resolveUnitByName(allPlayers(legacy), unitQuery);
  const lines = [`## mana @ ${unit.name} ${fmtTime(fromTT)}-${fmtTime(toTT)}`];

  if (!rawStreams || !rawStreams.available) {
    lines.push(NO_RAW);
    return lines;
  }

  // `manaAt`'s contract is strictly at-or-before `toTT` (the literal render
  // instant, not "anything that floors into the same second") — a raw
  // sample timestamped e.g. 20.3s is EXCLUDED from `manaAt(..., 20)` even
  // though `toRenderSecond(20.3) === 20`, because at the instant "0:20"
  // itself that sample hadn't happened yet. This can make the terminal
  // headline read slightly earlier than the LAST key point printed below
  // (which uses the floor-inclusive `inWindow` filter) when a sample lands
  // in the same render second but after `toTT`'s literal boundary — this is
  // correct render-grid behavior (CLAUDE.md), not a bug: "@toTT" means "as
  // of that instant", and a same-second-but-later sample is future info
  // relative to it.
  const terminal = manaAt(rawStreams, unit.id, toTT);
  lines.push(
    terminal
      ? `终局蓝量(@${fmtTime(toTT)}): ${terminal.mana}/${terminal.manaMax}`
      : `终局蓝量(@${fmtTime(toTT)}): 无样本`,
  );

  const inWindow = rawStreams.manaSamples.filter((s) => {
    if (s.unitGuid !== unit.id) return false;
    const tt = toRenderSecond(s.tSeconds);
    return tt >= fromTT && tt <= toTT;
  });
  const keyPoints = manaKeyPoints(inWindow);
  lines.push(
    `-- 蓝量关键点(${inWindow.length} 采样点 → ${keyPoints.length} 个转折/首尾点,峰谷抽样,不逐样本)--`,
  );
  if (keyPoints.length === 0) {
    lines.push(NO_DATA);
  } else {
    for (const p of keyPoints) {
      lines.push(
        `${fmtTime(toRenderSecond(p.tSeconds))} ${unit.name} mana ${p.mana}/${p.manaMax}`,
      );
    }
  }

  const windows = oomWindows(rawStreams, unit.id, MANA_PRESSURE_LOW_PCT)
    .map((w) => ({
      fromTT: toRenderSecond(w.fromS),
      toTT: toRenderSecond(w.toS),
      minMana: w.minMana,
    }))
    .filter((w) => w.toTT >= fromTT && w.fromTT <= toTT);
  lines.push(`-- OOM 窗(蓝量占比 <${MANA_PRESSURE_LOW_PCT}%)--`);
  if (windows.length === 0) {
    lines.push(NO_DATA);
  } else {
    for (const w of windows) {
      lines.push(
        `${fmtTime(w.fromTT)}-${fmtTime(w.toTT)} 窗内最低蓝 ${w.minMana}`,
      );
    }
  }

  const rejected = castFailedInWindow(rawStreams, unit.id, fromTT, toTT);
  lines.push(`-- 被拒施法(${rejected.length})--`);
  if (rejected.length === 0) {
    lines.push(NO_DATA);
  } else {
    for (const r of rejected) {
      lines.push(
        `${fmtTime(toRenderSecond(r.tSeconds))} ${r.spellName} 拒因:${r.reason}`,
      );
    }
  }

  return lines;
}

/** Was `unit` hit by damage inside `[fromTT, toTT]` render-grid seconds, OR
 * within 1s after `toTT` ("segment or ≤1s after its end" per the task
 * brief — a drink cut short by an interrupt often logs its damage a beat
 * after the last still-rising mana sample was recorded)? Reuses
 * `unit.damageIn` — already parsed onto the legacy round by the existing
 * pipeline, nothing re-derived here — the same field every other
 * damage-window predicate in this codebase reads (`cooldowns.ts`'s
 * Reactive/Unnecessary checks, `healingGaps.ts`, …). */
function interruptedByDamage(
  unit: ICombatUnit,
  legacy: LegacyRound,
  fromTT: number,
  toTT: number,
): boolean {
  const fromMs = legacy.startTime + fromTT * 1000;
  const toMs = legacy.startTime + (toTT + 1) * 1000;
  return unit.damageIn.some(
    (d) => d.timestamp >= fromMs && d.timestamp <= toMs,
  );
}

/**
 * `drink`: both sides' healers' drinking segments (`drinkingSegments`, Task
 * 1's predicate) — start/end (render-grid formatted, like every other
 * subcommand), mana gained, and whether a damage event landed on that healer
 * during the segment or the 1s grace period after it (`interruptedByDamage`
 * above). Optional time-range flags stay absent (the plan's brief pins this
 * subcommand's signature to `drink [--round N]` — `--round` is handled by
 * the CLI shell, not this dispatch); `--min-gain N` is the one addition
 * (review fix round 1, 2026-08-15).
 *
 * Curation (review Important #1): `drinkingSegments` intentionally catches
 * ANY contiguous mana-rise run, not only literal sit-and-drink usage — on a
 * real match a healer can have 25-100+ rows, the overwhelming majority
 * ordinary in-combat regen ticks (3-4 digit `manaGained`) burying the rare
 * genuine drink (5-digit `manaGained`, an order of magnitude larger). Two
 * changes, chosen deliberately over a `--min-gain` DEFAULT filter:
 *   1. Each healer's segment list is ALWAYS sorted by `manaGained`
 *      descending — unconditional, no flag needed — so the real drinks are
 *      the first rows printed under that healer's header regardless of
 *      whether the caller ever passes `--min-gain`.
 *   2. `--min-gain N` (default 0 = no filtering) lets a caller who already
 *      knows they only want the big hits narrow the list explicitly.
 * Default 0 rather than a nonzero cutoff baked into the tool: this is
 * exploration tooling, not a product feature with a calibrated threshold
 * (unlike `MANA_PRESSURE_LOW_PCT`) — picking an opinionated nonzero default
 * would silently hide real (if small) drinks from a caller who didn't know
 * to override it, whereas sorting is lossless and a caller who wants
 * filtering asks for it explicitly.
 */
export function drinkLines(
  legacy: LegacyRound,
  rawStreams: RawStreams | undefined,
  minGain = 0,
): string[] {
  const lines = ["## drink"];
  if (!rawStreams || !rawStreams.available) {
    lines.push(NO_RAW);
    return lines;
  }

  const { friends, enemies } = splitTeams(legacy);
  const sides: Array<{ label: string; healers: ICombatUnit[] }> = [
    { label: "友方", healers: friends.filter((u) => isHealerSpec(u.spec)) },
    { label: "敌方", healers: enemies.filter((u) => isHealerSpec(u.spec)) },
  ];

  let any = false;
  for (const side of sides) {
    for (const healer of side.healers) {
      const segments = drinkingSegments(rawStreams, healer.id)
        .filter((seg) => seg.manaGained >= minGain)
        .sort((a, b) => b.manaGained - a.manaGained);
      if (segments.length === 0) continue;
      any = true;
      lines.push(`-- ${healer.name}(${side.label}) --`);
      for (const seg of segments) {
        const fromTT = toRenderSecond(seg.fromS);
        const toTT = toRenderSecond(seg.toS);
        const interrupted = interruptedByDamage(healer, legacy, fromTT, toTT);
        lines.push(
          `${fmtTime(fromTT)}-${fmtTime(toTT)} 回蓝 ${seg.manaGained} 被伤害打断:${interrupted ? "是" : "否"}`,
        );
      }
    }
  }
  if (!any) lines.push(NO_DATA);
  return lines;
}

// ---------------------------------------------------------------------------
// runQuery — the shared dispatch
// ---------------------------------------------------------------------------

const USAGE =
  "usage: overview|cd --t S|hp --t S|hpcurve --from S --to S --step S|auras --t S|pos --t S|dr --from S --to S|flow --from S --to S|gaps|mana --unit X [--from S --to S]|drink [--min-gain N]";

function flagNum(argv: string[], name: string): number | undefined {
  const idx = argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  const raw = argv[idx + 1];
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function flagStr(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return argv[idx + 1];
}

/**
 * The single shared dispatch for the ten queries above (plus `overview`).
 * Both the prescreen and the exploration CLI must call this — not the
 * individual `*Lines` functions directly — so the two never drift on how a
 * subcommand's flags are parsed or validated. Pure: no I/O of its own, never
 * exits the process; illegal input always throws `Error("usage: …")`.
 * `rawStreams` is optional and only consulted by `mana`/`drink` — every
 * caller that never touches those two subcommands (all of `buildSession.ts`'s
 * existing evidence lines, today) can go on passing two arguments exactly as
 * before.
 */
export function runQuery(
  legacy: LegacyRound,
  argv: string[],
  rawStreams?: RawStreams,
): string[] {
  const [cmd, ...rest] = argv;
  const t = flagNum(rest, "t");
  const fromS = flagNum(rest, "from");
  const toS = flagNum(rest, "to");
  const stepS = flagNum(rest, "step");
  const unit = flagStr(rest, "unit");
  const minGain = flagNum(rest, "min-gain");

  switch (cmd) {
    case "overview":
      return overviewLines(legacy);
    case "cd":
      if (t === undefined) throw new Error(USAGE);
      return cdLines(legacy, t);
    case "hp":
      if (t === undefined) throw new Error(USAGE);
      return hpLines(legacy, t);
    case "hpcurve":
      if (fromS === undefined || toS === undefined || stepS === undefined)
        throw new Error(USAGE);
      return hpCurveLines(legacy, fromS, toS, stepS);
    case "auras":
      if (t === undefined) throw new Error(USAGE);
      return auraLines(legacy, t);
    case "pos":
      if (t === undefined) throw new Error(USAGE);
      return posLines(legacy, t);
    case "dr":
      if (fromS === undefined || toS === undefined) throw new Error(USAGE);
      return drLines(legacy, fromS, toS);
    case "flow":
      if (fromS === undefined || toS === undefined) throw new Error(USAGE);
      return flowLines(legacy, fromS, toS);
    case "gaps":
      return gapLines(legacy);
    case "mana":
      if (!unit) throw new Error(USAGE);
      return manaLines(legacy, rawStreams, unit, fromS, toS);
    case "drink":
      return drinkLines(legacy, rawStreams, minGain ?? 0);
    default:
      throw new Error(USAGE);
  }
}
