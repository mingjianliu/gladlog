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

import { saveCoversPressureOn } from "../../analysis/candidates/cooldownTiming";
import { reachesAlly } from "../../data/spellTargeting";
import { ccSpellIds } from "../../data/spellTags";
import { buffFullDurationForCaster } from "../../utils/buffDuration";
import {
  cdIsProcOnly,
  cdRoleTag,
  findCheaperDefensiveAlternatives,
  guardianSpiritSaveClause,
  type IDamageBucket,
  isTeamSaveCD,
  rendersOnCaster,
  THROUGHPUT_EMPOWER_DEFENSIVE_IDS,
} from "../../utils/cooldowns";
import { getDampeningPercentage } from "../../utils/dampening";
import {
  healAbsorbPressClause,
  healAbsorbUseOf,
  healerCreditOf,
} from "../../utils/healAbsorbSave";
import { documentRecordsAttackSpell } from "../../utils/incomingPressure";
import {
  computeEnemyInterruptAvailability,
  isInterruptUsable,
} from "../../utils/enemyInterrupts";
import { fmtTime } from "../../utils/renderGrid";
import { buildRosterSides } from "../../utils/rosterSide";
import { unitUnderFireAt } from "../../utils/threatAssessment";
import { isDeadAt } from "../../utils/unitDeath";
import {
  CHANNELED_CD_SPELL_IDS,
  channelWasInterrupted,
  computeHealingInWindow,
  DMG_SPIKE_THRESHOLD,
  HEALING_AMPLIFIER_SPELL_IDS,
} from "../timelineHelpers";
import { ALTER_TIME_CAST_ID, alterTimeReturnSeconds } from "./alterTime";
import type { DeferredSnapshot } from "./ctx";
import type { TimelineCtx } from "./ctx";

const DIVINE_HYMN_ID = "64843";
/** Spirit of Redemption, the pressed PvP-talent version (not the death proc). */
const SPIRIT_OF_REDEMPTION_PRESSED_ID = "215769";

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
    | "ownerNoCcAuraTag"
    | "ownerEmpowerTag"
    | "groundingAbsorbNote"
    | "params"
    | "_allUnits"
    | "pressureWindows"
    | "pid"
    | "cdExpiryEvents"
    | "ownerCCSummary"
    | "enemies"
    | "friends"
    | "summonOwners"
    | "ownerInterruptImmuneReasonAt"
    | "addEntry"
    | "ownerHardCcTagAt"
    | "ownerStunnedAtCast"
    | "ownerStunIdsAtCast"
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
    ownerNoCcAuraTag,
    ownerEmpowerTag,
    groundingAbsorbNote,
    params,
    _allUnits,
    pressureWindows,
    pid,
    cdExpiryEvents,
    ownerCCSummary,
    enemies,
    friends,
    summonOwners,
    ownerInterruptImmuneReasonAt,
    addEntry,
    ownerHardCcTagAt,
    ownerStunnedAtCast,
    ownerStunIdsAtCast,
  } = ctx;
  // B3a: the round-level inputs of the school split (`saveCoversPressureOn`)
  const roundFacts = {
    sides: buildRosterSides(_allUnits),
    recordsAttackSpell: documentRecordsAttackSpell(_allUnits),
  };
  // threaded: read from ctx, returned to the caller (GH #116)
  let { procLinesEmitted } = ctx;

  // User ruling 2026-09-30: the pressed Spirit of Redemption (PvP talent,
  // 215769) that carries a Divine Hymn is part of the Hymn throughput combo,
  // not a survival cooldown — no "cheaper available: Guardian Spirit,
  // Desperate Prayer" on it. "Carries" = the owner started Divine Hymn while
  // still in spirit form (cast … logged expiry). Pressed alone it stays a
  // defensive. 2026-09-30 capture (605 files): 483 owner SoR lines, the next
  // Hymn 0–1 s later on 279 of them.
  const hymnCastSeconds =
    ownerCDs
      .find((c) => c.spellId === DIVINE_HYMN_ID)
      ?.casts.map((c) => c.timeSeconds) ?? [];
  function spiritCarriesHymn(spellId: string, castAtSeconds: number): boolean {
    if (spellId !== SPIRIT_OF_REDEMPTION_PRESSED_ID) return false;
    const form = cdExpiryEvents.find(
      (e) =>
        e.spellId === spellId &&
        Math.abs(e.castAtSeconds - castAtSeconds) < 0.01,
    );
    if (!form) return false;
    return hymnCastSeconds.some(
      (h) => h >= castAtSeconds && h <= form.expiresAtSeconds,
    );
  }

  const ownerPvpTalentIds = new Set<string>(owner.info?.pvpTalents ?? []);

  for (const cd of ownerCDs) {
    // B112/B127: a big personal defensive that cannot be cast on an ally is self-only — force (self)
    // rendering so a self-buff (e.g. Obsidian Scales) logged against the caster's current enemy/ally
    // target is not shown as "→ <unit>" with that unit's HP. `rendersOnCaster` (hp-state F-S1)
    // adds the officially self-only Defensives outside the big-defensive roster.
    const forceSelf = rendersOnCaster(cd.spellId);
    // Reliability round 3 N5 (02c8 / ba8c / 3306): a proc-only entry (Renewing
    // Blaze — structurally cast-less; a talent-replaced button) keeps its aura
    // activations in `casts`, and this loop read them as presses: "[YOU] [CD]
    // Renewing Blaze … cheaper available: Time Dilation", "[while stunned]".
    // The activation stays a timeline fact under [PROC]; every press-only
    // judgement (cheaper alternative, [UNNECESSARY], CC tag, [HEALING]) is off.
    const isProc = cdIsProcOnly(cd);
    if (isProc) procLinesEmitted = true;
    for (const cast of cd.casts) {
      // No `cast.targetHpPct` override (hp-state F-R8): the helper reads
      // `hpAtPress` itself. The ledger field is the same press reading since
      // the A21 extension (2026-10-01) — one sampler for the line, the
      // [UNNECESSARY] threshold and the questionable-external facts.
      const targetPart = getCDTargetAndVelocityPart(
        cd.spellId,
        cast.timeSeconds,
        cast.targetName,
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
      // enemy-def F-E26: the units this line names, for the IMMUNE tag
      const named = new Set<string>(
        cast.targetName && cast.targetName !== "nil" ? [cast.targetName] : [],
      );
      if (isCC) {
        const matchingAoe = findAndConsumeAoeCC(
          cast.timeSeconds,
          owner.name,
          cd.spellName,
          true,
        );
        if (matchingAoe) {
          effectiveTargetPart = formatAoeTargetPart(matchingAoe, targetPart);
          for (const t of matchingAoe.targets) named.add(t.name);
        }
      }
      // Class F (2026-07-20 eval): [CC ON TEAM] carries [DR: category level]
      // while CC the player casts did not — an asymmetric information gap that
      // led the model to transfer the semantics of enemy lines onto its own.
      // Outgoing DR is already computed (drInfo on outgoingCCChains); align the
      // rendering here.
      const outgoingDrNote = isCC ? outgoingDrTag(cd.spellId, cast) : "";
      // enemy-def F-E25a: a non-CC press into an immunity (Grapple Weapon
      // into Bladestorm, a Freezing Trap the roster does not class as CC) is
      // tagged too; the MISS / REFLECT tag stays a CC tag. A proc-only
      // activation is not a press and gets neither.
      // (a spell that reaches allies is not aimed at an enemy — Mass
      // Invisibility logs IMMUNE on the enemies standing in it)
      const failTags = isProc
        ? ""
        : isCC
          ? ownerCcImmuneTag(cd.spellId, cast.timeSeconds, named) +
            ownerCcMissTag(cd.spellId, cast.timeSeconds)
          : reachesAlly(cd.spellId)
            ? ""
            : ownerCcImmuneTag(cd.spellId, cast.timeSeconds, named);
      // cc-dr F-NE1 (wording ruling A55): an aimed CC cast that left no CC
      // aura on its target and no miss either is said to have no logged
      // effect — an absence of evidence, never "it missed". Probe p12's rule:
      // no CC aura (any id, or the cast's own effect auras) from the owner or
      // the owner's summons on the target within [cast − 0.1 s, cast + 2.5 s],
      // and no owner miss on it in that window.
      const immuneNote =
        failTags ||
        (isCC && !isProc ? ownerNoCcAuraTag(cd.spellId, cast.timeSeconds) : "");
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
      // B15a step 2 (wording approved 2026-10-07): a self-save that puts a
      // heal absorb on the owner (Death Pact) says what the absorb ate
      const healAbsorbUse =
        isProc || isCC
          ? null
          : healAbsorbUseOf(
              owner,
              cd.spellId,
              matchStartMs + cast.timeSeconds * 1000,
              params.matchEndMs,
              healerCreditOf([...friends, ...(enemies ?? [])], summonOwners),
            );
      const healAbsorbNote = healAbsorbUse
        ? healAbsorbPressClause(
            healAbsorbUse,
            owner.id,
            (unitId) => {
              const u = _allUnits.find((x) => x.id === unitId);
              return u ? pid(u.name) : unitId;
            },
            (ms) => fmtTime((ms - matchStartMs) / 1000),
          )
        : "";
      // B18: the owner's own Guardian Spirit whose save triggered says so
      const guardianSaveNote = isProc
        ? ""
        : guardianSpiritSaveClause(
            cd.spellId,
            owner,
            cast.timeSeconds,
            matchStartMs,
            cast.targetName && cast.targetName !== "nil"
              ? cast.targetName
              : owner.name,
          );
      let cheaperNote = "";
      if (
        !isCC &&
        !isProc &&
        cd.tag === "Defensive" &&
        !THROUGHPUT_EMPOWER_DEFENSIVE_IDS.has(cd.spellId) &&
        !spiritCarriesHymn(cd.spellId, cast.timeSeconds)
      ) {
        // B142: a team/raid heal (Divine Hymn, Tranquility, …) covers an injured ALLY, so a
        // self-only tool (Desperate Prayer, Frenzied Regeneration) can't substitute for it — treat it
        // like an external cast so only team-capable alternatives are offered (extends the H11 guard).
        // Triage hp-state F-T1: the test is the team-SAVE set (the heals plus the group walls of
        // the 2026-09-26 ruling) — a nil-dest Spirit Link Totem / Aura Mastery read as a self-cast
        // and was offered Astral Shift / Divine Protection.
        const castOnTeammate =
          !!cast.targetName &&
          cast.targetName !== "nil" &&
          cast.targetName.split("-")[0] !== owner.name.split("-")[0];
        const castTargetIsTeammate = isTeamSaveCD(cd.spellId) || castOnTeammate;
        // U-T2 (user ruling 2026-10-06): a group save names no recipient. When
        // the owner was the only friendly under fire at the press, the danger
        // it answered was the owner's own, and a tool that only works on
        // another unit (Blessing of Sacrifice) was not an alternative.
        const pressMs = matchStartMs + cast.timeSeconds * 1000;
        const onlyCasterUnderFire =
          castTargetIsTeammate &&
          !castOnTeammate &&
          unitUnderFireAt(owner, pressMs) &&
          // a teammate who died just before the press still has his fatal
          // hits inside the ± window — nothing can be put on a corpse
          !params.friends.some(
            (f) =>
              f.id !== owner.id &&
              !isDeadAt(f, pressMs) &&
              unitUnderFireAt(f, pressMs),
          );
        // B3a: the unit the save went on — the named teammate, the owner for
        // a self-cast, the owner for a group save that answered only the
        // owner's danger; a group save with no single recipient has none,
        // and no school gate
        const recipient = castOnTeammate
          ? params.friends.find(
              (f) => f.name.split("-")[0] === cast.targetName!.split("-")[0],
            )
          : !castTargetIsTeammate || onlyCasterUnderFire
            ? owner
            : undefined;
        const cheaperAvailable = findCheaperDefensiveAlternatives(
          cd,
          ownerCDs,
          cast.timeSeconds,
          {
            castTargetIsTeammate,
            onlyCasterUnderFire,
            coversSchool: recipient
              ? (spellId) =>
                  saveCoversPressureOn(spellId, recipient, pressMs, roundFacts)
              : undefined,
            // F-E20: a stunned owner can only be offered what a stunned player can press.
            // U-T1: a school-limited purge (Blessing of Protection) is an
            // alternative only where it would go on the stunned owner himself.
            stunnedCaster: ownerStunnedAtCast(cast.timeSeconds)
              ? {
                  pvpTalentIds: ownerPvpTalentIds,
                  selfCastUnderStuns: castTargetIsTeammate
                    ? undefined
                    : ownerStunIdsAtCast(cast.timeSeconds),
                }
              : undefined,
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
          // F-C5 / F-C5b (ruling A′16): UP = usable at this instant — the
          // kicker alive and not in a cast-blocking CC, not merely off
          // cooldown. The CC test is at the exact instant, like kick-priority.
          const states = computeEnemyInterruptAvailability(
            enemies,
            matchStartMs + cast.timeSeconds * 1000,
            _allUnits,
          );
          const kickLabel = (s: (typeof states)[number]) =>
            s.assumedReady
              ? `${s.spellName}/${s.spec} (assumed)`
              : `${s.spellName}/${s.spec}`;
          const upKicks = states.filter(isInterruptUsable);
          const ccdKicks = states.filter(
            (s) => s.cdRemainingSeconds === 0 && s.ccd,
          );
          if (upKicks.length > 0) {
            interruptNote = ` | enemy interrupts UP: ${upKicks.map(kickLabel).join(", ")}`;
          } else if (ccdKicks.length > 0) {
            interruptNote = ` | no enemy interrupt usable (CC'd: ${ccdKicks.map(kickLabel).join(", ")})`;
          } else if (states.length > 0) {
            interruptNote = " | no enemy interrupt available (all on CD)";
          }
        }
      }

      // H17 (triage 2026-09-29): when the owner snapped back, and how soon
      let returnNote = "";
      if (cd.spellId === ALTER_TIME_CAST_ID) {
        const ret = alterTimeReturnSeconds(
          owner,
          cast.timeSeconds,
          matchStartMs,
        );
        if (ret !== null)
          returnNote = ` | returned +${(ret - cast.timeSeconds).toFixed(1)}s`;
      }

      addEntry(
        cast.timeSeconds,
        `${fmtTime(cast.timeSeconds)}  ${prefix}   ${displayNameWithChannel}${effectiveTargetPart}${outgoingDrNote}${immuneNote}${empowerNote}${healAbsorbNote}${guardianSaveNote}${dampeningNote}${cheaperNote}${groundingNote}${interruptNote}${returnNote}${isProc ? "" : ownerHardCcTagAt(cast.timeSeconds)}${unnecessaryNote}`,
        ...extraLines,
      );
    }
  }

  return { procLinesEmitted };
}
