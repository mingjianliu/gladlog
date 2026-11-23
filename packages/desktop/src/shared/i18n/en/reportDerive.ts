import type { MessageParams } from "../index";

const plural = (n: string | number, one: string, many: string): string =>
  Number(n) === 1 ? one : many;

/** English ordinal: 1st 2nd 3rd 4th … 11th 12th 13th … 21st 22nd 23rd … 101st
 * 111th. A non-integer value keeps a plain "th". */
const ordinal = (n: string | number): string => {
  const v = Number(n);
  if (!Number.isInteger(v)) return `${n}th`;
  const abs = Math.abs(v);
  const lastTwo = abs % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  const suffix = ["th", "st", "nd", "rd"][abs % 10] ?? "th";
  return `${n}${suffix}`;
};

// English dictionary for the report's derive layer (`report.*`). Severity,
// category, finding-type and kick-outcome wording is the glossary's
// (src/shared/i18n/glossary.ts).
export const enReportDerive = {
  // ── ExportReportPage.tsx (off-screen image export page) ──
  "report.exportPage.notFound": "Match {matchId} not found",
  "report.exportPage.noRounds": "This shuffle has no round data",
  "report.exportPage.loading": "Loading…",

  // ── findingDisplay.ts ──
  "report.severity.high": "High",
  "report.severity.med": "Medium",
  "report.severity.low": "Low",
  "report.category.survival": "Survival",
  "report.category.cooldowns": "Cooldowns",
  "report.category.positioning": "Positioning",
  "report.category.target-selection": "Target selection",
  "report.category.cc": "CC",
  "report.category.interrupts": "Interrupts",
  "report.category.dispels": "Dispels",
  "report.category.offense": "Offense",
  "report.findingType.death": "Death",
  "report.findingType.death-setup": "Death setup",
  "report.findingType.cd-waste": "Never used this round",
  "report.findingType.missed-cleanse": "Missed cleanse",
  "report.findingType.missed-purge": "Missed purge",
  "report.findingType.kick-eaten": "Cast interrupted",
  "report.findingType.burst-into-mitigation": "Burst into mitigation",
  "report.findingType.external-unused": "External not given",
  "report.findingType.healing-gap": "Healing gap",
  "report.findingType.position-mistake": "Positioning mistake",
  "report.findingType.cc-held": "CC held",
  "report.findingType.cc-avoidable": "Avoidable CC",
  "report.findingType.slow-defensive-response": "Slow defensive response",
  "report.findingType.crisis-no-response": "No response to crisis",
  "report.findingType.teammate-crisis-idle": "Idle during teammate crisis",
  "report.findingType.teammate-crisis-triage":
    "Wrong triage in teammate crisis",
  "report.findingType.backlash-dispel": "Backlash dispel",
  "report.findingType.backlash-dispel-window": "Dispel window missed",
  "report.findingType.kick-priority-missed": "Priority kick missed",
  "report.findingType.kick-priority-team": "Teammate could kick",

  // ── kickText.ts ──
  "report.kick.missed": "Missed",
  "report.kick.immune": "Target immune to interrupt",
  "report.kick.reflected": "Reflected by target",

  // ── aiRunStatus.ts ──
  "report.aiRun.cliWaitHint":
    "CLI backends return in one piece with no mid-run progress — this usually takes a few minutes",

  // ── cohortDims.ts ──
  "report.cohort.percentile": (p: MessageParams) => ordinal(p.n),
  "report.cohort.aboveMedian": "above this cohort's median",
  "report.cohort.belowMedian": "below this cohort's median",
  "report.cohort.atMedian": "at this cohort's median",

  // ── zeroFindingText.ts ──
  "report.zeroFinding.dropped": (p: MessageParams) =>
    `The model wrote ${p.n} ${plural(p.n, "finding", "findings")}, but ${plural(p.n, "it", "all of them")} failed the audit (bare numbers / invented events / causal claims) and ${plural(p.n, "was", "were")} dropped — click "Re-analyze" to try again.`,
  "report.zeroFinding.noCandidates":
    "Nothing to fault in this match (nobody died, no obvious problem with resource use) — that's good news, and no coaching advice is forced.",
  "report.zeroFinding.noClient":
    "No AI is set up (enter an API key or a local CLI backend in Settings); showing deterministic events only.",
  "report.zeroFinding.badJson":
    'The model\'s reply was malformed, so the deterministic view is shown instead — click "Re-analyze" to try again.',
  "report.zeroFinding.emptyReply":
    "Analysis complete: the model went through this match's candidate events and found none worth turning into coaching advice — the timeline and stats are all still here.",
  "report.zeroFinding.stale":
    'No commentary was generated (cache from an older version); click "Re-analyze" to generate it.',

  // ── selfReviewNote.ts ──
  "report.selfReview.failed":
    "Not self-reviewed · the AI self-review did not succeed; showing the original results",
  "report.selfReview.noChanges": "AI self-reviewed · no changes",
  "report.selfReview.reviewed": "AI self-reviewed",
  "report.selfReview.changed": (p: MessageParams) =>
    `${p.n} ${plural(p.n, "finding", "findings")} changed`,
  "report.selfReview.dropped": (p: MessageParams) => `${p.n} removed`,

  // ── teamSide.ts ──
  "report.teamSide.friendly": "Friendly",
  "report.teamSide.enemy": "Enemy",
  "report.teamSide.unknown": "Unknown",

  // ── flowSeries.ts ──
  "report.curveMetric.hp": "HP",
  "report.curveMetric.damage": "Damage",
  "report.curveMetric.healing": "Healing",
  "report.curveMetric.taken": "Damage taken",
  "report.curveMetric.healed": "Healing taken",

  // ── eventsView.ts ──
  "report.eventKind.damage": "Damage",
  "report.eventKind.heal": "Healing",
  "report.eventKind.cast": "Cast",
  "report.eventKind.aura": "Aura",
  "report.eventKind.dispel": "Dispel",
  "report.eventKind.interrupt": "Interrupt",
  "report.eventKind.death": "Death",
  "report.events.auraGained": "+gained",
  "report.events.auraLost": "−lost",
  "report.events.dispelled": "removed {spell}",
  "report.events.interrupted": "interrupted {spell}",
  "report.events.died": "Died",

  // ── shared spell fallbacks ──
  "report.spell.melee": "Melee",
  "report.spell.absorb": "Absorb",

  // ── pressureLanes.ts ──
  "report.pressure.trinketAvailable": "trinket ready",
  "report.pressure.trinketPassive": "passive trinket",
  "report.pressure.trinketOnCd": "trinket on cooldown",
  "report.pressure.losCover": "; LoS cover ~{yd} yd",
  "report.pressure.exposureTitle": (p: MessageParams) =>
    `Healer exposure (${p.label}) · ${p.n} ${plural(p.n, "threat", "threats")} in LoS · ${p.trinket}${p.los}`,

  // ── ccBreakDash.ts ──
  "report.ccBreak.remaining": " ({s}s left)",
  "report.ccBreak.friendly":
    "{breaker}'s {breakSpell} broke the {ccSpell} {caster} put on {holder}{remain}",
  "report.ccBreak.enemy":
    "Enemy {breaker}'s {breakSpell} broke {holder}'s {ccSpell} early{remain}",

  // ── deathRecap.ts ──
  "report.deathRecap.selfDispel": "{removed} (self-dispel)",
  "report.deathRecap.stolenFromVictim": "{removed} (stolen)",
  "report.deathRecap.dispelledOffVictim": "{removed} (dispelled)",
  "report.deathRecap.victimStole": "{removed} (stolen from {target})",
  "report.deathRecap.victimDispelled": "{removed} (dispelled off {target})",

  // ── statsTable.ts ──
  "report.stats.kickTaken": "{kick} interrupted {spell} ({source})",

  // ── uncoveredHighlights.ts ──
  "report.uncovered.kindCount": "{n}× {label}",

  // ── dispelDash.ts ──
  "report.dispel.blockedSeconds": " {s}s",
  "report.dispel.noReach": " (no line of sight / out of range)",
  "report.dispel.noReachUntil": " (no line of sight / out of range until {t})",
  "report.dispel.scopedMissed":
    "{spell} stayed on {enemy} for {s}s without being removed · {tool} available ({holder}){locked}{reach}{cd}{notActionable}",
  "report.dispel.holderLocked": " (holder CC'd / locked out{blocked})",
  "report.dispel.toolOnCdThroughout": " (on cooldown the whole time)",
  "report.dispel.notActionable": " · not possible at the time",
  "report.dispel.instance":
    "{dispelSpell} {verb} {removed} ({target}){fatal}{passive}",
  "report.dispel.verbSteal": "stole",
  "report.dispel.verbDispel": "dispelled",
  "report.dispel.fatal": " ☠ fatal",
  "report.dispel.passive": " (passive)",
  "report.dispel.missedPurge":
    "{spell} stayed on {enemy} for {s}s without being purged{killWindow}{cd}{locked}{reach}",
  "report.dispel.inKillWindow": " (inside our kill window)",
  "report.dispel.purgeOnCd": " (purge on cooldown)",
  "report.dispel.dispellersLocked": " (dispellers CC'd / locked out{blocked})",
  "report.dispel.missedCleanse":
    "{spell} stayed on {target} for {s}s without being cleansed{cd}{locked}{reach}{dr}",
  "report.dispel.cleanseOnCd": " (cleanse on cooldown)",
  "report.dispel.drChainRisk":
    " (their CC was not diminished yet; a cleanse invites a fresh one)",

  // ── keyMoments.ts ──
  "report.keyMoment.died": "Died",
  "report.keyMoment.kill": "Kill",
  "report.keyMoment.burstConverted": "Burst (converted)",
  "report.keyMoment.burstUnconverted": "Burst (not converted)",
  "report.keyMoment.enemyBurst": "Enemy burst",
  "report.keyMoment.panicUse": "panic use",
  "report.keyMoment.trinket": "Trinket",
  "report.keyMoment.dispelled": "removed {spell}",
  "report.keyMoment.ccTaken": "CC'd: {spell}",
  "report.keyMoment.trinketedOut": " · trinketed out",
  "report.keyMoment.ccLanded": "CC landed: {spell}",
  "report.keyMoment.healGap": "Healing gap {s}s",
  "report.keyMoment.healGapDetail": "{spec} ({name}) took {k}k",
  "report.keyMoment.stayedIn": "Stayed in through a burst",
  "report.keyMoment.missedPush": "Missed push",
  "report.keyMoment.outOfRange": "Out of CD range",
  "report.keyMoment.stayedInDetail":
    "{from}→{to}yd next to {enemy}{danger}{hp}",
  "report.keyMoment.danger": " · {label} burst",
  "report.keyMoment.missedPushDetail": ">{yd}yd, disconnected",
  "report.keyMoment.outOfRangeDetail": "{spell} · beyond {yd}yd",

  // ── exportReport.ts ──
  "report.export.title": "# gladlog report — {bracket} · {result}",
  "report.export.window": " · window {from}–{to} ({s}s)",
  "report.export.outputHeading": "## Damage / healing",
  "report.export.outputHeader":
    "| Player | Damage | Healing | Damage taken | Deaths |",
  "report.export.statsHeading": "## Stats",
  "report.export.statsHeader":
    "| Player | Interrupts cast | Interrupted | CC taken (s) | Dispels | Purges |",
  "report.export.kicksHeading": "## Interrupts",
  "report.export.kicksHeader":
    "| Player | Cast | Landed | Silenced | Juked | Missed |",
  "report.export.refused": " (incl. {n} immune / reflected)",
  "report.export.mistakesHeading":
    "## Findings ({n}, straight from deterministic rules)",
  "report.export.wholeRound": "Whole round",

  // ── mistakes.ts: rule labels ──
  "report.mistakes.rule.burst-into-mitigation": "Burst into mitigation",
  "report.mistakes.rule.cd-waste": "Defensive cooldown never used",
  "report.mistakes.rule.missed-kick": "Missed interrupt",
  "report.mistakes.rule.missed-purge-kill-window":
    "Missed purge in a kill window",
  "report.mistakes.rule.crisis-no-response": "No response for 3 s in a crisis",
  "report.mistakes.rule.backlash-dispel": "Backlash dispel that didn't pay",
  "report.mistakes.rule.backlash-dispel-window":
    "Backlash DoT left on when worth dispelling",
  "report.mistakes.rule.kick-priority-missed": "Priority heal not kicked",
  "report.mistakes.rule.kick-priority-team":
    "Heal a teammate could kick went unkicked",
  "report.mistakes.rule.external-unused":
    "External available when a teammate died",
  "report.mistakes.rule.questionable-external":
    "External given with no pressure",
  "report.mistakes.rule.healing-gap": "Healing gap",
  "report.mistakes.rule.position-mistake": "Positioning mistake",
  "report.mistakes.rule.cc-avoidable": "Avoidable CC",
  "report.mistakes.rule.slow-defensive-response": "Slow defensive response",
  "report.mistakes.rule.missed-sync-window": "Lockdown not burst into",
  "report.mistakes.rule.cd-hoarded": "Major cooldown held too long",

  // ── mistakes.ts: sentence frames ──
  "report.mistakes.listSep": ", ",
  "report.mistakes.syncYours": "{spell} (yours)",
  "report.mistakes.syncHolder": "{spell} ({holder}'s)",
  "report.mistakes.healCasts": (p: MessageParams) =>
    `, ${p.n} ${plural(p.n, "cast", "casts")} combined`,
  "report.mistakes.burstIntoMitigation":
    "{spell} went into {target}'s {mitSpell} ({mit}) while {betterTarget} was the softer target",
  "report.mistakes.mitDefers": "defers {amount} damage",
  "report.mistakes.mitPct": "{pct}% damage reduction",
  "report.mistakes.cdWaste": "{spell} never pressed this round",
  "report.mistakes.crisisOutcomeTeam":
    "in this state a friendly died within 15 s {noResp}% of the time without a response vs {resp}% with one",
  "report.mistakes.crisisOutcomeOwn":
    "in this state players died within 10 s {noResp}% of the time without a response vs {resp}% with one",
  "report.mistakes.crisisNoResponse":
    "No response for 3 s after HP fell to {hpPct}% ({outcome}; most common answers among those who responded: {refTop})",
  "report.mistakes.externalUnused":
    "{external} was available when {victim} died",
  "report.mistakes.questionableExternal":
    "{spell} on {target} ({targetHp}% HP, {gap}s from the nearest burst window)",
  "report.mistakes.slowDefensiveResponse":
    "Nobody on the team answered within 8 s of {leadCd}{extras}; {pressured} fell to {hpPct}%{died}",
  "report.mistakes.extras": " (+{extras})",
  "report.mistakes.diedInWindow": ", died in the window",
  "report.mistakes.missedSyncWindow":
    "{healer} was CC'd by {cc} for {durationS}s; {readyCds} all ready, none pressed",
  "report.mistakes.cdHoarded":
    "{crisisUnit} fell to {hpPct}%{own} at {t}s; {readyCds} all available, none pressed within 5 s",
  "report.mistakes.ownSelf": " (yourself)",
  "report.mistakes.backlashDispel":
    "At {t}s dispelled {debuff}{stacks} off {target} at {targetHpPct}% HP and took {backlash}; over 4 s, damage taken {selfDmgTrend}, healing {healTrend}{cdCc}",
  "report.mistakes.backlashCdCc":
    "; with the dispel on cooldown, {target} took a {durationS}s {spell} nobody could dispel",
  "report.mistakes.kickPriorityMissed":
    "At {t}s {healer} hardcast {heal} ({castS}s) on kill target {target} at {targetHpPct}% HP (+{healK}k{healCasts}); your {kick} was ready, {reach}, and not used{others}",
  "report.mistakes.reachPet": "{kicker} within {yd} yd",
  "report.mistakes.reachMelee":
    "{yd} yd away (melee kick, {range} yd; reachable during the cast)",
  "report.mistakes.reachInRange": "within {yd} yd",
  "report.mistakes.othersFeasible": "; {others} could also kick",
  "report.mistakes.kickPriorityTeam":
    "At {t}s {healer} hardcast {heal} ({castS}s) on kill target {target} at {targetHpPct}% HP (+{healK}k{healCasts}); you could not kick it ({ownerWhy}), {teammates} could, and nobody did",
  "report.mistakes.backlashWindowImmune":
    "At {t}s {debuff} on {target} ({targetHpPct}%) was dispellable: you had {immuneBuff}, so the backlash CC could not land",
  "report.mistakes.backlashWindowWorth": (p: MessageParams) =>
    `At ${p.t}s ${p.debuff} on ${p.target} (${p.targetHpPct}%, ${p.dots} ${plural(p.dots, "DoT", "DoTs")}) was worth dispelling; they took another ${p.k}k over the next 15 s`,
  "report.mistakes.kickRefused": "{kick} went into {castSpell}'s cast",
  "report.mistakes.kickMissed": "{kick} missed",
  "report.mistakes.purgeMissed":
    "{spell} stayed on {enemy} for {s}s without being purged",
};
