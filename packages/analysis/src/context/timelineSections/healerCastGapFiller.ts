/**
 * [YOU] [CAST] healer gap-filler (F61) — the healer owner's own casts that no
 * [YOU] [CD] line carries (folded runs, spam folds, CC casts). Healer owners
 * only (the caller gates on isHealer). With TIMELINE_LINE_FLAGS.deathWindowUnfold
 * = "summary" (not the current setting) it also writes one [YOU] [HEALS] line per
 * friendly-death window.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. Output is pinned by the 605-file
 * acceptanceCapture context hash.
 */
import { CombatUnitType, getUnitType, LogEvent } from "@gladlog/parser-compat";

import { fmtFactNum } from "../../analysis/factFormat";
import { PURGE_REMOVALS_PER_TARGET } from "../../data/purgeRemovalsGenerated";
import {
  effectiveCooldownSeconds,
  getEnglishSpellName,
} from "../../data/spellEffectData";
import {
  DEATH_WINDOW_S,
  DEATH_WINDOW_UNFOLD_CAP,
  TIMELINE_LINE_FLAGS,
} from "../../data/timelineLineFlags";
import { allyCopyRecipient } from "../../utils/allyCopyWall";
import { channelSpans } from "../../utils/castCommitSpans";
import { isControlCast } from "../../utils/castMissRows";
import {
  COPY_CAST_IDS,
  isCompanionCastRow,
  isFormReshiftCast,
} from "../../utils/castPress";
import { isControlledPlayerFlags } from "../../utils/charmedPlayer";
import { cdRoleTag, hpAtPress, rendersOnCaster } from "../../utils/cooldowns";
import {
  isPurgeableMagicBuff,
  purgeableCountText,
} from "../../utils/dispelAnalysis";
import { AOE_CC_LANDING_WINDOW_S } from "../../utils/drAnalysis";
import { isGroundingTotemTarget } from "../../utils/groundingRedirects";
import { fmtTime } from "../../utils/renderGrid";
import {
  HEALER_CAST_SPELL_ID_TO_NAME,
  isPassiveProcCast,
  landingCutChannel,
} from "../timelineHelpers";
import type { TimelineCtx } from "./ctx";

/** A purge removal belongs to an owner cast when it hit that cast's target
 *  at essentially the same instant (F159 / M-i: 50 ms, keyed on the raw
 *  destUnitName). One predicate: the `[removed: …]` annotation here and
 *  `[PURGE]`'s "already annotated on the cast line" skip (triage F-P1). */
export const PURGE_MATCH_TOLERANCE_SECONDS = 0.05;
export function purgeMatchesCast(
  purge: {
    targetName: string;
    timeSeconds: number;
    dispelSpellId?: string;
  },
  cast: {
    destUnitName?: string | null;
    timeSeconds: number;
    spellId?: string | null;
  },
): boolean {
  // and the cast must be the dispel itself when both ids are known: a Holy
  // Fire landing on the same target in the same 50 ms read
  // "[removed: Hot Streak!]" (5677ba13 1:08) once every removal was annotated
  // (F-P3). Names, not ids: a talent / rank variant may log another id —
  // but only a RESOLVED name can make two different ids the same spell
  // (codex review: two ids missing from the name table both read "").
  if (
    purge.dispelSpellId &&
    cast.spellId &&
    purge.dispelSpellId !== cast.spellId
  ) {
    const dispelName = getEnglishSpellName(purge.dispelSpellId, "");
    if (
      dispelName === "" ||
      dispelName !== getEnglishSpellName(cast.spellId, "")
    )
      return false;
  }
  return (
    purge.targetName === cast.destUnitName &&
    Math.abs(purge.timeSeconds - cast.timeSeconds) <=
      PURGE_MATCH_TOLERANCE_SECONDS
  );
}

/** The removals ONE purge press made on one target: the same source (and
 *  pet-or-not, when the press says), and `purgeMatchesCast` against the press's target, instant
 *  and dispel spell. F20 D31: one predicate for "how many buffs that press
 *  took" — the owner cast line's `[removed: … — k of N on the target]` and
 *  `[PURGE]`'s `(k of N purgeable buffs on it)`, which printed 1 for every
 *  removal (Greater Purge / Fire Breath remove 2). Every removal counts,
 *  the low-priority ones `[PURGE]` folds away included. */
export function purgePressRemovals<
  T extends {
    sourceName: string;
    isPetDispel?: boolean;
    targetName: string;
    timeSeconds: number;
    dispelSpellId?: string;
  },
>(
  purges: readonly T[],
  press: {
    sourceName: string;
    isPetDispel?: boolean;
    destUnitName?: string | null;
    timeSeconds: number;
    spellId?: string | null;
  },
): T[] {
  return purges.filter(
    (p) =>
      p.sourceName === press.sourceName &&
      (press.isPetDispel === undefined ||
        !!p.isPetDispel === press.isPetDispel) &&
      purgeMatchesCast(p, press),
  );
}

/** `k` of `k of N purgeable buffs`: how many of the purgeable buffs N
 *  counts (`isPurgeableMagicBuff`, N's own predicate) one press took from
 *  its target — `purgePressRemovals`' rows, at most the tool's DB2 per-target
 *  count (`PURGE_REMOVALS_PER_TARGET`, when every row's tool has one), at
 *  least 1. F20 wide residual (2026-10-29): a Tranquilizing Shot that took an
 *  Enrage with the Magic buff printed `2 of 1`; Improved Spellsteal's delayed
 *  repeat of the previous press, landing 10–14 ms after the next press's own
 *  steal, printed that press as `2 of N`. */
export function purgePressRemovalCount(
  removals: readonly { removedSpellId: string; dispelSpellId?: string }[],
): number {
  // distinct buffs, as N counts them (`purgeableBuffCountAt`'s id set):
  // a repeated removal row of one buff is one buff (codex F20-27)
  const counted = new Set(
    removals
      .filter((r) => isPurgeableMagicBuff(r.removedSpellId))
      .map((r) => r.removedSpellId),
  ).size;
  const caps = removals.map((r) =>
    r.dispelSpellId === undefined
      ? undefined
      : PURGE_REMOVALS_PER_TARGET[r.dispelSpellId],
  );
  const cap = caps.every((c): c is number => c !== undefined)
    ? Math.max(...caps)
    : Infinity;
  return Math.max(1, Math.min(cap, counted));
}

export function emitHealerCastGapFillerEntries(
  ctx: Pick<
    TimelineCtx,
    | "ownerCDs"
    | "matchStartMs"
    | "ccTrinketSummaries"
    | "owner"
    | "dispelSummary"
    | "addEntry"
    | "friendlyDeaths"
    | "_allUnits"
    | "resolveTarget"
    | "ownerEmpowerTag"
    | "findAndConsumeAoeCC"
    | "formatAoeTargetPart"
    | "ownerCcImmuneTag"
    | "ownerCcMissTag"
    | "ownerNoCcAuraTag"
    | "requestSnapshotPlaceholder"
    | "getCDTargetAndVelocityPart"
    | "manaCooldownNote"
    | "groundingAbsorbNote"
    | "ownerHardCcTagAt"
    | "criticalWindowSet"
    | "crisisUnfoldWindows"
    | "roundEndAtMs"
  >,
): void {
  const {
    ownerCDs,
    matchStartMs,
    ccTrinketSummaries,
    owner,
    dispelSummary,
    addEntry,
    friendlyDeaths,
    _allUnits,
    resolveTarget,
    ownerEmpowerTag,
    findAndConsumeAoeCC,
    formatAoeTargetPart,
    ownerCcImmuneTag,
    ownerCcMissTag,
    ownerNoCcAuraTag,
    requestSnapshotPlaceholder,
    getCDTargetAndVelocityPart,
    manaCooldownNote,
    groundingAbsorbNote,
    ownerHardCcTagAt,
    criticalWindowSet,
    crisisUnfoldWindows,
    roundEndAtMs,
  } = ctx;
  // fact3 D11 (12d734cd r0): a cast after the round's end — the next Solo
  // Shuffle round's preparation — is no cast of this round ("Echo x31 over
  // 140s" counted one at 2:21, after the deciding death at 2:15)
  const inRound = (e: { logLine: { timestamp: number } }) =>
    e.logLine.timestamp <= roundEndAtMs;

  const trackedCastsBySpellId = new Map<string, Set<number>>();
  for (const cd of ownerCDs) {
    trackedCastsBySpellId.set(
      cd.spellId,
      new Set(
        cd.casts.map((c) => matchStartMs + Math.round(c.timeSeconds * 1000)),
      ),
    );
  }
  // the OWNER's trinket presses — a cast row of the owner's at one of them
  // is that press; a teammate's trinket in the same second is no reason to
  // drop the owner's cast (codex 60-POSTHOC-05a #2: a teammate's Medallion
  // at 0:20 removed the owner's Dispel Magic there, and the PURGE row went
  // with it)
  const trinketUseTimesMs = new Set(
    ccTrinketSummaries
      .filter((s) => s.playerName === owner.name)
      .flatMap((s) =>
        s.trinketUseTimes.map((t) => Math.round(matchStartMs + t * 1000)),
      ),
  );

  // F68/B32: flat list of CC events targeting the owner only (not teammates).
  // B32 fix: restrict disambiguation annotations to CCs that hit the caster,
  // not CCs that hit teammates at a similar timestamp.
  const ownerCCMsTimestamps: number[] = ccTrinketSummaries
    .filter((s) => s.playerName === owner.name)
    .flatMap((s) =>
      s.ccInstances.map((cc) => Math.round(matchStartMs + cc.atSeconds * 1000)),
    );
  /** each owner CC's landing → its end (ms) */
  const ownerCCEndMs = new Map<number, number>(
    ccTrinketSummaries
      .filter((s) => s.playerName === owner.name)
      .flatMap((s) =>
        s.ccInstances.map(
          (cc) =>
            [
              Math.round(matchStartMs + cc.atSeconds * 1000),
              Math.round(
                matchStartMs + (cc.atSeconds + cc.durationSeconds) * 1000,
              ),
            ] as [number, number],
        ),
      ),
  );

  /** Seconds a channel ran before an owner CC cut it, or null (F-O14). The
   * channel is `channelSpans`'s span of this cast — the one reading of where
   * a channel starts and ends (predicate-index, 2026-10-01 entry: this
   * reader paired its aura within ±250 ms where channelSpans took
   * [−1, +100], and kept its own re-cast rules). A span a re-cast took over
   * was cut by that re-cast, not by a control (fact4 D69, ecfb3a7f 2:19). */
  const ownerChannels = channelSpans(owner);
  const channelCutByCc = (spellId: string, castMs: number): number | null => {
    const span = ownerChannels.find(
      (s) => s.spellId === spellId && s.castMs === castMs,
    );
    if (!span || span.endedBy === "recast") return null;
    // the one channel-cut predicate (`landingCutChannel`, FT-T08 step 5)
    const cutBy = ownerCCMsTimestamps.some((ccMs) =>
      landingCutChannel(ccMs, castMs, span.endMs),
    );
    return cutBy ? (span.endMs - castMs) / 1000 : null;
  };

  // F159: Track owner's successful offensive purges. Every removal is
  // annotated (triage missed-cleanse F-P3, ruling A18 2026-09-30): the old
  // Critical/High filter (F163) left a Low/Medium removal nowhere but a count.
  const ownerPurges = dispelSummary.ourPurges.filter(
    (p) => p.sourceName === owner.name,
  );

  const seenCasts: Array<{
    name: string;
    target: string;
    timeSeconds: number;
  }> = [];

  let activeFold: {
    displayName: string;
    targetLabel: string;
    startTimeSeconds: number;
    count: number;
  } | null = null;

  const flushFold = () => {
    if (!activeFold) return;
    const { displayName, targetLabel, startTimeSeconds, count } = activeFold;
    const targetPart = targetLabel ? ` → ${targetLabel}` : "";
    const countPart = count > 1 ? ` (x${count})` : "";
    addEntry(
      startTimeSeconds,
      `${fmtTime(startTimeSeconds)}  [YOU] [CAST]   ${displayName}${countPart}${targetPart}`,
    );
    activeFold = null;
  };

  // T-noise A/B (2026-07-15): high-frequency filler casts (Soothing Mist,
  // Crackling Jade Lightning, …) dominated template-duplicate lines corpus-
  // wide (42% of all lines). Spells cast ≥ SPAM_FOLD_THRESHOLD times fold
  // into windowed run-lines that survive interleaved entries and critical
  // windows (entries are time-sorted at assembly, so a fold line emitted at
  // its start second renders chronologically).
  const SPAM_FOLD_THRESHOLD = 12;
  const SPAM_FOLD_MAX_GAP_SECONDS = 30;
  // GH #97: friendly-death windows (death − DEATH_WINDOW_S … death) where
  // the spam fold steps aside, the per-window unfold budget, and the
  // target-HP tag a per-cast line carries — the [STATE] tick's sampler at
  // the rendered second, exactly what getCDTargetAndVelocityPart queries.
  const deathWindows = friendlyDeaths
    .map((d) => ({
      fromSeconds: Math.max(0, d.atSeconds - DEATH_WINDOW_S),
      toSeconds: d.atSeconds,
    }))
    .sort((a, b) => a.fromSeconds - b.fromSeconds);
  const deathWindowAt = (t: number) =>
    deathWindows.find((w) => t >= w.fromSeconds && t <= w.toSeconds) ?? null;
  const deathWindowUnfolded = new Map<(typeof deathWindows)[number], number>();
  // Triage 2026-09-29 H19: a cd-hoarded window ([t, t + 5 s] on a crisis
  // point) keeps the owner's casts ON THAT UNIT unfolded, with the death
  // window's per-window budget — b711d4ac's Swiftmend / Rejuvenation /
  // Regrowth on the crisis unit read "(x8 over 104s) → various".
  const crisisWindowFor = (t: number, destUnitName: string | undefined) =>
    destUnitName
      ? (crisisUnfoldWindows.find(
          (w) =>
            w.unitName === destUnitName &&
            t >= w.fromSeconds &&
            t <= w.toSeconds,
        ) ?? null)
      : null;
  const crisisWindowUnfolded = new Map<
    (typeof crisisUnfoldWindows)[number],
    number
  >();
  // A cast of a spam-folded spell printed on its own line: the running fold
  // counts it as printed — or a new fold starts from it when none runs
  // (fact1215 R11, codex 20-F15-32). One rule for every branch that prints
  // such a cast, so the fold's `xN` is every cast in its span.
  const countPrintedInFold = (
    displayName: string,
    timeSeconds: number,
    targetLabel: string | undefined,
  ) => {
    const f = spamFolds.get(displayName);
    if (f && timeSeconds - f.lastTimeSeconds <= SPAM_FOLD_MAX_GAP_SECONDS) {
      f.count++;
      f.printed++;
      f.lastTimeSeconds = timeSeconds;
      if (targetLabel) f.targets.add(targetLabel);
    } else {
      flushSpamFold(displayName);
      spamFolds.set(displayName, {
        startTimeSeconds: timeSeconds,
        lastTimeSeconds: timeSeconds,
        count: 1,
        printed: 1,
        targets: new Set(targetLabel ? [targetLabel] : []),
      });
    }
  };
  const takeCrisisUnfold = (t: number, destUnitName: string | undefined) => {
    const w = crisisWindowFor(t, destUnitName);
    if (!w) return false;
    const n = crisisWindowUnfolded.get(w) ?? 0;
    if (n >= DEATH_WINDOW_UNFOLD_CAP) return false;
    crisisWindowUnfolded.set(w, n + 1);
    return true;
  };
  // HP at the press (`hpAtPress`, ruling A21 / hp-state F-R8), like the
  // [YOU] [CD] lines: the cast event supplies the press ms and the spell /
  // caster whose own heal must not be read back as "HP at the press".
  const castTargetHpTag = (e: {
    destUnitName?: string;
    spellId?: string | null;
    timestamp: number;
  }): string => {
    const destUnitName = e.destUnitName;
    const isSelf =
      !destUnitName ||
      destUnitName === "nil" ||
      destUnitName === owner.name ||
      destUnitName.split("-")[0] === owner.name.split("-")[0];
    const unit = isSelf
      ? owner
      : _allUnits.find((u) => u.name === destUnitName);
    if (!unit) return "";
    const hp = hpAtPress(unit, e.timestamp, {
      spellId: e.spellId ?? "",
      srcUnitId: owner.id,
    });
    return hp === null ? "" : ` (${hp}% HP)`;
  };

  const ownerCastCountByName = new Map<string, number>();
  for (const e of owner.spellCastEvents ?? []) {
    if (e.logLine.event !== LogEvent.SPELL_CAST_SUCCESS || !e.spellId) continue;
    if (!inRound(e)) continue;
    const n =
      HEALER_CAST_SPELL_ID_TO_NAME[e.spellId] ??
      getEnglishSpellName(e.spellId, e.spellName);
    if (!n) continue;
    ownerCastCountByName.set(n, (ownerCastCountByName.get(n) ?? 0) + 1);
  }
  const UNNAMED_FOLD_TARGET = "\u0000unnamed:";
  const spamFolds = new Map<
    string,
    {
      startTimeSeconds: number;
      lastTimeSeconds: number;
      count: number;
      /** of `count`, the casts printed one by one (the death window) */
      printed: number;
      targets: Set<string>;
    }
  >();
  const flushSpamFold = (displayName: string) => {
    const f = spamFolds.get(displayName);
    if (!f) return;
    spamFolds.delete(displayName);
    // every cast of it already has its own line: the fold adds nothing
    if (f.printed === f.count) return;
    // one target the fold can name → it; several → "various"; only units
    // the label cannot name → no target
    const target =
      f.targets.size > 1
        ? "various"
        : f.targets.size === 1 &&
            !([...f.targets][0] ?? "").startsWith(UNNAMED_FOLD_TARGET)
          ? [...f.targets][0]
          : "";
    const targetPart = target ? ` → ${target}` : "";
    const spanSeconds = Math.round(f.lastTimeSeconds - f.startTimeSeconds);
    const countPart =
      f.count > 1
        ? ` (x${f.count}${spanSeconds > 0 ? ` over ${spanSeconds}s` : ""})`
        : "";
    addEntry(
      f.startTimeSeconds,
      `${fmtTime(f.startTimeSeconds)}  [YOU] [CAST]   ${displayName}${countPart}${targetPart}`,
    );
  };

  // T-noise A/B (2026-07-15): channeled CDs re-fire SPELL_CAST_SUCCESS per
  // tick under a different spellId but the same name (Divine Hymn 0:49 +
  // 0:50 + 0:51 …). The [CD] line already states the channel span, so tick
  // [CAST] lines are pure duplication — suppress same-name casts within a
  // short window after a tracked-CD cast (≥30s CDs cannot genuinely recast
  // that fast).
  const CHANNEL_TICK_SUPPRESS_SECONDS = 10;
  const trackedCastTimesByName = new Map<string, number[]>();
  for (const [spellId, times] of trackedCastsBySpellId) {
    const n = getEnglishSpellName(spellId, undefined);
    if (!n) continue;
    const arr = trackedCastTimesByName.get(n) ?? [];
    for (const t of times) arr.push((t - matchStartMs) / 1000);
    trackedCastTimesByName.set(n, arr);
  }

  for (const e of owner.spellCastEvents ?? []) {
    if (e.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
    if (!e.spellId) continue;
    if (!inRound(e)) continue;
    const englishName = getEnglishSpellName(e.spellId, e.spellName);
    if (isPassiveProcCast(e)) continue;
    // #36(a): echo copies / set procs / channel ticks under their own id are
    // not presses; rendering them doubles the apparent APM of the specs that
    // have them (Preservation Evoker nearly 2×).
    if (COPY_CAST_IDS.has(e.spellId)) continue;
    // a companion row of another press (Germination's 774, fact4 D47)
    if (isCompanionCastRow(e, owner.spellCastEvents ?? [])) continue;

    const displayName = HEALER_CAST_SPELL_ID_TO_NAME[e.spellId] ?? englishName;
    if (!displayName) continue;
    const tsMs = e.logLine.timestamp;
    const trackedSet = trackedCastsBySpellId.get(e.spellId);
    if (
      trackedSet &&
      (trackedSet.has(tsMs) ||
        trackedSet.has(tsMs - 1000) ||
        trackedSet.has(tsMs + 1000))
    )
      continue;
    // BACKLOG #40: skin-variant cast ids (Hex casts as 210873 while the
    // ledger tracks the base id) slip through the id-keyed suppression
    // above, so the same press rendered twice — once as the ledger's
    // [YOU] [CD]/[CC] line, once here. Same displayName within ±1s of ANY
    // ledger cast is that duplicate: two genuine same-name presses cannot
    // fit inside one GCD. Found by the #3 value-gate examples (2026-08-23).
    const ledgerNameTimes = trackedCastTimesByName.get(displayName);
    if (
      ledgerNameTimes &&
      ledgerNameTimes.some(
        (t) => Math.abs(t - (tsMs - matchStartMs) / 1000) <= 1,
      )
    )
      continue;
    if (
      trinketUseTimesMs.has(tsMs) ||
      trinketUseTimesMs.has(tsMs - 1000) ||
      trinketUseTimesMs.has(tsMs + 1000)
    )
      continue;
    const timeSeconds = (tsMs - matchStartMs) / 1000;

    // Channel-tick suppression: same-name success within 10s after a
    // tracked-CD cast is a channel tick (different spellId, so the ±1s
    // trackedSet check above misses it); the [CD] line already carries the
    // channel span.
    const trackedTimes = trackedCastTimesByName.get(displayName);
    if (
      trackedTimes?.some(
        (t) =>
          timeSeconds - t > 0 &&
          timeSeconds - t <= CHANNEL_TICK_SUPPRESS_SECONDS,
      )
    )
      continue;

    // A cast made while Stasis was storing went out and healed: Stasis
    // stores a COPY, replayed at the release (F16 retest idx 10, 06474ef2
    // 0:28: the Echo aura applied in the cast's own ms). It renders here like
    // any other press; the [STASIS RELEASE] line names the copies.

    // F68/F89/B32: find nearest CC *on the owner* within 1s — annotate ordering
    // so Claude knows the cast completed before or after incoming CC.
    // B32: only match CCs targeting the log owner, not teammates.
    const CC_PROXIMITY_MS = 1000;
    let nearestCC: number | undefined;
    let minDiff = Infinity;
    for (const ccMs of ownerCCMsTimestamps) {
      const diff = Math.abs(ccMs - tsMs);
      // fact3 D1 (02b930cd 0:48): a cast after the CC had already ended
      // (Execute broke the Fear 0.26 s before the Reversion) is not one
      // that "succeeded after CC arrived"
      if (tsMs > (ownerCCEndMs.get(ccMs) ?? Infinity)) continue;
      if (diff <= CC_PROXIMITY_MS && diff < minDiff) {
        minDiff = diff;
        nearestCC = ccMs;
      }
    }
    let orderNote = "";
    // Triage other F-O14: a CHANNEL the CC cut. SPELL_CAST_SUCCESS fires at
    // the channel's start, so "[cast succeeded before CC landed]" said nothing
    // about a Mana Tea that Hammer of Justice ended after 0.76 s (7f67e778:
    // aura 363.771, stun 364.498, aura removed 364.531). Evidence, all from
    // the log: the spell is a channel (official table — an instant self-buff
    // dropping right after a CC is not a cut channel), it put its own aura on
    // the owner at the cast, and that aura went right as a CC landed on the
    // owner (`landingCutChannel`, shared with the [YOU] [CD] channel suffix).
    const cut = e.spellId ? channelCutByCc(e.spellId, tsMs) : null;
    if (cut !== null) {
      orderNote = ` [channel cut by CC after ${fmtFactNum(cut)}s]`;
    } else if (nearestCC !== undefined) {
      if (tsMs < nearestCC) {
        // "succeeded", not "completed": SPELL_CAST_SUCCESS fires at channel
        // START for channeled spells, so a channel broken by this very CC
        // carried both "[completed before CC landed]" and "interrupted at
        // 0.1s" — a direct self-contradiction at pivotal moments (invariant
        // sweep I3, flagged independently by 4+ blind judges).
        orderNote = " [cast succeeded before CC landed]";
      } else if (tsMs > nearestCC) {
        orderNote = " [succeeded after CC arrived — within 1s in log]";
      } else {
        orderNote = " [same server tick as CC — cast succeeded per log]";
      }
    }

    const targetLabel = resolveTarget(e.destUnitName);
    // the spam fold's target: the label, or — for a real destination the
    // label cannot name (a pet with a non-ASCII name) — a key that makes
    // the fold say "various" rather than claim every cast went to the one
    // named target (fact3 D21: `Provoke (x12) → 5`, 10 of 12 on an Imp)
    const foldTarget =
      targetLabel ||
      (e.destUnitId && !/^0+$/.test(e.destUnitId)
        ? `${UNNAMED_FOLD_TARGET}${e.destUnitId}`
        : undefined);

    // B21: Dedup same-target, same-name casts within a 0.5s sliding window
    // Prevents arbitrary second-flooring boundaries (Math.floor) from over-collapsing or under-collapsing.
    const isDuplicate = seenCasts.some(
      (c) =>
        c.name === displayName &&
        c.target === targetLabel &&
        Math.abs(c.timeSeconds - timeSeconds) <= 0.5,
    );
    if (isDuplicate) continue;

    seenCasts.push({ name: displayName, target: targetLabel, timeSeconds });

    const targetPart = targetLabel ? ` → ${targetLabel}` : "";
    const destType = getUnitType(e.destUnitFlags ?? 0);
    let totemNote = "";
    if (
      (destType === CombatUnitType.Guardian ||
        destType === CombatUnitType.Pet) &&
      // a Mind-Controlled player carries the PET flag (W1d, 7b3c556e)
      !isControlledPlayerFlags(e.destUnitId, e.destUnitFlags)
    ) {
      // B44: distinguish Grounding Totem absorption (wasted cast) from other totem/pet
      // targets. Detect by npcId from the dest GUID (locale-independent — the unit NAME
      // is client-localized and the English substring check misses on non-EN logs),
      // keeping the name check as fallback for GUID-less events.
      const destIsGroundingTotem = isGroundingTotemTarget(
        e.destUnitId,
        e.destUnitName,
      );
      totemNote = destIsGroundingTotem
        ? " [absorbed: Grounding Totem]"
        : " [totem/pet]";
    }

    // F159 / M-i: Annotate offensive-purge casts with the removed buff.
    // The old ±0.5s proximity window was too loose: two distinct purges landing within
    // half a second of each other could cross-attach (a cast annotated with the OTHER
    // purge's removed buff, or both buffs joined onto both casts). Mirror the B11 fix in
    // dispelAnalysis.wasRemovedByAllyDispel — tighten to a 50ms window AND key the match
    // on the cast target (raw destUnitName) so only the buff removed at essentially the
    // same instant on the same target is attached. join(', ') then only fires when one
    // cast genuinely removed multiple buffs at once.
    let purgeNote = "";
    const matchingPurges = purgePressRemovals(ownerPurges, {
      sourceName: owner.name,
      destUnitName: e.destUnitName,
      timeSeconds,
      spellId: e.spellId,
    });
    if (matchingPurges.length > 0) {
      const removedNames = matchingPurges
        .map((p) => getEnglishSpellName(p.removedSpellId, p.removedSpellName))
        .join(", ");
      // B13e: how many purgeable buffs the target carried (one cast, one
      // target — the removals share the count)
      const onTarget = matchingPurges.find(
        (p) => p.purgeableOnTarget !== undefined,
      )?.purgeableOnTarget;
      const countNote =
        onTarget !== undefined
          ? ` — ${purgePressRemovalCount(matchingPurges)} of ${purgeableCountText(onTarget)} on the target`
          : "";
      purgeNote = ` [removed: ${removedNames}${countNote}]`;
    }

    const empowerNote = ownerEmpowerTag(e.spellId, timeSeconds);

    // F95: Offensive CC casts should carry a CC annotation or use an [YOU] [CC] prefix.
    if (isControlCast(e.spellId)) {
      flushFold();
      let effectiveTargetPart = targetPart;
      // enemy-def F-E26: the units this line names, for the IMMUNE tag (the
      // same wiring as the cooldown-ledger emitter, codex 35-CD-07)
      const named = new Set<string>(
        e.destUnitName && e.destUnitName !== "nil" ? [e.destUnitName] : [],
      );
      if (e.destUnitId) named.add(e.destUnitId);
      const matchingAoe = findAndConsumeAoeCC(
        timeSeconds,
        owner.name,
        displayName,
        true,
        AOE_CC_LANDING_WINDOW_S[e.spellId] ?? undefined,
      );
      if (matchingAoe) {
        effectiveTargetPart = formatAoeTargetPart(matchingAoe, targetPart);
        for (const t of matchingAoe.targets) named.add(t.name);
      }
      // cc-dr F-NE1: no aura and no miss on the aimed target
      const failTags =
        ownerCcImmuneTag(e.spellId, timeSeconds, named) +
        ownerCcMissTag(e.spellId, timeSeconds);
      const ccNote = failTags || ownerNoCcAuraTag(e.spellId, timeSeconds);
      addEntry(
        timeSeconds,
        `${fmtTime(timeSeconds)}  [YOU] [CC]   ${displayName}${effectiveTargetPart}${totemNote}${orderNote}${purgeNote}${ccNote}`,
        requestSnapshotPlaceholder(timeSeconds),
      );
      continue;
    }

    // B38: promote major-CD spells (CD ≥ 30s) to [YOU] [CD] format when extractMajorCooldowns
    // missed them (e.g. missing talent data). This keeps Avenging Crusader etc. from appearing
    // as filler casts when they are significant cooldown activations.
    // F11: a shift back into Tree of Life form while Incarnation runs is a
    // cast of the cooldown's id and no press of it (`isFormReshiftCast`) —
    // it stays a [YOU] [CAST] line, like any other form shift.
    const cdSeconds = effectiveCooldownSeconds(e.spellId) ?? 0;
    if (cdSeconds >= 30 && !isFormReshiftCast(owner, e)) {
      flushFold();
      // B112/B127: apply the same self-only override here (this promotion path is where MW/Evoker
      // throughput CDs render). B113/B130: append the role tag so the model does not invent mechanics.
      // F15 C1 / fact2 C1: a press whose copy the log shows on an ally is
      // that ally's, whatever unit the cast's dest named
      const promotedCopy = allyCopyRecipient(owner.id, e, _allUnits);
      const promotedTargetPart = getCDTargetAndVelocityPart(
        e.spellId,
        timeSeconds,
        promotedCopy?.name ?? e.destUnitName,
        rendersOnCaster(e.spellId) && !promotedCopy,
      );
      const promotedRole = cdRoleTag(e.spellId);
      const promotedDisplayName = promotedRole
        ? `${displayName} [${promotedRole}]`
        : displayName;
      const promotedManaNote = manaCooldownNote(
        e.spellId,
        timeSeconds,
        e.destUnitName,
      );
      // Grounding Totem is normally ABSENT from extractMajorCooldowns, so
      // production renders it HERE, not in the ownerCDs loop — the same trap
      // manaCooldownNote documents. Wired into the ledger loop only, the
      // note appeared on 0 of 374 owner Grounding casts (GH #100).
      const promotedGroundingNote = groundingAbsorbNote(
        e.spellId,
        displayName,
        owner.id,
        timeSeconds,
      );
      // round-1 retest idx 103 (fact2 605): the press refused by the unit
      // it was cast on — an IMMUNE row on that unit (a Holy Word: Serenity
      // into a Cycloned ally) — says so, as the ledger lines do
      // (`ccImmuneTagFor(…, onlyNamed)`)
      const promotedRefused =
        e.destUnitName && e.destUnitName !== "nil"
          ? ownerCcImmuneTag(
              e.spellId,
              timeSeconds,
              new Set([e.destUnitName]),
              true,
            )
          : "";
      addEntry(
        timeSeconds,
        `${fmtTime(timeSeconds)}  [YOU] [CD]   ${promotedDisplayName}${promotedTargetPart}${promotedRefused}${totemNote}${promotedGroundingNote}${purgeNote}${empowerNote}${ownerHardCcTagAt(timeSeconds)}`,
        // T3: delta form (same as the ownerCDs path; full snapshots are reserved
        // for death snapshots and the periodic 60s refresh)
        requestSnapshotPlaceholder(timeSeconds),
        ...(promotedManaNote ? [promotedManaNote] : []),
      );
      continue;
    }

    // F20 immunity residual (user ruling 2026-10-28): a plain cast the
    // unit it was cast on refused as IMMUNE carries the press lines' tag —
    // the same reading and wording as the promoted [YOU] [CD] line above
    // (s0/30-3 1:05 Holy Fire into Ice Block rendered bare). The tag is an
    // annotation: the cast prints on its own line, never inside a fold.
    const refusedNote =
      e.destUnitName && e.destUnitName !== "nil"
        ? ownerCcImmuneTag(
            e.spellId,
            timeSeconds,
            new Set([e.destUnitName]),
            true,
          )
        : "";
    const hasAnnotation =
      totemNote !== "" ||
      orderNote !== "" ||
      purgeNote !== "" ||
      empowerNote !== "" ||
      refusedNote !== "";

    // Spam-spell windowed fold: high-frequency fillers fold across
    // interleaved entries AND inside critical windows — per-cast lines for
    // a spell hit ≥12×/match carry no per-instance signal, only tokens.
    // Annotated casts still render individually (the annotation is the
    // signal) without breaking the running fold.
    //
    // GH #97 exception: inside a friendly-death window those per-instance
    // lines ARE the signal (which heal went where in the last seconds —
    // 18/50 Opus-baseline judges, 17/50 coach responses hedged "check the
    // VOD" there), so the fold steps aside for up to DEATH_WINDOW_UNFOLD_CAP
    // casts per window and each cast carries the target's HP at that
    // rendered second — the [STATE] sampler at toRenderSecond, the same
    // query the [YOU] [CD] line makes (class C stays pinned).
    const deathWindow =
      TIMELINE_LINE_FLAGS.deathWindowUnfold === "perCast"
        ? deathWindowAt(timeSeconds)
        : null;
    if (
      !hasAnnotation &&
      (ownerCastCountByName.get(displayName) ?? 0) >= SPAM_FOLD_THRESHOLD &&
      deathWindow !== null &&
      (deathWindowUnfolded.get(deathWindow) ?? 0) < DEATH_WINDOW_UNFOLD_CAP
    ) {
      deathWindowUnfolded.set(
        deathWindow,
        (deathWindowUnfolded.get(deathWindow) ?? 0) + 1,
      );
      addEntry(
        timeSeconds,
        `${fmtTime(timeSeconds)}  [YOU] [CAST]   ${displayName}${targetPart}${castTargetHpTag(e)}`,
      );
      // … and a fold still counts it, as the legend says (fact1215 R11,
      // 09dda3c6 r3: 13 Penance casts, the fold said x10 and two printed per
      // cast in the death window were in no count) — the running one, or a
      // new one from here when there is none (codex 20-F15-32: after a gap
      // over 30 s three casts were in no count)
      countPrintedInFold(displayName, timeSeconds, foldTarget);
      continue;
    }
    // H19: the spam fold also steps aside for a cast on the crisis unit
    // inside a cd-hoarded window
    if (
      !hasAnnotation &&
      (ownerCastCountByName.get(displayName) ?? 0) >= SPAM_FOLD_THRESHOLD &&
      takeCrisisUnfold(timeSeconds, e.destUnitName)
    ) {
      addEntry(
        timeSeconds,
        `${fmtTime(timeSeconds)}  [YOU] [CAST]   ${displayName}${targetPart}`,
      );
      // the fold still counts it (F16 retest idx 22: Riptide x13 for 15)
      countPrintedInFold(displayName, timeSeconds, foldTarget);
      continue;
    }
    if (
      !hasAnnotation &&
      (ownerCastCountByName.get(displayName) ?? 0) >= SPAM_FOLD_THRESHOLD
    ) {
      const f = spamFolds.get(displayName);
      if (f && timeSeconds - f.lastTimeSeconds <= SPAM_FOLD_MAX_GAP_SECONDS) {
        f.count++;
        f.lastTimeSeconds = timeSeconds;
        if (foldTarget) f.targets.add(foldTarget);
      } else {
        flushSpamFold(displayName);
        spamFolds.set(displayName, {
          startTimeSeconds: timeSeconds,
          lastTimeSeconds: timeSeconds,
          count: 1,
          printed: 0,
          targets: new Set(foldTarget ? [foldTarget] : []),
        });
      }
      continue;
    }

    // F151 Repetitive Cast Folding:
    // Simple casts outside critical windows are foldable.
    const isFoldable =
      !hasAnnotation &&
      !criticalWindowSet.has(Math.floor(timeSeconds)) &&
      !takeCrisisUnfold(timeSeconds, e.destUnitName);

    if (isFoldable) {
      if (
        activeFold &&
        activeFold.displayName === displayName &&
        activeFold.targetLabel === targetLabel
      ) {
        activeFold.count++;
      } else {
        flushFold();
        activeFold = {
          displayName,
          targetLabel,
          startTimeSeconds: timeSeconds,
          count: 1,
        };
      }
    } else {
      flushFold();
      // GH #97: inside a friendly-death window every owner cast carries
      // the target's HP, not only the ones the spam fold released — a
      // half-annotated window reads as if the un-annotated casts hit a
      // full-HP target.
      const windowHpTag =
        TIMELINE_LINE_FLAGS.deathWindowUnfold === "perCast" &&
        deathWindowAt(timeSeconds) !== null
          ? castTargetHpTag(e)
          : "";
      addEntry(
        timeSeconds,
        `${fmtTime(timeSeconds)}  [YOU] [CAST]   ${displayName}${targetPart}${windowHpTag}${refusedNote}${totemNote}${orderNote}${purgeNote}${empowerNote}`,
      );
      // an annotated cast of a spam-folded spell prints on its own line and
      // the fold still counts it (F16 retest idx 22: 0deb726b's 1:08 Riptide
      // `[cast succeeded before CC landed]` was in no count)
      if ((ownerCastCountByName.get(displayName) ?? 0) >= SPAM_FOLD_THRESHOLD)
        countPrintedInFold(displayName, timeSeconds, foldTarget);
    }
  }

  // Flush any remaining active folds at loop end
  flushFold();
  for (const name of [...spamFolds.keys()]) flushSpamFold(name);

  // GH #97 cheap alternative to the per-cast unfold: one line per
  // friendly-death window with the owner's casts counted by spell and
  // target. Measured against "perCast" by the fact-retrieval probe; only
  // one of the two renders.
  if (TIMELINE_LINE_FLAGS.deathWindowUnfold === "summary") {
    for (const w of deathWindows) {
      const counts = new Map<string, number>();
      for (const e of owner.spellCastEvents ?? []) {
        if (e.logLine.event !== LogEvent.SPELL_CAST_SUCCESS || !e.spellId)
          continue;
        if (isPassiveProcCast(e)) continue;
        const t = (e.timestamp - matchStartMs) / 1000;
        if (t < w.fromSeconds || t > w.toSeconds) continue;
        const label = resolveTarget(e.destUnitName);
        const key = `${getEnglishSpellName(e.spellId, e.spellName)}${label ? ` → ${label}` : ""}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      if (counts.size === 0) continue;
      const parts = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => (n > 1 ? k.replace(/( → |$)/, ` ×${n}$1`) : k));
      addEntry(
        w.fromSeconds,
        `${fmtTime(w.fromSeconds)}–${fmtTime(w.toSeconds)}  [YOU] [HEALS]   ${parts.join(", ")}`,
      );
    }
  }
}
