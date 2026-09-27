/**
 * [YOU] [CD] — the owner's major cooldown presses (and proc-only activations
 * as [PROC]): target and HP, DR / immune / empower / Grounding / interrupt-risk
 * notes, the hard-CC tag, [HEALING] blocks for amplifier spells, and the snapshot
 * request that follows a cast. The setup it reads (healingEmissionTimes,
 * cdExpiryEvents, ownerCCSummary, ownerHardCcTagAt, the interrupt-immunity
 * windows) stays in buildMatchTimeline — later sections use it too.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. `procLinesEmitted` is threaded:
 * the caller passes its current value and assigns back the returned one. Output
 * is pinned by the 605-file acceptanceCapture context hash.
 */
import { ccSpellIds } from "../../data/spellTags";
import { buffFullDurationForCaster } from "../../utils/buffDuration";
import {
  cdIsProcOnly,
  cdRoleTag,
  findCheaperDefensiveAlternatives,
  type IDamageBucket,
  isSelfOnlyDefensive,
  isTeamHealCD,
  THROUGHPUT_EMPOWER_DEFENSIVE_IDS,
} from "../../utils/cooldowns";
import { getDampeningPercentage } from "../../utils/dampening";
import { computeEnemyInterruptAvailability } from "../../utils/enemyInterrupts";
import { fmtTime } from "../../utils/renderGrid";
import {
  CHANNELED_CD_SPELL_IDS,
  channelWasInterrupted,
  computeHealingInWindow,
  DMG_SPIKE_THRESHOLD,
  HEALING_AMPLIFIER_SPELL_IDS,
} from "../timelineHelpers";
import type { DeferredSnapshot } from "./ctx";
import type { TimelineCtx } from "./ctx";

export function emitOwnerCdEntries(
  ctx: Pick<
    TimelineCtx,
    | "ownerCDs"
    | "procLinesEmitted"
    | "getCDTargetAndVelocityPart"
    | "requestSnapshotPlaceholder"
    | "healingEmissionTimes"
    | "owner"
    | "matchStartMs"
    | "manaCooldownNote"
    | "findAndConsumeAoeCC"
    | "formatAoeTargetPart"
    | "outgoingDrTag"
    | "ownerCcImmuneTag"
    | "ownerCcMissTag"
    | "ownerEmpowerTag"
    | "groundingAbsorbNote"
    | "params"
    | "_allUnits"
    | "pressureWindows"
    | "pid"
    | "cdExpiryEvents"
    | "ownerCCSummary"
    | "enemies"
    | "ownerInterruptImmuneReasonAt"
    | "addEntry"
    | "ownerHardCcTagAt"
  >,
): Pick<TimelineCtx, "procLinesEmitted"> {
  const {
    ownerCDs,
    getCDTargetAndVelocityPart,
    requestSnapshotPlaceholder,
    healingEmissionTimes,
    owner,
    matchStartMs,
    manaCooldownNote,
    findAndConsumeAoeCC,
    formatAoeTargetPart,
    outgoingDrTag,
    ownerCcImmuneTag,
    ownerCcMissTag,
    ownerEmpowerTag,
    groundingAbsorbNote,
    params,
    _allUnits,
    pressureWindows,
    pid,
    cdExpiryEvents,
    ownerCCSummary,
    enemies,
    ownerInterruptImmuneReasonAt,
    addEntry,
    ownerHardCcTagAt,
  } = ctx;
  // threaded: read from ctx, returned to the caller (GH #116)
  let { procLinesEmitted } = ctx;

  for (const cd of ownerCDs) {
    // B112/B127: a big personal defensive that cannot be cast on an ally is self-only — force (self)
    // rendering so a self-buff (e.g. Obsidian Scales) logged against the caster's current enemy/ally
    // target is not shown as "→ <unit>" with that unit's HP.
    const forceSelf = isSelfOnlyDefensive(cd.spellId);
    // Reliability round 3 N5 (02c8 / ba8c / 3306): a proc-only entry (Renewing
    // Blaze — structurally cast-less; a talent-replaced button) keeps its aura
    // activations in `casts`, and this loop read them as presses: "[YOU] [CD]
    // Renewing Blaze … cheaper available: Time Dilation", "[while stunned]".
    // The activation stays a timeline fact under [PROC]; every press-only
    // judgement (cheaper alternative, [UNNECESSARY], CC tag, [HEALING]) is off.
    const isProc = cdIsProcOnly(cd);
    if (isProc) procLinesEmitted = true;
    for (const cast of cd.casts) {
      const targetPart = getCDTargetAndVelocityPart(
        cd.spellId,
        cast.timeSeconds,
        cast.targetName,
        cast.targetHpPct,
        forceSelf,
      );

      const isCC = ccSpellIds.has(cd.spellId);
      const extraLines: (string | DeferredSnapshot)[] = [
        // T3: delta form (non-CC used to force a full snapshot, the main source of
        // [RES] tokens; full snapshots are reserved for death snapshots and the
        // periodic 60s refresh)
        requestSnapshotPlaceholder(cast.timeSeconds),
      ];

      if (
        HEALING_AMPLIFIER_SPELL_IDS.has(cd.spellId) &&
        healingEmissionTimes.get(cd.spellId)?.has(cast.timeSeconds)
      ) {
        const duration = buffFullDurationForCaster(cd.spellId, owner);
        if (duration) {
          const fromMs = matchStartMs + cast.timeSeconds * 1000;
          const toMs = fromMs + duration * 1000;
          const healStats = computeHealingInWindow(owner.healOut, fromMs, toMs);
          if (healStats) {
            const bucketParts = healStats.buckets.map(
              (b) =>
                `${b.fromSeconds}–${b.toSeconds}s: ${(b.hps / 1000).toFixed(1)}k HPS`,
            );
            extraLines.push(
              `      [HEALING]    ${bucketParts.join(" | ")} | Overheal: ${healStats.overhealPct}%`,
            );
          } else {
            extraLines.push(
              `      [HEALING]    No healing logged during this window`,
            );
          }
        }
      }

      const manaNote = manaCooldownNote(
        cd.spellId,
        cast.timeSeconds,
        cast.targetName,
      );
      if (manaNote) extraLines.push(manaNote);

      const prefix = isProc
        ? "[YOU] [PROC]"
        : ccSpellIds.has(cd.spellId)
          ? "[YOU] [CC]"
          : "[YOU] [CD]";
      let effectiveTargetPart = targetPart;
      if (isCC) {
        const matchingAoe = findAndConsumeAoeCC(
          cast.timeSeconds,
          owner.name,
          cd.spellName,
          true,
        );
        if (matchingAoe) {
          effectiveTargetPart = formatAoeTargetPart(matchingAoe, targetPart);
        }
      }
      // Class F (2026-07-20 eval): [CC ON TEAM] carries [DR: category level]
      // while CC the player casts did not — an asymmetric information gap that
      // led the model to transfer the semantics of enemy lines onto its own.
      // Outgoing DR is already computed (drInfo on outgoingCCChains); align the
      // rendering here.
      const outgoingDrNote = isCC ? outgoingDrTag(cd.spellId, cast) : "";
      const immuneNote = isCC
        ? ownerCcImmuneTag(cd.spellId, cast.timeSeconds) +
          ownerCcMissTag(cd.spellId, cast.timeSeconds)
        : "";
      const empowerNote = ownerEmpowerTag(cd.spellId, cast.timeSeconds);
      const groundingNote = groundingAbsorbNote(
        cd.spellId,
        cd.spellName,
        owner.id,
        cast.timeSeconds,
      );

      // 17c: surface the Unnecessary defensive-timing tier (17a) on the timeline cast line —
      // the legacy SUPPORTING DATA/COOLDOWN USAGE branch already rendered this, but that branch
      // is dead in production (useTimelinePrompt is hardcoded true). Single-source
      // predicate: consume the timingLabel/timingContext that annotateDefensiveTimings
      // already computed and attached to this very cast object — do not re-judge,
      // re-sample, or recompute the burst-window distance. Every time value inside
      // timingContext is already text rendered by annotateDefensiveTimings via
      // fmtTime, so pass it through verbatim.
      const unnecessaryNote =
        !isProc && cast.timingLabel === "Unnecessary" && cast.timingContext
          ? ` [UNNECESSARY — ${cast.timingContext}]`
          : "";

      let dampeningNote = "";
      if (!isCC) {
        dampeningNote = ` | dampening: ${getDampeningPercentage(params.bracket ?? "3v3", _allUnits, matchStartMs + cast.timeSeconds * 1000)}%`;
        // pressureWindows is sorted by totalDamage descending (see computePressureWindows),
        // so Array.find() would return the biggest future spike rather than the nearest one.
        // Select by minimum fromSeconds among qualifying spikes instead of relying on order.
        const qualifyingSpikes = pressureWindows.filter(
          (pw) =>
            pw.fromSeconds >= cast.timeSeconds &&
            pw.totalDamage >= DMG_SPIKE_THRESHOLD,
        );
        const nextSpike = qualifyingSpikes.reduce<IDamageBucket | undefined>(
          (nearest, pw) =>
            nearest === undefined || pw.fromSeconds < nearest.fromSeconds
              ? pw
              : nearest,
          undefined,
        );
        if (nextSpike) {
          dampeningNote += `, next spike in ${Math.round(nextSpike.fromSeconds - cast.timeSeconds)}s on ${pid(nextSpike.targetName)}`;
        }
      }

      // F166: "cheaper-tool-available" tag — if a shorter-CD defensive was available, flag it.
      // Throughput CDs (e.g. Power Infusion) are excluded by findCheaperDefensiveAlternatives.
      // H11: when this cast was an external thrown on a teammate, only suggest alternatives
      // that can themselves target a teammate — a self-only tool (e.g. Barkskin) can't help.
      let cheaperNote = "";
      if (
        !isCC &&
        !isProc &&
        cd.tag === "Defensive" &&
        !THROUGHPUT_EMPOWER_DEFENSIVE_IDS.has(cd.spellId)
      ) {
        // B142: a team/raid heal (Divine Hymn, Tranquility, …) covers an injured ALLY, so a
        // self-only tool (Desperate Prayer, Frenzied Regeneration) can't substitute for it — treat it
        // like an external cast so only team-capable alternatives are offered (extends the H11 guard).
        const castTargetIsTeammate =
          isTeamHealCD(cd.spellId) ||
          (!!cast.targetName &&
            cast.targetName !== "nil" &&
            cast.targetName.split("-")[0] !== owner.name.split("-")[0]);
        const cheaperAvailable = findCheaperDefensiveAlternatives(
          cd,
          ownerCDs,
          cast.timeSeconds,
          {
            castTargetIsTeammate,
          },
        );
        if (cheaperAvailable.length > 0) {
          cheaperNote = ` | cheaper available: ${cheaperAvailable.join(", ")}`;
        }
      }

      let channelSuffix = "";
      if (CHANNELED_CD_SPELL_IDS.has(cd.spellId)) {
        const expiry = cdExpiryEvents.find(
          (e) =>
            e.spellId === cd.spellId &&
            Math.abs(e.castAtSeconds - cast.timeSeconds) < 0.01,
        );
        if (expiry) {
          const actualDuration = expiry.expiresAtSeconds - cast.timeSeconds;
          // GH #34 ① (2026-08-29): channel length is haste-dependent (Divine Hymn
          // 2.3–4.6 s, p50 3.8, n=190; Tranquility 0.5–5.2 s) and the hand table
          // said 8 s, so every channel read "channeled 3.8s of 8.0s" — an
          // incomplete-channel claim on 190/190 Divine Hymns. Without a per-cast
          // expected length we state only what the log shows: the channel
          // length and its end; "interrupted" only on kick/CC evidence.
          if (expiry.isEstimated) {
            channelSuffix = ` (channel end not logged)`;
          } else {
            const interrupted = channelWasInterrupted(
              ownerCCSummary,
              cast.timeSeconds,
              cast.timeSeconds + actualDuration,
            );
            const channelEnd = fmtTime(cast.timeSeconds + actualDuration);
            channelSuffix = interrupted
              ? ` (interrupted at ${actualDuration.toFixed(1)}s, ended ${channelEnd})`
              : ` (channeled ${actualDuration.toFixed(1)}s, ended ${channelEnd})`;
          }
        }
      }
      // B113/B130: append a role tag for throughput/mana/modifier CDs so the model does not invent
      // a mechanic (e.g. "Restoral breaks stuns") for a CD it otherwise sees only as a [YOU] [CD] cast.
      const ownerRole = cdRoleTag(cd.spellId);
      const roleSuffix = ownerRole ? ` [${ownerRole}]` : "";
      const displayNameWithChannel = `${cd.spellName}${roleSuffix}${channelSuffix}`;

      // B128: for the owner's CHANNELED CDs, state whether any enemy had an interrupt available at the
      // cast — so the model can decide "was this a lockout reaction" and "would this have been kicked"
      // instead of guessing. A completed channel with kicks up is skill; an interrupted one with all
      // kicks down was not a kick.
      let interruptNote = "";
      if (
        CHANNELED_CD_SPELL_IDS.has(cd.spellId) &&
        enemies &&
        enemies.length > 0
      ) {
        const immuneReason = ownerInterruptImmuneReasonAt(cast.timeSeconds);
        if (immuneReason) {
          // B139: kicks can't land — a PvP talent grants interrupt/silence immunity here.
          interruptNote = ` | interrupt-immune (${immuneReason})`;
        } else {
          const states = computeEnemyInterruptAvailability(
            enemies,
            matchStartMs + cast.timeSeconds * 1000,
          );
          const upKicks = states.filter((s) => s.cdRemainingSeconds === 0);
          if (upKicks.length > 0) {
            interruptNote = ` | enemy interrupts UP: ${upKicks.map((s) => (s.assumedReady ? `${s.spellName}/${s.spec} (assumed)` : `${s.spellName}/${s.spec}`)).join(", ")}`;
          } else if (states.length > 0) {
            interruptNote = " | no enemy interrupt available (all on CD)";
          }
        }
      }

      addEntry(
        cast.timeSeconds,
        `${fmtTime(cast.timeSeconds)}  ${prefix}   ${displayNameWithChannel}${effectiveTargetPart}${outgoingDrNote}${immuneNote}${empowerNote}${dampeningNote}${cheaperNote}${groundingNote}${interruptNote}${isProc ? "" : ownerHardCcTagAt(cast.timeSeconds)}${unnecessaryNote}`,
        ...extraLines,
      );
    }
  }

  return { procLinesEmitted };
}
