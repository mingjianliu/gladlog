import type { MessageParams } from "../index";

const plural = (n: string | number, one: string, many: string): string =>
  Number(n) === 1 ? one : many;

// English dictionary for the match report's components (`report.<card>.*`).
// Terms follow src/shared/i18n/glossary.ts.
export const enReportReplay = {
  // ── ReportOverflowMenu.tsx ──
  "report.overflow.more": "More actions",
  "report.overflow.moreTitle":
    "More actions: copy Markdown / export image / report a problem",

  // ── ReplayZoomControls.tsx / ReplayMapResizer.tsx / ReplaySplitter.tsx ──
  "report.zoom.inTitle":
    "Zoom in (or ⌘/Ctrl + wheel; once zoomed, the plain wheel keeps zooming and dragging pans)",
  "report.zoom.outTitle": "Zoom out",
  "report.zoom.resetTitle": "Reset zoom (or double-click the map)",
  "report.zoom.reset": "⤢ {z}× Reset",
  "report.replay.resizeMap": "Resize the map height",
  "report.replay.resizeSplit": "Resize the map and GCD lanes",

  // ── VideoBattleTimeline.tsx / VideoMomentList.tsx / VideoMomentStrip.tsx ──
  "report.video.battleTimelineAria":
    "Battle timeline (click or drag to seek the recording)",
  "report.video.beforeRecording": "This moment is before the recording starts",
  "report.video.seekMoment": "Go to this moment",
  "report.video.clickToSeek": "{label} (click to seek)",

  // ── shared by the replay / GCD / events views ──
  "report.common.died": "Died",
  "report.common.clickDeathRecap": "Click to open the death recap",
  "report.common.clickToSeek": " (click to seek)",

  // ── GcdSwimlane.tsx ──
  "report.gcd.title": "GCD view · who did what each GCD",
  "report.gcd.legendMajor": "▮ Major cooldown",
  "report.gcd.density.standard": "Standard",
  "report.gcd.density.compact": "Compact",
  "report.gcd.sharedAxis": "Shares the map's clock",
  "report.gcd.bandChipTitle": "Click to seek (map follows)",
  "report.gcd.scrollAria": "GCD lanes (scrollable)",

  // ── ReplayView.tsx ──
  "report.replay.hintKeys":
    "Space play/pause · ← → ±5s · Shift ±1s · ⌘/Ctrl + wheel zoom (once zoomed, the wheel keeps zooming) · double-click resets · the dividers can be dragged (← → once focused)",
  "report.replay.hintLegend":
    "Dashed hollow = the log has no position for this unit yet at this moment (running is not logged; a position only shows up once they cast, get hit or get healed)",
  "report.replay.layout.split": "Map + GCD",
  "report.replay.layout.map": "Map only",
  "report.replay.layout.gcd": "GCD only",
  "report.replay.noPositions":
    "No position data — this match has no advanced combat logging (advancedSamples), so movement cannot be replayed.",
  "report.replay.deathTitle": "{name} died",
  "report.replay.deathClick": " — click to open the death recap",
  "report.replay.bursting": "{name} bursting: {spell}",
  "report.replay.focusFire": (p: MessageParams) =>
    `Focus fire: ${p.n} ${plural(p.n, "player", "players")} hit ${p.name} in the same second`,
  "report.replay.rooted": "{name} rooted: {spell} ({s}s left)",
  "report.replay.ccd": "{name} CC'd: {spell} ({s}s left)",
  "report.replay.ccLeft": "{spell} {s}s",
  "report.replay.unknownPos":
    "{name}: the log has no position for this unit yet at this moment (running is not logged). The dot is drawn where they first entered combat, not where they are now.",
  "report.replay.castBar": "Casting: {spell}",
  "report.replay.castCut": " (cut)",
  "report.replay.burstTag": "Burst",
  "report.replay.dead": "✝ Died {t}",
  "report.replay.pause": "⏸ Pause",
  "report.replay.replayAgain": "↻ Replay",
  "report.replay.play": "▶ Play",
  "report.replay.bandBurst": "Kill attempt on {name} (team damage {k}k)",
  "report.replay.bandVuln":
    "{name} had no major defensive and went unpunished (team damage only {k}k)",
  "report.replay.scrubAria": "Replay timeline",
  "report.replay.dampTitle": "Healing dampening",
  "report.replay.damp": "Dampening {pct}%",
  "report.replay.diveTitle":
    "Run an AI deep dive on the 10s around this moment (dense snapshot)",
  "report.replay.dive": "Deep dive here",
  "report.replay.helpAria": "Shortcuts and legend",

  // ── Timeline.tsx ──
  "report.timeline.metricAria": "Curve metric",
  "report.timeline.metricTitle":
    "HP is drawn as curves; damage / healing / damage taken / healing taken as stacked per-second bars (whole match; a time window only highlights, it does not crop)",
  "report.timeline.bandBurst": "Kill attempt on {name} (team damage {k}k)",
  "report.timeline.bandVuln": "{name} vulnerable and unpunished",
  "report.timeline.clickReplay": " (click to replay)",
  "report.timeline.flowTotal": "{name} — whole-match {metric} {amount}",
  "report.timeline.flowEmpty": "No “{metric}” data in this match",
  "report.timeline.pressure":
    "{from}–{to} {name} under pressure {m}M ({k}k DPS)",
  "report.timeline.pressureClick": " (click to set as the time window)",
  "report.timeline.death": "{name} died @ {s}s",
  "report.timeline.cursor": "Replay {s}s",
  "report.timeline.showAllTitle": "Show every unit's curve",
  "report.timeline.friendlyOnlyTitle":
    "Keep only your team's curves (enemies can still be shown one by one)",
  "report.timeline.friendlyOnly": "Your team only",

  // ── EventsPanel.tsx ──
  "report.eventsPanel.col.time": "Time",
  "report.eventsPanel.col.kind": "Type",
  "report.eventsPanel.col.src": "Source",
  "report.eventsPanel.col.dest": "Target",
  "report.eventsPanel.col.spell": "Spell",
  "report.eventsPanel.col.amount": "Details",
  "report.eventsPanel.sortBy": "Sort by {col}",
  "report.eventsPanel.key": "Key",
  "report.eventsPanel.kindAria": "Filter by type",
  "report.eventsPanel.openRecapTitle": "Open the death recap",
  "report.eventsPanel.openRecap": "▶ Death recap",
  "report.eventsPanel.rawTitle": "Show the raw log line",
  "report.eventsPanel.rawUnavailable":
    "Raw line unavailable (old save without line numbers, or raw.txt missing)",
  "report.eventsPanel.presetsAria": "Event presets",
  "report.eventsPanel.keyTitle": "Damage · interrupts · dispels · deaths",
  "report.eventsPanel.keyN": "Key {n}",
  "report.eventsPanel.allN": "All {n}",
  "report.eventsPanel.anchorTitle":
    "Window anchor: the whole match, or jump to a precomputed window (the same window as the Time column's input below)",
  "report.eventsPanel.custom": "Custom {from}–{to}",
  "report.eventsPanel.global": "Global time window {from}–{to}",
  "report.eventsPanel.trace": "Tracing {name} (source or target)",
  "report.eventsPanel.traceClear": "Clear the traced-unit filter",
  "report.eventsPanel.clearFilters": "Clear filters ({n})",
  "report.eventsPanel.count": (p: MessageParams) =>
    `${p.matched} / ${p.total} ${plural(p.total, "row", "rows")}`,
  "report.eventsPanel.timeAria": "Time window filter, e.g. 0:30-1:10",
  "report.eventsPanel.timeTitle":
    "Empty = whole match. You can also pick a precomputed window from the dropdown above.",
  "report.eventsPanel.srcAria": "Filter by source",
  "report.eventsPanel.destAria": "Filter by target",
  "report.eventsPanel.spellAria": "Filter by spell name",
  "report.eventsPanel.spellPlaceholder": "Spell name…",
  "report.eventsPanel.amountAria": "Minimum amount",
  "report.eventsPanel.amountPlaceholder": "≥ amount",
  "report.eventsPanel.amountTitle":
    "Only rows with an amount at least this large; rows without an amount (casts / auras / deaths) are left out",
  "report.eventsPanel.auraFlood": (p: MessageParams) =>
    `${p.name}: ${p.n} ${plural(p.n, "aura", "auras")} gone at once`,
  "report.eventsPanel.deathClear": "Cleared by death",

  // ── VideoTab.tsx ──
  "report.video.missingHead": (p: MessageParams) =>
    `Missing the first ${p.s} ${plural(p.s, "second", "seconds")}: the recording started after the gates opened, so there is no footage for it`,
  "report.video.playbackFailed":
    "Cannot play this recording (set OBS's recording format to Hybrid MP4)",
  "report.video.noFootage":
    "This round is outside the recording (it had already ended, e.g. OBS stopped early), so there is no footage. The battle timeline below and the moment list on the right come from the combat log and still work.",
  "report.video.controlsAria": "Recording playback controls",
  "report.video.pause": "Pause",
  "report.video.play": "Play",
  "report.video.progressAria": "Playback position (within this round)",
  "report.video.unmute": "Unmute",
  "report.video.mute": "Mute",
  "report.video.fullscreen": "Full screen",
  "report.video.battleTimeline":
    "Battle timeline — click or drag to seek the recording",
  "report.video.tab.feed": "Playback feed",
  "report.video.tab.all": "All moments {n}",
  "report.video.tab.ai": "AI findings {n}",
  "report.video.feedEmpty": "No footage to play — see the “All moments” list.",
  "report.video.aiEmpty":
    "No AI findings yet — run an AI analysis and the timeline findings show up here.",
  "report.video.hint":
    "Marker strip: gold band = burst window, ✕ = death, ⚠ = finding, ✦ = AI finding; click to seek. The battle timeline is the main seek surface; the thin bar in the controls is for fine adjustment.",
  // ── fix round 1: English left in migrated files ──
  "report.eventsPanel.ticks": (p: MessageParams) =>
    `×${p.n} ${plural(p.n, "tick", "ticks")}`,
};
