/**
 * 语料观测线 (技能事实地基 Task 4, 泛化于挂账清理 Task E) — corpus-empirical
 * corroboration for "usable while CC'd" facts: scan real raw.txt combat logs
 * for `SPELL_CAST_SUCCESS` events that landed inside a unit's own active
 * CC-aura window (originally stun-only for the official
 * `USABLE_WHILE_CC_GENERATED.stunned` table,
 * `packages/analysis/src/data/usableWhileCcGenerated.ts`; Task E generalized
 * the walker to accept ANY injected aura-id set — e.g. `DR_CATEGORIES_GENERATED
 * .disorient`/`.incapacitate` — because it never actually depended on the aura
 * being a stun, only on membership in the caller-supplied set), and count
 * casts by spellId.
 *
 * Task E category note: fear-family CC (恐惧/嚎叫/心灵尖啸/诱惑, e.g. spellId
 * 5484 恐惧嚎叫, 8122 心灵尖啸) lives in DB2's `disorient` DiminishType, NOT a
 * `fear` category of its own — there is no such category in
 * `DR_CATEGORIES_GENERATED`. `incapacitate` is a structurally different game
 * mechanic (mind-control-style loss-of-agency: 变形术/冰冻陷阱/闷棍/放逐术) that
 * happens to share "can't act" with disorient but is a distinct DR category
 * with its own reset timer — the two are scanned as separate observed sets by
 * `uwcCorpusScan.ts --category`, never merged, because merging would conflate
 * two different game-rule questions under one spellId → count map.
 *
 * Semantics (see the task brief and CLAUDE.md's 门规谓词即规范 rule): this is
 * an EVIDENCE line, not a ground truth — "observed" only ever proves usable
 * (a cast really happened during an active stun); "never observed" proves
 * nothing (nobody happened to press it while stunned in this sample), so the
 * only directional contradiction this can surface is "official says
 * false/absent but the corpus shows a cast during an active stun of that
 * exact aura" — see uwcCorpusScan.ts for how the diff report frames that.
 *
 * Raw-line splitting/timestamp parsing goes through `@gladlog/analysis`'s
 * `rawStreams.ts` (`splitRawLine`/`parseRawTimestamp`) rather than a bespoke
 * regex here — that module is BACKLOG #26's single source for "how does one
 * raw.txt line split, what instant does its date prefix mean" (rawStreams.ts
 * mirrors `@gladlog/parser`'s own `splitLine`/`parseTimestamp` byte-for-byte,
 * since `packages/analysis` cannot depend on `@gladlog/parser`; parity is
 * pinned by `packages/eval/test/predicateIndex.test.ts`). Field decoding for
 * the event shapes this module actually reads (base units, spell id) still
 * comes straight from `@gladlog/parser`'s `decodeBaseUnits`/`decodeSpell` —
 * that part of "what does this raw line mean" isn't raw-line splitting/
 * timestamp math, so it stays on the parser's own decoders (shared-predicate
 * rule: one fact, one predicate — not "avoid `@gladlog/parser` entirely").
 *
 * Interval tracking, keyed by dest GUID (the stunned unit):
 *  - `SPELL_AURA_APPLIED` / `_APPLIED_DOSE` / `_AURA_REFRESH` whose spellId is
 *    in `stunAuraIds` adds that aura id to the unit's active-stun set.
 *  - `SPELL_AURA_REMOVED` / `_AURA_BROKEN` / `_AURA_BROKEN_SPELL` removes it
 *    (a REMOVED for an aura never seen APPLIED — e.g. the unit was already
 *    stunned when the log started capturing — is a harmless no-op on an
 *    absent set entry, not an error).
 *  - `_AURA_REMOVED_DOSE` (losing one stack of a multi-stack aura) does NOT
 *    clear the aura — the unit may still be stunned by remaining stacks.
 *  - A unit is "currently stunned" iff its active-stun set is non-empty.
 *  - `SPELL_CAST_SUCCESS`, keyed by src GUID (the caster), counts by its own
 *    spellId when the caster is currently stunned at that instant.
 *
 * Edge cases called out by the brief:
 *  - Same-timestamp tie (a cast at the exact millisecond a stun is removed):
 *    resolved conservatively toward "outside the stun", regardless of which
 *    line the log happens to write first — aura APPLIED/REMOVED events are
 *    applied to the tracked state before any CAST_SUCCESS at the identical
 *    timestamp is evaluated (grouped by `parsed.timestamp`, not by file
 *    position).
 *  - Match/round boundary: `ARENA_MATCH_START` resets all tracked state. A
 *    raw.txt spans an entire session (including every round of a Solo
 *    Shuffle), and player GUIDs are stable across rounds, but stun auras do
 *    not carry over between rounds — an aura applied in round N with no
 *    matching REMOVED before round N+1 starts must not be read as "still
 *    stunned" in the next round.
 *
 * Edge case found empirically (not in the brief's list, added after a first
 * full-corpus run produced a wildly implausible 422/526 "official=false but
 * observed" contradiction rate — including everyday hard-cast heals like
 * Flash of Light and Healing Touch, which nobody is truly casting mid-stun at
 * that volume): WoW's own combat log occasionally DROPS a `SPELL_AURA_REMOVED`
 * event outright. Directly verified in match `229401a0`: Intimidation (24394)
 * applied to a player at 22:12:53.559 has no matching REMOVED before the next
 * APPLIED of the same spellId on the same unit at 22:13:52.498 — 59 seconds
 * later, for a pet stun whose sibling applications in the same match all
 * closed within ~3s. Every one of the mundane high-volume "contradictions"
 * traced this way (774 Rejuvenation, 8936 Healing Touch, 19750 Flash of
 * Light, …) shared the same signature: a stun aura that opened once and
 * never saw its own REMOVED for the rest of the round, silently marking the
 * unit "stunned" for everything that happened afterward. No known hard stun
 * in this DR "stun" category runs anywhere near that long even before DR
 * (DR only ever shortens repeats) — `MAX_STUN_WINDOW_MS` is a generous
 * ceiling above any real single application, purely to auto-expire a window
 * whose REMOVED never arrived, so a dropped log event can't silently poison
 * everything the unit does for the rest of the round.
 */
import { parseRawTimestamp, splitRawLine } from "@gladlog/analysis";
import { decodeBaseUnits, decodeSpell } from "@gladlog/parser";

const AURA_ADD_SUFFIXES = [
  "_AURA_APPLIED",
  "_AURA_APPLIED_DOSE",
  "_AURA_REFRESH",
];
const AURA_REMOVE_SUFFIXES = [
  "_AURA_REMOVED",
  "_AURA_BROKEN",
  "_AURA_BROKEN_SPELL",
];

/** Ceiling on how long a single CC-aura application is trusted to still be
 * active with no corroborating `SPELL_AURA_REMOVED` — see the module header
 * for the empirical finding that motivated this (dropped REMOVED events in
 * real raw.txt logs, first found on the stun category). 10s comfortably
 * clears every hard stun's baseline duration in that DR category (the
 * longest, Hammer of Justice, baselines at 6s; DR only ever shortens
 * repeats) while sitting far below the tens of seconds a dropped-REMOVED
 * window drifted to in the corpus. Task E reuses the same ceiling for
 * disorient/incapacitate scans rather than deriving a per-category value —
 * every disorient/incapacitate baseline duration in this game (Psychic
 * Scream/Howl of Terror 8s, Polymorph 60s handled by its own REMOVED in
 * practice, …) is either well under 10s or, for the long-duration
 * incapacitates, expected to see its own REMOVED fire reliably since those
 * are typically the ONLY aura on the target rather than one of several
 * short-lived stacked stuns — so 10s remains a safe, if untuned, default
 * rather than a value picked to fit disorient/incapacitate specifically. */
export const MAX_STUN_WINDOW_MS = 10_000;

type PendingEvent =
  | { kind: "auraAdd"; guid: string; spellId: string }
  | { kind: "auraRemove"; guid: string; spellId: string }
  | { kind: "cast"; guid: string; spellId: string };

/** Result of the single-pass walk: cast counts (the public contract) plus a
 * `windowCount` telemetry stat — how many times any unit transitioned from
 * "not CC'd" to "CC'd" by the injected aura set (a tracked-aura add landing
 * on a unit that wasn't already inside an active window of that set).
 * `windowCount` is not itself evidentiary (it doesn't check casts); it
 * exists purely so `uwcCorpusScan.ts` can report "N windows observed"
 * without a second parse pass over the same corpus. */
interface CcWindowScan {
  castsBySpell: Map<string, number>;
  windowCount: number;
}

/** Is `guid` still within `maxWindowMs` of any tracked aura it was seen
 * gaining, as of `atTs`? Checking elapsed time (rather than mere presence in
 * a Set) is what lets a window whose REMOVED was dropped by the log
 * auto-expire instead of poisoning every later cast for the rest of the
 * round — see the module header. Generic over whatever aura-id set the
 * caller injected (stun / disorient / incapacitate / …), not stun-specific
 * despite the historical name of its caller. */
function isCcActiveAt(
  appliedAt: ReadonlyMap<string, number> | undefined,
  atTs: number,
  maxWindowMs: number,
): boolean {
  if (!appliedAt) return false;
  for (const startedAt of appliedAt.values()) {
    if (atTs - startedAt <= maxWindowMs) return true;
  }
  return false;
}

/** The shared single-pass walker both `observedCastsInCc` (the generalized
 * public contract) and the corpus scan's telemetry consume — kept as one
 * function so the aura/cast tracking logic exists in exactly one place.
 * Generic over `auraIds`: it never actually depended on the set being a
 * stun, only on set membership (Task E, 2026-08-14 — the pre-existing
 * "stun" name in this function's original signature/docs described its
 * FIRST caller, not a constraint the walk itself enforced).
 *
 * `opts.maxWindowMs` overrides `MAX_STUN_WINDOW_MS` (default). Exists
 * solely so `uwcCorpusScan.ts --disable-window-cap` can reproduce the
 * pre-fix (uncapped) behavior on demand for a documented before/after
 * artifact — pass `Infinity` to disable the cap entirely. Production callers
 * (including `observedCastsInCc`) never pass this; they get the capped
 * default. */
export function scanCcWindows(
  rawText: string,
  auraIds: ReadonlySet<string>,
  opts?: { maxWindowMs?: number },
): CcWindowScan {
  const maxWindowMs = opts?.maxWindowMs ?? MAX_STUN_WINDOW_MS;
  const castsBySpell = new Map<string, number>();
  let windowCount = 0;
  // guid -> (active tracked-aura spellId -> the timestamp it was applied at).
  const activeCc = new Map<string, Map<string, number>>();

  let pendingTimestamp: number | null = null;
  let pendingBatch: PendingEvent[] = [];

  const flushBatch = (): void => {
    if (pendingBatch.length === 0) return;
    const ts = pendingTimestamp ?? 0;
    // Aura state changes resolve before any cast in the same batch is
    // evaluated — this is what makes the same-timestamp tie-break
    // conservative regardless of the two lines' order in the file.
    for (const ev of pendingBatch) {
      if (ev.kind === "auraAdd") {
        let appliedAt = activeCc.get(ev.guid);
        if (!appliedAt) {
          appliedAt = new Map();
          activeCc.set(ev.guid, appliedAt);
        }
        if (!isCcActiveAt(appliedAt, ts, maxWindowMs)) windowCount++;
        appliedAt.set(ev.spellId, ts);
      } else if (ev.kind === "auraRemove") {
        activeCc.get(ev.guid)?.delete(ev.spellId);
      }
    }
    for (const ev of pendingBatch) {
      if (ev.kind !== "cast") continue;
      if (isCcActiveAt(activeCc.get(ev.guid), ts, maxWindowMs)) {
        castsBySpell.set(ev.spellId, (castsBySpell.get(ev.spellId) ?? 0) + 1);
      }
    }
    pendingBatch = [];
  };

  for (const line of rawText.split("\n")) {
    if (!line) continue;
    // Single source for "how does one raw.txt line split, what instant does
    // its date prefix mean" (see module header) — both must succeed for a
    // line to be considered at all, matching @gladlog/parser's own
    // `parseLine` (which returns null on either failure) so this refactor is
    // behavior-preserving.
    const split = splitRawLine(line);
    if (!split) continue;
    const timestamp = parseRawTimestamp(split.datePart);
    if (timestamp === null) continue;
    const { eventName, params } = split;

    if (eventName === "ARENA_MATCH_START") {
      flushBatch();
      pendingTimestamp = null;
      activeCc.clear();
      continue;
    }

    if (timestamp !== pendingTimestamp) {
      flushBatch();
      pendingTimestamp = timestamp;
    }

    if (AURA_ADD_SUFFIXES.some((s) => eventName.endsWith(s))) {
      const spellId = String(decodeSpell(params, 8).spellId);
      const guid = decodeBaseUnits(params).destGuid;
      if (guid && spellId && auraIds.has(spellId)) {
        pendingBatch.push({ kind: "auraAdd", guid, spellId });
      }
    } else if (AURA_REMOVE_SUFFIXES.some((s) => eventName.endsWith(s))) {
      const spellId = String(decodeSpell(params, 8).spellId);
      const guid = decodeBaseUnits(params).destGuid;
      if (guid && spellId && auraIds.has(spellId)) {
        pendingBatch.push({ kind: "auraRemove", guid, spellId });
      }
    } else if (eventName === "SPELL_CAST_SUCCESS") {
      const guid = decodeBaseUnits(params).srcGuid;
      const spellId = String(decodeSpell(params, 8).spellId);
      if (guid && spellId) {
        pendingBatch.push({ kind: "cast", guid, spellId });
      }
    }
  }
  flushBatch();

  return { castsBySpell, windowCount };
}

/**
 * Task E's generalized interface: raw combat log text + any injected
 * aura-id set in, spellId → observed-cast-count-during-an-active-window-of-
 * that-set-on-the-caster out. Works for stun, disorient, incapacitate, or
 * any other DR-category aura set — the walker never checked which category
 * the ids came from, only membership in `auraIds`. Thin wrapper over
 * `scanCcWindows` — see that function for the actual walk.
 */
export function observedCastsInCc(
  rawText: string,
  auraIds: ReadonlySet<string>,
): Map<string, number> {
  return scanCcWindows(rawText, auraIds).castsBySpell;
}

/**
 * Task 4's pinned interface (brief's exact signature): raw combat log text in,
 * spellId → observed-cast-count-during-an-active-stun-of-that-unit out.
 * Thin alias over `observedCastsInCc` (Task E, 2026-08-14 generalization) —
 * kept under its original name because eval-internal consumers import it
 * directly by this name; behavior is byte-identical to before the rename.
 */
export function observedCastsWhileStunned(
  rawText: string,
  stunAuraIds: ReadonlySet<string>,
): Map<string, number> {
  return observedCastsInCc(rawText, stunAuraIds);
}

// ── Aggregation across the corpus + three-way diff report ──────────────────

/** One line of the hand-written 6-id table (`cooldowns.ts`
 * `USABLE_WHILE_CC_SPELL_IDS`) or a named diagnostic anchor, annotated with
 * what the corpus actually saw. */
interface UwcAnnotatedId {
  spellId: string;
  name: string;
  /** Official generated table's verdict for the "stunned" dimension. */
  official: boolean;
  /** Number of times the corpus observed a cast of this spellId landing
   * inside an active stun window of the caster (0 = never observed, not a
   * falsification — see module header). */
  observedCount: number;
}

function annotate(
  ids: { spellId: string; name: string }[],
  officialStunned: ReadonlySet<string>,
  totalCastsBySpell: ReadonlyMap<string, number>,
): UwcAnnotatedId[] {
  return ids.map(({ spellId, name }) => ({
    spellId,
    name,
    official: officialStunned.has(spellId),
    observedCount: totalCastsBySpell.get(spellId) ?? 0,
  }));
}

interface UwcDiffReportInputs {
  matchesScanned: number;
  /** Indexed matches whose raw.txt was missing/unreadable and so were
   * skipped (not counted in `matchesScanned`). 0 in the common case. */
  skippedMatches?: number;
  totalWindows: number;
  totalCastsInStun: number;
  totalCastsBySpell: ReadonlyMap<string, number>;
  officialStunned: ReadonlySet<string>;
  /** cooldowns.ts USABLE_WHILE_CC_SPELL_IDS, in file order. */
  handwrittenSix: { spellId: string; name: string }[];
  /** genUsableWhileCc.ts TIEBREAK_ANCHORS.stunned (unsigned, pending this
   * task's corroboration). */
  tiebreakAnchors: { spellId: string; name: string; expected: boolean }[];
  /** Best-effort id → Chinese name resolver for the free-text diff lists;
   * falls back to the bare id when unresolved. */
  spellName: (id: string) => string | undefined;
  /** Hand-investigated contradiction ids — spot-checked by sampling raw.txt
   * directly (caster GUID prefix, and the ms gap between the cast and its
   * matching aura's APPLIED, to separate "near-boundary timing jitter" from
   * "cast well into the window"). Rendered ahead of the generic contradiction
   * list; the rest of the contradiction set is bucketed by observed count
   * instead of hand-explained one by one (see that section's own text for
   * why exhaustive per-id explanation isn't attempted). */
  manualFindings?: { spellId: string; note: string }[];
  /** Extra hand-investigated markdown (raw SpellMisc bit-value table for the
   * high-confidence candidates, wowhead Flags-box spot-checks, proc-
   * contamination caveats, …) rendered immediately after the "高置信度候选"
   * list. Left free-form because it's curated investigation output this
   * function has no way to derive on its own — see uwcCorpusScan.ts for what
   * is currently supplied. */
  highConfidenceAppendix?: string;
}

/** Builds the Task 4 three-way diff report (Markdown). Framed per the task's
 * directional-error rule (see module header): the ONLY hard failure this
 * report can surface is "官方集 − observed cast" — an id the official table
 * marks NOT usable while stunned, yet the corpus shows a cast of that exact
 * spellId landing inside an active window of that exact stun aura set. Every
 * other quadrant is sample-size commentary, not a contradiction. */
export function buildUwcDiffReport(inputs: UwcDiffReportInputs): string {
  const {
    matchesScanned,
    skippedMatches = 0,
    totalWindows,
    totalCastsInStun,
    totalCastsBySpell,
    officialStunned,
    handwrittenSix,
    tiebreakAnchors,
    spellName,
    manualFindings = [],
    highConfidenceAppendix,
  } = inputs;

  const observedIds = new Set(totalCastsBySpell.keys());
  const intersection = [...observedIds]
    .filter((id) => officialStunned.has(id))
    .sort(
      (a, b) =>
        (totalCastsBySpell.get(b) ?? 0) - (totalCastsBySpell.get(a) ?? 0),
    );
  const contradictions = [...observedIds]
    .filter((id) => !officialStunned.has(id))
    .sort(
      (a, b) =>
        (totalCastsBySpell.get(b) ?? 0) - (totalCastsBySpell.get(a) ?? 0),
    );
  const neverObserved = [...officialStunned].filter(
    (id) => !observedIds.has(id),
  );

  const nameOf = (id: string): string => spellName(id) ?? "(未知名)";
  const fmtRow = (id: string): string =>
    `- ${id} ${nameOf(id)} — 观测 ${totalCastsBySpell.get(id) ?? 0} 次晕中施放成功`;

  const lines: string[] = [];
  lines.push("# UWC 语料观测线三方 diff 报告(技能事实地基 Task 4)");
  lines.push("");
  lines.push(
    `生成时间:${new Date().toISOString()}。判据框架:观测线只能证明"可用"(晕中真发生过一次施放成功),` +
      `不能证明"不可用"(没人在晕里按 ≠ 按不出来)——唯一构成矛盾的方向是"官方集内没有,但语料在该单位活跃的同一枚晕 aura 窗口内观测到该 spellId 施放成功"。`,
  );
  lines.push("");
  lines.push("## 扫描统计");
  lines.push(
    `- 扫描场次(含 shuffle 整把):${matchesScanned}` +
      (skippedMatches > 0
        ? `(另有 ${skippedMatches} 场 raw.txt 缺失/不可读,已跳过)`
        : ""),
  );
  lines.push(`- 晕区间(窗口)总数:${totalWindows}`);
  lines.push(`- 晕中施放成功条目总数:${totalCastsInStun}`);
  lines.push(`- 晕中施放去重 spellId 数(观测集大小):${observedIds.size}`);
  lines.push("");

  lines.push("## 观测集 ∩ 官方集(语料佐证官方判定)");
  lines.push(`共 ${intersection.length} 个 spellId。`);
  for (const id of intersection.slice(0, 40)) lines.push(fmtRow(id));
  if (intersection.length > 40) {
    lines.push(`……以及另外 ${intersection.length - 40} 个(见下方聚合数据)。`);
  }
  lines.push("");

  lines.push("## 观测集 − 官方集(矛盾候选——必须为 0 或逐条解释)");
  if (contradictions.length === 0) {
    lines.push(
      "**0 条。** 语料中没有任何一次晕中施放成功落在官方判定为「不可用」的 spellId 上。",
    );
  } else {
    lines.push(
      `> **对 brief 字面要求的偏离(需用户裁决时一并接受或驳回)**:brief 原文要求矛盾候选「必须为 0 或逐条解释」。` +
        `本报告对全部 ${contradictions.length} 条矛盾候选**没有**逐条解释——只对少数高置信度候选做了深入核查,其余按观测次数分桶列名单。` +
        `这是一处明确的、有意识的偏离,不是悄悄放宽判据;是否接受这种"分桶而非逐条"的处置方式(而非要求补齐剩余条目的逐条解释),` +
        `本身就是本报告 PAUSE 清单的一项,请用户明确表态接受或驳回。`,
    );
    lines.push("");
    lines.push(
      `**${contradictions.length} 条。** 逐条解释在这个规模下不现实——多数是 count=1/2 的孤例,与"晕中恰好一次巧合按出"或残留时序噪声(见下方分桶)区分不开;` +
        `真正值得当作候选证据的,是那些在**大量不同对局/不同玩家**间反复出现、且施放时刻散布在窗口中段(不是紧贴 REMOVED 边界)的高频 id —— 已手动逐条抽样核实的高置信度候选列在下面,其余按观测次数分桶,不做逐条解释。`,
    );
    lines.push("");

    if (manualFindings.length > 0) {
      lines.push(
        "### 高置信度候选(手动抽样核实,疑似官方表覆盖缺口——PAUSE 材料)",
      );
      for (const f of manualFindings) {
        lines.push(
          `- ${f.spellId} ${nameOf(f.spellId)}(观测 ${totalCastsBySpell.get(f.spellId) ?? 0} 次)${f.note}`,
        );
      }
      lines.push("");
      if (highConfidenceAppendix) {
        lines.push(highConfidenceAppendix);
        lines.push("");
      }
    }

    const HIGH = 5;
    const MID = 2;
    const remaining = contradictions.filter(
      (id) => !manualFindings.some((f) => f.spellId === id),
    );
    const highTail = remaining.filter(
      (id) => (totalCastsBySpell.get(id) ?? 0) >= HIGH,
    );
    const midTail = remaining.filter((id) => {
      const n = totalCastsBySpell.get(id) ?? 0;
      return n >= MID && n < HIGH;
    });
    const singletonTail = remaining.filter(
      (id) => (totalCastsBySpell.get(id) ?? 0) < MID,
    );

    if (highTail.length > 0) {
      lines.push(`### 其余高频(观测 ≥${HIGH} 次,未手动核实,建议下一步复核)`);
      for (const id of highTail) lines.push(fmtRow(id));
      lines.push("");
    }
    if (midTail.length > 0) {
      lines.push(`### 中频(观测 ${MID}-${HIGH - 1} 次)`);
      for (const id of midTail) lines.push(fmtRow(id));
      lines.push("");
    }
    lines.push(`### 单次观测(count=1,${singletonTail.length} 条,不逐条解释)`);
    lines.push(
      `这 ${singletonTail.length} 条各只出现过一次,与"孤立巧合"(瞬发豁免边角情况 / 晕后毫秒级时序噪声 / 记号歧义)一致,` +
        `在 ${matchesScanned} 场语料的规模下逐条深挖投入产出比过低——不做逐条解释,列出 id 供留档,不主张其中任何一条是系统性的"可用"证据:`,
    );
    lines.push(
      singletonTail.map((id) => `${id}(${nameOf(id)})`).join("、") || "(无)",
    );
  }
  lines.push("");

  lines.push("## 官方集 − 观测集(语料从未观测到,仅样本量说明,非证伪)");
  lines.push(
    `官方集 ${officialStunned.size} 条中,本次语料 ${matchesScanned} 场从未观测到晕中施放成功的有 ${neverObserved.length} 条` +
      `(占 ${((neverObserved.length / officialStunned.size) * 100).toFixed(1)}%)。这只说明"没人在晕里按过",不构成对官方位判定的证伪——` +
      `官方集里的大多数技能本就是低频防御 CD,晕中恰好被按下需要"晕中 + 恰好这个 CD 没在冷却 + 玩家选择用它"三重巧合同时发生,单次语料样本覆盖不到这个量级也在预期之内。`,
  );
  lines.push("");

  lines.push("## 手写表 6 条终判材料(cooldowns.ts USABLE_WHILE_CC_SPELL_IDS)");
  const annotatedSix = annotate(
    handwrittenSix,
    officialStunned,
    totalCastsBySpell,
  );
  for (const row of annotatedSix) {
    const officialStr = row.official ? "官方=可用" : "官方=不可用/未收录";
    const obsStr =
      row.observedCount > 0
        ? `语料观测到 ${row.observedCount} 次晕中施放成功`
        : "语料未观测到晕中施放(样本量说明,非证伪)";
    lines.push(`- **${row.spellId} ${row.name}**${officialStr},${obsStr}。`);
  }
  lines.push("");
  lines.push(
    "**642(圣盾术)专记**:官方位=" +
      (officialStunned.has("642") ? "可用" : "不可用/未收录") +
      `,语料观测到 ${totalCastsBySpell.get("642") ?? 0} 次晕中施放成功。` +
      "Task 2 用户裁决已认定 642 机制上任何被控状态下都能按下(此前「晕中开不出」系误记),此处只做交叉验证,不改变 Task 2 的机制判定;" +
      "教练规范层面(代价过大、非常规挡控手段)归 Task 6 签字册。",
  );
  lines.push("");
  lines.push(
    "**树皮术(22812)/消散(47585)恐惧格说明**:本报告的观测线只追踪 DR「stun」类 aura,只能对「晕中可用」维度提供语料佐证/证伪——" +
      "两条技能在 Task 2 锚点文件里被记录为「恐惧(feared)维度用户意见与 wowhead flags/游戏内 tooltip 正面冲突,未裁定」," +
      "**本次晕中观测线结构性无法裁决恐惧维度的分歧**(需要一条独立的「恐惧类 aura 观测线」,不在本任务范围内),特此明确说明,不可被误读为「本报告已解决」。",
  );
  lines.push("");

  lines.push(
    "## 判别锚 5 条的语料佐证情况(genUsableWhileCc.ts TIEBREAK_ANCHORS.stunned,未签字,待本任务佐证)",
  );
  const annotatedAnchors = tiebreakAnchors.map((a) => ({
    ...a,
    observedCount: totalCastsBySpell.get(a.spellId) ?? 0,
    official: officialStunned.has(a.spellId),
  }));
  for (const row of annotatedAnchors) {
    // A cast observed during stun only ever corroborates expected=true (proof
    // of usable); it can never corroborate expected=false (absence of proof
    // isn't proof of absence) — so an observed cast against an
    // expected=false anchor is itself the interesting case (flag it, don't
    // silently print "一致").
    const verdict =
      row.observedCount === 0
        ? "N/A(未观测,样本量说明)"
        : row.expected
          ? "与预期一致(佐证可用)"
          : "与预期冲突——语料观测到晕中施放,但该锚点预期为不可用";
    lines.push(
      `- ${row.spellId} ${row.name}:预期 ${row.expected ? "可用" : "不可用"},官方位=${row.official ? "可用" : "不可用/未收录"},` +
        `语料观测 ${row.observedCount} 次晕中施放成功(${verdict})。`,
    );
  }

  return lines.join("\n");
}

// ── Task E (2026-08-14): feared/disorient-family observation report ───────

/** One category's aggregated scan totals — `uwcCorpusScan.ts --category
 * disorient|incapacitate` produces one of these per category. Deliberately
 * NOT merged across categories anywhere in this module: disorient (fear-
 * family: 恐惧/嚎叫/心灵尖啸/诱惑) and incapacitate (mind-lock family:
 * 变形术/冰冻陷阱/闷棍/放逐术) are different DR categories with independent
 * reset timers and different game-rule questions — see the module header's
 * Task E category note. */
export interface CcCategoryScanSummary {
  category: string;
  matchesScanned: number;
  skippedMatches: number;
  totalWindows: number;
  totalCastsInCc: number;
  totalCastsBySpell: ReadonlyMap<string, number>;
}

/** One row of the signed UWC_ANCHORS list (`usableWhileCcAnchors.ts`),
 * feared dimension only — this report's whole point is corroborating (or
 * flagging conflict with) that dimension using the disorient-category
 * corpus scan. `feared: null` marks an anchor the user deliberately left
 * unsigned (either low-confidence, or — historically, for 22812/47585 — a
 * documented user-vs-tooltip conflict; see `disputeSpellIds`). **Stale note
 * (2026-08-15)**: 22812 was resolved to `feared: true` by the Task E corpus
 * evidence this report itself produced (430e3b7) and no longer reads as
 * `null` — only 47585 remains unsigned. */
interface FearedAnchorRow {
  spellId: string;
  name: string;
  feared: boolean | null;
  rationale: string;
}

interface FearedDiffReportInputs {
  /** One entry per category actually scanned — brief requires disorient AND
   * incapacitate as separate runs; both are expected here. */
  categories: CcCategoryScanSummary[];
  /** Signed anchors' feared dimension (`UWC_ANCHORS` from
   * `usableWhileCcAnchors.ts`, imported directly rather than duplicated —
   * it is a stable signed export, unlike the private datagen scratch list
   * `TIEBREAK_ANCHORS_STUNNED` duplicates for the stun report above). */
  anchors: FearedAnchorRow[];
  /** spellIds this report's headline dispute section was built for (22812
   * 树皮术, 47585 消散 — both started as a documented user-vs-tooltip
   * conflict, `feared: null` in `anchors`). Rendered as the report's
   * headline dispute section instead of buried in the generic anchor list.
   * **Stale note (2026-08-15)**: 22812 has since been resolved to
   * `feared: true` (430e3b7) using exactly this report's own corpus
   * evidence — only 47585 is still `feared: null`. The pair stays fixed
   * here regardless, since the section's job is presenting the evidence
   * that drove the resolution, not gating on current sign-off state. */
  disputeSpellIds: readonly string[];
  spellName: (id: string) => string | undefined;
  /** Hand-investigated candidate writeups (GUID/proc-confound assessment,
   * same discipline as `manualFindings` above) for the PAUSE candidate
   * list — computed after the real scan numbers are in, so supplied by the
   * caller rather than derived here. */
  candidateFindings?: {
    spellId: string;
    category: string;
    note: string;
    /** "sign" = corpus evidence clean enough to promote into UWC_ANCHORS/
     * CURATED_ABILITY_FACTS as-is; "do-not-sign" = evidence too thin/noisy
     * (singleton, boundary-jitter gap, proc confound, …) to act on;
     * "flag-for-review" = this candidate's spellId ALREADY has a signed
     * anchor and the corpus evidence conflicts with it — never silently
     * overturn a signed decision, surface it back to the user instead. */
    recommend: "sign" | "do-not-sign" | "flag-for-review";
    /** Final user ruling on this candidate (2026-08-15 sign-off round),
     * rendered ahead of `recommend`/`note` when present. Absent = still
     * open/PAUSE material with no ruling yet. Once set this is the record
     * of what the user actually decided — `recommend` stays as this
     * report's own (possibly now-historical) recommendation, not
     * overwritten, so a reader can see recommendation vs. actual ruling
     * side by side. */
    verdict?: string;
  }[];
}

/** Builds the Task E feared/disorient-family observation report (Markdown).
 * Unlike `buildUwcDiffReport`, this is NOT a three-way diff against an
 * official table — `USABLE_WHILE_CC_GENERATED` has no feared dimension
 * (`usableWhileCcGenerated.ts`'s own header: "feared: NOT emitted ...
 * structurally impossible via <=2-bit OR-union"), so there is no "official
 * set" to diff against. This report instead corroborates (or flags conflict
 * with) the signed anchors' feared dimension using the disorient/
 * incapacitate corpus scans, and assembles PAUSE candidate material. */
export function buildFearedDiffReport(inputs: FearedDiffReportInputs): string {
  const {
    categories,
    anchors,
    disputeSpellIds,
    spellName,
    candidateFindings = [],
  } = inputs;

  const nameOf = (id: string): string => spellName(id) ?? "(未知名)";
  const byCategory = new Map(categories.map((c) => [c.category, c] as const));
  const observedIn = (category: string, id: string): number =>
    byCategory.get(category)?.totalCastsBySpell.get(id) ?? 0;

  const lines: string[] = [];
  lines.push("# 恐惧/混乱类语料观测线报告(挂账清理 Task E)");
  lines.push("");
  lines.push(
    `生成时间:${new Date().toISOString()}。判据框架与 Task 4 晕中观测线一致(见 uwc-diff.md):` +
      `观测线只能证明"可用"(CC 窗口内真发生过一次施放成功),不能证明"不可用"。`,
  );
  lines.push("");
  lines.push(
    "**类别口径(本报告的核心前提,务必先读)**:DB2 `SpellCategories.DiminishType` 把 CC 分成 " +
      "`stun`(4)/`incapacitate`(16)/`disorient`(32)/`silence`(64)/`root`(1) 五类,**没有单独的 `fear` 类别**。" +
      "类别归属只能查 `DR_CATEGORIES_GENERATED` 本身(逐条核对 `.disorient` 数组的成员 id)——名表(spellNamesZhGenerated.json)" +
      "只能查一个 id 叫什么名字,**不能**证明它属于哪个 DR 类别,两者是不同的生成表。" +
      "5484 恐惧嚎叫、6358 诱惑、8122 心灵尖啸、5246 破胆怒吼、118699(恐惧的另一个 spellId)、360806 梦游、207685 悲苦咒符" +
      "等确认在 `.disorient` 数组里,这是本报告扫 `disorient` 作为「恐惧类硬控」观测对象的直接依据" +
      "(**注**:基础「恐惧」这个技能常见的 spellId 5782 本身实际不在 `DR_CATEGORIES_GENERATED` 任何类别里,0 命中——" +
      "语料实际追踪、观测到的是上面这些确实登记在案的 disorient 类 id,不含 5782)。" +
      "`incapacitate` 类(变形术/冰冻陷阱/闷棍/放逐术等,「心控」而非「心理驱散」)是另一套完全不同的游戏机制(目标失去主动权而非被驱赶逃跑)," +
      "本报告把它当作对照组独立扫描、**从不与 disorient 合并计数**——两者是不同的游戏规则问题,合并会把两个事实混进同一个 spellId → count。",
  );
  lines.push("");

  lines.push("## 扫描统计(按类别分列,互不合并)");
  for (const c of categories) {
    const distinct = c.totalCastsBySpell.size;
    lines.push(
      `- **${c.category}**:扫描场次 ${c.matchesScanned}` +
        (c.skippedMatches > 0 ? `(另 ${c.skippedMatches} 场跳过)` : "") +
        `,CC 窗口总数 ${c.totalWindows},窗口内施放成功条目总数 ${c.totalCastsInCc},去重 spellId 数 ${distinct}。`,
    );
  }
  lines.push("");

  for (const c of categories) {
    const sorted = [...c.totalCastsBySpell.entries()].sort(
      (a, b) => b[1] - a[1],
    );
    lines.push(`## ${c.category} 观测集(按观测次数降序,前 40)`);
    if (sorted.length === 0) {
      lines.push("(无观测)");
    } else {
      for (const [id, n] of sorted.slice(0, 40)) {
        lines.push(`- ${id} ${nameOf(id)} — 观测 ${n} 次窗口内施放成功`);
      }
      if (sorted.length > 40) {
        lines.push(`……以及另外 ${sorted.length - 40} 个 spellId(count 更低)。`);
      }
    }
    lines.push("");
  }

  lines.push(
    "## 树皮术(22812)/消散(47585)恐惧格——争议裁决用语料证据(本报告的 headline)",
  );
  lines.push(
    "Task 2 锚点文件把这两条的 feared 维度记为「用户意见 false vs 游戏内 tooltip/wowhead flags true,正面冲突,未裁定」," +
      "并明确留待一条独立的恐惧类 aura 观测线裁决(uwc-diff.md 原文:「本次晕中观测线结构性无法裁决恐惧维度的分歧」)。" +
      "本报告就是那条独立观测线——以下是两条技能在 disorient 类窗口内的实测施放次数:",
  );
  for (const id of disputeSpellIds) {
    const disorientCount = observedIn("disorient", id);
    const incapCount = observedIn("incapacitate", id);
    lines.push(
      `- **${id} ${nameOf(id)}**:disorient(恐惧类)窗口内观测到 ${disorientCount} 次施放成功` +
        `,incapacitate(心控类,对照组)窗口内观测到 ${incapCount} 次。`,
    );
  }
  lines.push("");

  lines.push("## 签字锚点(UWC_ANCHORS)feared 维度对照");
  for (const a of anchors) {
    const disorientCount = observedIn("disorient", a.spellId);
    const fearedStr =
      a.feared === null ? "未裁定(null)" : a.feared ? "true" : "false";
    lines.push(
      `- ${a.spellId} ${a.name}:签字 feared=${fearedStr},disorient 窗口内观测 ${disorientCount} 次施放成功。`,
    );
  }
  lines.push("");

  lines.push("## 候选清单(高频且样本干净,呈签供用户裁决——含已签字终判)");
  if (candidateFindings.length === 0) {
    lines.push("(本轮无手动核实候选——见下方观测集自行分桶复核。)");
  } else {
    for (const f of candidateFindings) {
      const n = observedIn(f.category, f.spellId);
      const recommendStr =
        f.recommend === "sign"
          ? "签字采纳"
          : f.recommend === "flag-for-review"
            ? "⚠️ 请用户复核(与已签字条目冲突,不由本报告单方改判)"
            : "不建议签字";
      const verdictPrefix = f.verdict ? `**终判**:${f.verdict} ` : "";
      lines.push(
        `- **${f.spellId} ${nameOf(f.spellId)}**(${f.category},观测 ${n} 次)——${verdictPrefix}本报告建议:${recommendStr}。${f.note}`,
      );
    }
  }

  return lines.join("\n");
}
