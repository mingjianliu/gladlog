/**
 * rawStreams.ts — 单源模块:直读 raw.txt 里两条被 parser 丢弃的流(逐事件法力样本 +
 * SPELL_CAST_FAILED 施法意图),供意图守护(cd-hoarded 冤枉修正)、mana-pressure/
 * mana-efficiency 候选、matchExplore 深挖子命令共用(BACKLOG #26,
 * docs/superpowers/plans/2026-08-15-raw-streams.md「数据契约」)。
 *
 * 行拆分 / 时间戳 / advanced 块解码**不再镜像** parser 的实现:2026-09-26 起
 * `@gladlog/parser-compat` 重导出 parser 的行级 API(`splitLine` / `parseTimestamp` /
 * `decodeAdvanced`),这里只是把它们按本模块一直对外的名字再导出一次,
 * 所以 `packages/analysis` 仍然只依赖 parser-compat,而「raw.txt 一行怎么拆、几点几分、
 * advanced 块哪几个字段」全仓只有 parser 里那一份实现。2026-08-15 到 09-26 之间这里
 * 曾维护三份逐字节镜像 + 三份 parity 测试(见 docs/rule-history.md 的共享谓词一节);
 * `packages/eval/test/predicateIndex.test.ts` 现在断言的是三个名字与 parser 的函数
 * **同一引用**,而不是逐字节相等。
 *
 * `packages/eval/src/explore/uwcObserved.ts` 直接消费这里的 `splitRawLine` /
 * `parseRawTimestamp`(仍用 `@gladlog/parser` 的 `decodeBaseUnits` / `decodeSpell`
 * 做字段解码),使"raw.txt 一行怎么拆、几点几分"在 analysis / eval 两侧走同一个入口。
 */
import {
  decodeAdvanced,
  parseTimestamp,
  splitLine,
} from "@gladlog/parser-compat";

/** raw.txt 一行 → `{ datePart, eventName, params }`,不是日志行返回 `null`。
 * 就是 parser 的 `splitLine`(同一引用),名字保留给既有消费者。 */
export const splitRawLine = splitLine;

/** raw.txt 日期前缀(如 `"7/19/2026 04:19:05.269-4"`)→ 绝对 epoch ms,畸形返回
 * `null`。就是 parser 的 `parseTimestamp`(同一引用)。 */
export const parseRawTimestamp = parseTimestamp;

/** advanced 块(actorGuid / hp / x / y / powers …)。就是 parser 的 `decodeAdvanced`
 * (同一引用);名字沿用镜像时期的 `mirrorDecodeAdvanced`,消费者不用改。 */
export const mirrorDecodeAdvanced = decodeAdvanced;

const GUID_PREFIX_RE = /^(Player|Creature|Pet)-/;

/**
 * The advanced-info block's mana entry (WoW power type 0), from a
 * `SPELL_CAST_SUCCESS` (or other advanced-bearing) event's params array.
 *
 * Real layout, verified against match 60ab1e8f raw.txt (2026-08-15; see
 * `docs/superpowers/sdd/2026-08-15-raw-streams/task-1-report.md` for the
 * derivation): the four fields immediately before the x/y position pair are
 * `powerType, currentPower, maxPower, powerCost` — e.g.
 * `...,0,0,9|0,3|270177,5|273000,3|1500,1306.72,1681.85,...` (Holy Paladin
 * casting 永恒之火/Eternal Flame): powerType `"9|0"` = Holy Power(9) and
 * Mana(0) tracked in parallel; currentPower `"3|270177"` and maxPower
 * `"5|273000"` line up index-for-index with powerType, so mana (`"0"`) is at
 * parallel index 1 → 270177/273000. Single-power units (the overwhelming
 * majority of lines) show plain unpiped values, e.g. `...,0,0,0,545,273000,0,
 * 1262.06,...` → powerType `"0"`, current `"545"`, max `"273000"` (this exact
 * line is match 60ab1e8f's healer 10s-before-death mana reading — see the
 * task report's acceptance numbers).
 *
 * Deriving the four fields as `xIdx-4..xIdx-1` (rather than a fixed offset
 * from `at`) makes the count of other fields between `absorb` and `powerType`
 * irrelevant — whatever that count is, it's already absorbed into where
 * `mirrorDecodeAdvanced`'s own x/y scan lands.
 */
export function extractManaFromAdvanced(
  params: string[],
  at: number,
): { mana: number; manaMax: number } | null {
  // 走 parser `decodeAdvanced` 的 powers(x/y 锚点落在 `at + 4` 之前时它给空表),
  // 不再自己拆一遍管道分隔的资源块 —— 2026-08-23 parser 开始解同样的三个字段,
  // 两处各拆一次正是共享谓词规则要防的形状。
  const manaEntry = decodeAdvanced(params, at).powers.find(
    (e) => e.powerType === 0,
  );
  if (!manaEntry) return null;
  const { current: mana, max: manaMax } = manaEntry;
  if (!Number.isFinite(mana) || !Number.isFinite(manaMax)) return null;
  return { mana, manaMax };
}

// ── 数据契约 ─────────────────────────────────────────────────────────────

export interface ManaSample {
  tSeconds: number;
  unitGuid: string;
  mana: number;
  manaMax: number;
}

export interface CastFailedEvent {
  tSeconds: number;
  unitGuid: string;
  spellId: number;
  spellName: string;
  reason: string;
}

export interface RawStreams {
  available: boolean;
  manaSamples: ManaSample[];
  castFailed: CastFailedEvent[];
}

/** Offset of the spell/advanced block for a `SPELL_CAST_SUCCESS` line — same
 * "8" `decodeSpell` and "11" `decodeAdvanced` offsets `parseLine` uses for
 * this event (packages/parser/src/l1/parseLine.ts:92-95). */
const CAST_SUCCESS_ADVANCED_AT = 11;

function parseLineInto(
  line: string,
  manaSamples: ManaSample[],
  castFailed: CastFailedEvent[],
  baseMs: number,
  roundDurationS: number | undefined,
): void {
  if (!line) return;
  const split = splitRawLine(line);
  if (!split) return; // malformed line — silently skipped, per Global Constraints
  const { datePart, eventName, params } = split;

  if (eventName !== "SPELL_CAST_FAILED" && eventName !== "SPELL_CAST_SUCCESS") {
    return;
  }

  const absMs = parseRawTimestamp(datePart);
  if (absMs === null) return;
  const tSeconds = (absMs - baseMs) / 1000;

  // Round-boundary clamp (BACKLOG #32, 2026-08-16): a Solo Shuffle raw.txt is
  // ONE file shared by all 6 rounds, so without a bound here a line
  // belonging to a DIFFERENT round of the same lobby still gets a `tSeconds`
  // value relative to THIS round's `baseMs` and is indistinguishable from a
  // same-round sample downstream (`oomWindows`/`castFailedInWindow` have no
  // way to tell). Both directions leak: an earlier round's tail lands at
  // negative `tSeconds`, a later round's head lands past this round's own
  // duration. Zero grace (no slack past `roundDurationS`, no slack before 0):
  // empirically verified on 300/300 sampled non-shuffle ("match"-kind, single
  // round == the whole raw.txt) rounds from the real corpus that ZERO
  // manaSamples/castFailed events ever fall outside `[0, roundDurationS]`
  // even unclamped — real raw.txt logging is already exactly round-scoped
  // when there is only one round, so no boundary-jitter slack is needed (see
  // BACKLOG #32 fix commit for the check). `roundDurationS === undefined`
  // (caller has no round context, e.g. a whole-match tool) skips this check
  // entirely — unbounded, byte-identical to pre-#32 behavior.
  if (
    roundDurationS !== undefined &&
    (tSeconds < 0 || tSeconds > roundDurationS)
  ) {
    return;
  }

  if (eventName === "SPELL_CAST_FAILED") {
    // base units occupy params[0..7] (decodeBaseUnits); spell id/name/school
    // follow at [8]/[9]/[10]; the localized failure reason is [11] — verified
    // against real raw.txt (see module header / task report).
    const unitGuid = params[0];
    const spellIdStr = params[8];
    const spellName = params[9];
    const reason = params[11];
    if (
      unitGuid === undefined ||
      spellIdStr === undefined ||
      spellName === undefined ||
      reason === undefined
    ) {
      return;
    }
    const spellId = parseInt(spellIdStr, 10);
    if (!Number.isFinite(spellId)) return;
    castFailed.push({ tSeconds, unitGuid, spellId, spellName, reason });
    return;
  }

  // SPELL_CAST_SUCCESS: advanced block starts at 11; block-start (actorGuid)
  // must look like a real unit GUID or the line is skipped (Step 1 red line).
  const actorGuid = params[CAST_SUCCESS_ADVANCED_AT];
  if (actorGuid === undefined || !GUID_PREFIX_RE.test(actorGuid)) return;
  const mana = extractManaFromAdvanced(params, CAST_SUCCESS_ADVANCED_AT);
  if (!mana) return;
  manaSamples.push({
    tSeconds,
    unitGuid: actorGuid,
    mana: mana.mana,
    manaMax: mana.manaMax,
  });
}

/**
 * Parses raw.txt's two analysis-relevant streams: per-event mana samples
 * (from `SPELL_CAST_SUCCESS`'s advanced block, powerType 0) and
 * `SPELL_CAST_FAILED` intent events (localized reason kept verbatim). Streams
 * line-by-line (never `rawText.split(",")` across the whole file). `rawText`
 * null/empty (raw.txt missing/unreadable, or advanced combat logging was off
 * for the match) → `{ available: false, manaSamples: [], castFailed: [] }` —
 * every consumer must treat `available:false` as "silently keep existing
 * behavior", never throw (Global Constraint).
 *
 * `baseMs` is the match/round start epoch ms — same time base every other
 * `atSeconds`/`tSeconds` fact in this codebase uses
 * (`buildMatchContext.ts`'s `(event.timestamp - combat.startTime) / 1000`).
 *
 * `roundDurationS` (BACKLOG #32, optional, clamp at the single source):
 * when provided, every sample/event whose `tSeconds` falls outside
 * `[0, roundDurationS]` is excluded at parse time — see `parseLineInto`'s own
 * doc comment for why (Solo Shuffle's raw.txt spans all 6 rounds; without
 * this, a round's builders can silently see another round's data). Every
 * ROUND-scoped caller (production IPC, `matchExplore`'s mana/drink
 * subcommands, `candidateCalibration`'s corpus scan, the P1/P2 A/B harness)
 * MUST pass it — it is optional only so whole-match tools with no single
 * round in scope (none currently call this without a round context; kept
 * optional for forward-compat) can opt out explicitly rather than being
 * forced to invent a duration. Omitting it is unbounded — byte-identical to
 * this function's pre-#32 behavior.
 */
export function parseRawStreams(
  rawText: string | null,
  baseMs: number,
  roundDurationS?: number,
): RawStreams {
  if (!rawText) return { available: false, manaSamples: [], castFailed: [] };
  const manaSamples: ManaSample[] = [];
  const castFailed: CastFailedEvent[] = [];
  for (const line of rawText.split("\n")) {
    parseLineInto(line, manaSamples, castFailed, baseMs, roundDurationS);
  }
  return { available: true, manaSamples, castFailed };
}

/**
 * A round's duration in seconds — the fact `parseRawStreams`'s optional
 * `roundDurationS` clamp expects as its 3rd arg. Single-sourced (BACKLOG #26
 * final review §2.d.2) after this exact `(endTimeMs - startTimeMs) / 1000`
 * derivation was independently hand-written at 6 call sites (desktop's
 * `rawStreamsCache.ts`/`p1p2Ab.ts`, eval's `matchExplore.ts` CLI shell and
 * `manaCalibrationScan.ts` ×3) under TWO different conventions for a
 * missing/malformed `endTimeMs`. This is the GUARDED convention (the one
 * `rawStreamsCache.ts` and `p1p2Ab.ts` already used): non-finite or
 * `endTimeMs < startTimeMs` → `undefined` (unbounded — `parseRawStreams`'s
 * pre-#32, no-clamp behavior), never a fabricated `0`/negative duration,
 * which would silently clamp every sample out.
 */
export function roundDurationSOf(
  startTimeMs: number,
  endTimeMs: number | undefined,
): number | undefined {
  return typeof endTimeMs === "number" &&
    Number.isFinite(endTimeMs) &&
    endTimeMs >= startTimeMs
    ? (endTimeMs - startTimeMs) / 1000
    : undefined;
}

/**
 * The mana reading nearest-at-or-before `tSeconds` for `unitGuid` — `null`
 * when unavailable or when every sample for that unit is strictly after `t`.
 * `manaSamples` is time-ordered (raw.txt lines are chronological), so this
 * can stop scanning the moment a later sample is reached.
 */
export function manaAt(
  s: RawStreams,
  unitGuid: string,
  tSeconds: number,
): { mana: number; manaMax: number } | null {
  if (!s.available) return null;
  let result: ManaSample | null = null;
  for (const sample of s.manaSamples) {
    if (sample.tSeconds > tSeconds) break;
    if (sample.unitGuid === unitGuid) result = sample;
  }
  return result ? { mana: result.mana, manaMax: result.manaMax } : null;
}

/**
 * A mana sample's percent of its own `manaMax`, as a raw (unrounded) value in
 * `[0, 100]` — `0` when `manaMax` is non-positive (a display-safe degenerate
 * case, not a claim the unit is actually empty). Single-sourced because
 * `oomWindows` below and `extendOomTailWithFailedCasts`
 * (`candidateFindings.ts`) both need this exact fact — see
 * docs/predicate-index.md's "Raw log streams" section.
 */
export function manaPct(sample: { mana: number; manaMax: number }): number {
  return sample.manaMax > 0 ? (sample.mana / sample.manaMax) * 100 : 0;
}

/**
 * Contiguous runs of `unitGuid`'s mana samples whose mana% (of that sample's
 * own `manaMax`) is strictly below `thresholdPct` — each run becomes one
 * window spanning its first-to-last below-threshold sample, with the run's
 * lowest raw mana value.
 */
export function oomWindows(
  s: RawStreams,
  unitGuid: string,
  thresholdPct: number,
): Array<{ fromS: number; toS: number; minMana: number }> {
  if (!s.available) return [];
  const windows: Array<{ fromS: number; toS: number; minMana: number }> = [];
  let fromS: number | null = null;
  let toS = 0;
  let minMana = Infinity;
  for (const sample of s.manaSamples) {
    if (sample.unitGuid !== unitGuid) continue;
    const pct = manaPct(sample);
    if (pct < thresholdPct) {
      if (fromS === null) {
        fromS = sample.tSeconds;
        minMana = sample.mana;
      } else {
        minMana = Math.min(minMana, sample.mana);
      }
      toS = sample.tSeconds;
    } else if (fromS !== null) {
      windows.push({ fromS, toS, minMana });
      fromS = null;
      minMana = Infinity;
    }
  }
  if (fromS !== null) windows.push({ fromS, toS, minMana });
  return windows;
}

/**
 * `CastFailedEvent`s for `unitGuid` whose `tSeconds` falls in
 * `[fromS, toS]` (inclusive both ends — matches this codebase's other
 * time-window predicates, e.g. `msInRange`), optionally narrowed to one
 * `spellId`.
 */
export function castFailedInWindow(
  s: RawStreams,
  unitGuid: string,
  fromS: number,
  toS: number,
  spellId?: number,
): CastFailedEvent[] {
  if (!s.available) return [];
  return s.castFailed.filter(
    (c) =>
      c.unitGuid === unitGuid &&
      c.tSeconds >= fromS &&
      c.tSeconds <= toS &&
      (spellId === undefined || c.spellId === spellId),
  );
}

/**
 * Contiguous runs of `unitGuid`'s mana samples where each sample's mana is
 * strictly greater than the previous one ("drinking"/regen segments) — a run
 * spans from the sample immediately before the first rise (the pre-rise
 * baseline) through the last rising sample, with `manaGained` = end − start.
 * A run needs at least one actual rise to be reported (a lone non-rising
 * sample never opens a segment).
 */
export function drinkingSegments(
  s: RawStreams,
  unitGuid: string,
): Array<{ fromS: number; toS: number; manaGained: number }> {
  if (!s.available) return [];
  const segments: Array<{ fromS: number; toS: number; manaGained: number }> =
    [];
  let segStart: ManaSample | null = null;
  let prev: ManaSample | null = null;
  for (const sample of s.manaSamples) {
    if (sample.unitGuid !== unitGuid) continue;
    if (prev && sample.mana > prev.mana) {
      if (!segStart) segStart = prev;
    } else if (segStart && prev) {
      segments.push({
        fromS: segStart.tSeconds,
        toS: prev.tSeconds,
        manaGained: prev.mana - segStart.mana,
      });
      segStart = null;
    } else {
      segStart = null;
    }
    prev = sample;
  }
  if (segStart && prev) {
    segments.push({
      fromS: segStart.tSeconds,
      toS: prev.tSeconds,
      manaGained: prev.mana - segStart.mana,
    });
  }
  return segments;
}
