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

import {
  effectiveCooldownSeconds,
  getEnglishSpellName,
} from "../../data/spellEffectData";
import { ccSpellIds } from "../../data/spellTags";
import {
  DEATH_WINDOW_S,
  DEATH_WINDOW_UNFOLD_CAP,
  TIMELINE_LINE_FLAGS,
} from "../../data/timelineLineFlags";
import { COPY_CAST_IDS } from "../../utils/castPress";
import { isControlledPlayerFlags } from "../../utils/charmedPlayer";
import {
  cdRoleTag,
  gridHpPct,
  isSelfOnlyDefensive,
} from "../../utils/cooldowns";
import { fmtTime, toRenderSecond } from "../../utils/renderGrid";
import {
  getNpcIdFromGuid,
  GROUNDING_TOTEM_NPC_ID,
  HEALER_CAST_SPELL_ID_TO_NAME,
  isPassiveProcCast,
} from "../timelineHelpers";
import type { TimelineCtx } from "./ctx";

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
    | "stasisEvents"
    | "resolveTarget"
    | "ownerEmpowerTag"
    | "findAndConsumeAoeCC"
    | "formatAoeTargetPart"
    | "ownerCcImmuneTag"
    | "ownerCcMissTag"
    | "requestSnapshotPlaceholder"
    | "getCDTargetAndVelocityPart"
    | "manaCooldownNote"
    | "groundingAbsorbNote"
    | "ownerHardCcTagAt"
    | "criticalWindowSet"
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
    stasisEvents,
    resolveTarget,
    ownerEmpowerTag,
    findAndConsumeAoeCC,
    formatAoeTargetPart,
    ownerCcImmuneTag,
    ownerCcMissTag,
    requestSnapshotPlaceholder,
    getCDTargetAndVelocityPart,
    manaCooldownNote,
    groundingAbsorbNote,
    ownerHardCcTagAt,
    criticalWindowSet,
  } = ctx;

  const trackedCastsBySpellId = new Map<string, Set<number>>();
  for (const cd of ownerCDs) {
    trackedCastsBySpellId.set(
      cd.spellId,
      new Set(
        cd.casts.map((c) => matchStartMs + Math.round(c.timeSeconds * 1000)),
      ),
    );
  }
  const trinketUseTimesMs = new Set(
    ccTrinketSummaries.flatMap((s) =>
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

  // F159: Track owner's successful offensive purges
  // F163: Filter out low/medium priority purges to de-noise the timeline
  const ownerPurges = dispelSummary.ourPurges.filter(
    (p) =>
      p.sourceName === owner.name &&
      (p.priority === "Critical" || p.priority === "High"),
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
  const castTargetHpTag = (
    destUnitName: string | undefined,
    rawTimeSeconds: number,
  ): string => {
    const isSelf =
      !destUnitName ||
      destUnitName === "nil" ||
      destUnitName === owner.name ||
      destUnitName.split("-")[0] === owner.name.split("-")[0];
    const unit = isSelf
      ? owner
      : _allUnits.find((u) => u.name === destUnitName);
    if (!unit) return "";
    const hp = gridHpPct(
      unit,
      matchStartMs + toRenderSecond(rawTimeSeconds) * 1000,
    );
    return hp === null ? "" : ` (${hp}% HP)`;
  };

  const ownerCastCountByName = new Map<string, number>();
  for (const e of owner.spellCastEvents ?? []) {
    if (e.logLine.event !== LogEvent.SPELL_CAST_SUCCESS || !e.spellId) continue;
    const n =
      HEALER_CAST_SPELL_ID_TO_NAME[e.spellId] ??
      getEnglishSpellName(e.spellId, e.spellName);
    if (!n) continue;
    ownerCastCountByName.set(n, (ownerCastCountByName.get(n) ?? 0) + 1);
  }
  const spamFolds = new Map<
    string,
    {
      startTimeSeconds: number;
      lastTimeSeconds: number;
      count: number;
      targets: Set<string>;
    }
  >();
  const flushSpamFold = (displayName: string) => {
    const f = spamFolds.get(displayName);
    if (!f) return;
    spamFolds.delete(displayName);
    const target =
      f.targets.size === 1
        ? [...f.targets][0]
        : f.targets.size > 1
          ? "various"
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
    const englishName = getEnglishSpellName(e.spellId, e.spellName);
    if (isPassiveProcCast(e)) continue;
    // #36(a): echo copies / set procs / channel ticks under their own id are
    // not presses; rendering them doubles the apparent APM of the specs that
    // have them (Preservation Evoker nearly 2×).
    if (COPY_CAST_IDS.has(e.spellId)) continue;

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

    const activeStasis = stasisEvents.find(
      (s) => timeSeconds >= s.startSeconds && timeSeconds < s.releaseSeconds,
    );
    // Suppress buffered heals — a stasis-stored cast renders at release, not here.
    if (activeStasis && activeStasis.spells.includes(displayName)) continue;

    // F68/F89/B32: find nearest CC *on the owner* within 1s — annotate ordering
    // so Claude knows the cast completed before or after incoming CC.
    // B32: only match CCs targeting the log owner, not teammates.
    const CC_PROXIMITY_MS = 1000;
    let nearestCC: number | undefined;
    let minDiff = Infinity;
    for (const ccMs of ownerCCMsTimestamps) {
      const diff = Math.abs(ccMs - tsMs);
      if (diff <= CC_PROXIMITY_MS && diff < minDiff) {
        minDiff = diff;
        nearestCC = ccMs;
      }
    }
    let orderNote = "";
    if (nearestCC !== undefined) {
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
      const destIsGroundingTotem =
        getNpcIdFromGuid(e.destUnitId ?? "") === GROUNDING_TOTEM_NPC_ID ||
        (e.destUnitName?.toLowerCase().includes("grounding totem") ?? false);
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
    const PURGE_MATCH_TOLERANCE_SECONDS = 0.05;
    let purgeNote = "";
    const matchingPurges = ownerPurges.filter(
      (p) =>
        p.targetName === e.destUnitName &&
        Math.abs(p.timeSeconds - timeSeconds) <= PURGE_MATCH_TOLERANCE_SECONDS,
    );
    if (matchingPurges.length > 0) {
      const removedNames = matchingPurges
        .map((p) => p.removedSpellName)
        .join(", ");
      purgeNote = ` [removed: ${removedNames}]`;
    }

    const empowerNote = ownerEmpowerTag(e.spellId, timeSeconds);

    // F95: Offensive CC casts should carry a CC annotation or use an [YOU] [CC] prefix.
    if (ccSpellIds.has(e.spellId)) {
      flushFold();
      let effectiveTargetPart = targetPart;
      const matchingAoe = findAndConsumeAoeCC(
        timeSeconds,
        owner.name,
        displayName,
        true,
      );
      if (matchingAoe) {
        effectiveTargetPart = formatAoeTargetPart(matchingAoe, targetPart);
      }
      addEntry(
        timeSeconds,
        `${fmtTime(timeSeconds)}  [YOU] [CC]   ${displayName}${effectiveTargetPart}${totemNote}${orderNote}${purgeNote}${ownerCcImmuneTag(e.spellId, timeSeconds)}${ownerCcMissTag(e.spellId, timeSeconds)}`,
        requestSnapshotPlaceholder(timeSeconds),
      );
      continue;
    }

    // B38: promote major-CD spells (CD ≥ 30s) to [YOU] [CD] format when extractMajorCooldowns
    // missed them (e.g. missing talent data). This keeps Avenging Crusader etc. from appearing
    // as filler casts when they are significant cooldown activations.
    const cdSeconds = effectiveCooldownSeconds(e.spellId) ?? 0;
    if (cdSeconds >= 30) {
      flushFold();
      // B112/B127: apply the same self-only override here (this promotion path is where MW/Evoker
      // throughput CDs render). B113/B130: append the role tag so the model does not invent mechanics.
      const promotedTargetPart = getCDTargetAndVelocityPart(
        e.spellId,
        timeSeconds,
        e.destUnitName,
        undefined,
        isSelfOnlyDefensive(e.spellId),
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
      addEntry(
        timeSeconds,
        `${fmtTime(timeSeconds)}  [YOU] [CD]   ${promotedDisplayName}${promotedTargetPart}${totemNote}${promotedGroundingNote}${purgeNote}${empowerNote}${ownerHardCcTagAt(timeSeconds)}`,
        // T3: delta form (same as the ownerCDs path; full snapshots are reserved
        // for death snapshots and the periodic 60s refresh)
        requestSnapshotPlaceholder(timeSeconds),
        ...(promotedManaNote ? [promotedManaNote] : []),
      );
      continue;
    }

    const hasAnnotation =
      totemNote !== "" ||
      orderNote !== "" ||
      purgeNote !== "" ||
      empowerNote !== "";

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
        `${fmtTime(timeSeconds)}  [YOU] [CAST]   ${displayName}${targetPart}${castTargetHpTag(e.destUnitName, timeSeconds)}`,
      );
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
        if (targetLabel) f.targets.add(targetLabel);
      } else {
        flushSpamFold(displayName);
        spamFolds.set(displayName, {
          startTimeSeconds: timeSeconds,
          lastTimeSeconds: timeSeconds,
          count: 1,
          targets: new Set(targetLabel ? [targetLabel] : []),
        });
      }
      continue;
    }

    // F151 Repetitive Cast Folding:
    // Simple casts outside critical windows are foldable.
    const isFoldable =
      !hasAnnotation && !criticalWindowSet.has(Math.floor(timeSeconds));

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
          ? castTargetHpTag(e.destUnitName, timeSeconds)
          : "";
      addEntry(
        timeSeconds,
        `${fmtTime(timeSeconds)}  [YOU] [CAST]   ${displayName}${targetPart}${windowHpTag}${totemNote}${orderNote}${purgeNote}${empowerNote}`,
      );
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
