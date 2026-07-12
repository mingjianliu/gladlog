# gladlog feature backlog

Ideas not yet scheduled. Each is a starting point for a future brainstorm → spec →
plan cycle, not a committed design. Compliance: where an item references the old
fork (`/Users/mingjianliu/code/wowarenalogs`, CC BY-NC-ND) it's for the _concept_
only — any port is clean-room (controller extracts audit-CLEAN files; the app's
data is already gladlog-native).

---

## 1. OBS / video recording integration

Record arena matches (video) and sync playback to the combat-log timeline — click
a death / finding / burst window and jump to that moment in the video.

- **Old-fork reference:** `packages/recorder` (OBS bindings — `manager.ts`,
  `noobs.d.ts`, `activity.ts`, config schema) and the playback UI in
  `packages/shared/src/components/CombatReport/CombatVideo/VideoPlayerTimeline.tsx`
  - `CombatReplay/`. The roadmap explicitly deferred the recorder ("第一版不做"),
    so this is net-new work in gladlog.
- **Scope signals:** largest item here — a recorder subsystem (native OBS/noobs
  integration, Windows-first), on-disk video↔match association, and a
  video-timeline component. Likely its own multi-task sub-project. Decide first:
  drive OBS externally vs. embed a capture lib; how video files map to stored
  matches (by timestamp window).
- **gladlog seam:** the desktop app already stores matches with `startTime`/
  `endTime`; a recording started around a match window can be associated by time.

## 2. Interrupt (kick) dashboard

A per-match (and maybe cross-match) view of interrupts: kicks landed vs. missed,
by player, interrupt availability windows, locked schools, wasted kicks.

- **Already have the data:** `packages/analysis/src/utils/enemyInterrupts.ts`
  (`computeEnemyInterruptAvailability`) + the `[KICK]` timeline events in
  `buildMatchContext`. This is mostly an **aggregation + renderer** on top of
  existing analysis, not new parsing.
- **Scope signals:** small–medium. A new report tab/panel in the desktop
  renderer + a small aggregator in `analysis` (kicks by caster/target, hit/miss,
  interrupt uptime). Reuse the report UI patterns (FindingsList/TimelineStrip).

## 3. Purge / dispel dashboard

A view of offensive purges and dispels: purges done, **missed purge
opportunities** (an enemy buff left up), by player, plus friendly dispels.

- **Already have the data:** `packages/analysis/src/utils/dispelAnalysis.ts` +
  the `[MISSED PURGE OPPORTUNITY]` / `[CLEANSE]` / `[MINOR DISPELS]` timeline
  events in `buildMatchContext`. Again mostly **aggregation + renderer**.
- **Scope signals:** small–medium, parallel to #2 (same shape: aggregator in
  `analysis` + a report panel). Could ship #2 and #3 together as a "utility
  dashboards" sub-project since they share structure.

## 4. Burst-window analysis timeline (visual)

A visual timeline of offensive/burst windows, damage spikes, and healer-exposure
moments — the "bursting window" timeline from the old repo's analysis view.
Today gladlog only renders _deaths_ on `TimelineStrip`; this adds the burst/
pressure lane.

- **Already have the data:** `buildMatchContext` emits `[OFFENSIVE WINDOW]`,
  `[DMG SPIKE]`, `[HEALER EXPOSURE]` via `computePressureWindows`
  (`packages/analysis/src/utils/healerMetrics.ts` / `context/*`). The candidate
  data exists; this is a **timeline visualization** on top.
- **Old-fork reference (concept):**
  `packages/shared/src/components/CombatReport/CombatAIAnalysis/matchTimeline.ts`
  - `TimelineStrip.tsx` (the burst/offensive-window timeline strip) and
    `CombatReplay/` for the scrubbable timeline. gladlog's own `context/matchTimeline*`
    already ports much of the _data_ side.
- **Scope signals:** medium — extend the existing `TimelineStrip` (currently
  deaths-only, `packages/desktop/src/renderer/src/report/components/TimelineStrip.tsx`)
  to render burst/pressure/exposure lanes with hover detail. Ties in with #1
  (video sync) if that ships — the same timeline could scrub the recording.
