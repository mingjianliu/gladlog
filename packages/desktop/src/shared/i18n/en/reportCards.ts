import type { MessageParams } from "../index";

const plural = (n: string | number, one: string, many: string): string =>
  Number(n) === 1 ? one : many;

// English dictionary for the match report's components (`report.<card>.*`).
// Terms follow src/shared/i18n/glossary.ts.
export const enReportCards = {
  // ── shared across report cards ──
  "report.common.replayHere": "Replay this moment",
  "report.common.all": "All",
  "report.common.clear": "Clear",
  "report.common.retry": "Retry",
  "report.common.wholeMatch": "Whole match",
  "report.common.player": "Player",
  "report.common.target": "Target",
  "report.common.spell": "Spell",
  "report.common.close": "Close",
  "report.common.kill": "Kill",
  "report.common.analyzing": "Analyzing…",
  "report.common.passiveDispelTitle":
    "Dispels from passive procs or movement abilities; not counted as decisions",
  "report.common.burstWindow": "Kill attempt",
  "report.common.vulnWindow": "Vulnerable",
  "report.common.thisMatchNoRecords": "No records in this match.",
  "report.common.thisRoundNoRecords": "No records in this round.",
  "report.common.listSep": ", ",

  // ── AuraUptimeCard.tsx ──
  "report.aura.title": "Aura uptime",
  "report.aura.windowBasis": "Uptime measured over the {s}s window",
  "report.aura.kind.offense": "Offense",
  "report.aura.kind.defense": "Defense",
  "report.aura.kind.cc": "CC",
  "report.aura.inferredStart": " (already up before the opener, inferred)",
  "report.aura.inferredEnd": " (never seen falling off, inferred to match end)",
  "report.aura.hasInferred": "Includes inferred segments (dashed)",
  "report.aura.moreRows": "+{n} lower-uptime auras",

  // ── BreakdownTable.tsx ──
  "report.breakdown.empty": "No data",
  "report.breakdown.col.spell": "Spell",
  "report.breakdown.col.total": "Total",
  "report.breakdown.col.share": "Share",
  "report.breakdown.col.hits": "Hits",
  "report.breakdown.col.crit": "Crit",
  "report.breakdown.col.overheal": "Overheal",
  "report.breakdown.col.maxHit": "Biggest hit",
  "report.breakdown.absorb": "Absorb",
  "report.breakdown.rest": "{n} more (combined)",

  // ── CCChainPanel.tsx ──
  "report.ccChain.title": "Enemy CC chains",
  "report.ccChain.empty":
    "No CC chains on the enemy in this match. In longer matches this shows each enemy target's chain length, total CC time and DR tiers.",
  "report.ccChain.col.chainLen": "Chain",
  "report.ccChain.col.totalCc": "Total CC",
  "report.ccChain.wasted": "Wasted",

  // ── CohortDimsTable.tsx ──
  "report.cohortTable.overall": "Overall score",
  "report.cohortTable.bestWorst":
    " · strongest: {best} ({bestScore}) · weakest: {worst} ({worstScore})",
  "report.cohortTable.scoreTitle":
    "Score {score} (direction-corrected) · p10 {p10} · p50 {p50} · p90 {p90}",
  "report.cohortTable.measured": "Measured {value}",

  // ── kick outcomes (BurstLedgerCard.tsx / KickDashboard.tsx) ──
  "report.kicks.landed": "Interrupted {spell}",
  "report.kicks.jukedChannel": "Juked ({spell} channel just stopped)",
  "report.kicks.jukedFake": "Juked by a fake cast ({spell})",
  "report.kicks.silencedOpen": "Silence landed ({spell} cast not finished)",
  "report.kicks.silenced": "Silence landed (no cast interrupted)",
  "report.kicks.unknown": "Old save, no cast data",

  // ── BurstLedgerCard.tsx ──
  "report.burstLedger.title": "Burst ledger",
  "report.burstLedger.noData": "No burst window data in this match.",
  "report.burstLedger.alignment": "Burst alignment",
  "report.burstLedger.noDamage": "No damage dealt",
  "report.burstLedger.intoImmunity": "Into immunity {spell} {s}s",
  "report.burstLedger.intoWall": "Into their defensive {spell} {s}s",
  "report.burstLedger.synced": "Synced with {names}",
  "report.burstLedger.noPress": " (auto-proc)",
  "report.burstLedger.solo": "Solo",
  "report.burstLedger.noBursts": "No burst windows recorded in this match.",
  "report.burstLedger.noTargeting":
    "No window target discipline recorded in this match.",
  "report.burstLedger.targeting": "Window target discipline",
  "report.burstLedger.windowTarget": "Window target {name}",
  "report.burstLedger.onTarget": "On target {pct}%",
  "report.burstLedger.topOffTarget": "Most off-target: {name} ({dmg})",
  "report.burstLedger.betterTarget": "Should have hit {name} ({spec})",
  "report.burstLedger.noKicks": "No interrupts recorded in this match.",
  "report.burstLedger.kickAudit": "Interrupt audit",

  // ── KickDashboard.tsx ──
  "report.kickDash.title": "Interrupts",
  "report.kickDash.empty":
    "Neither team cast an interrupt in this match. In longer matches this shows both teams' landed / juked / missed interrupt audit.",
  "report.kickDash.col.casts": "Casts",
  "report.kickDash.col.landed": "Landed",
  "report.kickDash.col.juked": "Juked",
  "report.kickDash.col.missed": "Missed",
  "report.kickDash.col.rate": "Land rate",
  "report.kickDash.silencedN": " ({n} silence landed)",
  "report.kickDash.refusedN": " (missed includes {n} immune / reflected)",
  "report.kickDash.unknownN": " ({n} unknown)",
  "report.castControl.line":
    " hardcasts {hardcasts} · stopped yourself {cancels}{median} · interrupted {kicked} · enemy kicks baited {baited}",
  "report.castControl.median": " (median {pct}% through the cast)",
  "report.castControl.expand": "Show the baited interrupts",
  "report.castControl.baited": "'s {kick} baited by your stopped {bait}",

  // ── DeathRecapCard.tsx ──
  "report.deathCard.kind.dmg": "Damage",
  "report.deathCard.kind.heal": "Heal",
  "report.deathCard.kind.cc": "CC",
  "report.deathCard.kind.def_used": "Defensive",
  "report.deathCard.kind.dispel": "Dispel",
  "report.deathCard.school.physical": "physical",
  "report.deathCard.school.magic": "magic",
  "report.deathCard.school.holy": "holy",
  "report.deathCard.school.fire": "fire",
  "report.deathCard.school.nature": "nature",
  "report.deathCard.school.frost": "frost",
  "report.deathCard.school.shadow": "shadow",
  "report.deathCard.school.arcane": "arcane",
  "report.deathCard.schoolName": "{spell} ({schools} damage)",
  "report.deathCard.mit.arith": "{name} blocked ~{k}k{pct}, covering {s}s",
  "report.deathCard.mit.pctMaxHp": " (≈{pct}% maxHp)",
  "report.deathCard.mit.deferred":
    "{name} held back ~{k}k{pct}, covering {s}s (it lands later as its own damage)",
  "report.deathCard.mit.immunity":
    "{name} immunity covered {s}s (~{k}k damage taken observed during it)",
  "report.deathCard.mit.deflection":
    "{name} deflected direct attacks for {s}s (damage over time still lands; ~{k}k damage taken observed during it)",
  "report.deathCard.mit.absorb": "{name} absorbed ~{k}k{pct}, covering {s}s",
  "report.deathCard.mit.other":
    "{name} active {s}s; special mechanic, left out of the gap arithmetic",
  "report.deathCard.cf.subject": "{caster}'s {spell}",
  "report.deathCard.cf.line":
    "Had {subject} covered this window, the damage would have stayed below the lethal line (margin >{margin}% max HP); arithmetic only, single factor",
  "report.deathCard.panicTitle":
    "Panic press: no clear enemy threat, or pressed while the target was not under pressure",
  "report.deathCard.panic": "⚠Panic",
  "report.deathCard.ticks": (p: MessageParams) =>
    ` ×${p.ticks} ${plural(p.ticks, "tick", "ticks")}/${p.s}s`,
  "report.deathCard.foldExpand": "Expand the folded small events",
  "report.deathCard.foldCollapse": "Collapse the folded small events",
  "report.deathCard.foldLabel": (p: MessageParams) =>
    `${p.n} small ${plural(p.n, "event", "events")} folded (total ${p.dmg} damage / ${p.heal} healing)`,
  "report.deathCard.empty": "No events recorded in the {s}s before death.",
  "report.deathCard.titleEnemy": "Kill recap",
  "report.deathCard.title": "Death recap",
  "report.deathCard.showAllTitle":
    "Raw tick-by-tick event stream (no filtering, no merging)",
  "report.deathCard.showAll": "Show all",
  "report.deathCard.replayHere": "▶ Replay this moment",
  "report.deathCard.unpressed": "Available at death but not pressed: ",
  "report.deathCard.wasInCc": " (CC'd at the time)",
  "report.deathCard.cheaper": " · cheaper alternatives: {list}",
  "report.deathCard.missedExternals": "Teammate could have given: ",
  "report.deathCard.blockedExternals": "Teammate couldn't give: ",
  "report.deathCard.you": "You",
  "report.deathCard.casterSpell": "{caster}: {spell}",
  "report.deathCard.casterCc": " (CC'd)",
  "report.deathCard.casterOom": " (not enough mana)",
  "report.deathCard.mitTitle":
    "Mitigation audit (active inside the death window, each line priced on its own, stacking not modelled):",
  "report.deathCard.timelineAria": "Events before death (scrollable)",

  // ── DispelDashboard.tsx ──
  "report.dispelCard.title": "Dispels",
  "report.dispelCard.empty": "No dispels or steals in this match.",
  "report.dispelCard.col.cleanses": "Cleanses",
  "report.dispelCard.col.steals": "Steals",
  "report.dispelCard.col.passive": "Passive",
  "report.dispelCard.missedPurges": "Missed purge chances ({n})",
  "report.dispelCard.missedCleanses": "Missed CC / debuff cleanses ({n})",
  "report.dispelCard.ccRate": "Friendly dispellable CC cleanse rate",
  "report.dispelCard.counts": "Cleansed {cleansed} / missed {missed}",
  "report.dispelCard.broken": " / broken by damage {n}",
  "report.dispelCard.rate": " — cleanse rate {pct}%",

  // ── EngagementPanel.tsx (tab labels shared with ReportSkeleton.tsx) ──
  "report.engage.tab.kick": "Interrupts",
  "report.engage.tab.dispel": "Dispels",
  "report.engage.tab.aura": "Auras",
  "report.engage.tab.cc": "CC chains",
  "report.engage.tab.break": "CC breaks",
  "report.engage.friendlyBreaks":
    "Gifted breaks — your team's damage broke CC on an enemy ({n})",
  "report.engage.enemyBreaks":
    "Enemy mistakes — the enemy broke their own CC on your team ({n}, a positive sign)",
  "report.engage.rootBreaks": (p: MessageParams) =>
    `Roots were also broken ${p.n} ${plural(p.n, "time", "times")}. Roots are often broken on purpose to reposition, so they are listed apart and not coached.`,

  // ── MistakesCard.tsx / KpiChips.tsx (mistake severity: WoWAnalyzer's minor / average / major) ──
  "report.mistakeSev.major": "Major",
  "report.mistakeSev.average": "Average",
  "report.mistakeSev.minor": "Minor",
  "report.mistakesCard.title": "Findings",
  "report.mistakesCard.emptyMatch": "No findings in this match — a clean game.",
  "report.mistakesCard.allN": "All {n}",
  "report.mistakesCard.source": "Straight from deterministic rules",
  "report.mistakesCard.emptyOwn": "No findings for you — a clean game.",
  "report.mistakesCard.folded": (p: MessageParams) =>
    `+${p.n} ${plural(p.n, "moment", "moments")} folded — click to expand`,
  "report.mistakesCard.mates": (p: MessageParams) =>
    `Teammates: ${p.n} ${plural(p.n, "moment", "moments")} ${p.toggle}`,
  "report.mistakesCard.collapse": "▲ Collapse",
  "report.mistakesCard.expand": "▼ Expand",
  "report.mistakesCard.sameWave": " + same wave: {list}",

  // ── KpiChips.tsx ──
  "report.kpi.findings": "Findings",
  "report.kpi.majorN": "{n} major",
  "report.kpi.restN": "{n} average",
  "report.kpi.matesN": " · teammates {n}",
  "report.kpi.bursts": "Burst windows",
  "report.kpi.converted": "{done}/{total} converted",
  "report.kpi.kicks": "Interrupts",
  "report.kpi.dispels": "Dispels",
  "report.kpi.passiveN": "+{n} passive",

  // ── MatchArcLine.tsx ──
  "report.arc.early": "Early",
  "report.arc.mid": "Mid",
  "report.arc.late": "Late",
  "report.arc.jumpTurningPoint": "Jump to the turning point at {t}",
  "report.arc.sep": " | ",

  // ── Meters.tsx (glossary report.meter.*) ──
  "report.meters.mode.damage": "Damage",
  "report.meters.mode.healing": "Healing",
  "report.meters.mode.taken": "Damage taken",
  "report.meters.mode.stats": "Stats",
  "report.meters.modeLabel": "Meter mode",

  // ── ReportHeader.tsx ──
  "report.header.result.win": "Victory",
  "report.header.result.loss": "Defeat",
  "report.header.result.draw": "Draw",
  "report.header.finisherTitle": "Replay the finishing moment",
  "report.header.finisher": "Finish",
  "report.header.turning": "Turning point",

  // ── report shell (MatchReport.tsx / ReportSkeleton.tsx) ──
  "report.view.report": "Report",
  "report.view.replay": "Replay",
  "report.view.events": "Events",
  "report.view.video": "Video",
  "report.view.ai": "AI analysis",
  "report.side.recap": "Recap",
  "report.side.chat": "Ask the coach",
  "report.timeRange.label": "Time window",
  "report.timeline.label": "Curves",
  "report.shell.loadingMatch": "Loading match…",
  "report.shell.loadingRound": "Loading round…",

  // ── ShuffleReport.tsx ──
  "report.shuffle.roundOf": "Round {i}/{n}",
  "report.shuffle.title": (p: MessageParams) =>
    `Solo Shuffle · ${p.n} ${plural(p.n, "round", "rounds")} · ${p.result}`,
  "report.shuffle.round": "Round {i}",
  "report.shuffle.won": " · won",
  "report.shuffle.lost": " · lost",

  // ── StatsTable.tsx ──
  "report.statsTable.kicksCast": "Interrupts cast",
  "report.statsTable.kicksTaken": "Interrupted",
  "report.statsTable.ccTaken": "CC taken",
  "report.statsTable.dispels": "Dispels",
  "report.statsTable.purges": "Steals / purges",

  // ── kill / vulnerability windows (TimeRangeBar.tsx / WindowList.tsx / UncoveredHighlightsCard.tsx) ──
  "report.band.burstTo": "Kill attempt → {name}",
  "report.band.vuln": "{name} vulnerable",
  "report.band.vulnUnpunished": "{name} vulnerable and unpunished",
  "report.common.analyzeSpan": "Analyze this span with AI",
  "report.uncoveredCard.title": "Uncovered highlights",
  "report.timeRange.pickTitle": "Pick a window (or drag-select on the curves)",
  "report.timeRange.hint": "Drag-select on the curves to focus a time span",
  "report.windows.aria": "Kill / vulnerability windows",
  "report.windows.teamDamage": "Team damage {k}k",
  "report.windows.teamDamageOnly": "Team damage only {k}k",
  "report.windows.absorbed": " (+{k}k absorbed)",
  "report.windows.replay": "▶ Replay",

  // ── MatchReport.tsx ──
  "report.match.windowAiTitle":
    "Run an AI deep dive on the selected span (the model is not called when there is nothing to coach)",
  "report.match.copyMd": "Copy Markdown",
  "report.match.copyMdTitle":
    "Export the report as Markdown, scoped to the current window",
  "report.match.exportImg": "Export image",
  "report.match.exportImgTitle":
    "Export the report as an image (renders the same page off-screen and captures it whole)",
  "report.match.reportBug": "Report a problem",
  "report.match.reportBugTitle":
    "Bundle this match's raw log + AI call records + your description into a report package",
  "report.match.recapPlaceholder":
    "Click a ✕ on the curves to open the death recap",
  "report.bug.title": "Report a problem — this match",
  "report.bug.hint":
    "Bundles: this match's raw log, the latest AI calls' prompts and replies, and the description below. If it lands in the gladlog-sync folder it uploads automatically.",
  "report.bug.placeholder":
    "What's wrong? For example: the coach blamed me for not dispelling Dragon's Breath, but I was polymorphed at the time",
  "report.bug.sending": "Packaging…",
  "report.bug.submit": "Create report package",
  "report.bug.done": "Created",
  "report.bug.synced": " (in the sync folder, will upload automatically)",
  "report.bug.local": " (saved locally, opened in the file manager)",
  "report.bug.error": "Could not create it — try again later",
  // ── fix round 1: English left in migrated files ──
  "report.dispelCard.col.purges": "Purges",
  "report.header.zone": "Zone {id}",
  "report.shuffle.pillWin": " · W",
  "report.shuffle.pillLoss": " · L",
};
